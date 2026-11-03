//! Native special-view backend (Step 07g T2-T5).

#[path = "special_psd_backend.rs"]
mod psd;
use psd::open_psd;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use fs_service::owned_io::{PinnedSource, SourceIdentity};
use uuid::Uuid;

use crate::special_images::validate_png;
use crate::special_scene::finalize_safe_scene;
use crate::special_view_jobs::{
    OpenArtifact, PreparedImage, PsdOpen, PsdPage, SceneArtifact, SpecialBackend,
};
use crate::special_view_types::{PsdLayerInfo, SceneUnit, SpecialKind, SPECIAL_MAX_SOURCE_BYTES};
use crate::webview_helper::{start_webview_helper, WebviewHelperSession};
use crate::webview_helper_types::{
    HelperAction, HelperInputGrant, HelperInputSource, HelperOutputSpec, HelperOutputStorage,
    HelperWindowPlacement, WebviewHelperConfig, WebviewHelperKind, WebviewHelperRequest,
};

fn disk_grant(
    path: &Path,
    stamp: &fs_service::SourceStamp,
    name: &str,
    mime: &str,
) -> Result<HelperInputGrant, String> {
    let identity = SourceIdentity::capture(path).map_err(|_| "special_view.changed".to_string())?;
    let pinned = PinnedSource::open_background(path, &identity)
        .map_err(|_| "special_view.changed".to_string())?;
    Ok(HelperInputGrant {
        grant_id: Uuid::new_v4(),
        name: name.to_string(),
        mime: mime.to_string(),
        source: HelperInputSource::Disk {
            path: path.to_path_buf(),
            expected: stamp.clone(),
            pinned: Arc::new(pinned),
        },
    })
}

fn output_bytes(output: crate::webview_helper_types::HelperOutput) -> Result<Vec<u8>, String> {
    match output.storage {
        HelperOutputStorage::Memory(bytes) => Ok(bytes.to_vec()),
        HelperOutputStorage::OwnedFile(mut owned) => {
            use std::io::{Read, Seek, SeekFrom};
            let file = owned.file_mut();
            file.seek(SeekFrom::Start(0))
                .map_err(|_| "special_view.unavailable".to_string())?;
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes)
                .map_err(|_| "special_view.unavailable".to_string())?;
            Ok(bytes)
        }
    }
}

fn unit_from(value: Option<&str>) -> SceneUnit {
    value
        .and_then(|text| SceneUnit::parse(text).ok())
        .unwrap_or(SceneUnit::None)
}

pub struct NativeSpecialBackend {
    pub data_dir: PathBuf,
    pub cache: Arc<crate::cache::CacheService>,
    pub cancel: fs_service::CancellationToken,
}

impl SpecialBackend for NativeSpecialBackend {
    fn open(
        &self,
        source: &fs_service::SourceStamp,
        path: &Path,
        kind: SpecialKind,
        stamp_for: &dyn Fn(&Path) -> Result<fs_service::SourceStamp, String>,
        cancel: &fs_service::CancellationToken,
    ) -> Result<OpenArtifact, String> {
        match kind {
            SpecialKind::Raw | SpecialKind::CodecImage => {
                let image = decode_image(&self.cache, path, kind, 2048, false, cancel)?;
                Ok(OpenArtifact {
                    preview: Some(image),
                    scene: None,
                    psd: None,
                    helper: None,
                    codec_required: false,
                    partial: false,
                })
            }
            SpecialKind::Psd => open_psd(self, source, path, cancel),
            SpecialKind::Model => open_model(self, source, path, stamp_for, cancel),
        }
    }

    fn full_raw(
        &self,
        _source: &fs_service::SourceStamp,
        path: &Path,
        edge: u32,
        cancel: &fs_service::CancellationToken,
    ) -> Result<PreparedImage, String> {
        decode_image(&self.cache, path, SpecialKind::Raw, edge, true, cancel)
    }

    fn psd_layers(
        &self,
        helper: &mut Option<WebviewHelperSession>,
        offset: u32,
    ) -> Result<PsdPage, String> {
        let session = helper
            .as_mut()
            .ok_or_else(|| "special_view.unavailable".to_string())?;
        let request = WebviewHelperRequest {
            request_id: Uuid::new_v4(),
            action: HelperAction::PsdLayers,
            payload: serde_json::json!({ "offset": offset }),
            output_specs: Vec::new(),
        };
        let result = session.request(request, self.cancel.clone())?;
        let complete = result
            .reply
            .get("complete")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        let entries = result
            .reply
            .get("layers")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        if entries.len() > crate::special_view_types::PSD_LAYER_PAGE as usize {
            return Err("special_view.corrupt".to_string());
        }
        let mut layers = Vec::new();
        for entry in entries {
            let id = entry
                .get("id")
                .and_then(|value| value.as_u64())
                .ok_or_else(|| "special_view.corrupt".to_string())? as u32;
            let parent = entry
                .get("parent")
                .and_then(|value| value.as_u64())
                .map(|value| value as u32);
            let name = entry
                .get("name")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_string();
            if name.chars().count() > 512 {
                return Err("special_view.corrupt".to_string());
            }
            let visible = entry
                .get("visible")
                .and_then(|value| value.as_bool())
                .unwrap_or(true);
            let opacity = entry
                .get("opacity")
                .and_then(|value| value.as_f64())
                .unwrap_or(1.0);
            if !opacity.is_finite() || !(0.0..=1.0).contains(&opacity) {
                return Err("special_view.corrupt".to_string());
            }
            let children_count = entry
                .get("children_count")
                .and_then(|value| value.as_u64())
                .unwrap_or(0) as u32;
            layers.push(PsdLayerInfo {
                id,
                parent,
                name,
                visible,
                opacity,
                children_count,
            });
        }
        Ok(PsdPage { layers, complete })
    }
}

