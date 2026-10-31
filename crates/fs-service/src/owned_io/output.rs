//! One new file, created exclusively below a pinned folder and published
//! without replacing anything (Step 06e D5).
//!
//! The staging file carries a random name next to its target and is held
//! with exclusive sharing. A failure or cancellation disposes of exactly
//! this handle; publication is a no-replace rename of the same handle.

use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use super::{
    handle_identity, is_reparse, staging_name, validate_component, FileIdentity, OwnedIoError,
    OwnedIoResult, PinnedDirectory,
};

/// A file this operation alone owns until it is published or dropped.
pub struct OwnedOutput {
    file: Option<File>,
    directory: PathBuf,
    staging: PathBuf,
    identity: FileIdentity,
    published: bool,
}

impl OwnedOutput {
    /// Create a staging file with a random name derived from `hint`.
    pub fn create(directory: &PinnedDirectory, hint: &str) -> OwnedIoResult<Self> {
        Self::create_named(directory, &staging_name(hint))
    }

    /// The same, with the staging name given (tests inject it). A name that
    /// already exists creates nothing at all: there is no owned file to
    /// clean up and nothing else is touched.
    pub fn create_named(directory: &PinnedDirectory, name: &str) -> OwnedIoResult<Self> {
        validate_component(name)?;
        let staging = directory.path().join(name);
        let file = open_staging(&staging).map_err(|error| {
            if error.kind() == io::ErrorKind::AlreadyExists {
                OwnedIoError::StagingTaken
            } else {
                OwnedIoError::Io(error)
            }
        })?;
        if is_reparse(&file)? {
            return Err(OwnedIoError::ReparseRefused);
        }
        let identity = handle_identity(&file)?;
        Ok(Self {
            file: Some(file),
            directory: directory.path().to_path_buf(),
            staging,
            identity,
            published: false,
        })
    }

    pub fn file_mut(&mut self) -> &mut File {
        self.file.as_mut().expect("owned output until publication")
    }

    /// Where the file is while it is written.
    pub fn staging_path(&self) -> &Path {
        &self.staging
    }

    /// Flush the buffers and ask the disk to keep them.
    pub fn flush_sync(&mut self) -> OwnedIoResult<()> {
        self.flush_sync_with(|file| {
            file.flush()?;
            file.sync_all()
        })
    }

    /// The same with the final step supplied, so a test can make it fail.
    pub fn flush_sync_with(
        &mut self,
        finish: impl FnOnce(&mut File) -> io::Result<()>,
    ) -> OwnedIoResult<()> {
        let file = self.file.as_mut().expect("owned output until publication");
        finish(file)?;
        Ok(())
    }

    /// Rename the still-owned file to `name` inside the pinned folder. The
    /// target must not exist; a name that arrived meanwhile is left alone.
    pub fn publish_name(&mut self, name: &str) -> OwnedIoResult<PathBuf> {
        validate_component(name)?;
        let file = self.file.as_ref().expect("owned output until publication");
        if handle_identity(file)? != self.identity {
            return Err(OwnedIoError::OutputChanged);
        }
        let target = self.directory.join(name);
        publish(file, &self.staging, &target)?;
        self.published = true;
        Ok(target)
    }
}

impl Drop for OwnedOutput {
    fn drop(&mut self) {
        if self.published {
            return;
        }
        if let Some(file) = self.file.as_ref() {
            dispose(file);
        }
    }
}

#[cfg(windows)]
fn open_staging(path: &Path) -> io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows::Win32::Foundation::{GENERIC_READ, GENERIC_WRITE};
    use windows::Win32::Storage::FileSystem::{
        DELETE, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_NONE,
    };
    OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .access_mode(GENERIC_READ.0 | GENERIC_WRITE.0 | DELETE.0)
        .share_mode(FILE_SHARE_NONE.0)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(path)
}

#[cfg(not(windows))]
fn open_staging(path: &Path) -> io::Result<File> {
    OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(path)
}

/// A no-replace rename of the handle we already own.
#[cfg(windows)]
fn publish(file: &File, _staging: &Path, target: &Path) -> OwnedIoResult<()> {
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        FileRenameInfo, SetFileInformationByHandle, FILE_RENAME_INFO,
    };
    let name: Vec<u16> = target.as_os_str().encode_wide().chain([0]).collect();
    let offset = std::mem::offset_of!(FILE_RENAME_INFO, FileName);
    let bytes = offset + name.len() * 2;
    let mut storage = vec![0u64; bytes.div_ceil(8)];
    let info = storage.as_mut_ptr().cast::<FILE_RENAME_INFO>();
    // SAFETY: the aligned buffer holds the header and one terminated
    // absolute name. ReplaceIfExists stays zero, so an arriving target is
    // never replaced, and RootDirectory is null (absolute name).
    let result = unsafe {
        (*info).FileNameLength = ((name.len() - 1) * 2) as u32;
        std::ptr::copy_nonoverlapping(
            name.as_ptr(),
            std::ptr::addr_of_mut!((*info).FileName).cast::<u16>(),
            name.len(),
        );
        SetFileInformationByHandle(
            HANDLE(file.as_raw_handle()),
            FileRenameInfo,
            info.cast(),
            bytes as u32,
        )
    };
    match result {
        Ok(()) => Ok(()),
        Err(error) => {
            let code = error.code().0 as u32 & 0xffff;
            // ERROR_FILE_EXISTS / ERROR_ALREADY_EXISTS
            if code == 80 || code == 183 {
                Err(OwnedIoError::TargetExists)
            } else {
                Err(OwnedIoError::Io(io::Error::from_raw_os_error(code as i32)))
            }
        }
    }
}

#[cfg(not(windows))]
fn publish(_file: &File, staging: &Path, target: &Path) -> OwnedIoResult<()> {
    if target.symlink_metadata().is_ok() {
        return Err(OwnedIoError::TargetExists);
    }
    crate::move_without_replacing(staging, target)
        .map_err(|error| OwnedIoError::Io(io::Error::other(error.to_string())))
}

/// Mark the owned handle for deletion when it closes. A failure leaves our
/// staging file; it never removes a path we do not own.
#[cfg(windows)]
fn dispose(file: &File) {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        FileDispositionInfo, SetFileInformationByHandle, FILE_DISPOSITION_INFO,
    };
    let info = FILE_DISPOSITION_INFO { DeleteFile: true };
    // SAFETY: the handle is still exclusive and refers to our staging file.
    let _ = unsafe {
        SetFileInformationByHandle(
            HANDLE(file.as_raw_handle()),
            FileDispositionInfo,
            (&info as *const FILE_DISPOSITION_INFO).cast(),
            std::mem::size_of_val(&info) as u32,
        )
    };
}

#[cfg(not(windows))]
fn dispose(file: &File) {
    let _ = file;
}
