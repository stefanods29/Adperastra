//! High-precision source stamps and stable file identities (Step 07a, E9).
//!
//! A cache key needs more than a path and a whole-second timestamp: two
//! saves inside the same second must be different revisions. This module
//! reads the full Windows 100 ns `LastWriteTime` from an attribute-only
//! handle (`FILE_FLAG_OPEN_NO_RECALL`), so capturing a stamp never hydrates
//! an online-only file. `SourceIdentity` in `owned_io` keeps its existing
//! whole-second meaning; this stamp is the precise companion it never had.

use std::fs::File;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::owned_io::{
    handle_attributes, handle_identity, is_reparse, OwnedIoError, OwnedIoResult,
};

/// The longest normalized path key a stamp may carry, in UTF-16 units.
pub const MAX_STAMP_PATH_UTF16: usize = 32_768;
/// The largest byte size that survives the JSON wire without precision loss.
pub const MAX_WIRE_SIZE: u64 = 9_007_199_254_740_991;
/// Windows ticks between 1601-01-01 and 1970-01-01 (only used elsewhere).
#[cfg(not(windows))]
const UNIX_EPOCH_TICKS: u64 = 116_444_736_000_000_000;

/// The precise revision of one local file (Step 07a, E9).
///
/// All native identifiers and timestamps cross IPC as strings: Windows file
/// IDs and 100 ns ticks do not fit a JavaScript number.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceStamp {
    /// Normalized source path (lower case, `/` as `\`, no `\\?\`).
    pub path_key: String,
    /// Volume serial number, exactly 8 lower-case hex characters.
    pub volume_id: String,
    /// File index, exactly 16 lower-case hex characters.
    pub file_id: String,
    /// Windows `LastWriteTime` in 100 ns ticks, as a decimal string.
    pub modified_ticks: String,
    pub size_bytes: u64,
}

impl SourceStamp {
    /// True when every field respects its wire bound. Callers validate a
    /// stamp before it becomes part of a cache key.
    pub fn validate(&self) -> Result<(), &'static str> {
        if path_key_of(Path::new(&self.path_key)).ok().as_deref() != Some(self.path_key.as_str()) {
            return Err("source path is too long");
        }
        if !is_lower_hex(&self.volume_id, 8) {
            return Err("volume_id is not 8 lower-case hex characters");
        }
        if !is_lower_hex(&self.file_id, 16) {
            return Err("file_id is not 16 lower-case hex characters");
        }
        if self.modified_ticks.is_empty()
            || self.modified_ticks.len() > 20
            || !self
                .modified_ticks
                .bytes()
                .all(|byte| byte.is_ascii_digit())
            || self.modified_ticks.parse::<u64>().is_err()
        {
            return Err("modified_ticks is not a decimal tick count");
        }
        if self.size_bytes > MAX_WIRE_SIZE {
            return Err("size_bytes is larger than the wire limit");
        }
        Ok(())
    }
}

/// A stable file identity: volume and file index, with the normalized path
/// as the fallback key when the volume cannot provide stable IDs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileIdentityKey {
    pub volume_id: String,
    pub file_id: String,
    pub path_key: String,
    /// False when the volume reports no stable identity (FAT/exFAT, network).
    pub stable: bool,
}

/// Read a precise stamp from an attribute-only handle. Never hydrates an
/// online-only file and refuses links and reparse points.
pub fn capture_source_stamp(path: &Path) -> OwnedIoResult<SourceStamp> {
    let path_key = path_key_of(path)?;
    let file = open_attributes(path)?;
    if is_reparse(&file)? || !file.metadata()?.is_file() {
        return Err(OwnedIoError::ReparseRefused);
    }
    let identity = handle_identity(&file)?;
    let metadata = file.metadata()?;
    let stamp = SourceStamp {
        path_key,
        volume_id: format!("{:08x}", identity.volume),
        file_id: format!("{:016x}", identity.index),
        modified_ticks: modified_ticks(&file)?.to_string(),
        size_bytes: metadata.len(),
    };
    stamp
        .validate()
        .map_err(|_| OwnedIoError::Io(io::ErrorKind::InvalidInput.into()))?;
    Ok(stamp)
}

/// Read the stable identity of a local file. Zero identifiers are allowed
/// only together with `stable: false`.
pub fn capture_file_identity(path: &Path) -> OwnedIoResult<FileIdentityKey> {
    let path_key = path_key_of(path)?;
    let file = open_attributes(path)?;
    if is_reparse(&file)? || !(file.metadata()?.is_file() || file.metadata()?.is_dir()) {
        return Err(OwnedIoError::ReparseRefused);
    }
    let identity = handle_identity(&file)?;
    Ok(FileIdentityKey {
        volume_id: format!("{:08x}", identity.volume),
        file_id: format!("{:016x}", identity.index),
        path_key,
        stable: identity.volume != 0 && identity.index != 0 && stable_filesystem(&file, path),
    })
}

