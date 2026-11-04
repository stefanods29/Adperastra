//! Owned staging for version restore and Save a copy. Existing copy targets
//! remain unavailable until identity-bound recycling is supported (KI-030).

use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use fs_service::SavedInfo;
use version_store::{VersionStore, MAX_SNAPSHOT_BYTES};

fn error_code(error: io::Error) -> String {
    if matches!(error.raw_os_error(), Some(32) | Some(33)) {
        "versions.in_use".to_string()
    } else {
        "versions.other".to_string()
    }
}

#[derive(Debug, PartialEq, Eq)]
struct FileIdentity {
    size: u64,
    modified: Option<SystemTime>,
    #[cfg(windows)]
    object: (u32, u32, u32),
    #[cfg(unix)]
    object: (u64, u64),
}

fn identity(file: &File) -> io::Result<FileIdentity> {
    let metadata = file.metadata()?;
    #[cfg(windows)]
    let object = {
        use std::os::windows::io::AsRawHandle;
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
        };
        let mut info = BY_HANDLE_FILE_INFORMATION::default();
        // SAFETY: this owned file handle and the output structure remain valid
        // throughout the call; no path is reopened to identify the file.
        unsafe { GetFileInformationByHandle(HANDLE(file.as_raw_handle()), &mut info) }
            .map_err(windows_io)?;
        (
            info.dwVolumeSerialNumber,
            info.nFileIndexHigh,
            info.nFileIndexLow,
        )
    };
    #[cfg(unix)]
    let object = {
        use std::os::unix::fs::MetadataExt;
        (metadata.dev(), metadata.ino())
    };
    Ok(FileIdentity {
        size: metadata.len(),
        modified: metadata.modified().ok(),
        #[cfg(any(windows, unix))]
        object,
    })
}

/// Excludes external writers and renames while staging and keeping the undo
/// copy. The existing content-save contract releases it immediately before
/// ReplaceFileW, which preserves the target's attributes and permissions.
struct RestoreTarget {
    file: File,
    identity: FileIdentity,
}

impl RestoreTarget {
    fn open(path: &Path) -> Result<Self, String> {
        let mut options = OpenOptions::new();
        options.read(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(1); // FILE_SHARE_READ only
        }
        let file = options.open(path).map_err(|error| {
            if error.kind() == io::ErrorKind::NotFound {
                "versions.snapshot_failed".to_string()
            } else {
                error_code(error)
            }
        })?;
        let metadata = file.metadata().map_err(error_code)?;
        if !metadata.is_file() || metadata.len() > MAX_SNAPSHOT_BYTES {
            return Err("versions.snapshot_failed".to_string());
        }
        if metadata.permissions().readonly() {
            return Err("versions.read_only".to_string());
        }
        let identity = identity(&file).map_err(error_code)?;
        Ok(Self { file, identity })
    }

    fn verify(&self, path: &Path) -> Result<(), String> {
        let current = File::open(path).map_err(error_code)?;
        if identity(&self.file).map_err(error_code)? != self.identity
            || identity(&current).map_err(error_code)? != self.identity
        {
            return Err("versions.snapshot_failed".to_string());
        }
        Ok(())
    }
}

/// Restore always preserves a bounded undo snapshot, including when ordinary
/// history is disabled. Missing/large/unreadable current files fail untouched.
pub(super) fn restore_version(
    store: &mut VersionStore,
    target: &Path,
    id: i64,
    now_unix: u64,
) -> Result<(i64, SavedInfo), String> {
    let mut session = store.session().map_err(super::store_error_code)?;
    let bytes = session
        .read_bytes_for_path(id, &target.to_string_lossy())
        .map_err(super::store_error_code)?;
    let guard = RestoreTarget::open(target)?;
    let mut staged =
        StagedFile::write(target, |file| file.write_all(&bytes)).map_err(error_code)?;
    let previous_id = session
        .snapshot_current(
            target,
            super::reason_text(super::ModifyReason::Restore),
            now_unix,
        )
        .map_err(|_| "versions.snapshot_failed".to_string())?
        .ok_or_else(|| "versions.snapshot_failed".to_string())?;
    staged.replace_contents(target, guard)?;
    Ok((previous_id, saved_info(target).map_err(error_code)?))
}

pub(super) fn save_copy(target: &Path, bytes: &[u8]) -> Result<SavedInfo, String> {
    save_copy_with(target, |file| file.write_all(bytes), || {})
}

fn save_copy_with(
    target: &Path,
    write: impl FnOnce(&mut File) -> io::Result<()>,
    before_publish: impl FnOnce(),
) -> Result<SavedInfo, String> {
    match target.symlink_metadata() {
        Ok(_) => return Err("versions.replace_unavailable".to_string()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error_code(error)),
    }
    let mut staged = StagedFile::write(target, write).map_err(error_code)?;
    before_publish();
    staged.publish_new(target).map_err(error_code)?;
    drop(staged);
    saved_info(target).map_err(error_code)
}

fn saved_info(target: &Path) -> io::Result<SavedInfo> {
    let metadata = std::fs::metadata(target)?;
    Ok(SavedInfo {
        size: metadata.len(),
        modified_unix: metadata
            .modified()?
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    })
}

struct StagedFile {
    file: Option<File>,
    path: PathBuf,
    identity: FileIdentity,
    published: bool,
}

