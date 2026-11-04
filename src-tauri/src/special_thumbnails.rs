//! Special thumbnail providers (Step 07g T6/E8).
//!
//! Registered through the 07a E11 registry, never through a private
//! registration API. The model provider renders in the isolated helper;
//! RAW/codec decode through WIC; PSD uses the verified composite adapter.

use std::sync::Arc;
use tauri::Manager;

use fs_service::SourceStamp;
use uuid::Uuid;

use crate::jobs::JobContext;
use crate::special_view_types::SpecialKind;
use crate::thumbnail_providers::{
    PreparedThumbnail, PreviewSource, ThumbnailProvider, ThumbnailProviderRegistry,
};
use crate::webview_helper::run_webview_helper;
use crate::webview_helper_types::{
    HelperAction, HelperInputGrant, HelperInputSource, HelperOutputSpec, HelperOutputStorage,
    HelperWindowPlacement, WebviewHelperConfig, WebviewHelperKind, WebviewHelperRequest,
};

use crate::special_output as output;
fn temp_file(
    bytes: &[u8],
    source: &SourceStamp,
    context: &JobContext,
) -> Result<PreparedThumbnail, String> {
    output::prepare(
        context
            .app()
            .state::<Arc<crate::cache::CacheService>>()
            .inner(),
        bytes,
        source,
    )
}

fn grant(source: &PreviewSource) -> HelperInputGrant {
    HelperInputGrant {
        grant_id: Uuid::new_v4(),
        name: source
            .path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "model".to_string()),
        mime: source.mime.clone(),
        source: HelperInputSource::Disk {
            path: source.path.clone(),
            expected: source.stamp.clone(),
            pinned: source.pinned.clone(),
        },
    }
}

fn image_provider(id: &'static str, kind: SpecialKind) -> Arc<dyn ThumbnailProvider + Send + Sync> {
    Arc::new(ImageProvider { id, kind })
}

struct ImageProvider {
    id: &'static str,
    kind: SpecialKind,
}

impl ThumbnailProvider for ImageProvider {
    fn id(&self) -> &'static str {
        self.id
    }

    fn version(&self) -> u32 {
        1
    }

    fn supports(&self, source: &PreviewSource) -> bool {
        match self.kind {
            SpecialKind::Raw => crate::special_images::is_raw_extension(&source.extension),
            SpecialKind::CodecImage => {
                crate::special_images::is_codec_image_extension(&source.extension)
            }
            _ => false,
        }
    }

    fn produce(
        &self,
        source: &PreviewSource,
        edge: u32,
        context: &JobContext,
    ) -> Result<PreparedThumbnail, String> {
        if context.token().load(std::sync::atomic::Ordering::Relaxed) {
            return Err("thumbnail.failed".to_string());
        }
        let (png, _width, _height) = crate::raw_helper::decode_in_helper(
            context
                .app()
                .state::<Arc<crate::cache::CacheService>>()
                .inner(),
            &source.path,
            self.kind,
            edge,
            false,
            context.token(),
        )?;
        temp_file(&png, &source.stamp, context)
    }
}

struct ModelProvider;

impl ThumbnailProvider for ModelProvider {
    fn id(&self) -> &'static str {
        "model"
    }

    fn version(&self) -> u32 {
        1
    }

    fn supports(&self, source: &PreviewSource) -> bool {
        matches!(
            source.extension.to_ascii_lowercase().as_str(),
            "stl" | "obj" | "gltf" | "glb" | "3mf"
        )
    }

    fn produce(
        &self,
        source: &PreviewSource,
        _edge: u32,
        context: &JobContext,
    ) -> Result<PreparedThumbnail, String> {
        let config = WebviewHelperConfig {
            kind: WebviewHelperKind::Model,
            entry: "model-helper.html",
            max_body_bytes: 768 * 1024,
            max_output_bytes: 16 * 1024 * 1024,
            data_dir: crate::resolve_data_dir(),
            placement: HelperWindowPlacement::Hidden,
        };
        let input = grant(source);
        let payload = serde_json::json!({
            "grant_id": input.grant_id.to_string(),
            "extension": source.extension,
            "resource_grants": [],
            "thumbnail_edge": 256,
        });
        let request = WebviewHelperRequest {
            request_id: Uuid::new_v4(),
            action: HelperAction::ModelOpen,
            payload,
            output_specs: vec![HelperOutputSpec {
                mime: "image/png".to_string(),
                max_bytes: 16 * 1024 * 1024,
            }],
        };
        let result = run_webview_helper(config, vec![input], request, context.token().clone())?;
        let output = result
            .outputs
            .into_iter()
            .next()
            .ok_or_else(|| "thumbnail.failed".to_string())?;
        let bytes = match output.storage {
            HelperOutputStorage::Memory(bytes) => bytes.to_vec(),
            HelperOutputStorage::OwnedFile(mut owned) => {
                use std::io::{Read, Seek, SeekFrom};
                let file = owned.file_mut();
                file.seek(SeekFrom::Start(0))
                    .map_err(|_| "thumbnail.failed".to_string())?;
                let mut bytes = Vec::new();
                file.read_to_end(&mut bytes)
                    .map_err(|_| "thumbnail.failed".to_string())?;
                bytes
            }
        };
        temp_file(&bytes, &source.stamp, context)
    }
}

/// Register all four actual providers. Coordinator calls this once after the
/// 07a registry exists; no provider is registered before its code exists.
pub fn register_special_providers(registry: &mut ThumbnailProviderRegistry) -> Result<(), String> {
    registry.register(Arc::new(ModelProvider))?;
    registry.register(Arc::new(PsdProvider))?;
    registry.register(image_provider("special_raw", SpecialKind::Raw))?;
    registry.register(image_provider("special_codec", SpecialKind::CodecImage))?;
    Ok(())
}

struct PsdProvider;

impl ThumbnailProvider for PsdProvider {
    fn id(&self) -> &'static str {
        "special_psd"
    }

    fn version(&self) -> u32 {
        1
    }

    fn supports(&self, source: &PreviewSource) -> bool {
        source.extension.eq_ignore_ascii_case("psd")
    }

    fn produce(
        &self,
        source: &PreviewSource,
        edge: u32,
        context: &JobContext,
    ) -> Result<PreparedThumbnail, String> {
        crate::psd_raster::rasterize_psd(grant(source), edge, context)
    }
}
