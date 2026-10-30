//! Remove the exact source of a move only after comparing it with the copy.

use crate::{CancellationToken, FsError, Result};
#[cfg(windows)]
use std::fs;
#[cfg(windows)]
use std::io::Read;
use std::path::Path;

#[cfg(windows)]
#[derive(PartialEq, Eq)]
pub(super) struct Snapshot {
    volume: u32,
    index: u64,
    attributes: u32,
    created: u64,
    modified: u64,
    size: u64,
}

#[cfg(windows)]
pub(super) fn snapshot(file: &fs::File) -> Result<Snapshot> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_REPARSE_POINT,
    };
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    unsafe { GetFileInformationByHandle(HANDLE(file.as_raw_handle()), &mut info) }
        .map_err(crate::winpath::win32_error)?;
    if info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 {
        return Err(FsError::Io(std::io::ErrorKind::Unsupported.into()));
    }
    let pair = |high: u32, low: u32| (u64::from(high) << 32) | u64::from(low);
    Ok(Snapshot {
        volume: info.dwVolumeSerialNumber,
        index: pair(info.nFileIndexHigh, info.nFileIndexLow),
        attributes: info.dwFileAttributes,
        created: pair(
            info.ftCreationTime.dwHighDateTime,
            info.ftCreationTime.dwLowDateTime,
        ),
        modified: pair(
            info.ftLastWriteTime.dwHighDateTime,
            info.ftLastWriteTime.dwLowDateTime,
        ),
        size: pair(info.nFileSizeHigh, info.nFileSizeLow),
    })
}

#[cfg(not(windows))]
#[derive(PartialEq, Eq)]
pub(super) struct Snapshot;
#[cfg(not(windows))]
pub(super) fn snapshot(_file: &std::fs::File) -> Result<Snapshot> {
    Err(FsError::Io(std::io::ErrorKind::Unsupported.into()))
}

#[cfg(windows)]
pub(super) fn remove_if_matches(
    source_path: &Path,
    destination_path: &Path,
    expected: &Snapshot,
    token: &CancellationToken,
) -> Result<()> {
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    use std::os::windows::io::AsRawHandle;
    use std::sync::atomic::Ordering;
    use windows::Win32::Foundation::{GENERIC_READ, HANDLE};
    use windows::Win32::Storage::FileSystem::{
        FileDispositionInfoEx, SetFileInformationByHandle, DELETE, FILE_ATTRIBUTE_REPARSE_POINT,
        FILE_DISPOSITION_FLAG_DELETE, FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE,
        FILE_DISPOSITION_INFO_EX, FILE_DISPOSITION_INFO_EX_FLAGS, FILE_FLAG_OPEN_REPARSE_POINT,
        FILE_SHARE_READ,
    };

    // Deny writes, renames and deletes for both files until the comparison
    // and the handle-based source deletion are complete.
    let mut source = fs::OpenOptions::new()
        .read(true)
        .access_mode(GENERIC_READ.0 | DELETE.0)
        .share_mode(FILE_SHARE_READ.0)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(source_path)?;
    let mut destination = fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ.0)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(destination_path)?;
    if source.metadata()?.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0
        || destination.metadata()?.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0
    {
        return Err(FsError::Io(std::io::ErrorKind::Unsupported.into()));
    }
    if snapshot(&source)? != *expected {
        return Err(FsError::Io(std::io::ErrorKind::Other.into()));
    }
    if source.metadata()?.len() != destination.metadata()?.len() {
        return Err(FsError::Io(std::io::ErrorKind::Other.into()));
    }
    let mut left = vec![0; super::CHUNK];
    let mut right = vec![0; super::CHUNK];
    loop {
        if token.load(Ordering::Relaxed) {
            return Err(FsError::Cancelled);
        }
        let n = source.read(&mut left)?;
        destination.read_exact(&mut right[..n])?;
        if left[..n] != right[..n] {
            return Err(FsError::Io(std::io::ErrorKind::Other.into()));
        }
        if n == 0 {
            break;
        }
    }
    let disposition = FILE_DISPOSITION_INFO_EX {
        Flags: FILE_DISPOSITION_INFO_EX_FLAGS(
            FILE_DISPOSITION_FLAG_DELETE.0 | FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE.0,
        ),
    };
    unsafe {
        SetFileInformationByHandle(
            HANDLE(source.as_raw_handle()),
            FileDispositionInfoEx,
            (&disposition as *const FILE_DISPOSITION_INFO_EX).cast(),
            std::mem::size_of::<FILE_DISPOSITION_INFO_EX>() as u32,
        )
    }
    .map_err(crate::winpath::win32_error)
}

#[cfg(not(windows))]
pub(super) fn remove_if_matches(
    _source: &Path,
    _destination: &Path,
    _expected: &Snapshot,
    _token: &CancellationToken,
) -> Result<()> {
    // Until an equivalent platform-specific file lock and handle deletion is
    // available, leave the original rather than risking newer data.
    Err(FsError::Io(std::io::ErrorKind::Unsupported.into()))
}
