//! Metadata-only traversal helpers (Step 11c D1/D2).
//!
//! Every read here opens a handle with `FILE_READ_ATTRIBUTES` and
//! `FILE_FLAG_OPEN_NO_RECALL` only: an online-only placeholder is described,
//! never hydrated. Link and reparse directories are never followed, so a
//! loop cannot form. Tests inject a `ScanIo` that records content reads; the
//! scanner must leave that counter at zero.

use std::collections::HashSet;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::Instant;

use fs_service::owned_io::SourceIdentity;
use fs_service::{capture_source_stamp, FileIdentityKey, SourceStamp};

use crate::limits::{ENTRY_CHUNK, MAX_DUPLICATE_INPUTS, SCAN_WORKERS};
use crate::types::{checked_safe, Coverage, StorageError};

/// One inspected filesystem entry. No content field exists on purpose.
#[derive(Debug, Clone)]
pub struct Inspected {
    pub path: PathBuf,
    pub name: String,
    pub is_dir: bool,
    pub is_link: bool,
    pub hidden: bool,
    pub online_only: bool,
    pub logical_bytes: u64,
    pub allocated_bytes: Option<u64>,
    pub key: FileIdentityKey,
    pub modified_unix: u64,
    /// 100 ns `LastWriteTime` of the entry itself. For a folder this is the
    /// bounded root/watch generation used by the cache key.
    pub modified_ticks: u64,
}

/// One file found by the duplicate enumerator.
#[derive(Debug, Clone)]
pub struct FileRecord {
    pub path: String,
    pub name: String,
    pub key: FileIdentityKey,
    pub stamp: SourceStamp,
    pub identity: SourceIdentity,
    pub logical_bytes: u64,
    pub allocated_bytes: Option<u64>,
    pub modified_unix: u64,
    pub online_only: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct EnumerateOutcome {
    pub skipped_count: u32,
    pub coverage: Coverage,
    pub cancelled: bool,
}

/// The metadata source of a scan. Tests implement this to model cloud
/// placeholders, loops and hard links without touching user files.
pub trait ScanIo: Sync {
    fn is_network(&self, path: &Path) -> bool;
    fn read_dir(&self, path: &Path) -> io::Result<Vec<PathBuf>>;
    fn inspect(&self, path: &Path) -> io::Result<Inspected>;
    /// Incremented only by a test double that also exposes a content read.
    /// The scanner itself never calls such a method.
    fn content_reads(&self) -> u64 {
        0
    }
}

/// The real Windows implementation. Non-Windows builds keep a portable
/// fallback so the pure crate's tests can run anywhere.
#[derive(Debug, Default, Clone, Copy)]
pub struct FsScanIo;

impl ScanIo for FsScanIo {
    fn is_network(&self, path: &Path) -> bool {
        is_network_root(path)
    }

    fn read_dir(&self, path: &Path) -> io::Result<Vec<PathBuf>> {
        let mut entries = Vec::new();
        for entry in std::fs::read_dir(path)? {
            match entry {
                Ok(entry) => entries.push(entry.path()),
                Err(_) => continue,
            }
        }
        entries.sort();
        Ok(entries)
    }

