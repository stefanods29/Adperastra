//! The copy engine behind the transfer window (Step 09f D2, D3).
//!
//! Enumeration is metadata-only: it reads attributes and identities through
//! `SourceIdentity::capture`, which never recalls an online-only placeholder
//! and never follows a reparse point. A copy then opens the *exact* file that
//! was enumerated (`PinnedSource::open`), reads it in 1 MiB chunks into an
//! exclusively created staging file (`OwnedOutput`) and leaves publishing to
//! the caller, which is the only place that knows the final name.
//!
//! Between two chunks the engine asks the job's `TransferGate`. A pause
//! therefore stops before the next read: no byte is written twice, the
//! handles stay open and resuming continues at the same offset.

use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

use crate::owned_io::{OwnedIoError, OwnedOutput, PinnedDirectory, PinnedSource};
use crate::transfer_decisions::{Checkpoint, TransferGate};
use crate::transfer_rates::{CounterError, RateSampler, TransferCounters};
use crate::transfer_verify::{verify_before_publish, CopyHash, VerifiedHash, VerifyError};
use crate::CancellationToken;

/// One read or write per chunk; also the pause granularity.
pub const CHUNK: usize = 1024 * 1024;
/// Top-level items one transfer may name.
pub const MAX_TOP_LEVEL_SOURCES: usize = 10_000;
/// Entries (files and folders) one transfer may enumerate.
pub const MAX_ENUMERATED_ITEMS: usize = 500_000;
/// Folder depth one transfer may walk.
pub const MAX_DEPTH: usize = 256;
/// Online-only report entries kept for the confirmation.
pub const MAX_ONLINE_ONLY_REPORT: usize = 100;

/// Windows attributes that mean "reading this file downloads it".
pub const FILE_ATTRIBUTE_OFFLINE: u32 = 0x0000_1000;
pub const FILE_ATTRIBUTE_RECALL_ON_OPEN: u32 = 0x0004_0000;
pub const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x0040_0000;
pub const FILE_ATTRIBUTE_READONLY: u32 = 0x0000_0001;
pub const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;
pub const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;

/// True when touching the content of this item would reach the cloud.
pub fn is_online_only(attributes: u32) -> bool {
    attributes
        & (FILE_ATTRIBUTE_OFFLINE
            | FILE_ATTRIBUTE_RECALL_ON_OPEN
            | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS)
        != 0
}

/// Everything this transfer has enumerated so far (shared budget).
#[derive(Debug, Clone, Copy, Default)]
pub struct EnumerationBudget {
    items: usize,
}

impl EnumerationBudget {
    pub fn items(&self) -> usize {
        self.items
    }
}

/// The volume serial and file index of an entry, file or folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EntryIdentity {
    pub volume: u32,
    pub index: u64,
}

/// Identity of `path` itself through an attribute-only handle: no content
/// read, no cloud recall, no link followed.
#[cfg(windows)]
pub fn capture_identity(path: &Path) -> Option<EntryIdentity> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_NO_RECALL, FILE_FLAG_OPEN_REPARSE_POINT,
        FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
    };
    let file = std::fs::OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES.0)
        .share_mode((FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE).0)
        .custom_flags(
            FILE_FLAG_BACKUP_SEMANTICS.0
                | FILE_FLAG_OPEN_REPARSE_POINT.0
                | FILE_FLAG_OPEN_NO_RECALL.0,
        )
        .open(path)
        .ok()?;
    let identity = crate::owned_io::handle_identity(&file).ok()?;
    Some(EntryIdentity {
        volume: identity.volume,
        index: identity.index,
    })
}

#[cfg(not(windows))]
pub fn capture_identity(_path: &Path) -> Option<EntryIdentity> {
    None
}

/// Windows 100 ns ticks for a modification time, printed as decimal.
fn ticks_of(path: &Path) -> String {
    const EPOCH_AS_FILETIME: u64 = 116_444_736_000_000_000;
    let Ok(metadata) = path.symlink_metadata() else {
        return "0".to_string();
    };
    let nanos = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|age| age.as_nanos())
        .unwrap_or(0);
    format!("{}", (nanos / 100) as u64 + EPOCH_AS_FILETIME)
}

