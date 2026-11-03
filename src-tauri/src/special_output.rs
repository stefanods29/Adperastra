use crate::raw_helper::staging;
use crate::{cache::CacheService, thumbnail_providers::PreparedThumbnail};
use std::io::Write;
pub fn prepare(
    cache: &CacheService,
    bytes: &[u8],
    source: &fs_service::SourceStamp,
) -> Result<PreparedThumbnail, String> {
    let (width, height) = crate::special_images::validate_png(bytes)?;
    if bytes.is_empty() || bytes.len() as u64 > crate::special_view_types::SPECIAL_MAX_PREVIEW_BYTES
    {
        return Err("thumbnail.too_large".into());
    }
    let guard = cache.with_store(|store| {
        store
            .with_staging_budget(bytes.len() as u64, || {
                let guard = staging::GuardedStaging::create(&cache.pending_dir())
                    .map_err(|_| cache_store::CacheError::Unavailable)?;
                let mut writer = staging::open_staging_for_write(&guard.path, &guard.identity)
                    .map_err(|_| cache_store::CacheError::Unavailable)?;
                writer.write_all(bytes)?;
                writer.sync_all()?;
                drop(writer);
                Ok(guard)
            })
            .map_err(|_| "thumbnail.failed".to_string())
    })?;
    let file = staging::open_staged_read(&guard.path)?;
    if staging::file_identity(&file)? != guard.identity {
        return Err("thumbnail.failed".into());
    }
    drop(guard);
    Ok(PreparedThumbnail {
        file,
        width,
        height,
        mime: "image/png".into(),
        source: source.clone(),
    })
}