    fn inspect(&self, path: &Path) -> io::Result<Inspected> {
        #[cfg(windows)]
        {
            windows_inspect(path)
        }
        #[cfg(not(windows))]
        {
            portable_inspect(path)
        }
    }
}

/// Inspect entries in bounded chunks with at most two metadata workers.
pub(crate) fn inspect_chunk<I: ScanIo + ?Sized>(
    io: &I,
    paths: &[PathBuf],
) -> Vec<Option<Inspected>> {
    let mut out: Vec<Option<Inspected>> = vec![None; paths.len()];
    if paths.is_empty() {
        return out;
    }
    let workers = SCAN_WORKERS.min(paths.len()).max(1);
    let chunk_size = paths.len().div_ceil(workers);
    std::thread::scope(|scope| {
        let mut rest = paths;
        let mut slots = out.as_mut_slice();
        while !rest.is_empty() {
            let take = chunk_size.min(rest.len());
            let (batch, tail) = rest.split_at(take);
            let (slot_batch, slot_tail) = slots.split_at_mut(take);
            scope.spawn(move || {
                for (slot, path) in slot_batch.iter_mut().zip(batch.iter()) {
                    *slot = io.inspect(path).ok();
                }
            });
            rest = tail;
            slots = slot_tail;
        }
    });
    out
}

/// Enumerate regular local files for duplicate review. Hard-link aliases
/// are left in the record stream; `duplicate_candidates` collapses them.
pub fn enumerate_files<I: ScanIo + ?Sized>(
    io: &I,
    roots: &[PathBuf],
    include_hidden: bool,
    allow_network: bool,
    cancel: &fs_service::CancellationToken,
    progress: &mut dyn FnMut(&fs_service::OpProgress),
) -> Result<(Vec<FileRecord>, EnumerateOutcome), StorageError> {
    let mut files = Vec::new();
    let mut skipped = 0u32;
    let mut cancelled = false;
    let mut reason_partial = false;
    let mut seen_dirs: HashSet<String> = HashSet::new();
    let mut last_report = Instant::now();
    let mut bytes_seen = 0u64;
    let mut capped = false;

    for root in roots {
        if cancel.load(Ordering::Relaxed) || capped {
            cancelled = cancelled || cancel.load(Ordering::Relaxed);
            break;
        }
        if io.is_network(root) && !allow_network {
            return Err(StorageError::Invalid);
        }
        let root_info = io.inspect(root).map_err(|_| StorageError::Unavailable)?;
        if !root_info.is_dir {
            return Err(StorageError::Invalid);
        }
        let mut stack = vec![(root.clone(), 0u16)];
        while let Some((folder, depth)) = stack.pop() {
            if cancel.load(Ordering::Relaxed) {
                cancelled = true;
                break;
            }
            if depth > crate::limits::MAX_DEPTH {
                reason_partial = true;
                skipped = skipped.saturating_add(1);
                continue;
            }
            let entries = match io.read_dir(&folder) {
                Ok(entries) => entries,
                Err(_) => {
                    skipped = skipped.saturating_add(1);
                    reason_partial = true;
                    continue;
                }
            };
            for batch in entries.chunks(ENTRY_CHUNK) {
                if cancel.load(Ordering::Relaxed) {
                    cancelled = true;
                    break;
                }
                let inspected = inspect_chunk(io, batch);
                for (path, info) in batch.iter().zip(inspected) {
                    let Some(info) = info else {
                        skipped = skipped.saturating_add(1);
                        reason_partial = true;
                        continue;
                    };
                    if info.hidden && !include_hidden {
                        continue;
                    }
                    if info.is_link {
                        skipped = skipped.saturating_add(1);
                        reason_partial = true;
                        continue;
                    }
                    if info.is_dir {
                        let directory_key = info.key.path_key.clone();
                        if seen_dirs.insert(directory_key) {
                            stack.push((path.clone(), depth.saturating_add(1)));
                        } else {
                            skipped = skipped.saturating_add(1);
                            reason_partial = true;
                        }
                        continue;
                    }
                    if files.len() >= MAX_DUPLICATE_INPUTS as usize {
                        reason_partial = true;
                        capped = true;
                        skipped = skipped.saturating_add(1);
                        break;
                    }
                    // Metadata only: an online-only placeholder is described
                    // here and never opened for content by the stages.
                    let stamp = match capture_source_stamp(path) {
                        Ok(stamp) => stamp,
                        Err(_) => {
                            skipped = skipped.saturating_add(1);
                            reason_partial = true;
                            continue;
                        }
                    };
                    let identity = match SourceIdentity::capture(path) {
                        Ok(identity) => identity,
                        Err(_) => {
                            skipped = skipped.saturating_add(1);
                            reason_partial = true;
                            continue;
                        }
                    };
                    let name = info.name.clone();
                    bytes_seen = bytes_seen.saturating_add(info.logical_bytes);
                    files.push(FileRecord {
                        path: path.to_string_lossy().into_owned(),
                        name,
                        key: info.key,
                        stamp,
                        identity,
                        logical_bytes: info.logical_bytes,
                        allocated_bytes: info.allocated_bytes,
                        modified_unix: info.modified_unix,
                        online_only: info.online_only,
                    });
                    if last_report.elapsed().as_millis() >= 100 {
                        last_report = Instant::now();
                        progress(&fs_service::OpProgress {
                            items_done: files.len(),
                            items_total: 0,
                            bytes_done: bytes_seen,
                            bytes_total: 0,
                            current: truncate_current(&path.to_string_lossy()),
                        });
                    }
                }
                if files.len() >= MAX_DUPLICATE_INPUTS as usize {
                    capped = true;
                    reason_partial = true;
                    break;
                }
            }
            if files.len() >= MAX_DUPLICATE_INPUTS as usize || cancelled {
                capped = true;
                reason_partial = true;
                break;
            }
        }
        if cancelled || capped {
            break;
        }
    }

    progress(&fs_service::OpProgress {
        items_done: files.len(),
        items_total: 0,
        bytes_done: bytes_seen,
        bytes_total: 0,
        current: String::new(),
    });
    Ok((
        files,
        EnumerateOutcome {
            skipped_count: skipped,
            coverage: Coverage::partial_if(reason_partial || cancelled),
            cancelled,
        },
    ))
}

/// The allocation of one file from an attribute-only handle, if Windows
/// reports it. Negative/unsupported values stay `None`, never zero.
pub fn allocated_bytes_of(path: &Path) -> Option<u64> {
    #[cfg(windows)]
    {
        windows_metrics(path)
            .ok()
            .and_then(|metrics| metrics.allocation)
    }
    #[cfg(not(windows))]
    {
        std::fs::metadata(path).ok().map(|meta| meta.len())
    }
}

pub(crate) fn truncate_current(path: &str) -> String {
    const MAX: usize = 512;
    if path.chars().count() <= MAX {
        return path.to_string();
    }
    path.chars().take(MAX).collect()
}

#[cfg(windows)]
#[derive(Debug, Clone, Copy)]
struct WindowsMetrics {
    volume: u32,
    index: u64,
    attributes: u32,
    size: u64,
    allocation: Option<u64>,
    modified_ticks: u64,
}

#[cfg(windows)]
fn windows_metrics(path: &Path) -> io::Result<WindowsMetrics> {
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        FileBasicInfo, FileStandardInfo, GetFileInformationByHandle, GetFileInformationByHandleEx,
        BY_HANDLE_FILE_INFORMATION, FILE_BASIC_INFO, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_FLAG_OPEN_NO_RECALL, FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES,
        FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_STANDARD_INFO,
    };
    let file = std::fs::OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES.0)
        .share_mode((FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE).0)
        .custom_flags(
            (FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_OPEN_NO_RECALL | FILE_FLAG_BACKUP_SEMANTICS)
                .0,
        )
        .open(path)?;
    let handle = HANDLE(file.as_raw_handle());
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    // SAFETY: the owned handle stays open; `info` is the exact output type.
    unsafe { GetFileInformationByHandle(handle, &mut info) }.map_err(windows_io)?;

    let mut standard = FILE_STANDARD_INFO::default();
    let allocation = {
        // SAFETY: same owned handle and correctly sized output structure.
        let result = unsafe {
            GetFileInformationByHandleEx(
                handle,
                FileStandardInfo,
                (&mut standard as *mut FILE_STANDARD_INFO).cast(),
                std::mem::size_of::<FILE_STANDARD_INFO>() as u32,
            )
        };
        match result {
            Ok(()) if standard.AllocationSize >= 0 => Some(standard.AllocationSize as u64),
            _ => None,
        }
    };

    let mut basic = FILE_BASIC_INFO::default();
    let modified_ticks = {
        // SAFETY: same owned handle and correctly sized output structure.
        let result = unsafe {
            GetFileInformationByHandleEx(
                handle,
                FileBasicInfo,
                (&mut basic as *mut FILE_BASIC_INFO).cast(),
                std::mem::size_of::<FILE_BASIC_INFO>() as u32,
            )
        };
        match result {
            Ok(()) => u64::try_from(basic.LastWriteTime).unwrap_or(0),
            Err(_) => 0,
        }
    };

    Ok(WindowsMetrics {
        volume: info.dwVolumeSerialNumber,
        index: (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow),
        attributes: info.dwFileAttributes,
        size: (u64::from(info.nFileSizeHigh) << 32) | u64::from(info.nFileSizeLow),
        allocation,
        modified_ticks,
    })
}

