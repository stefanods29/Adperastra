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
    handle_identity, hint_of, is_reparse, staging_name, validate_component, FileIdentity,
    OwnedIoError, OwnedIoResult, PinnedDirectory,
};

/// The most folder entries one orphan cleanup looks at.
const MAX_ORPHAN_SCAN: usize = 200_000;

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

    /// Keep the staging file after this value is dropped. The helper uses
    /// this for its verified spool, which the parent reads next.
    pub fn keep(&mut self) {
        self.published = true;
    }

    /// Close the finished file so `ReplaceFileW` can open it itself. The
    /// result still knows which file it wrote, so later cleanup never touches
    /// another file that took the name.
    pub fn close(mut self) -> ClosedOutput {
        self.published = true;
        drop(self.file.take());
        ClosedOutput {
            path: self.staging.clone(),
            identity: self.identity,
        }
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

/// A finished staging file whose handle was closed. Dropping it leaves the
/// file on disk: it may hold the only copy of the user's content.
pub struct ClosedOutput {
    path: PathBuf,
    identity: FileIdentity,
}

impl ClosedOutput {
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Remove the file, only if it is still the one this operation wrote.
    pub fn dispose(self) -> OwnedIoResult<()> {
        let file = self.reopen()?;
        dispose(&file);
        Ok(())
    }

    /// Publish the file at `target` without replacing anything.
    pub fn publish_to(self, target: &Path) -> OwnedIoResult<()> {
        let file = self.reopen()?;
        publish(&file, &self.path, target)
    }

    fn reopen(&self) -> OwnedIoResult<File> {
        let file = reopen_staging(&self.path)?;
        if is_reparse(&file)? || handle_identity(&file)? != self.identity {
            return Err(OwnedIoError::OutputChanged);
        }
        Ok(file)
    }
}

/// Remove staging files that a killed helper left for `target`. Only names
/// this app makes (`~adp-<hint>-<uuid>.partial`) qualify, and only regular
/// files nobody holds: a live operation keeps its file open exclusively.
/// Returns how many were removed.
pub fn dispose_orphaned_staging(target: &Path) -> usize {
    let (Some(parent), Some(name)) = (target.parent(), target.file_name()) else {
        return 0;
    };
    let prefix = format!("~adp-{}-", hint_of(&name.to_string_lossy()));
    let Ok(entries) = std::fs::read_dir(parent) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten().take(MAX_ORPHAN_SCAN) {
        let entry_name = entry.file_name().to_string_lossy().into_owned();
        let random = entry_name
            .strip_prefix(&prefix)
            .and_then(|rest| rest.strip_suffix(".partial"));
        if !random.is_some_and(|text| uuid::Uuid::try_parse(text).is_ok()) {
            continue;
        }
        let Ok(file) = reopen_staging(&entry.path()) else {
            continue;
        };
        if !matches!(is_reparse(&file), Ok(false)) || !file.metadata().is_ok_and(|m| m.is_file()) {
            continue;
        }
        dispose(&file);
        removed += 1;
    }
    removed
}

/// Open a finished staging file again, alone, with the access a rename or a
/// delete needs. Links are opened as themselves, never followed.
#[cfg(windows)]
fn reopen_staging(path: &Path) -> io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows::Win32::Storage::FileSystem::{
        DELETE, FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES, FILE_SHARE_NONE,
    };
    OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES.0 | DELETE.0)
        .share_mode(FILE_SHARE_NONE.0)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(path)
}

#[cfg(not(windows))]
fn reopen_staging(path: &Path) -> io::Result<File> {
    File::open(path)
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