/// A full-precision stamp for any entry, file or folder.
///
/// `capture_source_stamp` (07a E9) is file-only, so folders use this
/// metadata-only variant. It follows the same shape and the same rules: an
/// attribute-only handle, no content read, no cloud recall.
pub fn entry_stamp(path: &Path) -> Result<crate::SourceStamp, EnumerateError> {
    let identity = capture_identity(path).ok_or(EnumerateError::Unreadable)?;
    let size = path
        .symlink_metadata()
        .map(|metadata| if metadata.is_dir() { 0 } else { metadata.len() })
        .map_err(|_| EnumerateError::Unreadable)?;
    // The same canonical key `capture_source_stamp` produces (lower case,
    // `\` separators, no `\\?\`), so a stamp taken here still equals a
    // stamp taken later for the same object.
    let path_key =
        crate::source_stamp::path_key_of(path).map_err(|_| EnumerateError::Unreadable)?;
    Ok(crate::SourceStamp {
        path_key,
        volume_id: format!("{:08x}", identity.volume),
        file_id: format!("{:016x}", identity.index),
        modified_ticks: ticks_of(path),
        size_bytes: size,
    })
}

/// One file or folder inside an enumerated source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnumeratedEntry {
    pub from: PathBuf,
    /// Path below the source's own name, empty for the top-level item.
    pub rel: PathBuf,
    pub is_dir: bool,
    pub size: u64,
    pub online_only: bool,
    pub readonly: bool,
    /// Identity recorded at enumeration; a move renames only this object.
    pub identity: Option<EntryIdentity>,
}

/// One top-level item the user chose, expanded for copying.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnumeratedSource {
    pub root: PathBuf,
    pub name: String,
    pub entries: Vec<EnumeratedEntry>,
    pub total_bytes: u64,
    /// Online-only items, bounded; used for the confirmation text.
    pub online_only: Vec<PathBuf>,
}

/// Why enumeration stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnumerateError {
    /// The item budget for this transfer is spent.
    Budget,
    /// The folder tree is deeper than 256 levels.
    TooDeep,
    /// The path is not an absolute path with a name.
    Invalid,
    /// Metadata could not be read (permissions, a disappearing drive).
    Unreadable,
}

impl EnumerateError {
    pub fn code(self) -> &'static str {
        match self {
            EnumerateError::Budget => "ops.too_large",
            EnumerateError::TooDeep => "ops.too_long",
            EnumerateError::Invalid => "ops.invalid_request",
            EnumerateError::Unreadable => "ops.access_denied",
        }
    }
}

/// Why copying one file did not produce a publishable result.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CopyError {
    Cancelled,
    /// The user chose "Skip file" for this item.
    Skipped,
    /// The file under the path is no longer the enumerated file.
    SourceChanged,
    /// The read-back did not match the bytes copied.
    VerifyFailed,
    /// Another program holds the file.
    InUse,
    /// The destination volume is full.
    NoSpace,
    /// The destination name appeared while the copy was being written.
    TargetExists,
    /// Permission denied, or any other I/O failure.
    Io,
    /// The byte accounting refused the counts (overflow or a bug).
    Counters,
}

impl CopyError {
    pub fn code(self) -> &'static str {
        match self {
            CopyError::Cancelled => "ops.cancelled",
            CopyError::Skipped => "ops.exists",
            CopyError::SourceChanged => "ops.source_changed",
            CopyError::VerifyFailed => "ops.verify_failed",
            CopyError::InUse => "ops.in_use",
            CopyError::NoSpace => "ops.no_space",
            CopyError::TargetExists => "ops.exists",
            CopyError::Io => "ops.io",
            CopyError::Counters => "ops.too_large",
        }
    }

    /// Errors a user can answer with Retry / Skip / Cancel.
    pub fn is_retryable(self) -> bool {
        matches!(
            self,
            CopyError::InUse | CopyError::Io | CopyError::NoSpace | CopyError::SourceChanged
        )
    }
}

impl From<OwnedIoError> for CopyError {
    fn from(error: OwnedIoError) -> Self {
        match error {
            OwnedIoError::SourceChanged => CopyError::SourceChanged,
            OwnedIoError::TargetExists => CopyError::TargetExists,
            OwnedIoError::StagingTaken => CopyError::TargetExists,
            OwnedIoError::Io(error) => CopyError::from_io(&error),
            _ => CopyError::Io,
        }
    }
}

impl CopyError {
    fn from_io(error: &std::io::Error) -> Self {
        match error.raw_os_error() {
            // ERROR_SHARING_VIOLATION, ERROR_LOCK_VIOLATION
            Some(32) | Some(33) => CopyError::InUse,
            // ERROR_DISK_FULL, ERROR_HANDLE_DISK_FULL
            Some(112) | Some(39) => CopyError::NoSpace,
            // ERROR_FILE_EXISTS, ERROR_ALREADY_EXISTS
            Some(80) | Some(183) => CopyError::TargetExists,
            // ERROR_ACCESS_DENIED
            Some(5) => CopyError::Io,
            _ => CopyError::Io,
        }
    }
}

