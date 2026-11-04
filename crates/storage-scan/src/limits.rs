//! Fixed bounds for storage scans (Step 11c D1/D3/D5).

/// The largest byte/count value that survives JSON without precision loss.
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
/// Longest accepted path, in UTF-16 units (Windows long paths).
pub const MAX_SCAN_PATH_UTF16: usize = 32_768;
/// The only accepted request entry cap.
pub const MAX_ENTRIES: u32 = 1_000_000;
/// Maximum files kept by one scan.
pub const MAX_FILES: u32 = 1_000_000;
/// Maximum folders kept by one scan.
pub const MAX_FOLDERS: u32 = 250_000;
/// Maximum folder depth followed by the walk.
pub const MAX_DEPTH: u16 = 256;
/// Two metadata workers inspect one chunk at a time.
pub const SCAN_WORKERS: usize = 2;
/// Entries inspected by one chunk (bounded queue).
pub const ENTRY_CHUNK: usize = 256;
/// Retained tree budget of the pure scanner.
pub const MAX_RETAINED_TREE_BYTES: usize = 256 * 1024 * 1024;
/// One page of nodes.
pub const MAX_PAGE_NODES: usize = 256;
/// One serialized node page, before it crosses IPC.
pub const MAX_PAGE_BYTES: usize = 768 * 1024;
/// At most 32 reason groups in a summary.
pub const MAX_REASON_CODES: usize = 32;
/// At most 32 typed file groups.
pub const MAX_TYPE_GROUPS: usize = 32;
/// One duplicate request may name up to 32 roots.
pub const MAX_DUPLICATE_ROOTS: usize = 32;
/// One physical member may carry up to 256 hard-link aliases.
pub const MAX_HARDLINK_PATHS: usize = 256;
/// One duplicate group may contain 10,000 physical members.
pub const MAX_GROUP_MEMBERS: u32 = 10_000;
/// One duplicate page holds at most 32 groups.
pub const MAX_PAGE_GROUPS: usize = 32;
/// At most 1,000,000 duplicate inputs per job.
pub const MAX_DUPLICATE_INPUTS: u32 = 1_000_000;
/// The SQLite store's physical budget, including WAL and staging.
pub const STORAGE_DB_LIMIT_BYTES: u64 = 256 * 1024 * 1024;
/// At most ten roots are cached.
pub const MAX_RETAINED_ROOTS: usize = 10;
/// At most four scan results stay open in the UI.
pub const MAX_RETAINED_SCANS: usize = 4;
/// A cached scan older than seven days is irrelevant.
pub const MAX_SCAN_AGE_SECS: u64 = 7 * 24 * 60 * 60;
/// A cleanup plan expires after five minutes.
pub const CLEANUP_PLAN_TTL_SECS: u64 = 300;
/// Scanner version that participates in the cache key.
pub const SCANNER_VERSION: u32 = 1;

/// The bounds one scan uses. The public request always fixes the entry cap
/// at `MAX_ENTRIES`; tests inject a smaller cap to exercise partial results.
#[derive(Debug, Clone, Copy)]
pub struct ScanLimits {
    pub max_entries: u32,
    pub max_files: u32,
    pub max_folders: u32,
    pub max_depth: u16,
}

impl Default for ScanLimits {
    fn default() -> Self {
        Self {
            max_entries: MAX_ENTRIES,
            max_files: MAX_FILES,
            max_folders: MAX_FOLDERS,
            max_depth: MAX_DEPTH,
        }
    }
}

impl ScanLimits {
    /// A deliberately small cap for unit tests.
    pub fn with_max_entries(max_entries: u32) -> Self {
        Self {
            max_entries,
            ..Self::default()
        }
    }
}