#[cfg(windows)]
fn windows_io(error: windows::core::Error) -> io::Error {
    io::Error::from_raw_os_error((error.code().0 as u32 & 0xffff) as i32)
}

#[cfg(windows)]
fn windows_inspect(path: &Path) -> io::Result<Inspected> {
    const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x0000_0002;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
    const FILE_ATTRIBUTE_OFFLINE: u32 = 0x0000_1000;
    const FILE_ATTRIBUTE_RECALL_ON_OPEN: u32 = 0x0004_0000;
    const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x0040_0000;

    let metrics = windows_metrics(path)?;
    let is_dir = metrics.attributes & FILE_ATTRIBUTE_DIRECTORY != 0;
    let is_link = metrics.attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0;
    let hidden = metrics.attributes & FILE_ATTRIBUTE_HIDDEN != 0;
    let online_only = metrics.attributes
        & (FILE_ATTRIBUTE_OFFLINE
            | FILE_ATTRIBUTE_RECALL_ON_OPEN
            | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS)
        != 0;
    let path_key =
        fs_service::path_key_of(path).map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))?;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());
    let stable = metrics.volume != 0 && metrics.index != 0;
    Ok(Inspected {
        path: path.to_path_buf(),
        name,
        is_dir,
        is_link,
        hidden,
        online_only,
        logical_bytes: if is_dir {
            0
        } else {
            checked_safe(metrics.size).map_err(|_| io::Error::from(io::ErrorKind::InvalidData))?
        },
        allocated_bytes: if is_dir { None } else { metrics.allocation },
        key: FileIdentityKey {
            volume_id: format!("{:08x}", metrics.volume),
            file_id: format!("{:016x}", metrics.index),
            path_key,
            stable,
        },
        modified_unix: ticks_to_unix(metrics.modified_ticks),
        modified_ticks: metrics.modified_ticks,
    })
}

