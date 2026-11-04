//! Special-view orchestration (Step 07g T2-T5).
//!
//! A backend does the risky work (isolated helpers, WIC); this module owns
//! publication, leasing, source validation and session state. Tests inject
//! a fake backend, so helper crashes and late results are exercised without
//! launching a WebView.
#[path = "special_texture_publication.rs"]
mod texture_publication;
use crate::cache::CacheService;
use crate::special_scene::{finalize_safe_scene, SafeSceneSummary};
use crate::special_view_session::{SpecialSessionState, SpecialViews};
use crate::special_view_types::{
    PsdLayerInfo, SceneInfo, SceneUnit, SpecialKind, SpecialSession, SPECIAL_MAX_PREVIEW_BYTES,
    SPECIAL_MAX_SOURCE_BYTES, SPECIAL_MAX_TEXTURES,
};
use crate::webview_helper::WebviewHelperSession;
use cache_store::CacheLease;
use cache_store::{CacheKey, CacheKind};
use fs_service::{CancellationToken, SourceStamp};
use std::io::Write;
use std::path::Path;
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct PreparedImage {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub codec_required: bool,
    pub partial: bool,
}

#[derive(Debug, Clone)]
pub struct SceneArtifact {
    pub bytes: Vec<u8>,
    pub summary: SafeSceneSummary,
    pub textures: Vec<PreparedImage>,
    pub unit: SceneUnit,
    pub partial: bool,
}

#[derive(Debug, Clone)]
pub struct PsdOpen {
    pub width: u32,
    pub height: u32,
    pub layer_count: u32,
    pub composite: bool,
}

pub struct OpenArtifact {
    pub preview: Option<PreparedImage>,
    pub scene: Option<SceneArtifact>,
    pub psd: Option<PsdOpen>,
    pub helper: Option<WebviewHelperSession>,
    pub codec_required: bool,
    pub partial: bool,
}

#[derive(Debug, Clone)]
pub struct PsdPage {
    pub layers: Vec<PsdLayerInfo>,
    pub complete: bool,
}

/// The risky half of a special view. The real implementation launches the
/// 07d helper or WIC; tests inject a bounded fake.
pub trait SpecialBackend: Send + Sync {
    fn open(
        &self,
        source: &SourceStamp,
        path: &Path,
        kind: SpecialKind,
        stamp_for: &dyn Fn(&Path) -> Result<SourceStamp, String>,
        cancel: &CancellationToken,
    ) -> Result<OpenArtifact, String>;

    fn full_raw(
        &self,
        source: &SourceStamp,
        path: &Path,
        edge: u32,
        cancel: &CancellationToken,
    ) -> Result<PreparedImage, String>;

    fn psd_layers(
        &self,
        helper: &mut Option<WebviewHelperSession>,
        offset: u32,
    ) -> Result<PsdPage, String>;
}

fn key(source: &SourceStamp, kind: CacheKind, handler: &str, options: &str) -> CacheKey {
    CacheKey {
        source: source.clone(),
        kind,
        handler_id: handler.replace('_', "-"),
        handler_version: 1,
        options_key: options.to_string(),
    }
}

/// Publish one in-memory PNG through the shared cache. The temporary file
/// is internal to this operation; it is never next to a user's file.
fn publish_image(
    cache: &CacheService,
    source: &SourceStamp,
    handler: &str,
    image: &PreparedImage,
) -> Result<CacheLease, String> {
    if image.png.is_empty()
        || image.width == 0
        || image.height == 0
        || image.png.len() as u64 > SPECIAL_MAX_PREVIEW_BYTES
    {
        return Err("special_view.too_large".to_string());
    }
    match publish_image_disk(cache, source, handler, image) {
        Err(error) if error == "special_view.too_large" => cache.lease_memory(
            Arc::new(zeroize::Zeroizing::new(image.png.clone())),
            "preview.png",
            "image/png",
            Some(image.width),
            Some(image.height),
            false,
        ),
        other => other,
    }
}

