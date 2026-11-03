//! Measured physical bytes and deletion of the recorded native object.
use crate::CacheError;
use std::fs::{File, OpenOptions};
use std::path::Path;

const MAX_SCAN_FILES: usize = 200_000;
const MAX_SCAN_DEPTH: usize = 32;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct BlobIdentity {
    pub volume: u64,
    pub index: u64,
}

pub(crate) fn physical_bytes(root: &Path) -> Result<u64, CacheError> {
    fn walk(path: &Path, depth: usize, seen: &mut usize) -> Result<u64, CacheError> {
        if depth > MAX_SCAN_DEPTH {
            return Err(CacheError::Unavailable);
        }
        let mut total = 0u64;
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            *seen += 1;
            if *seen > MAX_SCAN_FILES {
                return Err(CacheError::Unavailable);
            }
            let metadata = std::fs::symlink_metadata(entry.path())?;
            if is_reparse(&metadata) {
                return Err(CacheError::Unavailable);
            }
            let bytes = if metadata.is_dir() {
                walk(&entry.path(), depth + 1, seen)?
            } else if metadata.is_file() {
                metadata.len()
            } else {
                return Err(CacheError::Unavailable);
            };
            total = total.checked_add(bytes).ok_or(CacheError::Unavailable)?;
        }
        Ok(total)
    }
    walk(root, 0, &mut 0)
}

pub(crate) fn require_directory(path: &Path) -> Result<(), CacheError> {
    let metadata = std::fs::symlink_metadata(path)?;
    if !metadata.is_dir() || is_reparse(&metadata) {
        return Err(CacheError::Unavailable);
    }
    Ok(())
}

fn is_reparse(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

pub(crate) fn identity(file: &File) -> Result<BlobIdentity, CacheError> {
    let metadata = file.metadata()?;
    if !metadata.is_file() || is_reparse(&metadata) {
        return Err(CacheError::Unavailable);
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows::Win32::{
            Foundation::HANDLE,
            Storage::FileSystem::{GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION},
        };
        let mut info = BY_HANDLE_FILE_INFORMATION::default();
        // SAFETY: owned live handle and correctly sized writable structure.
        unsafe { GetFileInformationByHandle(HANDLE(file.as_raw_handle()), &mut info) }
            .map_err(|_| CacheError::Unavailable)?;
        if info.nNumberOfLinks != 1 || info.dwFileAttributes & 0x400 != 0 {
            return Err(CacheError::Unavailable);
        }
        Ok(BlobIdentity {
            volume: u64::from(info.dwVolumeSerialNumber),
            index: (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow),
        })
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err(CacheError::Unavailable);
        }
        Ok(BlobIdentity {
            volume: metadata.dev(),
            index: metadata.ino(),
        })
    }
    #[cfg(not(any(windows, unix)))]
    {
        Err(CacheError::Unavailable)
    }
}

pub(crate) fn open_reading(path: &Path) -> Result<File, CacheError> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows::Win32::Storage::FileSystem::{
            FILE_FLAG_OPEN_NO_RECALL, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
        };
        options
            .share_mode(FILE_SHARE_READ.0)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0 | FILE_FLAG_OPEN_NO_RECALL.0);
    }
    let file = options.open(path)?;
    identity(&file)?;
    Ok(file)
}

/// Pin the database object without conflicting with SQLite's live writers.
pub(crate) fn open_index_guard(path: &Path) -> Result<File, CacheError> {
    let mut options = OpenOptions::new();
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows::Win32::Storage::FileSystem::{
            FILE_FLAG_OPEN_NO_RECALL, FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ, FILE_SHARE_WRITE,
        };
        options
            .access_mode(FILE_READ_ATTRIBUTES.0)
            .share_mode((FILE_SHARE_READ | FILE_SHARE_WRITE).0)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0 | FILE_FLAG_OPEN_NO_RECALL.0);
    }
    #[cfg(not(windows))]
    options.read(true);
    let file = options.open(path)?;
    identity(&file)?;
    Ok(file)
}

#[cfg(windows)]
fn open_deleting(path: &Path) -> std::io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows::Win32::Storage::FileSystem::{
        DELETE, FILE_FLAG_OPEN_NO_RECALL, FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES,
        FILE_SHARE_NONE,
    };
    OpenOptions::new()
        .access_mode(DELETE.0 | FILE_READ_ATTRIBUTES.0)
        .share_mode(FILE_SHARE_NONE.0)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0 | FILE_FLAG_OPEN_NO_RECALL.0)
        .open(path)
}

pub(crate) fn is_leased(path: &Path) -> bool {
    #[cfg(windows)]
    {
        match open_deleting(path) {
            Ok(_) => false,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
            Err(_) => true,
        }
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        true
    }
}

pub(crate) fn remove_owned(path: &Path, expected: BlobIdentity) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows::Win32::{
            Foundation::HANDLE,
            Storage::FileSystem::{
                FileDispositionInfo, SetFileInformationByHandle, FILE_DISPOSITION_INFO,
            },
        };
        let file = match open_deleting(path) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return true,
            Err(_) => return false,
        };
        if identity(&file).ok() != Some(expected) {
            return false;
        }
        let info = FILE_DISPOSITION_INFO { DeleteFile: true };
        // SAFETY: exclusive owned handle verified against persisted identity;
        // deletion acts on this handle, never a re-opened/replaced pathname.
        unsafe {
            SetFileInformationByHandle(
                HANDLE(file.as_raw_handle()),
                FileDispositionInfo,
                (&info as *const FILE_DISPOSITION_INFO).cast(),
                std::mem::size_of_val(&info) as u32,
            )
        }
        .is_ok()
    }
    #[cfg(not(windows))]
    {
        let _ = (path, expected);
        false
    }
}