/// Attributes of `path` itself, never of what a link points at.
#[cfg(windows)]
fn attributes_of(path: &Path) -> std::io::Result<u32> {
    use std::os::windows::fs::MetadataExt;
    Ok(path.symlink_metadata()?.file_attributes())
}

#[cfg(not(windows))]
fn attributes_of(path: &Path) -> std::io::Result<u32> {
    let metadata = path.symlink_metadata()?;
    let mut attributes = 0;
    if metadata.file_type().is_symlink() {
        attributes |= FILE_ATTRIBUTE_REPARSE_POINT;
    }
    if metadata.is_dir() {
        attributes |= FILE_ATTRIBUTE_DIRECTORY;
    }
    if metadata.permissions().readonly() {
        attributes |= FILE_ATTRIBUTE_READONLY;
    }
    Ok(attributes)
}

fn item_name(path: &Path) -> Option<String> {
    Some(path.file_name()?.to_string_lossy().into_owned())
}

/// Expand one top-level item. Never follows a reparse point, never leaves
/// the item budget, never reads file content.
pub fn enumerate_source(
    root: &Path,
    budget: &mut EnumerationBudget,
) -> Result<EnumeratedSource, EnumerateError> {
    if !root.is_absolute() {
        return Err(EnumerateError::Invalid);
    }
    let name = item_name(root).ok_or(EnumerateError::Invalid)?;
    let attributes = attributes_of(root).map_err(|_| EnumerateError::Unreadable)?;
    let mut source = EnumeratedSource {
        root: root.to_path_buf(),
        name,
        entries: Vec::new(),
        total_bytes: 0,
        online_only: Vec::new(),
    };
    let is_folder = attributes & FILE_ATTRIBUTE_DIRECTORY != 0;
    let online = is_online_only(attributes);
    if online && source.online_only.len() < MAX_ONLINE_ONLY_REPORT {
        source.online_only.push(root.to_path_buf());
    }
    let metadata = root
        .symlink_metadata()
        .map_err(|_| EnumerateError::Unreadable)?;
    source.entries.push(EnumeratedEntry {
        from: root.to_path_buf(),
        rel: PathBuf::new(),
        is_dir: is_folder,
        size: if is_folder { 0 } else { metadata.len() },
        online_only: online,
        readonly: attributes & FILE_ATTRIBUTE_READONLY != 0,
        identity: capture_identity(root),
    });
    source.total_bytes += if is_folder { 0 } else { metadata.len() };
    budget.items += 1;
    if is_folder && attributes & FILE_ATTRIBUTE_REPARSE_POINT == 0 {
        let mut visited: HashSet<String> = HashSet::new();
        walk(root, Path::new(""), 1, budget, &mut visited, &mut source)?;
    }
    if budget.items > MAX_ENUMERATED_ITEMS {
        return Err(EnumerateError::Budget);
    }
    Ok(source)
}

fn walk(
    folder: &Path,
    rel: &Path,
    depth: usize,
    budget: &mut EnumerationBudget,
    visited: &mut HashSet<String>,
    source: &mut EnumeratedSource,
) -> Result<(), EnumerateError> {
    if depth > MAX_DEPTH {
        return Err(EnumerateError::TooDeep);
    }
    let key = folder
        .to_string_lossy()
        .trim_start_matches(r"\\?\")
        .replace('/', "\\")
        .to_lowercase();
    if !visited.insert(key) {
        return Err(EnumerateError::TooDeep);
    }
    let entries = std::fs::read_dir(folder).map_err(|_| EnumerateError::Unreadable)?;
    let mut children: Vec<PathBuf> = Vec::new();
    for entry in entries.flatten() {
        children.push(entry.path());
    }
    children.sort();
    for child in children {
        if budget.items >= MAX_ENUMERATED_ITEMS {
            return Err(EnumerateError::Budget);
        }
        let attributes = attributes_of(&child).map_err(|_| EnumerateError::Unreadable)?;
        let metadata = child
            .symlink_metadata()
            .map_err(|_| EnumerateError::Unreadable)?;
        let is_dir = attributes & FILE_ATTRIBUTE_DIRECTORY != 0;
        let entry_rel = match item_name(&child) {
            Some(name) => rel.join(name),
            None => continue,
        };
        let online = is_online_only(attributes);
        if online && source.online_only.len() < MAX_ONLINE_ONLY_REPORT {
            source.online_only.push(child.clone());
        }
        budget.items += 1;
        if !is_dir {
            source.total_bytes = source.total_bytes.saturating_add(metadata.len());
        }
        source.entries.push(EnumeratedEntry {
            from: child.clone(),
            rel: entry_rel.clone(),
            is_dir,
            size: if is_dir { 0 } else { metadata.len() },
            online_only: online,
            readonly: attributes & FILE_ATTRIBUTE_READONLY != 0,
            identity: capture_identity(&child),
        });
        // A link or junction is listed but never walked into: a move must
        // not reach outside the folder the user chose.
        if is_dir && attributes & FILE_ATTRIBUTE_REPARSE_POINT == 0 {
            walk(&child, &entry_rel, depth + 1, budget, visited, source)?;
        }
    }
    Ok(())
}

/// The destination folder for one enumerated entry.
pub fn target_of(directory: &Path, name: &str, rel: &Path) -> PathBuf {
    if rel.as_os_str().is_empty() {
        directory.join(name)
    } else {
        directory.join(rel)
    }
}

/// Create the destination folders a copy needs. Existing folders are used as
/// they are (that is what merging means); nothing is removed.
pub fn ensure_destination_dir(path: &Path) -> Result<(), CopyError> {
    if path.is_dir() {
        return Ok(());
    }
    std::fs::create_dir_all(path).map_err(|error| CopyError::from_io(&error))
}

/// One file copy, from the guarded source handle into owned staging.
///
/// The caller owns the pin, so a move can take its exact source snapshot
/// while the file is held and remove that same object afterwards.
pub struct FileCopyRequest<'a> {
    pub source: &'a mut PinnedSource,
    pub directory: &'a PinnedDirectory,
    pub hint: &'a str,
    pub verify: bool,
    pub token: &'a CancellationToken,
    pub gate: &'a TransferGate,
    /// Called once per written chunk, so a caller can report progress and a
    /// test can stop the copy at an exact boundary.
    pub on_chunk: &'a mut dyn FnMut(u64),
}