#[cfg(not(windows))]
fn portable_inspect(path: &Path) -> io::Result<Inspected> {
    use std::time::UNIX_EPOCH;
    let metadata = std::fs::symlink_metadata(path)?;
    let is_dir = metadata.is_dir();
    let key = if is_dir {
        FileIdentityKey {
            volume_id: "00000000".to_string(),
            file_id: "0000000000000000".to_string(),
            path_key: fs_service::path_key_of(path)
                .map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))?,
            stable: false,
        }
    } else {
        fs_service::capture_file_identity(path)
            .map_err(|_| io::Error::from(io::ErrorKind::InvalidData))?
    };
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|age| age.as_secs())
        .unwrap_or(0);
    let attributes = 0u32;
    Ok(Inspected {
        path: path.to_path_buf(),
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string_lossy().into_owned()),
        is_dir,
        is_link: metadata.file_type().is_symlink(),
        hidden: attributes & 0x2 != 0,
        online_only: attributes & (0x1000 | 0x4_0000 | 0x40_0000) != 0,
        logical_bytes: if is_dir { 0 } else { metadata.len() },
        allocated_bytes: if is_dir { None } else { Some(metadata.len()) },
        key,
        modified_unix: modified,
        modified_ticks: modified.saturating_mul(10_000_000),
    })
}

fn ticks_to_unix(ticks: u64) -> u64 {
    if ticks == 0 {
        return 0;
    }
    (ticks / 10_000_000).saturating_sub(11_644_473_600)
}

#[cfg(windows)]
fn is_network_root(path: &Path) -> bool {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetDriveTypeW;
    use windows::Win32::System::WindowsProgramming::DRIVE_REMOTE;
    let text = path.to_string_lossy();
    // A UNC share is remote even when it arrives in `\\?\UNC\` form.
    let normalized = text.strip_prefix(r"\\?\").unwrap_or(text.as_ref());
    if normalized.starts_with(r"\\") || normalized.to_ascii_uppercase().starts_with(r"UNC\") {
        return true;
    }
    let root = match path.components().next() {
        Some(std::path::Component::Prefix(prefix)) => {
            format!("{}\\", prefix.as_os_str().to_string_lossy())
        }
        _ => return false,
    };
    let wide: Vec<u16> = root.encode_utf16().chain(std::iter::once(0)).collect();
    // SAFETY: `wide` is a NUL-terminated UTF-16 string that outlives the call.
    let kind = unsafe { GetDriveTypeW(PCWSTR(wide.as_ptr())) };
    kind == DRIVE_REMOTE
}

#[cfg(not(windows))]
fn is_network_root(path: &Path) -> bool {
    path.to_string_lossy().starts_with(r"\\")
}