fn decode_image(
    cache: &crate::cache::CacheService,
    path: &Path,
    kind: SpecialKind,
    edge: u32,
    full: bool,
    cancel: &fs_service::CancellationToken,
) -> Result<PreparedImage, String> {
    match crate::raw_helper::decode_in_helper(cache, path, kind, edge, full, cancel) {
        Ok((png, width, height)) => Ok(PreparedImage {
            png,
            width,
            height,
            codec_required: false,
            partial: false,
        }),
        Err(error) if error == "special_view.codec_required" => Ok(PreparedImage {
            png: Vec::new(),
            width: 0,
            height: 0,
            codec_required: true,
            partial: false,
        }),
        Err(error) => Err(error),
    }
}

fn open_model(
    backend: &NativeSpecialBackend,
    source: &fs_service::SourceStamp,
    path: &Path,
    stamp_for: &dyn Fn(&Path) -> Result<fs_service::SourceStamp, String>,
    cancel: &fs_service::CancellationToken,
) -> Result<OpenArtifact, String> {
    let resources = crate::special_model_resources::collect(path, source, stamp_for)?;
    let resource_partial = resources.partial;
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let main = disk_grant(
        path,
        source,
        path.file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default()
            .as_str(),
        "application/octet-stream",
    )?;
    let mut inputs = vec![main];
    let mut references = Vec::new();
    for resource in resources.disk {
        let grant = disk_grant(
            &resource.path,
            &resource.stamp,
            &resource.name,
            &resource.mime,
        )?;
        references.push(
            serde_json::json!({ "name": resource.name, "grant_id": grant.grant_id.to_string() }),
        );
        inputs.push(grant);
    }
    for (name, bytes) in resources.memory {
        let document_id: String = name.chars().take(128).collect();
        let grant = HelperInputGrant {
            grant_id: Uuid::new_v4(),
            name: name.clone(),
            mime: "image/png".to_string(),
            source: HelperInputSource::Memory {
                data: Arc::new(zeroize::Zeroizing::new(bytes)),
                document_id,
                revision: 1,
                content_id: Uuid::new_v4(),
                sensitive: false,
            },
        };
        references
            .push(serde_json::json!({ "name": name, "grant_id": grant.grant_id.to_string() }));
        inputs.push(grant);
    }
    let config = WebviewHelperConfig {
        kind: WebviewHelperKind::Model,
        entry: "model-helper.html",
        max_body_bytes: 768 * 1024,
        max_output_bytes: 512 * 1024 * 1024,
        data_dir: backend.data_dir.clone(),
        placement: HelperWindowPlacement::Hidden,
    };
    let request = WebviewHelperRequest {
        request_id: Uuid::new_v4(),
        action: HelperAction::ModelOpen,
        payload: serde_json::json!({
            "grant_id": inputs[0].grant_id.to_string(),
            "extension": extension,
            "resource_grants": references,
        }),
        output_specs: std::iter::once(HelperOutputSpec {
            mime: "application/x-adperastra-scene".to_string(),
            max_bytes: SPECIAL_MAX_SOURCE_BYTES,
        })
        .chain((0..32).map(|_| HelperOutputSpec {
            mime: "image/png".to_string(),
            max_bytes: 16 * 1024 * 1024,
        }))
        .collect(),
    };
    let result =
        crate::webview_helper::run_webview_helper(config, inputs, request, cancel.clone())?;
    if cancel.load(std::sync::atomic::Ordering::Relaxed) {
        return Err("special_view.unavailable".to_string());
    }
    let mut outputs = result.outputs.into_iter();
    let scene_output = outputs
        .next()
        .ok_or_else(|| "special_view.corrupt".to_string())?;
    let mut scene_bytes = output_bytes(scene_output)?;
    let summary = finalize_safe_scene(&mut scene_bytes)?;
    let mut textures = Vec::new();
    for output in outputs.take(32) {
        let bytes = output_bytes(output)?;
        let (width, height) = validate_png(&bytes)?;
        textures.push(PreparedImage {
            png: bytes,
            width,
            height,
            codec_required: false,
            partial: false,
        });
    }
    let unit = unit_from(result.reply.get("unit").and_then(|value| value.as_str()));
    let partial = resource_partial
        || result
            .reply
            .get("partial")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
    Ok(OpenArtifact {
        preview: None,
        scene: Some(SceneArtifact {
            bytes: scene_bytes,
            summary,
            textures,
            unit,
            partial,
        }),
        psd: None,
        helper: None,
        codec_required: false,
        partial,
    })
}
