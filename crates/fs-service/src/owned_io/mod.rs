//! Owned I/O for new app output (Step 06e D5). Nothing here is shared with
//! the older save/extract code: a pinned directory chain, guarded source
//! handles and an exclusively created staging file that publishes without
//! replacing anything. Cancellation and failures dispose only the owned
//! handle, never a guessed path.

use std::path::{Path, PathBuf};

use thiserror::Error;

mod directory;
mod output;
mod source;

pub use directory::PinnedDirectory;
pub use output::OwnedOutput;
pub use source::{PinnedSource, SourceIdentity};

/// The most directory components one pinned chain may hold.
pub const MAX_PINNED_COMPONENTS: usize = 256;

/// Why owned I/O refused to continue. The archive layer turns these into
/// `archive.*` codes; no user text is built here.
#[derive(Debug, Error)]
pub enum OwnedIoError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    /// The file under a path is no longer the file that was enumerated.
    #[error("the source changed")]
    SourceChanged,
    /// A link or reparse point where a real folder or file is required.
    #[error("a link cannot be used here")]
    ReparseRefused,
    /// The random staging name already belongs to another item.
    #[error("the staging name is taken")]
    StagingTaken,
    /// The publication target appeared while the output was being written.
    #[error("the target already exists")]
    TargetExists,
    /// The prepared output could not be verified before publication.
    #[error("the output changed")]
    OutputChanged,
    /// A name is not a single, valid path component.
    #[error("the name is not valid")]
    InvalidName,
}

pub type OwnedIoResult<T> = std::result::Result<T, OwnedIoError>;

/// A path is a single component that Windows accepts as a new name.
pub(crate) fn validate_component(name: &str) -> OwnedIoResult<()> {
    let invalid = name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
        || name.contains(':')
        || name.chars().any(|character| character == '\0');
    if invalid || crate::validate_new_name(name).is_err() {
        return Err(OwnedIoError::InvalidName);
    }
    Ok(())
}

/// A bounded, harmless hint taken from a wanted name (`notes.txt`).
pub(crate) fn hint_of(hint: &str) -> String {
    let mut text = String::new();
    for character in hint.chars() {
        if text.len() >= 32 {
            break;
        }
        if character.is_ascii_alphanumeric() || character == '.' || character == '-' {
            text.push(character);
        }
    }
    if text.is_empty() {
        "output".to_string()
    } else {
        text
    }
}

/// `~adp-<hint>-<uuid>.partial`: random, next to the target, recognizably
/// ours.
pub(crate) fn staging_name(hint: &str) -> String {
    format!("~adp-{}-{}.partial", hint_of(hint), uuid::Uuid::new_v4())
}

/// The volume and file index of an open file: its identity across a path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct FileIdentity {
    pub(crate) volume: u32,
    pub(crate) index: u64,
}

#[cfg(windows)]
pub(crate) fn handle_identity(file: &std::fs::File) -> std::io::Result<FileIdentity> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    };
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    // SAFETY: the caller's handle and the output structure outlive the call.
    unsafe { GetFileInformationByHandle(HANDLE(file.as_raw_handle()), &mut info) }
        .map_err(windows_io)?;
    Ok(FileIdentity {
        volume: info.dwVolumeSerialNumber,
        index: (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow),
    })
}

#[cfg(not(windows))]
pub(crate) fn handle_identity(file: &std::fs::File) -> std::io::Result<FileIdentity> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let metadata = file.metadata()?;
        Ok(FileIdentity {
            volume: metadata.dev() as u32,
            index: metadata.ino(),
        })
    }
    #[cfg(not(unix))]
    {
        let _ = file;
        Ok(FileIdentity {
            volume: 0,
            index: 0,
        })
    }
}

/// The attributes Windows stores on the very handle that was opened (so a
/// reparse point is seen as a reparse point, never followed).
#[cfg(windows)]
pub(crate) fn handle_attributes(file: &std::fs::File) -> std::io::Result<u32> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    };
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    // SAFETY: same owned handle, correctly sized output.
    unsafe { GetFileInformationByHandle(HANDLE(file.as_raw_handle()), &mut info) }
        .map_err(windows_io)?;
    Ok(info.dwFileAttributes)
}

#[cfg(not(windows))]
pub(crate) fn handle_attributes(file: &std::fs::File) -> std::io::Result<u32> {
    Ok(if file.metadata()?.file_type().is_symlink() {
        0x400
    } else {
        0
    })
}

/// True for a link or junction: those are never written through.
pub(crate) fn is_reparse(file: &std::fs::File) -> std::io::Result<bool> {
    #[cfg(windows)]
    {
        use windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        Ok(handle_attributes(file)? & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0)
    }
    #[cfg(not(windows))]
    {
        Ok(handle_attributes(file)? & 0x400 != 0)
    }
}

/// The exact path a handle refers to, with the long-path prefix removed.
#[cfg(windows)]
pub(crate) fn handle_path(file: &std::fs::File) -> std::io::Result<PathBuf> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{GetFinalPathNameByHandleW, FILE_NAME_NORMALIZED};
    let mut buffer = vec![0u16; 512];
    loop {
        // SAFETY: the handle stays alive and `buffer` is writable.
        let written = unsafe {
            GetFinalPathNameByHandleW(
                HANDLE(file.as_raw_handle()),
                &mut buffer,
                FILE_NAME_NORMALIZED,
            )
        } as usize;
        if written == 0 {
            return Err(std::io::Error::last_os_error());
        }
        if written < buffer.len() {
            let text = OsString::from_wide(&buffer[..written]);
            let text = text.to_string_lossy();
            return Ok(PathBuf::from(text.trim_start_matches(r"\\?\").to_string()));
        }
        if written > crate::MAX_PATH_INPUT + 1 {
            return Err(std::io::ErrorKind::InvalidInput.into());
        }
        buffer.resize(written + 1, 0);
    }
}

#[cfg(not(windows))]
pub(crate) fn handle_path(file: &std::fs::File) -> std::io::Result<PathBuf> {
    let _ = file;
    Err(std::io::ErrorKind::Unsupported.into())
}

/// Two Windows paths naming the same place (case-insensitive text).
pub(crate) fn same_place(left: &Path, right: &Path) -> bool {
    let text = |path: &Path| {
        path.to_string_lossy()
            .trim_start_matches(r"\\?\")
            .replace('/', "\\")
            .to_lowercase()
    };
    text(left) == text(right)
}

#[cfg(windows)]
fn windows_io(error: windows::core::Error) -> std::io::Error {
    std::io::Error::from_raw_os_error((error.code().0 as u32 & 0xffff) as i32)
}