impl StagedFile {
    fn write(target: &Path, write: impl FnOnce(&mut File) -> io::Result<()>) -> io::Result<Self> {
        let parent = target.parent().ok_or(io::ErrorKind::NotFound)?;
        let path = parent.join(format!("~adp-version-{}.partial", uuid::Uuid::new_v4()));
        let mut options = OpenOptions::new();
        options.read(true).write(true).create_new(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.access_mode(0xc001_0000).share_mode(0); // READ | WRITE | DELETE
        }
        let file = options.open(&path)?;
        let mut staged = Self {
            identity: identity(&file)?,
            file: Some(file),
            path,
            published: false,
        };
        let file = staged.file.as_mut().ok_or(io::ErrorKind::NotFound)?;
        write(file)?;
        file.flush()?;
        file.sync_all()?;
        staged.identity = identity(file)?;
        Ok(staged)
    }

    #[cfg(windows)]
    fn publish_new(&mut self, target: &Path) -> io::Result<()> {
        use std::os::windows::io::AsRawHandle;
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::Storage::FileSystem::{
            FileRenameInfo, SetFileInformationByHandle, FILE_RENAME_INFO,
        };
        let path = wide_path(target)?;
        let offset = std::mem::offset_of!(FILE_RENAME_INFO, FileName);
        let bytes = offset + path.len() * 2;
        let mut storage = vec![0u64; bytes.div_ceil(8)];
        let info = storage.as_mut_ptr().cast::<FILE_RENAME_INFO>();
        let file = self.file.as_ref().ok_or(io::ErrorKind::NotFound)?;
        // SAFETY: the aligned buffer contains the complete terminated filename.
        // ReplaceIfExists remains zero; the exclusive owned handle publishes
        // our staging file and cannot overwrite a concurrently created target.
        unsafe {
            (*info).FileNameLength = ((path.len() - 1) * 2) as u32;
            std::ptr::copy_nonoverlapping(
                path.as_ptr(),
                std::ptr::addr_of_mut!((*info).FileName).cast::<u16>(),
                path.len(),
            );
            SetFileInformationByHandle(
                HANDLE(file.as_raw_handle()),
                FileRenameInfo,
                info.cast(),
                bytes as u32,
            )
        }
        .map_err(windows_io)?;
        self.published = true;
        Ok(())
    }

    #[cfg(not(windows))]
    fn publish_new(&mut self, target: &Path) -> io::Result<()> {
        fs_service::move_without_replacing(&self.path, target).map_err(|error| match error {
            fs_service::FsError::Io(error) => error,
            _ => io::Error::other(error.to_string()),
        })?;
        self.published = true;
        Ok(())
    }

    fn replace_contents(&mut self, target: &Path, guard: RestoreTarget) -> Result<(), String> {
        #[cfg(windows)]
        let target_wide = wide_path(target).map_err(error_code)?;
        #[cfg(windows)]
        let replacement = wide_path(&self.path).map_err(error_code)?;
        guard.verify(target)?;
        drop(guard);
        // ReplaceFileW requires reopening the replacement with delete access.
        // The randomly named staging file is already complete and flushed.
        drop(self.file.take());
        #[cfg(windows)]
        {
            use windows::core::PCWSTR;
            use windows::Win32::Storage::FileSystem::{
                ReplaceFileW, REPLACEFILE_IGNORE_MERGE_ERRORS,
            };
            // SAFETY: both terminated path buffers outlive the call. This is
            // the explicit content-save replacement contract, with no recycle.
            unsafe {
                ReplaceFileW(
                    PCWSTR(target_wide.as_ptr()),
                    PCWSTR(replacement.as_ptr()),
                    PCWSTR::null(),
                    REPLACEFILE_IGNORE_MERGE_ERRORS,
                    None,
                    None,
                )
            }
            .map_err(windows_io)
            .map_err(error_code)?;
        }
        #[cfg(not(windows))]
        std::fs::rename(&self.path, target).map_err(error_code)?;
        self.published = true;
        Ok(())
    }
}

#[cfg(windows)]
fn windows_io(error: windows::core::Error) -> io::Error {
    io::Error::from_raw_os_error((error.code().0 as u32 & 0xffff) as i32)
}

#[cfg(windows)]
fn wide_path(path: &Path) -> io::Result<Vec<u16>> {
    use std::os::windows::ffi::OsStrExt;
    let parent = std::fs::canonicalize(path.parent().ok_or(io::ErrorKind::NotFound)?)?;
    let absolute = parent.join(path.file_name().ok_or(io::ErrorKind::NotFound)?);
    Ok(absolute.as_os_str().encode_wide().chain([0]).collect())
}

impl Drop for StagedFile {
    fn drop(&mut self) {
        if self.published {
            return;
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            use std::os::windows::io::AsRawHandle;
            use windows::Win32::Foundation::HANDLE;
            use windows::Win32::Storage::FileSystem::{
                FileDispositionInfo, SetFileInformationByHandle, FILE_DISPOSITION_INFO,
            };
            let reopened = if self.file.is_none() {
                OpenOptions::new()
                    .read(true)
                    .access_mode(0x8001_0000)
                    .share_mode(0)
                    .open(&self.path)
                    .ok()
            } else {
                None
            };
            if let Some(file) = self.file.as_ref().or(reopened.as_ref()) {
                if identity(file).is_ok_and(|identity| identity.object == self.identity.object) {
                    let info = FILE_DISPOSITION_INFO { DeleteFile: true };
                    // SAFETY: deletion uses the still-owned staging handle;
                    // a different file at the old path is never removed.
                    let _ = unsafe {
                        SetFileInformationByHandle(
                            HANDLE(file.as_raw_handle()),
                            FileDispositionInfo,
                            (&info as *const FILE_DISPOSITION_INFO).cast(),
                            std::mem::size_of_val(&info) as u32,
                        )
                    };
                }
            }
        }
        #[cfg(not(windows))]
        if File::open(&self.path)
            .and_then(|file| identity(&file))
            .is_ok_and(|identity| identity.object == self.identity.object)
        {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

#[cfg(test)]
#[path = "version_files_tests.rs"]
mod tests;
