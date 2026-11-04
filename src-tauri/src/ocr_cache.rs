#![allow(dead_code)] // Public producer API; consumed from later steps.
//! Ordinary-disk OCR cache (Step 07e plan D5).
//!
//! Results are JSON blobs of kind `ocr`, provider `windows-ocr` version 1,
//! options `schema=1;lang=…;rot=…;page=…;edge=…;mode=…`. Only a stamped
//! local disk source is cached; snapshots and sensitive sessions stay in
//! memory and never call this module. A hit is revalidated by the caller
//! against the current source identity and language before it reaches the
//! UI.
//!
//! The store lives inside 07a `CacheService` (one `CacheStore` owns
//! `cache.lock` for the process lifetime), so this module goes through
//! `CacheService::with_store`, never a second `CacheStore::open`.

use std::io::{Read, Write};

use cache_store::{CacheKey, CacheKind, SourceStamp, MAX_BLOB_BYTES};
use fs_service::owned_io::{OwnedOutput, PinnedDirectory};

use crate::cache::CacheService;
use crate::ocr_types::{
    validate_ocr_page, OcrPage, OCR_CACHE_SCHEMA, OCR_PROVIDER_ID, OCR_PROVIDER_VERSION,
};

/// The provider option string. It is ASCII, bounded and never raw user JSON.
/// `mode` separates a PDF's native text layer (`native`) from a raster
/// recognition (`raster`), so an OCR hit can never replace selectable text.
pub fn options_key(language: &str, rotation: u16, page: u32, edge: u32, mode: &str) -> String {
    format!(
        "schema={OCR_CACHE_SCHEMA};lang={language};rot={rotation};page={page};edge={edge};mode={mode}"
    )
}

/// One key for a stamped disk source revision.
pub fn cache_key(
    source: &SourceStamp,
    language: &str,
    rotation: u16,
    page: u32,
    edge: u32,
    mode: &str,
) -> CacheKey {
    CacheKey {
        source: source.clone(),
        kind: CacheKind::Ocr,
        handler_id: OCR_PROVIDER_ID.to_string(),
        handler_version: OCR_PROVIDER_VERSION,
        options_key: options_key(language, rotation, page, edge, mode),
    }
}

/// A valid hit, or `None`. Corrupt, oversized or foreign blobs are misses;
/// the cache is never allowed to fail recognition.
pub fn lookup(cache: &CacheService, key: &CacheKey) -> Option<OcrPage> {
    cache
        .with_store(|store| -> Result<Option<OcrPage>, String> {
            let Some(record) = store.lookup(key).ok().flatten() else {
                return Ok(None);
            };
            if record.mime != "application/json" || record.byte_len > MAX_BLOB_BYTES {
                return Ok(None);
            }
            let path = store.root().join(&record.relative_name);
            let metadata = match std::fs::metadata(&path) {
                Ok(metadata) => metadata,
                Err(_) => return Ok(None),
            };
            if !metadata.is_file()
                || metadata.len() != record.byte_len
                || metadata.len() > MAX_BLOB_BYTES
            {
                return Ok(None);
            }
            let mut file = match std::fs::File::open(&path) {
                Ok(file) => file,
                Err(_) => return Ok(None),
            };
            let mut bytes = Vec::with_capacity(record.byte_len as usize);
            if (&mut file)
                .take(MAX_BLOB_BYTES + 1)
                .read_to_end(&mut bytes)
                .is_err()
                || bytes.len() as u64 != record.byte_len
            {
                return Ok(None);
            }
            let Ok(page) = serde_json::from_slice::<OcrPage>(&bytes) else {
                return Ok(None);
            };
            if validate_ocr_page(&page).is_err() {
                return Ok(None);
            }
            Ok(Some(page))
        })
        .ok()
        .flatten()
}

/// Publish one bounded result through an owned staging file. The staging
/// file is removed through its own handle whether publication succeeds or
/// fails; a failed publish never leaves a usable hit.
pub fn publish(cache: &CacheService, key: &CacheKey, page: &OcrPage) -> Result<(), String> {
    validate_ocr_page(page)?;
    let bytes = serde_json::to_vec(page).map_err(|_| "ocr.bad_request".to_string())?;
    if bytes.is_empty() {
        return Err("ocr.bad_request".to_string());
    }
    if bytes.len() as u64 > MAX_BLOB_BYTES {
        return Err("ocr.too_large".to_string());
    }
    // Stage under the cache root so the bytes are accounted by the shared
    // cache budget; a failed publication never leaves a usable entry.
    let staging_dir = cache.pending_dir();
    let _ = std::fs::create_dir_all(&staging_dir);
    let directory = PinnedDirectory::open(&staging_dir).map_err(|_| "ocr.failed".to_string())?;
    let mut output =
        OwnedOutput::create(&directory, "ocr-cache").map_err(|_| "ocr.failed".to_string())?;
    output
        .file_mut()
        .write_all(&bytes)
        .map_err(|_| "ocr.failed".to_string())?;
    output.flush_sync().map_err(|_| "ocr.failed".to_string())?;
    cache
        .publish(
            key,
            output.file_mut(),
            "application/json",
            Some(page.recognized_width),
            Some(page.recognized_height),
        )
        .map_err(|_| "ocr.failed".to_string())?;
    let closed = output.close();
    let _ = closed.dispose();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{cache_key, options_key};
    use cache_store::CacheKind;
    use fs_service::SourceStamp;

    fn stamp() -> SourceStamp {
        SourceStamp {
            path_key: r"c:\pictures\scan.png".to_string(),
            volume_id: "0011aabb".to_string(),
            file_id: "00112233445566aa".to_string(),
            modified_ticks: "133000000000000000".to_string(),
            size_bytes: 42,
        }
    }

    #[test]
    fn language_and_page_change_the_key() {
        assert_ne!(
            options_key("en-US", 0, 1, 4096, "raster"),
            options_key("es-ES", 0, 1, 4096, "raster")
        );
        assert_ne!(
            options_key("en-US", 0, 1, 4096, "raster"),
            options_key("en-US", 0, 2, 4096, "raster")
        );
        assert_ne!(
            options_key("en-US", 0, 1, 4096, "raster"),
            options_key("en-US", 90, 1, 4096, "raster")
        );
        assert_ne!(
            options_key("en-US", 0, 1, 4096, "raster"),
            options_key("en-US", 0, 1, 4096, "native")
        );
        let key = cache_key(&stamp(), "en-US", 0, 1, 4096, "raster");
        assert_eq!(key.kind, CacheKind::Ocr);
        assert_eq!(key.handler_id, "windows-ocr");
        assert_eq!(key.handler_version, 1);
        assert!(key.validate().is_ok());
    }
}
