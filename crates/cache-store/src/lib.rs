//! Bounded, owned preview cache (Step 07a, E1/E2).
//!
//! One store owns `<data>/cache`: a SQLite index, `blobs/<uuid>.png` files,
//! staging under `pending/`, and an OS lock (`cache.lock`) that serializes
//! the store across processes. Nothing here reads a user's original file:
//! `publish` copies a finite prepared result (at most 4 MiB) that a helper
//! already produced.

mod cleanup;
mod error;
mod maintenance;
mod publication;
mod records;
mod schema;
mod store;
mod types;

pub use error::CacheError;
pub use fs_service::source_stamp::{FileIdentityKey, SourceStamp};
pub use store::{CacheStore, DEFAULT_LIMIT_BYTES};
pub use types::{
    key_hash, CacheKey, CacheKind, CacheLease, CacheRecord, CacheUsage, MAX_BLOB_BYTES,
    MAX_CACHE_ENTRIES, MAX_PATH_KEY_UTF16, MAX_RESULT_EDGE, MAX_RESULT_PIXELS,
};

/// The cache index schema this build understands.
pub const STORE_SCHEMA: u32 = 1;
