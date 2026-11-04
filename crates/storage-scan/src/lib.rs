//! Pure bounded storage scanning for Step 11c (`storage-scan-1`).
//!
//! The crate never reads file content. It describes metadata (including
//! allocation from an attribute-only handle), records bounded nodes through
//! a sink, and returns an honest coverage summary. Cache storage, paging,
//! duplicate hashing and the Tauri commands live in the app crate.

pub mod limits;
pub mod scan;
pub mod types;
pub mod walk;

pub use limits::{
    ScanLimits, CLEANUP_PLAN_TTL_SECS, MAX_DUPLICATE_INPUTS, MAX_DUPLICATE_ROOTS, MAX_ENTRIES,
    MAX_FILES, MAX_FOLDERS, MAX_GROUP_MEMBERS, MAX_HARDLINK_PATHS, MAX_PAGE_BYTES, MAX_PAGE_GROUPS,
    MAX_PAGE_NODES, MAX_RETAINED_ROOTS, MAX_RETAINED_SCANS, MAX_SCAN_AGE_SECS, MAX_TYPE_GROUPS,
    SCANNER_VERSION, STORAGE_DB_LIMIT_BYTES,
};
pub use scan::{scan_storage, scan_storage_with, ScanRun, ScanSink};
pub use types::{
    checked_safe, Coverage, DuplicateCleanupPlan, DuplicateGroup, DuplicateMember, DuplicatePage,
    DuplicateRequest, PlanBinding, StorageError, StorageNode, StorageNodeKind, StoragePage,
    StorageScanRequest, StorageSummary, TypeBreakdown,
};
pub use walk::{
    allocated_bytes_of, enumerate_files, EnumerateOutcome, FileRecord, FsScanIo, Inspected, ScanIo,
};