fn publish_image_disk(
    cache: &CacheService,
    source: &SourceStamp,
    handler: &str,
    image: &PreparedImage,
) -> Result<CacheLease, String> {
    if image.png.is_empty() || image.png.len() as u64 > SPECIAL_MAX_PREVIEW_BYTES {
        return Err("special_view.too_large".to_string());
    }
    publish_bytes(
        cache,
        &key(
            source,
            CacheKind::Thumbnail,
            handler,
            &format!("edge={}", image.width.max(image.height)),
        ),
        &image.png,
        "image/png",
        Some(image.width),
        Some(image.height),
        SPECIAL_MAX_PREVIEW_BYTES,
    )
}

fn publish_bytes(
    cache: &CacheService,
    key: &CacheKey,
    bytes: &[u8],
    mime: &str,
    width: Option<u32>,
    height: Option<u32>,
    cap: u64,
) -> Result<CacheLease, String> {
    if bytes.is_empty() || bytes.len() as u64 > cap {
        return Err("special_view.too_large".into());
    }
    let mut owned = cache.with_store(|store| {
        store
            .with_staging_budget(bytes.len() as u64, || {
                let directory = fs_service::owned_io::PinnedDirectory::open(&cache.pending_dir())?;
                let mut output = fs_service::owned_io::OwnedOutput::create(&directory, "special")?;
                output.file_mut().write_all(bytes)?;
                output.flush_sync()?;
                Ok(output)
            })
            .map_err(|_| "special_view.unavailable".to_string())
    })?;
    let record = cache.publish_result(key, owned.file_mut(), mime, width, height, cap)?;
    cache.lease(&record)
}

/// Open a session, publish only validated outputs, then publish the session
/// itself. A failure anywhere leaves no half session in the map.
struct LeaseGuard<'a> {
    cache: &'a CacheService,
    ids: Vec<String>,
    armed: bool,
}

impl<'a> LeaseGuard<'a> {
    fn new(cache: &'a CacheService) -> Self {
        Self {
            cache,
            ids: Vec::new(),
            armed: true,
        }
    }

