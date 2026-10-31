//! Attribute changes for app-owned files, never a content replacement.

use std::fs::OpenOptions;
use std::io;
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::AsRawHandle;
use std::path::Path;

use windows::Win32::Foundation::HANDLE;
use windows::Win32::Storage::FileSystem::{
    FileBasicInfo, GetFileInformationByHandleEx, SetFileInformationByHandle,
    FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_READONLY,
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_BASIC_INFO, FILE_FLAG_OPEN_REPARSE_POINT,
    FILE_READ_ATTRIBUTES, FILE_SHARE_READ, FILE_WRITE_ATTRIBUTES,
};

/// Clear only the Windows read-only attribute before removing an app-owned
/// cache copy. Callers must establish ownership; user files never use this.
/// The opened handle excludes writes/renames and refuses reparse points.
pub fn clear_owned_readonly(path: &Path) -> io::Result<()> {
    let file = OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES.0 | FILE_WRITE_ATTRIBUTES.0)
        .share_mode(FILE_SHARE_READ.0)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(path)?;
    let handle = HANDLE(file.as_raw_handle());
    let mut info = FILE_BASIC_INFO::default();
    // SAFETY: the owned file and correctly sized output structure outlive the call.
    unsafe {
        GetFileInformationByHandleEx(
            handle,
            FileBasicInfo,
            (&mut info as *mut FILE_BASIC_INFO).cast(),
            std::mem::size_of_val(&info) as u32,
        )
    }
    .map_err(windows_io)?;
    if info.FileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT.0 | FILE_ATTRIBUTE_DIRECTORY.0) != 0 {
        return Err(io::Error::other(
            "refusing attributes on a link or directory",
        ));
    }
    info.FileAttributes &= !FILE_ATTRIBUTE_READONLY.0;
    if info.FileAttributes == 0 {
        info.FileAttributes = FILE_ATTRIBUTE_NORMAL.0;
    }
    // SAFETY: attributes apply to the same still-owned handle, preserving the
    // other flags and timestamps returned by GetFileInformationByHandleEx.
    unsafe {
        SetFileInformationByHandle(
            handle,
            FileBasicInfo,
            (&info as *const FILE_BASIC_INFO).cast(),
            std::mem::size_of_val(&info) as u32,
        )
    }
    .map_err(windows_io)
}

fn windows_io(error: windows::core::Error) -> io::Error {
    io::Error::from_raw_os_error((error.code().0 as u32 & 0xffff) as i32)
}
