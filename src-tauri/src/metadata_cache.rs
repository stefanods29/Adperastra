use crate::{
    cache::CacheService,
    metadata_jobs::MAX_CACHED_BYTES,
    metadata_types::{MetadataInfo, MAX_SERIALIZED_BYTES},
};
use cache_store::CacheKey;
use fs_service::SourceStamp;
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    sync::Arc,
};

pub fn cached(cache: &CacheService, key: &CacheKey) -> Option<MetadataInfo> {
    let bytes = cache
        .with_store(|store| {
            let Some(record) = store.lookup(key).map_err(|_| "cache.unavailable")? else {
                return Ok(None);
            };
            if record.byte_len > MAX_CACHED_BYTES || record.mime != "application/json" {
                return Ok(None);
            }
            let mut file = match store.open_blob(&record) {
                Ok(file) => file,
                Err(_) => return Ok(None),
            };
            let mut bytes = Vec::new();
            (&mut file)
                .take(MAX_CACHED_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| "cache.unavailable")?;
            if bytes.len() as u64 != record.byte_len {
                return Ok(None);
            }
            Ok(Some(bytes))
        })
        .ok()??;
    parse_cached(&bytes, &key.source)
}
pub fn parse_cached(bytes: &[u8], expected: &SourceStamp) -> Option<MetadataInfo> {
    if bytes.len() > MAX_SERIALIZED_BYTES {
        return None;
    }
    let info: MetadataInfo = serde_json::from_slice(bytes).ok()?;
    if info.source != *expected {
        return None;
    }
    info.validated().ok()
}
pub fn publish(
    cache: &Arc<CacheService>,
    key: &CacheKey,
    info: &MetadataInfo,
) -> Result<(), String> {
    let bytes = serde_json::to_vec(info).map_err(|_| "metadata.failed")?;
    if bytes.len() > MAX_SERIALIZED_BYTES {
        return Err("metadata.too_large".into());
    }
    let folder = cache.pending_dir();
    let directory =
        fs_service::owned_io::PinnedDirectory::open(&folder).map_err(|_| "cache.unavailable")?;
    let path = directory
        .path()
        .join(format!("~adp-metadata-{}.partial", uuid::Uuid::new_v4()));
    let mut file = owned_temporary(&path).map_err(|_| "cache.unavailable")?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .and_then(|_| file.seek(SeekFrom::Start(0)).map(|_| ()))
        .map_err(|_| "cache.unavailable")?;
    cache
        .publish(key, &file, "application/json", None, None)
        .map(|_| ())
}
#[cfg(windows)]
fn owned_temporary(path: &std::path::Path) -> std::io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows::Win32::Storage::FileSystem::{
        FILE_FLAG_DELETE_ON_CLOSE, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
    };
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .share_mode(FILE_SHARE_READ.0)
        .custom_flags(FILE_FLAG_DELETE_ON_CLOSE.0 | FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(path)
}
#[cfg(not(windows))]
fn owned_temporary(_path: &std::path::Path) -> std::io::Result<File> {
    Err(std::io::ErrorKind::Unsupported.into())
}

#[cfg(test)]
#[path = "metadata_cache_tests.rs"]
mod tests;