    fn add(&mut self, lease: &CacheLease) {
        self.ids.push(lease.lease_id.clone());
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for LeaseGuard<'_> {
    fn drop(&mut self) {
        if self.armed {
            for id in &self.ids {
                let _ = self.cache.release(id);
            }
        }
    }
}

pub fn open_session(
    backend: &dyn SpecialBackend,
    views: &SpecialViews,
    cache: &CacheService,
    source: SourceStamp,
    path: &Path,
    kind: SpecialKind,
    cancel: &CancellationToken,
) -> Result<SpecialSession, String> {
    if source.size_bytes == 0 || source.size_bytes > SPECIAL_MAX_SOURCE_BYTES {
        return Err("special_view.too_large".to_string());
    }
    let artifact = backend.open(
        &source,
        path,
        kind,
        &|candidate| cache.source_stamp(candidate),
        cancel,
    )?;
    let session_id = uuid::Uuid::new_v4().to_string();
    let mut state = SpecialSessionState::new(session_id, source.clone(), kind);
    let mut lease_guard = LeaseGuard::new(cache);

    if let Some(scene) = artifact.scene {
        let mut bytes = scene.bytes;
        if bytes.len() as u64 > SPECIAL_MAX_SOURCE_BYTES {
            return Err("special_view.too_large".to_string());
        }
        let summary = finalize_safe_scene(&mut bytes)?;
        let geometry = publish_bytes(
            cache,
            &key(&source, CacheKind::ModelScene, "model", "scene=1"),
            &bytes,
            "application/x-adperastra-scene",
            None,
            None,
            SPECIAL_MAX_SOURCE_BYTES,
        )?;
        lease_guard.add(&geometry);
        let textures = texture_publication::publish_textures(
            cache,
            &source,
            &scene.textures,
            &mut lease_guard,
        )?;
        state.scene = Some(SceneInfo {
            session_id: state.session_id.clone(),
            geometry,
            object_count: summary.object_count,
            vertex_count: summary.vertex_count,
            triangle_count: summary.triangle_count,
            bounds: summary.bounds,
            unit: scene.unit,
            textures,
            partial: scene.partial,
        });
        state.unit = scene.unit;
        state.partial |= scene.partial;
    }

    if let Some(preview) = artifact.preview {
        match publish_image(cache, &source, preview_handler(kind), &preview) {
            Ok(lease) => {
                lease_guard.add(&lease);
                state.preview = Some(lease);
                state.width = Some(preview.width);
                state.height = Some(preview.height);
                state.codec_required = preview.codec_required;
                state.partial |= preview.partial;
            }
            Err(error) => {
                if preview.codec_required {
                    state.codec_required = true;
                } else {
                    return Err(error);
                }
            }
        }
    }

    if let Some(psd) = artifact.psd {
        state.psd_layer_count = psd.layer_count;
        state.psd_composite = psd.composite;
        state.width = Some(psd.width);
        state.height = Some(psd.height);
    }
    state.psd_helper = artifact.helper;
    state.codec_required |= artifact.codec_required;
    state.partial |= artifact.partial;

    if kind == SpecialKind::Model && state.scene.is_none() {
        return Err("special_view.unsupported".to_string());
    }
    if kind.is_image() && state.preview.is_none() && !state.codec_required {
        return Err("special_view.unsupported".to_string());
    }

    let wire = state.wire();
    views.insert(state)?;
    lease_guard.disarm();
    Ok(wire)
}

fn preview_handler(kind: SpecialKind) -> &'static str {
    match kind {
        SpecialKind::Raw => "special_raw",
        SpecialKind::CodecImage => "special_codec",
        SpecialKind::Psd => "special_psd",
        SpecialKind::Model => "special_preview",
    }
}

/// E3: replace the embedded preview with a full decoded frame.
pub fn refresh_raw_preview(
    backend: &dyn SpecialBackend,
    cache: &CacheService,
    state: &mut SpecialSessionState,
    path: &Path,
    edge: u32,
    cancel: &CancellationToken,
) -> Result<SpecialSession, String> {
    if !(1..=16_384).contains(&edge) {
        return Err("special_view.bad_request".to_string());
    }
    let image = backend.full_raw(&state.source, path, edge, cancel)?;
    if image.codec_required {
        state.codec_required = true;
        return Ok(state.wire());
    }
    let lease = publish_image(cache, &state.source, "special_raw_full", &image)?;
    if let Some(old) = state.preview.take() {
        let _ = cache.release(&old.lease_id);
    }
    state.preview = Some(lease);
    state.width = Some(image.width);
    state.height = Some(image.height);
    state.partial |= image.partial;
    Ok(state.wire())
}

/// E4: read one layer page through the persistent PSD helper.
pub fn read_psd_page(
    backend: &dyn SpecialBackend,
    state: &mut SpecialSessionState,
    cursor: Option<&str>,
) -> Result<crate::special_view_types::PsdInfo, String> {
    if state.kind != SpecialKind::Psd {
        return Err("special_view.bad_request".to_string());
    }
    let offset = match cursor {
        Some(cursor) => state.offset_for_cursor(cursor)?,
        None => 0,
    };
    let page = backend.psd_layers(&mut state.psd_helper, offset)?;
    if page.layers.len() > crate::special_view_types::PSD_LAYER_PAGE as usize {
        return Err("special_view.corrupt".to_string());
    }
    if offset.saturating_add(page.layers.len() as u32) > state.psd_layer_count {
        return Err("special_view.corrupt".to_string());
    }
    Ok(state.page_layers(page.layers, offset, page.complete))
}

#[cfg(test)]
#[path = "special_view_jobs_tests.rs"]
mod tests;