/// A staged file that is ready to publish under a chosen name.
pub struct StagedFile {
    pub output: OwnedOutput,
    pub bytes_written: u64,
    pub verified: Option<VerifiedHash>,
}

impl StagedFile {
    /// Publish under `name` without replacing anything. A name that appeared
    /// meanwhile is `TargetExists`, and the same staging file is offered the
    /// next name: nothing is ever written over the item that won the race.
    pub fn publish(&mut self, name: &str) -> Result<PathBuf, CopyError> {
        Ok(self.output.publish_name(name)?)
    }
}

/// Copy one file. The caller owns the returned staging file, so a failure
/// here can only dispose of it (never of a user path).
pub fn copy_file(
    request: FileCopyRequest<'_>,
    counters: &mut TransferCounters,
    rates: &mut RateSampler,
) -> Result<StagedFile, CopyError> {
    let source = request.source;
    let mut output =
        OwnedOutput::create(request.directory, request.hint).map_err(|error| match error {
            OwnedIoError::StagingTaken => CopyError::Io,
            other => CopyError::from(other),
        })?;
    let mut hasher = CopyHash::new();
    let mut buffer = vec![0u8; CHUNK];
    let result = (|| -> Result<(), CopyError> {
        loop {
            match request.gate.checkpoint(request.token) {
                Checkpoint::Cancel => return Err(CopyError::Cancelled),
                Checkpoint::SkipItem => return Err(CopyError::Skipped),
                Checkpoint::Continue => {}
            }
            let started = Instant::now();
            let read = source
                .file_mut()
                .read(&mut buffer)
                .map_err(|error| CopyError::from_io(&error))?;
            if read == 0 {
                break;
            }
            output
                .file_mut()
                .write_all(&buffer[..read])
                .map_err(|error| CopyError::from_io(&error))?;
            hasher.update(&buffer[..read]);
            counters
                .add_bytes(read as u64)
                .map_err(|error| match error {
                    CounterError::Overflow => CopyError::Counters,
                    CounterError::BeyondTotal => CopyError::Counters,
                })?;
            rates.record(read as u64, started.elapsed().as_nanos() as u64);
            (request.on_chunk)(read as u64);
        }
        // The file must still be the one we opened when the last byte lands.
        source.verify_after_read()?;
        output.flush_sync()?;
        Ok(())
    })();
    result?;
    let (expected_hash, expected_len) = hasher.finish();
    let verified = if request.verify {
        match verify_before_publish(&mut output, expected_hash, expected_len, request.token) {
            Ok(hash) => Some(hash),
            Err(VerifyError::Cancelled) => return Err(CopyError::Cancelled),
            Err(VerifyError::Mismatch) => return Err(CopyError::VerifyFailed),
            Err(VerifyError::Io) => return Err(CopyError::Io),
        }
    } else {
        None
    };
    Ok(StagedFile {
        output,
        bytes_written: expected_len,
        verified,
    })
}
