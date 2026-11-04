//! Static metadata providers (Step 07b E6, `metadata-preview-1`).
//!
//! Providers only emit the existing `MetadataFieldId` and `MetadataValue`
//! variants. Special decoders (PSD, RAW, codecs) are added by Step 07g; this
//! step registers the Windows property provider and keeps the fixed
//! priority order in one place.

use std::sync::Arc;

use crate::jobs::JobContext;
use crate::metadata::read_metadata;
use crate::metadata_types::MetadataInfo;
use crate::thumbnail_providers::PreviewSource;

/// Fixed priority, highest first. Unknown IDs are refused on registration.
pub const PROVIDER_ORDER: [&str; 4] = [
    "special_psd",
    "special_raw",
    "special_codec",
    "windows_properties",
];

/// One read-only source of rich facts for a previewed file.
pub trait MetadataProvider {
    fn id(&self) -> &'static str;
    fn supports(&self, source: &PreviewSource) -> bool;
    /// Read inside the outer request's one background permit (E6). Providers
    /// never acquire their own permit recursively.
    fn read(&self, source: &PreviewSource, context: &JobContext) -> Result<MetadataInfo, String>;
}

/// The installed providers. Registration is by fixed ID only.
#[derive(Default)]
pub struct MetadataProviderRegistry {
    providers: Vec<Arc<dyn MetadataProvider + Send + Sync>>,
}

impl MetadataProviderRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register one provider. Duplicate and unknown IDs are refused.
    pub fn register(
        &mut self,
        provider: Arc<dyn MetadataProvider + Send + Sync>,
    ) -> Result<(), String> {
        let id = provider.id();
        if !PROVIDER_ORDER.contains(&id) || self.providers.iter().any(|known| known.id() == id) {
            return Err("metadata.bad_request".to_string());
        }
        self.providers.push(provider);
        Ok(())
    }

    /// The highest-priority provider that claims this source.
    pub fn resolve(
        &self,
        source: &PreviewSource,
    ) -> Option<Arc<dyn MetadataProvider + Send + Sync>> {
        for id in PROVIDER_ORDER {
            if let Some(provider) = self
                .providers
                .iter()
                .find(|candidate| candidate.id() == id && candidate.supports(source))
            {
                return Some(provider.clone());
            }
        }
        None
    }

    #[allow(dead_code)] // Diagnostics for the fixed provider registry.
    pub fn ids(&self) -> Vec<&'static str> {
        self.providers
            .iter()
            .map(|provider| provider.id())
            .collect()
    }
}

/// The Windows property provider: always delegated to the isolated helper
/// in `metadata.rs`, never COM on this thread.
pub struct WindowsPropertiesProvider;

impl MetadataProvider for WindowsPropertiesProvider {
    fn id(&self) -> &'static str {
        "windows_properties"
    }

    fn supports(&self, _source: &PreviewSource) -> bool {
        // Any local file has a property store; the caller has already
        // refused online-only sources and links.
        true
    }

    fn read(&self, source: &PreviewSource, context: &JobContext) -> Result<MetadataInfo, String> {
        read_metadata(&source.path, &source.stamp, context.token())
    }
}

/// The registry this step installs: the Windows property provider only.
pub fn default_registry() -> MetadataProviderRegistry {
    let mut registry = MetadataProviderRegistry::new();
    // Registration of the fixed provider cannot fail: its ID is in the
    // table and the registry is empty.
    let _ = registry.register(Arc::new(WindowsPropertiesProvider));
    registry
}

#[cfg(test)]
#[path = "metadata_providers_tests.rs"]
mod metadata_providers_tests;
