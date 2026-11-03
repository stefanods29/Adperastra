//! Wire and store shapes of the preview cache (Step 07a).
//!
//! `SourceStamp` and `FileIdentityKey` are canonical in
//! `fs_service::source_stamp` and re-exported by this crate. The remaining
//! shapes here are mirrored by `src/services/cache.ts` with the same
//! snake_case field names.

use serde::{Deserialize, Serialize};

use crate::error::CacheError;
use fs_service::source_stamp::SourceStamp;

/// The largest prepared result this build accepts for one cache entry.
pub const MAX_BLOB_BYTES: u64 = 4 * 1024 * 1024;
/// The default cap on index rows (plan D3).
pub const MAX_CACHE_ENTRIES: usize = 50_000;
/// Longest source path key, in UTF-16 units.
pub const MAX_PATH_KEY_UTF16: usize = 32_768;
/// Largest decoded edge any producer may report, in pixels.
pub const MAX_RESULT_EDGE: u32 = 65_536;
/// Largest decoded pixel product any producer may report.
pub const MAX_RESULT_PIXELS: u64 = 100_000_000;

/// What a cached result is used for. These IDs are stable: later steps add
/// producers, never renamed variants (plan D1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CacheKind {
    Thumbnail,
    Metadata,
    PdfPage,
    Ocr,
    MediaProxy,
    /// Reserved for Step 07g; activated only when that producer registers.
    ModelScene,
}

impl CacheKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            CacheKind::Thumbnail => "thumbnail",
            CacheKind::Metadata => "metadata",
            CacheKind::PdfPage => "pdf_page",
            CacheKind::Ocr => "ocr",
            CacheKind::MediaProxy => "media_proxy",
            CacheKind::ModelScene => "model_scene",
        }
    }

    pub fn from_key(value: &str) -> Option<Self> {
        Some(match value {
            "thumbnail" => CacheKind::Thumbnail,
            "metadata" => CacheKind::Metadata,
            "pdf_page" => CacheKind::PdfPage,
            "ocr" => CacheKind::Ocr,
            "media_proxy" => CacheKind::MediaProxy,
            "model_scene" => CacheKind::ModelScene,
            _ => return None,
        })
    }

    /// The finite per-kind result cap. Producers with a different cap must
    /// agree on it before their step registers; this build serves thumbnails.
    pub fn blob_cap(&self) -> u64 {
        MAX_BLOB_BYTES
    }
}

/// One cache key: the exact source revision, the producer and its options.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CacheKey {
    pub source: SourceStamp,
    pub kind: CacheKind,
    /// Provider ID: 1 to 64 ASCII letters, digits or dashes.
    pub handler_id: String,
    /// The provider's own revision; a positive number.
    pub handler_version: u32,
    /// A provider-defined option string, at most 256 ASCII characters and
    /// never raw user JSON.
    pub options_key: String,
}

impl CacheKey {
    /// Check every bound before the key reaches the index or a hash.
    pub fn validate(&self) -> Result<(), CacheError> {
        self.source.validate().map_err(|_| CacheError::BadRequest)?;
        if self.handler_id.is_empty()
            || self.handler_id.len() > 64
            || !self
                .handler_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        {
            return Err(CacheError::BadRequest);
        }
        if self.handler_version == 0 {
            return Err(CacheError::BadRequest);
        }
        if self.options_key.len() > 256
            || !self
                .options_key
                .bytes()
                .all(|byte| byte.is_ascii() && !byte.is_ascii_control())
        {
            return Err(CacheError::BadRequest);
        }
        Ok(())
    }
}

/// One indexed result. Store-only: the UI receives a `CacheLease` instead.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CacheRecord {
    /// BLAKE3 hex of the canonical key fields.
    pub key_hash: String,
    /// UUID of the owned blob.
    pub blob_id: String,
    /// Always `blobs/<blob_id>.png`; validated, never an input path.
    pub relative_name: String,
    pub mime: String,
    pub byte_len: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub used_unix: u64,
    pub pending_delete: bool,
}

impl CacheRecord {
    /// Check the fields read from disk before any consumer sees them.
    pub fn validate(&self) -> Result<(), CacheError> {
        if !is_blake3_hex(&self.key_hash) {
            return Err(CacheError::BadRequest);
        }
        if uuid::Uuid::try_parse(&self.blob_id).is_err() {
            return Err(CacheError::BadRequest);
        }
        if self.relative_name != format!("blobs/{}.png", self.blob_id) {
            return Err(CacheError::BadRequest);
        }
        if self.mime.is_empty()
            || self.mime.len() > 64
            || !self
                .mime
                .bytes()
                .all(|byte| byte.is_ascii() && !byte.is_ascii_control())
        {
            return Err(CacheError::BadRequest);
        }
        if self.byte_len == 0 || self.byte_len > MAX_BLOB_BYTES {
            return Err(CacheError::BadRequest);
        }
        match (self.width, self.height) {
            (None, None) => {}
            (Some(width), Some(height))
                if width >= 1
                    && height >= 1
                    && width <= MAX_RESULT_EDGE
                    && height <= MAX_RESULT_EDGE
                    && u64::from(width) * u64::from(height) <= MAX_RESULT_PIXELS => {}
            _ => return Err(CacheError::BadRequest),
        }
        Ok(())
    }
}

/// One leased result the UI may display. Its token comes from `FileGrants`;
/// bytes never travel through IPC.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CacheLease {
    pub lease_id: String,
    pub token: String,
    pub name: String,
    pub mime: String,
    pub byte_len: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    /// Additive field for Step 07d's memory leases; always false here.
    #[serde(default)]
    pub sensitive: bool,
}

/// What the cache occupies and how many entries and leases it has.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CacheUsage {
    /// Physical bytes under the cache root, including the index and staging.
    pub disk_bytes: u64,
    pub limit_bytes: u64,
    pub entry_count: u64,
    pub leased_count: u64,
    pub pending_delete_bytes: u64,
}

/// The canonical cache key hash: BLAKE3 over length-prefixed UTF-8 values
/// and fixed-width little-endian integers, in a fixed field order.
pub fn key_hash(key: &CacheKey) -> Result<String, CacheError> {
    key.validate()?;
    let mut hasher = blake3::Hasher::new();
    write_text(&mut hasher, &key.source.path_key);
    write_text(&mut hasher, &key.source.volume_id);
    write_text(&mut hasher, &key.source.file_id);
    write_text(&mut hasher, &key.source.modified_ticks);
    hasher.update(&key.source.size_bytes.to_le_bytes());
    write_text(&mut hasher, key.kind.as_str());
    write_text(&mut hasher, &key.handler_id);
    hasher.update(&key.handler_version.to_le_bytes());
    write_text(&mut hasher, &key.options_key);
    Ok(hasher.finalize().to_hex().to_string())
}

fn write_text(hasher: &mut blake3::Hasher, value: &str) {
    hasher.update(&(value.len() as u64).to_le_bytes());
    hasher.update(value.as_bytes());
}

pub(crate) fn is_blake3_hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