/// The normalized key of a source path: no `\\?\`, `/` as `\`, no trailing
/// separator, lower case (Windows compares these paths that way).
pub fn path_key_of(path: &Path) -> OwnedIoResult<String> {
    let invalid = || OwnedIoError::Io(io::ErrorKind::InvalidInput.into());
    let text = path.to_str().ok_or_else(invalid)?;
    if text.chars().any(char::is_control) || text.starts_with(r"\\.\") {
        return Err(invalid());
    }
    let text = if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        text.strip_prefix(r"\\?\").unwrap_or(text).to_string()
    };
    let mut key = text.replace('/', "\\").to_lowercase();
    let drive_root = key.as_bytes().get(1) == Some(&b':')
        && key.as_bytes().get(2) == Some(&b'\\')
        && key.as_bytes()[0].is_ascii_alphabetic();
    let unc = key.starts_with(r"\\") && key[2..].split('\\').filter(|s| !s.is_empty()).count() >= 2;
    if !drive_root && !unc {
        return Err(invalid());
    }
    while key.ends_with('\\') && !(drive_root && key.len() == 3) {
        key.pop();
    }
    if key.encode_utf16().count() > MAX_STAMP_PATH_UTF16 {
        return Err(invalid());
    }
    Ok(key)
}

/// High-precision revision of the exact already-open prepared source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileHandleStamp {
    pub volume_id: u32,
    pub file_id: u64,
    pub modified_ticks: u64,
    pub size_bytes: u64,
}

pub fn stamp_for_open_file(file: &File) -> OwnedIoResult<FileHandleStamp> {
    if is_reparse(file)? || !file.metadata()?.is_file() {
        return Err(OwnedIoError::ReparseRefused);
    }
    let id = handle_identity(file)?;
    Ok(FileHandleStamp {
        volume_id: id.volume,
        file_id: id.index,
        modified_ticks: modified_ticks(file)?,
        size_bytes: file.metadata()?.len(),
    })
}

#[cfg(windows)]
fn stable_filesystem(file: &File, path: &Path) -> bool {
    use std::os::windows::io::AsRawHandle;
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::HANDLE,
            Storage::FileSystem::{GetDriveTypeW, GetVolumeInformationByHandleW},
        },
    };
    let mut name = [0u16; 64];
    // SAFETY: live attribute-only handle and bounded mutable buffer.
    if unsafe {
        GetVolumeInformationByHandleW(
            HANDLE(file.as_raw_handle()),
            None,
            None,
            None,
            None,
            Some(&mut name),
        )
    }
    .is_err()
    {
        return false;
    }
    let end = name.iter().position(|v| *v == 0).unwrap_or(name.len());
    let root = path
        .components()
        .next()
        .map(|c| format!("{}\\", c.as_os_str().to_string_lossy()))
        .unwrap_or_default();
    let wide: Vec<_> = root.encode_utf16().chain(Some(0)).collect();
    // SAFETY: zero-terminated root path remains alive throughout call.
    let remote = unsafe { GetDriveTypeW(PCWSTR(wide.as_ptr())) } == 4;
    crate::file_id_is_stable(&String::from_utf16_lossy(&name[..end]), remote)
}
#[cfg(not(windows))]
fn stable_filesystem(_file: &File, _path: &Path) -> bool {
    false
}

fn is_lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Attributes that mean "the content is not local": reading would download
/// it (plan/rules.md R-FS-1).
pub fn attributes_are_online_only(attributes: u32) -> bool {
    const OFFLINE: u32 = 0x0000_1000;
    const RECALL_ON_OPEN: u32 = 0x0004_0000;
    const RECALL_ON_DATA_ACCESS: u32 = 0x0040_0000;
    attributes & (OFFLINE | RECALL_ON_OPEN | RECALL_ON_DATA_ACCESS) != 0
}

/// The attributes of an already opened file, for online-only checks.
pub fn attributes_of(file: &File) -> OwnedIoResult<u32> {
    Ok(handle_attributes(file)?)
}

#[cfg(windows)]
fn open_attributes(path: &Path) -> io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_NO_RECALL, FILE_FLAG_OPEN_REPARSE_POINT,
        FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
    };
    std::fs::OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES.0)
        .share_mode((FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE).0)
        .custom_flags(
            FILE_FLAG_OPEN_REPARSE_POINT.0
                | FILE_FLAG_OPEN_NO_RECALL.0
                | FILE_FLAG_BACKUP_SEMANTICS.0,
        )
        .open(path)
}

#[cfg(not(windows))]
fn open_attributes(path: &Path) -> io::Result<File> {
    File::open(path)
}

#[cfg(windows)]
fn modified_ticks(file: &File) -> io::Result<u64> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        FileBasicInfo, GetFileInformationByHandleEx, FILE_BASIC_INFO,
    };
    let mut info = FILE_BASIC_INFO::default();
    // SAFETY: the handle is open for attributes and `info` is exactly the
    // structure the information class expects.
    unsafe {
        GetFileInformationByHandleEx(
            HANDLE(file.as_raw_handle()),
            FileBasicInfo,
            (&mut info as *mut FILE_BASIC_INFO).cast(),
            std::mem::size_of::<FILE_BASIC_INFO>() as u32,
        )
    }
    .map_err(|error| io::Error::from_raw_os_error((error.code().0 as u32 & 0xffff) as i32))?;
    u64::try_from(info.LastWriteTime).map_err(|_| io::ErrorKind::InvalidData.into())
}

#[cfg(not(windows))]
fn modified_ticks(file: &File) -> io::Result<u64> {
    let modified = file.metadata()?.modified()?;
    let unix = modified
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| io::ErrorKind::InvalidInput)?;
    Ok(UNIX_EPOCH_TICKS.saturating_add(
        unix.as_secs().saturating_mul(10_000_000) + u64::from(unix.subsec_nanos()) / 100,
    ))
}
