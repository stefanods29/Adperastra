//! Thumbnail providers (Step 07a, E11).
//!
//! A provider claims a prepared source and produces one bounded PNG. The
//! registry keeps a fixed order: later steps register special providers ahead
//! of the WIC fallback, never in front of it twice.

use std::fs::File;
use std::path::PathBuf;
use std::sync::Arc;

use fs_service::owned_io::PinnedSource;
use fs_service::source_stamp::SourceStamp;

use crate::jobs::JobContext;
use crate::thumbnail_helper;

/// Extensions the WIC fallback claims (Step 07a, D1).
pub const WIC_EXTENSIONS: [&str; 10] = [
    "png", "jpg", "jpeg", "jfif", "gif", "webp", "bmp", "ico", "tif", "tiff",
];

/// One source pinned and identified just before decoding.
pub struct PreviewSource {
    pub path: PathBuf,
    pub stamp: SourceStamp,
    pub mime: String,
    pub extension: String,
    pub pinned: Arc<PinnedSource>,
}

/// One prepared, bounded result. `file` is an owned staging file that is
/// already marked for deletion when the handle closes.
pub struct PreparedThumbnail {
    pub file: File,
    pub width: u32,
    pub height: u32,
    pub mime: String,
    pub source: SourceStamp,
}

pub trait ThumbnailProvider: Send + Sync {
    fn id(&self) -> &'static str;
    fn version(&self) -> u32;
    fn supports(&self, source: &PreviewSource) -> bool;
    fn produce(
        &self,
        source: &PreviewSource,
        edge: u32,
        context: &JobContext,
    ) -> Result<PreparedThumbnail, String>;
}

/// Providers in priority order; the first supporting one wins.
#[derive(Default)]
pub struct ThumbnailProviderRegistry {
    providers: Vec<Arc<dyn ThumbnailProvider + Send + Sync>>,
}

impl ThumbnailProviderRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(
        &mut self,
        provider: Arc<dyn ThumbnailProvider + Send + Sync>,
    ) -> Result<(), String> {
        if self
            .providers
            .iter()
            .any(|existing| existing.id() == provider.id())
        {
            return Err(format!(
                "thumbnail provider {} is already registered",
                provider.id()
            ));
        }
        self.providers.push(provider);
        self.providers.sort_by_key(|provider| match provider.id() {
            "model" => 0,
            "special_psd" => 1,
            "special_raw" => 2,
            "special_codec" => 3,
            "wic" => 5,
            _ => 4,
        });
        Ok(())
    }

    pub fn resolve(
        &self,
        source: &PreviewSource,
    ) -> Option<Arc<dyn ThumbnailProvider + Send + Sync>> {
        self.providers
            .iter()
            .find(|provider| provider.supports(source))
            .cloned()
    }
}

/// The WIC fallback. It runs one isolated helper for each result; the helper
/// owns decoding, encoding and the size limits.
pub struct WicThumbnailProvider {
    cache: Arc<crate::cache::CacheService>,
}

impl WicThumbnailProvider {
    pub fn new(cache: Arc<crate::cache::CacheService>) -> Self {
        Self { cache }
    }
}

impl ThumbnailProvider for WicThumbnailProvider {
    fn id(&self) -> &'static str {
        "wic"
    }

    fn version(&self) -> u32 {
        1
    }

    fn supports(&self, source: &PreviewSource) -> bool {
        WIC_EXTENSIONS.contains(&source.extension.as_str())
    }

    fn produce(
        &self,
        source: &PreviewSource,
        edge: u32,
        context: &JobContext,
    ) -> Result<PreparedThumbnail, String> {
        let rendered = thumbnail_helper::render_thumbnail(
            &self.cache,
            &source.path,
            &source.stamp,
            edge,
            context.token(),
        )?;
        Ok(PreparedThumbnail {
            file: rendered.file,
            width: rendered.width,
            height: rendered.height,
            mime: "image/png".to_string(),
            source: rendered.source,
        })
    }
}

/// The registry this build installs: only the WIC fallback exists at 07a.
pub fn default_registry(cache: Arc<crate::cache::CacheService>) -> ThumbnailProviderRegistry {
    let mut registry = ThumbnailProviderRegistry::new();
    let _ = registry.register(Arc::new(WicThumbnailProvider::new(cache)));
    registry
}

#[cfg(test)]
mod tests {
    use super::ThumbnailProviderRegistry;
    use std::sync::Arc;

    struct Named(&'static str);

    impl super::ThumbnailProvider for Named {
        fn id(&self) -> &'static str {
            self.0
        }
        fn version(&self) -> u32 {
            1
        }
        fn supports(&self, _source: &super::PreviewSource) -> bool {
            false
        }
        fn produce(
            &self,
            _source: &super::PreviewSource,
            _edge: u32,
            _context: &crate::jobs::JobContext,
        ) -> Result<super::PreparedThumbnail, String> {
            Err("thumbnail.failed".to_string())
        }
    }

    #[test]
    fn duplicate_provider_ids_are_refused() {
        let mut registry = ThumbnailProviderRegistry::new();
        assert!(registry.register(Arc::new(Named("wic"))).is_ok());
        assert!(registry.register(Arc::new(Named("wic"))).is_err());
    }
}
