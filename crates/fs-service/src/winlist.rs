//! Windows directory enumeration with file IDs (Step 02, owner change 1).
//!
//! `GetFileInformationByHandleEx` with `FileIdExtdDirectoryInfo` (falling
//! back to `FileIdBothDirectoryInfo`) returns each entry's file ID,
//! attributes (including recall-on-data-access), size and times from the
//! directory handle alone - no per-file opens, so online-only files are
//! never woken. API shapes verified against Microsoft Learn:
//! - https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getfileinformationbyhandleex
//! - https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_extd_dir_info
//! - https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_both_dir_info

use crate::item::{BackingKind, Item, ItemAttrs, ItemKind};
use crate::list::{file_id_is_stable, validate_path_input, Listing};
use crate::sort::{sort_items, SortSpec};
use crate::{FsError, Result};
use std::path::Path;

#[cfg(not(windows))]
pub fn list_dir_with_ids(path: &Path, sort: SortSpec) -> Result<Listing> {
    crate::list::list_dir_std(path, sort)
}

#[cfg(not(windows))]
pub fn list_dir_with_ids_cancellable(
    path: &Path,
    sort: SortSpec,
    _token: &crate::list::CancellationToken,
) -> Result<Listing> {
    crate::list::list_dir_std(path, sort)
}

#[cfg(windows)]
pub fn list_dir_with_ids_cancellable(
    path: &Path,
    sort: SortSpec,
    token: &crate::list::CancellationToken,
) -> Result<Listing> {
    validate_path_input(&path.to_string_lossy())?;
    let metadata = std::fs::symlink_metadata(path)?;
    if !metadata.is_dir() {
        return Err(FsError::Validation(format!(
            "{} is not a folder",
            path.display()
        )));
    }
    win::enumerate(path, sort, Some(token))
}

