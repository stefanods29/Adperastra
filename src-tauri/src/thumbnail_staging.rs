//! Handle-bound validation for the exact staging file created by the parent.
use fs_service::owned_io::PinnedDirectory;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::path::{Path, PathBuf};
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StagingIdentity {
    volume: u32,
    index: String,
}

/// The kernel owns crash cleanup from exclusive creation through the last read.
pub struct GuardedStaging {
    pub path: PathBuf,
    pub identity: StagingIdentity,
    _guard: File,
    _directory: PinnedDirectory,
}
impl GuardedStaging {
    pub fn create_reserved(directory: &Path, bytes: u64) -> Result<Self, String> {
        let staging = Self::create(directory)?;
        let writer = open_staging_for_write(&staging.path, &staging.identity)?;
        writer
            .set_len(bytes)
            .map_err(|_| "thumbnail.failed".to_string())?;
        writer
            .sync_all()
            .map_err(|_| "thumbnail.failed".to_string())?;
        drop(writer);
        Ok(staging)
    }
    #[cfg(windows)]
    pub fn create(directory: &Path) -> Result<Self, String> {
        use std::os::windows::fs::OpenOptionsExt;
        use windows::Win32::Storage::FileSystem::{
            DELETE, FILE_FLAG_DELETE_ON_CLOSE, FILE_FLAG_OPEN_NO_RECALL,
            FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE,
        };
        let directory =
            PinnedDirectory::open(directory).map_err(|_| "thumbnail.failed".to_string())?;
        let path = directory
            .path()
            .join(format!("~adp-thumbnail-{}.partial", uuid::Uuid::new_v4()));
        // write(true) permits CREATE_NEW in std's option validation; access_mode
        // overrides actual access to DELETE/attributes, with no data-write right.
        // The guard denies renames/deletion while allowing the child writer.
        let guard = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .access_mode(DELETE.0 | FILE_READ_ATTRIBUTES.0)
            .share_mode((FILE_SHARE_READ | FILE_SHARE_WRITE).0)
            .custom_flags(
                FILE_FLAG_DELETE_ON_CLOSE.0
                    | FILE_FLAG_OPEN_REPARSE_POINT.0
                    | FILE_FLAG_OPEN_NO_RECALL.0,
            )
            .open(&path)
            .map_err(|_| "thumbnail.failed".to_string())?;
        let identity = file_identity(&guard)?;
        Ok(Self {
            path,
            identity,
            _guard: guard,
            _directory: directory,
        })
    }
    #[cfg(not(windows))]
    pub fn create(_directory: &Path) -> Result<Self, String> {
        Err("thumbnail.failed".into())
    }
}

pub fn is_owned_staging_path(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.strip_prefix("~adp-thumbnail-"))
        .and_then(|name| name.strip_suffix(".partial"))
        .is_some_and(|id| uuid::Uuid::try_parse(id).is_ok())
}

#[cfg(windows)]
pub fn file_identity(file: &File) -> Result<StagingIdentity, String> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_REPARSE_POINT,
    };
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    // SAFETY: the File owns a live handle and info is valid output storage.
    unsafe { GetFileInformationByHandle(HANDLE(file.as_raw_handle()), &mut info) }
        .map_err(|_| "thumbnail.failed".to_string())?;
    if info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 || info.nNumberOfLinks != 1 {
        return Err("thumbnail.failed".to_string());
    }
    Ok(StagingIdentity {
        volume: info.dwVolumeSerialNumber,
        index: format!(
            "{:016x}",
            (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow)
        ),
    })
}

#[cfg(not(windows))]
pub fn file_identity(_file: &File) -> Result<StagingIdentity, String> {
    Err("thumbnail.failed".into())
}

#[cfg(windows)]
pub fn open_staging_for_write(path: &Path, expected: &StagingIdentity) -> Result<File, String> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows::Win32::Storage::FileSystem::{
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE, FILE_SHARE_READ,
    };
    // Do not truncate before checking the opened object's identity.
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(false)
        .share_mode((FILE_SHARE_READ | FILE_SHARE_DELETE).0)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(path)
        .map_err(|_| "thumbnail.failed".to_string())?;
    if file_identity(&file)? != *expected
        || !file.metadata().is_ok_and(|m| {
            m.is_file() && (m.len() == 0 || m.len() == crate::thumbnail_encode::MAX_OUTPUT_BYTES)
        })
    {
        return Err("thumbnail.failed".to_string());
    }
    Ok(file)
}

#[cfg(not(windows))]
pub fn open_staging_for_write(_path: &Path, _expected: &StagingIdentity) -> Result<File, String> {
    Err("thumbnail.failed".into())
}

#[cfg(windows)]
pub fn open_staged_read(path: &Path) -> Result<File, String> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows::Win32::Foundation::GENERIC_READ;
    use windows::Win32::Storage::FileSystem::{
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE, FILE_SHARE_READ,
    };
    std::fs::OpenOptions::new()
        .access_mode(GENERIC_READ.0)
        .share_mode((FILE_SHARE_READ | FILE_SHARE_DELETE).0)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(path)
        .map_err(|_| "thumbnail.failed".to_string())
}

#[cfg(not(windows))]
pub fn open_staged_read(_path: &Path) -> Result<File, String> {
    Err("thumbnail.failed".into())
}

#[cfg(test)]
#[path = "thumbnail_staging_tests.rs"]
mod tests;
