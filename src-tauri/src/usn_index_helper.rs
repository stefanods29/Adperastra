//! Optional elevated NTFS metadata helper (Step 11a decision 10). It starts
//! only when the user enables the feature, receives one validated drive root
//! and the current user SID, and emits metadata records. It never opens a
//! file's contents, never writes, and never accepts an arbitrary path.

use std::io::{BufRead, BufReader, Write};
use std::path::Path;

use search_index::limits::{USN_MAX_RECORDS, USN_RECORD_CHUNK};
use search_index::usn_records::{parse_usn_records, UsnRecord};
use serde::{Deserialize, Serialize};

use crate::usn_admin;

pub const HELPER_FLAG: &str = "--usn-index-helper";

#[derive(Debug, Deserialize)]
struct HelperControl {
    nonce: String,
    volume_root: String,
    expected_sid: String,
}

#[derive(Debug, Serialize)]
struct HelperRecord<'a> {
    file_id: u64,
    parent_id: u64,
    name: &'a str,
    attributes: u32,
    timestamp: i64,
}

#[cfg(windows)]
pub fn run() -> Result<(), String> {
    let pipe_name = std::env::args()
        .nth(2)
        .ok_or_else(|| "search.denied".to_string())?;
    let mut pipe = usn_admin::connect_pipe(&pipe_name)?;
    let reader_pipe = pipe
        .try_clone()
        .map_err(|_| "search.failed".to_string())?;
    let mut reader = BufReader::new(reader_pipe);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|_| "search.denied".to_string())?;
    let control: HelperControl =
        serde_json::from_str(line.trim()).map_err(|_| "search.invalid".to_string())?;
    if usn_admin::pipe_name(&control.nonce)? != pipe_name {
        return Err("search.denied".to_string());
    }
    let root = usn_admin::validate_volume_root(&control.volume_root)?;
    let current = usn_admin::current_user_sid()?;
    if !usn_admin::same_user(&control.expected_sid, &current) {
        return Err("search.denied".to_string());
    }
    let mut count = 0usize;
    enumerate_volume(&root, &mut |record| {
        if count >= USN_MAX_RECORDS {
            return Err("search.too_large".to_string());
        }
        count += 1;
        let line = HelperRecord {
            file_id: record.file_id,
            parent_id: record.parent_id,
            name: &record.name,
            attributes: record.attributes,
            timestamp: record.timestamp,
        };
        serde_json::to_writer(&mut pipe, &line).map_err(|_| "search.failed".to_string())?;
        pipe.write_all(b"\n")
            .map_err(|_| "search.failed".to_string())
    })
}

#[cfg(not(windows))]
pub fn run() -> Result<(), String> {
    Err("search.unavailable".to_string())
}

#[cfg(windows)]
fn enumerate_volume(
    root: &Path,
    emit: &mut dyn FnMut(&UsnRecord) -> Result<(), String>,
) -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, GENERIC_READ};
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows::Win32::System::IO::DeviceIoControl;
    use windows::Win32::System::Ioctl::{
        FSCTL_ENUM_USN_DATA, FSCTL_QUERY_USN_JOURNAL, MFT_ENUM_DATA_V0, USN_JOURNAL_DATA_V0,
    };

    let drive = root.to_string_lossy().trim_end_matches('\\').to_string();
    let volume = windows::core::HSTRING::from(format!(r"\\.\{drive}"));
    // SAFETY: a volume handle with read access; no individual file is opened.
    // The handle is closed before returning.
    let handle = unsafe {
        CreateFileW(
            PCWSTR(volume.as_ptr()),
            GENERIC_READ.0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            None,
        )
    }
    .map_err(|_| "search.denied".to_string())?;

    let mut journal = USN_JOURNAL_DATA_V0::default();
    let mut returned = 0u32;
    // SAFETY: the journal buffer is the exact output size and the handle is
    // a live volume handle.
    let queried = unsafe {
        DeviceIoControl(
            handle,
            FSCTL_QUERY_USN_JOURNAL,
            None,
            0,
            Some(&mut journal as *mut _ as *mut core::ffi::c_void),
            std::mem::size_of::<USN_JOURNAL_DATA_V0>() as u32,
            Some(&mut returned),
            None,
        )
    };
    if queried.is_err() {
        let _ = unsafe { CloseHandle(handle) };
        return Err("search.unavailable".to_string());
    }

    let mut start = 0u64;
    let mut buffer = vec![0u8; USN_RECORD_CHUNK];
    let outcome = loop {
        let input = MFT_ENUM_DATA_V0 {
            StartFileReferenceNumber: start,
            LowUsn: journal.FirstUsn,
            HighUsn: journal.NextUsn,
        };
        let mut used = 0u32;
        // SAFETY: input and output buffers are correctly sized; the output
        // is at most 64 KiB and the handle is still owned.
        let result = unsafe {
            DeviceIoControl(
                handle,
                FSCTL_ENUM_USN_DATA,
                Some(&input as *const _ as *const core::ffi::c_void),
                std::mem::size_of::<MFT_ENUM_DATA_V0>() as u32,
                Some(buffer.as_mut_ptr() as *mut core::ffi::c_void),
                buffer.len() as u32,
                Some(&mut used),
                None,
            )
        };
        if result.is_err() || used <= 8 || used as usize > buffer.len() {
            break Ok(());
        }
        let Ok(parsed) = parse_usn_records(&buffer[8..used as usize], 4096) else {
            break Err("search.invalid".to_string());
        };
        if parsed.consumed == 0 {
            break Ok(());
        }
        for record in &parsed.records {
            if let Err(error) = emit(record) {
                let _ = unsafe { CloseHandle(handle) };
                return Err(error);
            }
        }
        start = u64::from_le_bytes(buffer[0..8].try_into().unwrap_or([0u8; 8]));
    };
    // SAFETY: the volume handle was opened above and is closed exactly once.
    let _ = unsafe { CloseHandle(handle) };
    outcome
}

#[cfg(not(windows))]
fn enumerate_volume(
    _root: &Path,
    _emit: &mut dyn FnMut(&UsnRecord) -> Result<(), String>,
) -> Result<(), String> {
    Err("search.unavailable".to_string())
}

#[cfg(test)]
mod tests {
    use super::HELPER_FLAG;

    #[test]
    fn the_helper_flag_is_fixed() {
        assert_eq!(HELPER_FLAG, "--usn-index-helper");
    }
}