#[cfg(windows)]
pub fn list_dir_with_ids(path: &Path, sort: SortSpec) -> Result<Listing> {
    validate_path_input(&path.to_string_lossy())?;
    let metadata = std::fs::symlink_metadata(path)?;
    if !metadata.is_dir() {
        return Err(FsError::Validation(format!(
            "{} is not a folder",
            path.display()
        )));
    }
    win::enumerate(path, sort, None)
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::ffi::c_void;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, GetDriveTypeW, GetFileInformationByHandleEx, GetVolumeInformationByHandleW,
        FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_ID_BOTH_DIR_INFO, FILE_ID_EXTD_DIR_INFO, FILE_INFO_BY_HANDLE_CLASS,
        FILE_LIST_DIRECTORY, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };

    // GetDriveTypeW return values (winbase.h).
    const DRIVE_REMOTE: u32 = 4;
    const ERROR_NO_MORE_FILES_HRESULT: i32 = 0x8007_0012u32 as i32; // Win32 error 18

    struct DirHandle(HANDLE);
    impl Drop for DirHandle {
        fn drop(&mut self) {
            // SAFETY: the handle came from CreateFileW and is closed once.
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    fn wide_null(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// CreateFileW only honours >260-char paths with the `\\?\` prefix.
    fn long_path_wide(path: &Path) -> Vec<u16> {
        let text = path.to_string_lossy().into_owned();
        let prefixed = if text.starts_with(r"\\?\") || text.starts_with(r"\\.\") {
            text
        } else if let Some(unc) = text.strip_prefix(r"\\") {
            format!(r"\\?\UNC\{unc}")
        } else if text.len() >= 2 && text.as_bytes()[1] == b':' {
            format!(r"\\?\{text}")
        } else {
            text
        };
        wide_null(&prefixed)
    }

    fn open_dir(path: &Path) -> Result<DirHandle> {
        let wide = long_path_wide(path);
        // SAFETY: `wide` outlives the call; no security attributes; the
        // returned handle is owned by DirHandle and closed on drop.
        let handle = unsafe {
            CreateFileW(
                PCWSTR(wide.as_ptr()),
                FILE_LIST_DIRECTORY.0,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                None,
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS,
                None,
            )
        }
        .map_err(|e| FsError::Validation(format!("cannot open folder {}: {e}", path.display())))?;
        Ok(DirHandle(handle))
    }

    fn filesystem_name(handle: HANDLE) -> String {
        let mut buffer = [0u16; 64];
        // SAFETY: buffer is a valid writable slice for the call.
        let result = unsafe {
            GetVolumeInformationByHandleW(handle, None, None, None, None, Some(&mut buffer))
        };
        if result.is_err() {
            return String::new();
        }
        let end = buffer.iter().position(|c| *c == 0).unwrap_or(buffer.len());
        String::from_utf16_lossy(&buffer[..end])
    }

    fn is_remote(path: &Path) -> bool {
        let root = path
            .components()
            .next()
            .map(|c| format!("{}\\", c.as_os_str().to_string_lossy()))
            .unwrap_or_default();
        let wide = wide_null(&root);
        // SAFETY: `wide` is a NUL-terminated root path for the call.
        unsafe { GetDriveTypeW(PCWSTR(wide.as_ptr())) == DRIVE_REMOTE }
    }

    fn filetime_to_unix(value: i64) -> u64 {
        // 100-ns intervals since 1601 -> seconds since 1970.
        let seconds = value.div_euclid(10_000_000) - 11_644_473_600;
        if seconds < 0 {
            0
        } else {
            seconds as u64
        }
    }

    const ATTR_HIDDEN: u32 = 0x0000_0002;
    const ATTR_SYSTEM: u32 = 0x0000_0004;
    const ATTR_OFFLINE: u32 = 0x0000_1000;
    const ATTR_RECALL_ON_OPEN: u32 = 0x0004_0000;
    const ATTR_RECALL_ON_DATA_ACCESS: u32 = 0x0040_0000;

    fn item_from_parts(
        dir: &Path,
        name: String,
        attrs: u32,
        end_of_file: i64,
        last_write: i64,
        file_id: Option<u64>,
        stable: bool,
    ) -> Item {
        let is_dir = attrs & FILE_ATTRIBUTE_DIRECTORY.0 != 0;
        Item {
            path: dir.join(&name),
            name,
            kind: if is_dir {
                ItemKind::Folder
            } else {
                ItemKind::File
            },
            backing: BackingKind::Real,
            size: if is_dir { 0 } else { end_of_file.max(0) as u64 },
            modified_unix: filetime_to_unix(last_write),
            attrs: ItemAttrs {
                hidden: attrs & ATTR_HIDDEN != 0,
                system: attrs & ATTR_SYSTEM != 0,
                is_link: attrs & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0,
                online_only: attrs
                    & (ATTR_OFFLINE | ATTR_RECALL_ON_OPEN | ATTR_RECALL_ON_DATA_ACCESS)
                    != 0,
                file_id,
                file_id_stable: stable && file_id.is_some(),
            },
        }
    }

    unsafe fn read_name(name_ptr: *const u16, byte_len: u32) -> String {
        // SAFETY: caller guarantees name_ptr covers byte_len/2 WCHARs.
        let chars = unsafe { std::slice::from_raw_parts(name_ptr, (byte_len / 2) as usize) };
        String::from_utf16_lossy(chars)
    }

    /// One enumeration pass in the given info class. Returns Err on the
    /// first failed call so the caller can fall back to the other class.
    fn enumerate_class(
        dir: &Path,
        class: FILE_INFO_BY_HANDLE_CLASS,
        stable: bool,
        extended: bool,
        token: Option<&crate::list::CancellationToken>,
    ) -> Result<Vec<Item>> {
        let handle = open_dir(dir)?;
        let mut buffer: Vec<u64> = vec![0; 8192]; // 64 KiB, 8-byte aligned
        let mut items = Vec::new();
        let mut id_overflow = false;
        loop {
            // SAFETY: buffer is 64 KiB and 8-byte aligned (Vec<u64>); the
            // OS writes a chain of entries described by NextEntryOffset.
            let result = unsafe {
                GetFileInformationByHandleEx(
                    handle.0,
                    class,
                    buffer.as_mut_ptr() as *mut c_void,
                    (buffer.len() * 8) as u32,
                )
            };
            if let Err(error) = result {
                if error.code().0 == ERROR_NO_MORE_FILES_HRESULT && !items.is_empty() {
                    break;
                }
                // Any other mid-enumeration failure (a drive vanishing,
                // a device error) must not present a partial folder as
                // complete: fail so the caller can fall back / report.
                return Err(FsError::Validation(format!(
                    "directory enumeration failed: {error}"
                )));
            }
            if let Some(token) = token {
                if token.load(std::sync::atomic::Ordering::Relaxed) {
                    return Err(FsError::Cancelled);
                }
            }
            let base = buffer.as_ptr() as *const u8;
            let mut offset = 0usize;
            loop {
                // SAFETY: each entry lies inside the returned chain; name
                // length comes from the entry itself.
                let (next, name, attrs, size, mtime, file_id) = unsafe {
                    if extended {
                        let entry = &*(base.add(offset) as *const FILE_ID_EXTD_DIR_INFO);
                        let id128 = entry.FileId.Identifier;
                        let low = u64::from_le_bytes(id128[0..8].try_into().unwrap());
                        let high_nonzero = id128[8..].iter().any(|b| *b != 0);
                        if high_nonzero {
                            id_overflow = true;
                        }
                        (
                            entry.NextEntryOffset,
                            read_name(entry.FileName.as_ptr(), entry.FileNameLength),
                            entry.FileAttributes,
                            entry.EndOfFile,
                            entry.LastWriteTime,
                            if high_nonzero { None } else { Some(low) },
                        )
                    } else {
                        let entry = &*(base.add(offset) as *const FILE_ID_BOTH_DIR_INFO);
                        (
                            entry.NextEntryOffset,
                            read_name(entry.FileName.as_ptr(), entry.FileNameLength),
                            entry.FileAttributes,
                            entry.EndOfFile,
                            entry.LastWriteTime,
                            Some(entry.FileId as u64),
                        )
                    }
                };
                if name != "." && name != ".." {
                    items.push(item_from_parts(
                        dir, name, attrs, size, mtime, file_id, stable,
                    ));
                }
                if next == 0 {
                    break;
                }
                offset += next as usize;
            }
        }
        if extended && id_overflow {
            // 128-bit IDs beyond u64 (some ReFS volumes): re-enumerate in
            // the 64-bit class instead of truncating an ID.
            return Err(FsError::Validation(
                "extended file IDs exceed 64 bits".to_string(),
            ));
        }
        Ok(items)
    }

    pub fn enumerate(
        dir: &Path,
        sort: SortSpec,
        token: Option<&crate::list::CancellationToken>,
    ) -> Result<Listing> {
        let probe = open_dir(dir)?;
        let fs_name = filesystem_name(probe.0);
        let stable = file_id_is_stable(&fs_name, is_remote(dir));
        drop(probe);

        // FileIdExtdDirectoryInfo = 19, FileIdBothDirectoryInfo = 10
        // (FILE_INFO_BY_HANDLE_CLASS, winbase.h).
        let items = match enumerate_class(dir, FILE_INFO_BY_HANDLE_CLASS(19), stable, true, token) {
            Ok(items) => items,
            Err(FsError::Cancelled) => return Err(FsError::Cancelled),
            Err(_) => enumerate_class(dir, FILE_INFO_BY_HANDLE_CLASS(10), stable, false, token)?,
        };
        let mut items = items;
        sort_items(&mut items, sort);
        Ok(Listing {
            path: dir.to_path_buf(),
            items,
            skipped: Vec::new(),
        })
    }
}
