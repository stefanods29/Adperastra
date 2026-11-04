//! Fixed bounds for the search index (Step 11a decision 2, 8 and 11).

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// At most this many explicitly chosen indexed folders.
pub const MAX_ROOTS: usize = 32;
/// Longest accepted root or excluded path, in UTF-16 units.
pub const MAX_ROOT_PATH_UNITS: usize = 32_768;
/// Longest query text accepted from the UI, in UTF-8 bytes.
pub const MAX_QUERY_BYTES: usize = 1024;
/// Most clauses in one typed filter.
pub const MAX_FILTER_CLAUSES: usize = 32;
/// Deepest allowed filter nesting, counting the root as depth 1.
pub const MAX_FILTER_DEPTH: usize = 4;
/// Most tag IDs in one filter or tag update.
pub const MAX_TAG_IDS: usize = 100;
/// Most tag IDs in one authoritative tag-mirror update (Step 11a type table).
pub const MAX_TAG_UPDATE_IDS: usize = 1_000;
/// Most tag updates in one authoritative batch.
pub const MAX_TAG_UPDATES: usize = 256;
/// Hard cap on indexed file rows (1,000,000). Reaching it pauses indexing.
pub const MAX_INDEX_RECORDS: u64 = 1_000_000;
/// Smallest and largest index size setting, in MiB.
pub const DB_LIMIT_MIN_MB: u32 = 128;
pub const DB_LIMIT_MAX_MB: u32 = 8192;
/// Default index size, in MiB.
pub const DB_LIMIT_DEFAULT_MB: u32 = 2048;
/// Bounded WAL size before a checkpoint is requested.
pub const WAL_LIMIT_BYTES: u64 = 64 * 1024 * 1024;
/// A commit carries at most this many records or waits this long.
pub const COMMIT_BATCH_RECORDS: usize = 256;
pub const COMMIT_BATCH_MS: u64 = 100;
/// Two traversal workers and at most this many queued folders.
pub const SCAN_WORKERS: usize = 2;
pub const SCAN_QUEUE: usize = 256;
/// Deepest folder chain followed from an indexed root.
pub const MAX_SCAN_DEPTH: usize = 256;
/// Largest content input inspected, and largest normalized text kept.
pub const MAX_CONTENT_INPUT_BYTES: u64 = 50 * 1024 * 1024;
pub const MAX_CONTENT_TEXT_BYTES: usize = 10 * 1024 * 1024;
/// Characters stored for one file and serialized extractor result.
pub const MAX_EXTRACTED_CHARS: usize = 100_000;
pub const MAX_EXTRACTED_BYTES: usize = 2 * 1024 * 1024;
/// Metadata fields kept for one extracted file.
pub const MAX_EXTRACTED_METADATA: usize = 16;
/// Longest search snippet, in Unicode scalar values.
pub const MAX_SNIPPET_SCALARS: usize = 256;
/// Regex pattern and compiled-size limits.
pub const MAX_REGEX_BYTES: usize = 1024;
pub const REGEX_SIZE_LIMIT: usize = 1 << 20;
pub const REGEX_DFA_SIZE_LIMIT: usize = 2 << 20;
pub const REGEX_NEST_LIMIT: u32 = 64;
/// First regex-scan budget; later pages continue from the saved offset.
pub const REGEX_FIRST_BUDGET: Duration = Duration::from_secs(2);
/// Opaque query cursors.
pub const MAX_CURSORS: usize = 16;
pub const CURSOR_TTL: Duration = Duration::from_secs(60);
/// Result pages: 50 first, 256 after, at most 768 KiB serialized.
pub const FIRST_PAGE: usize = 50;
pub const PAGE_SIZE: usize = 256;
pub const PAGE_MAX_BYTES: usize = 768 * 1024;
/// Saved search catalog.
pub const MAX_SAVED_SEARCHES: usize = 100;
pub const MAX_SAVED_SEARCH_BYTES: usize = 1024 * 1024;
pub const MAX_SAVED_SEARCH_NAME_CHARS: usize = 60;
/// OCR work allowed in one indexing session.
pub const OCR_FILES_PER_SESSION: usize = 100;
/// USN helper bounds.
pub const USN_RECORD_CHUNK: usize = 64 * 1024;
pub const USN_MAX_RECORDS: usize = 1_000_000;
pub const USN_MAX_PARENT_DEPTH: usize = 256;

/// The configured database budget, in bytes.
pub fn db_limit_bytes(index_limit_mb: u32) -> u64 {
    u64::from(index_limit_mb.clamp(DB_LIMIT_MIN_MB, DB_LIMIT_MAX_MB)) * 1024 * 1024
}

/// Physical bytes owned by the index: `index.sqlite3`, `-wal` and `-shm`.
pub fn physical_bytes(db_path: &Path) -> u64 {
    let mut total = file_len(db_path);
    total = total.saturating_add(file_len(&sidecar(db_path, "-wal")));
    total = total.saturating_add(file_len(&sidecar(db_path, "-shm")));
    total
}

fn file_len(path: &Path) -> u64 {
    std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

fn sidecar(db_path: &Path, suffix: &str) -> PathBuf {
    let mut name = db_path.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

/// True when a byte value can cross JSON without losing precision.
pub fn is_safe_u64(value: u64) -> bool {
    9_007_199_254_740_991 >= value
}

pub fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|age| age.as_secs())
        .unwrap_or(0)
}

/// Windows-style path comparison key: no long-path prefix, no trailing
/// separator (except a drive root), lower case.
pub fn path_key(path: &str) -> String {
    let mut value = path.trim().to_string();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        value = format!(r"\\{rest}");
    } else if let Some(rest) = value.strip_prefix(r"\\?\") {
        value = rest.to_string();
    }
    while value.len() > 3 && value.ends_with('\\') {
        value.pop();
    }
    value.to_lowercase()
}

/// True when `path` is `root` or lies below it, using `path_key`.
pub fn path_is_under(path: &str, root: &str) -> bool {
    let path = path_key(path);
    let mut root = path_key(root);
    if root.len() == 2 && root.ends_with(':') {
        root.push('\\');
    }
    path == root || path.starts_with(&format!("{root}\\"))
}

/// Longest content text accepted for storage.
pub fn content_chars_allowed(configured: u32) -> usize {
    (configured as usize).clamp(1_000, MAX_EXTRACTED_CHARS)
}
