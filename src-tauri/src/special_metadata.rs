//! Dimensions-only metadata providers for special images (Step 07g T6).
//!
//! 07b owns the metadata DTO and property allowlist. These providers emit
//! only width and height; model counts and PSD layer names stay in their
//! own viewer UI.

use std::sync::Arc;
use tauri::Manager;

use crate::jobs::JobContext;
use crate::metadata_providers::{MetadataProvider, MetadataProviderRegistry};
use crate::metadata_types::{MetadataField, MetadataFieldId, MetadataInfo, MetadataValue};
use crate::raw_helper::decode_in_helper;
use crate::special_view_types::SpecialKind;
use crate::thumbnail_providers::PreviewSource;

struct DimensionsProvider {
    id: &'static str,
    kind: SpecialKind,
}

fn info(source: &PreviewSource, width: u32, height: u32) -> MetadataInfo {
    MetadataInfo {
        source: source.stamp.clone(),
        fields: vec![
            MetadataField {
                id: MetadataFieldId::Width,
                value: MetadataValue::Integer {
                    value: u64::from(width),
                },
            },
            MetadataField {
                id: MetadataFieldId::Height,
                value: MetadataValue::Integer {
                    value: u64::from(height),
                },
            },
        ],
        partial: false,
        missing: Vec::new(),
    }
}

impl MetadataProvider for DimensionsProvider {
    fn id(&self) -> &'static str {
        self.id
    }

    fn supports(&self, source: &PreviewSource) -> bool {
        match self.kind {
            SpecialKind::Raw => crate::special_images::is_raw_extension(&source.extension),
            SpecialKind::CodecImage => {
                crate::special_images::is_codec_image_extension(&source.extension)
            }
            SpecialKind::Psd => source.extension.eq_ignore_ascii_case("psd"),
            SpecialKind::Model => false,
        }
    }

    fn read(&self, source: &PreviewSource, context: &JobContext) -> Result<MetadataInfo, String> {
        if context.token().load(std::sync::atomic::Ordering::Relaxed) {
            return Err("background.cancelled".to_string());
        }
        if self.kind == SpecialKind::Psd {
            let grant = crate::special_views::grant_for(source);
            let prepared = crate::psd_raster::rasterize_psd(grant, 128, context)?;
            return Ok(info(source, prepared.width, prepared.height));
        }
        let (_png, width, height) = decode_in_helper(
            context
                .app()
                .state::<Arc<crate::cache::CacheService>>()
                .inner(),
            &source.path,
            self.kind,
            128,
            false,
            context.token(),
        )?;
        Ok(info(source, width, height))
    }
}

/// Register in the fixed priority order: PSD, RAW, codec image. The
/// windows-properties provider remains the fallback owned by 07b.
pub fn register_special_metadata(registry: &mut MetadataProviderRegistry) -> Result<(), String> {
    registry.register(Arc::new(DimensionsProvider {
        id: "special_psd",
        kind: SpecialKind::Psd,
    }))?;
    registry.register(Arc::new(DimensionsProvider {
        id: "special_raw",
        kind: SpecialKind::Raw,
    }))?;
    registry.register(Arc::new(DimensionsProvider {
        id: "special_codec",
        kind: SpecialKind::CodecImage,
    }))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emits_only_width_and_height() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("a.cr2");
        std::fs::write(&path, b"x").unwrap();
        let identity = fs_service::owned_io::SourceIdentity::capture(&path).unwrap();
        let pinned = fs_service::owned_io::PinnedSource::open_background(&path, &identity).unwrap();
        let source = PreviewSource {
            path,
            stamp: fs_service::SourceStamp {
                path_key: "C:\\a.cr2".to_string(),
                volume_id: "00000000".to_string(),
                file_id: "0000000000000000".to_string(),
                modified_ticks: "1".to_string(),
                size_bytes: 1,
            },
            mime: "image/x-canon-cr2".to_string(),
            extension: "cr2".to_string(),
            pinned: Arc::new(pinned),
        };
        let value = info(&source, 400, 300);
        assert_eq!(value.fields.len(), 2);
        assert_eq!(value.fields[0].id, MetadataFieldId::Width);
        assert_eq!(value.fields[1].id, MetadataFieldId::Height);
    }
}
