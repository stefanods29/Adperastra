//! Safe recipe exports (Step 15 T4, `E3`).
//!
//! The captured recipe is immutable. Native validation repeats every recipe
//! bound, refuses sensitive sources and arbitrary graphs, and builds a plan
//! from the fixed filter allowlist. The engine adapter is replaceable; with
//! no verified pack the command fails closed with `engines.pack_missing`,
//! while the ordinary player keeps working.
#![allow(dead_code)]


use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State, WebviewWindow};
use tauri::Manager;

use crate::engine_types::EngineError;
use crate::file_grant_backing::MAX_BACKING_CHUNK;
use crate::jobs::spawn_job;
use crate::media_edit_types::{
    decode_recipe, MediaEditError, MediaRecipe, MediaSubtitleCue, MediaSubtitleMode,
    MAX_MEDIA_RECIPE_BYTES,
};

/// The only filter names an export graph may contain (`D3`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "filter", rename_all = "snake_case")]
pub enum MediaFilter {
    Crop { x: u32, y: u32, width: u32, height: u32 },
    Transpose { quarter_turns: u16 },
    SetPts { speed: f64 },
    Atempo { factor: f64 },
    Volume { gain: f64 },
    Concat { inputs: u32 },
    SubtitlesOverlay,
}

/// One fully validated export plan; no path or text becomes filter syntax.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaExportPlan {
    pub schema_version: u32,
    pub project_id: uuid::Uuid,
    pub content_id: uuid::Uuid,
    pub converter_id: String,
    pub dest_dir: String,
    pub duration_us: u64,
    pub filters: Vec<MediaFilter>,
    pub subtitles: Vec<MediaSubtitleCue>,
    pub subtitle_mode: MediaSubtitleMode,
    pub metadata_keep: bool,
    pub request_revision: u32,
}

/// The captured recipe bytes. The coordinator binds this to 08a's
/// `ExportSnapshots` registry; this module never opens a user path.
pub trait RecipeSnapshotStore: Send + Sync {
    fn read_recipe(
        &self,
        snapshot_id: &str,
        request: &convert::ConversionRequest,
        max_bytes: usize,
    ) -> Result<Vec<u8>, String>;
}

/// Concrete 08a adapter: resolves the exact immutable capture the request
/// names, reads it in bounded chunks and verifies the published SHA-256.
/// It never opens a user path and never accepts a snapshot for another
/// document/revision.
pub struct ExportSnapshotsRecipeStore {
    snapshots: Arc<crate::export_snapshots::ExportSnapshots>,
}

impl ExportSnapshotsRecipeStore {
    pub fn new(snapshots: Arc<crate::export_snapshots::ExportSnapshots>) -> Self {
        Self { snapshots }
    }
}

impl RecipeSnapshotStore for ExportSnapshotsRecipeStore {
    fn read_recipe(
        &self,
        snapshot_id: &str,
        request: &convert::ConversionRequest,
        max_bytes: usize,
    ) -> Result<Vec<u8>, String> {
        let (document_id, revision) = match request.inputs.as_slice() {
            [convert::ConversionInput::Snapshot {
                snapshot_id: requested,
                document_id,
                revision,
            }] if requested == snapshot_id => (document_id.as_str(), *revision),
            _ => return Err(MediaEditError::Changed.message()),
        };
        let lease = self.snapshots.resolve(snapshot_id, document_id, revision)?;
        if lease.snapshot.mime != crate::media_edit_types::MEDIA_EDIT_MIME
            || lease.snapshot.storage_policy
                == crate::export_snapshot_types::StoragePolicy::Sensitive
            || lease.backing.is_sensitive()
        {
            return Err(MediaEditError::Unsupported.message());
        }
        let byte_len = usize::try_from(lease.snapshot.byte_len)
            .map_err(|_| MediaEditError::TooLarge.message())?;
        if byte_len == 0 || byte_len > max_bytes || byte_len > MAX_MEDIA_RECIPE_BYTES {
            return Err(MediaEditError::TooLarge.message());
        }
        let mut bytes = Vec::with_capacity(byte_len);
        let mut offset = 0u64;
        while bytes.len() < byte_len {
            let remaining = byte_len - bytes.len();
            let take = remaining.min(MAX_BACKING_CHUNK);
            let chunk = lease
                .backing
                .read_range(offset, take)
                .map_err(|_| MediaEditError::Failed.message())?;
            if chunk.is_empty() {
                return Err(MediaEditError::Changed.message());
            }
            offset += chunk.len() as u64;
            bytes.extend_from_slice(&chunk);
        }
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        if hex::encode(hasher.finalize()) != lease.content_sha256 {
            return Err(MediaEditError::Changed.message());
        }
        Ok(bytes)
    }
}

/// The confined media engine adapter. It receives only the validated plan
/// and the shared cancellation token; it never sees a user path.
pub trait RecipeExportBackend: Send + Sync {
    fn export(
        &self,
        plan: MediaExportPlan,
        cancel: &fs_service::CancellationToken,
    ) -> Result<serde_json::Value, String>;
}

#[derive(Default)]
pub struct MediaRecipeExport {
    store: Mutex<Option<Arc<dyn RecipeSnapshotStore>>>,
    backend: Mutex<Option<Arc<dyn RecipeExportBackend>>>,
}

impl MediaRecipeExport {
    fn lock_store(&self) -> Result<MutexGuard<'_, Option<Arc<dyn RecipeSnapshotStore>>>, String> {
        self.store
            .lock()
            .map_err(|_| MediaEditError::Failed.message())
    }

    fn lock_backend(&self) -> Result<MutexGuard<'_, Option<Arc<dyn RecipeExportBackend>>>, String> {
        self.backend
            .lock()
            .map_err(|_| MediaEditError::Failed.message())
    }

    pub fn install_store(&self, store: Arc<dyn RecipeSnapshotStore>) -> Result<(), String> {
        let mut slot = self.lock_store()?;
        if slot.is_some() {
            return Err(MediaEditError::Failed.message());
        }
        *slot = Some(store);
        Ok(())
    }

    pub fn install_backend(&self, backend: Arc<dyn RecipeExportBackend>) -> Result<(), String> {
        let mut slot = self.lock_backend()?;
        if slot.is_some() {
            return Err(MediaEditError::Failed.message());
        }
        *slot = Some(backend);
        Ok(())
    }

    fn store(&self) -> Option<Arc<dyn RecipeSnapshotStore>> {
        self.lock_store().ok().and_then(|slot| slot.clone())
    }

    fn backend(&self) -> Option<Arc<dyn RecipeExportBackend>> {
        self.lock_backend().ok().and_then(|slot| slot.clone())
    }

    /// Builds a plan; without a verified engine the caller already fails.
    pub fn plan(
        &self,
        snapshot_id: &str,
        request: &convert::ConversionRequest,
    ) -> Result<MediaExportPlan, String> {
        let store = self
            .store()
            .ok_or_else(|| MediaEditError::Unsupported.message())?;
        validate_request_shape(snapshot_id, request)?;
        let bytes = store.read_recipe(snapshot_id, request, MAX_MEDIA_RECIPE_BYTES)?;
        if bytes.len() > MAX_MEDIA_RECIPE_BYTES {
            return Err(MediaEditError::TooLarge.message());
        }
        let recipe = decode_recipe(&bytes)?.normalize()?;
        build_plan(&recipe, request)
    }

    fn export_value(
        &self,
        plan: MediaExportPlan,
        cancel: &fs_service::CancellationToken,
    ) -> Result<serde_json::Value, String> {
        let backend = self
            .backend()
            .ok_or_else(|| EngineError::PackMissing.message())?;
        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            return Err(EngineError::Cancelled.message());
        }
        backend.export(plan, cancel)
    }
}

fn request_value(request: &convert::ConversionRequest) -> Result<serde_json::Value, String> {
    serde_json::to_value(request).map_err(|_| MediaEditError::BadRequest.message())
}

fn validate_request_shape(snapshot_id: &str, request: &convert::ConversionRequest) -> Result<(), String> {
    if snapshot_id.is_empty() || snapshot_id.len() > 128 {
        return Err(MediaEditError::BadRequest.message());
    }
    let value = request_value(request)?;
    let inputs = value
        .get("inputs")
        .and_then(|inputs| inputs.as_array())
        .ok_or_else(|| MediaEditError::BadRequest.message())?;
    if inputs.len() != 1 {
        return Err(MediaEditError::BadRequest.message());
    }
    let input = &inputs[0];
    if input.get("kind").and_then(|kind| kind.as_str()) != Some("snapshot") {
        return Err(MediaEditError::Unsupported.message());
    }
    if input.get("snapshot_id").and_then(|id| id.as_str()) != Some(snapshot_id) {
        return Err(MediaEditError::Changed.message());
    }
    if value.get("keep_original").and_then(|keep| keep.as_bool()) != Some(true) {
        return Err(MediaEditError::ReadOnly.message());
    }
    let dest = value
        .get("dest_dir")
        .and_then(|dest| dest.as_str())
        .ok_or_else(|| MediaEditError::BadRequest.message())?;
    if !Path::new(dest).is_absolute() || dest.contains("..") {
        return Err(MediaEditError::BadRequest.message());
    }
    let options = value
        .get("options")
        .ok_or_else(|| MediaEditError::BadRequest.message())?;
    if options.get("kind").and_then(|kind| kind.as_str()) != Some("media") {
        return Err(MediaEditError::Unsupported.message());
    }
    Ok(())
}

fn filters_for_recipe(recipe: &MediaRecipe) -> Result<Vec<MediaFilter>, String> {
    let mut filters = Vec::new();
    if let Some(crop) = recipe.crop {
        filters.push(MediaFilter::Crop {
            x: crop.x,
            y: crop.y,
            width: crop.width,
            height: crop.height,
        });
    }
    if recipe.rotation != 0 {
        filters.push(MediaFilter::Transpose {
            quarter_turns: recipe.rotation / 90,
        });
    }
    for segment in &recipe.segments {
        if (segment.speed - 1.0).abs() > f64::EPSILON {
            filters.push(MediaFilter::SetPts {
                speed: segment.speed,
            });
            filters.push(MediaFilter::Atempo {
                factor: segment.speed,
            });
        }
    }
    if recipe.mute {
        filters.push(MediaFilter::Volume { gain: 0.0 });
    } else if (recipe.volume - 1.0).abs() > f64::EPSILON {
        filters.push(MediaFilter::Volume {
            gain: recipe.volume,
        });
    }
    if recipe.segments.len() > 1 {
        filters.push(MediaFilter::Concat {
            inputs: u32::try_from(recipe.segments.len())
                .map_err(|_| MediaEditError::TooLarge.message())?,
        });
    }
    if recipe.subtitle_mode == MediaSubtitleMode::Burn {
        if recipe.subtitles.is_empty() {
            return Err(MediaEditError::BadRequest.message());
        }
        filters.push(MediaFilter::SubtitlesOverlay);
    }
    Ok(filters)
}

/// The pure plan builder shared by the command and the named tests.
pub fn plan_for_recipe(
    recipe: &MediaRecipe,
    converter_id: &str,
    dest_dir: &str,
    request_revision: u32,
) -> Result<MediaExportPlan, String> {
    if recipe.sources.iter().any(|source| source.sensitive) {
        return Err(MediaEditError::Unsupported.message());
    }
    if !converter_id.starts_with("media/") || converter_id.len() > 64 {
        return Err(MediaEditError::Unsupported.message());
    }
    if !Path::new(dest_dir).is_absolute() {
        return Err(MediaEditError::BadRequest.message());
    }
    Ok(MediaExportPlan {
        schema_version: 1,
        project_id: recipe.project_id,
        content_id: recipe.content_id,
        converter_id: converter_id.to_string(),
        dest_dir: dest_dir.to_string(),
        duration_us: recipe.duration_us()?,
        filters: filters_for_recipe(recipe)?,
        subtitles: recipe.subtitles.clone(),
        subtitle_mode: recipe.subtitle_mode,
        metadata_keep: recipe.metadata_keep,
        request_revision,
    })
}

fn build_plan(
    recipe: &MediaRecipe,
    request: &convert::ConversionRequest,
) -> Result<MediaExportPlan, String> {
    let value = request_value(request)?;
    let converter_id = value
        .get("converter_id")
        .and_then(|id| id.as_str())
        .ok_or_else(|| MediaEditError::BadRequest.message())?;
    let dest_dir = value
        .get("dest_dir")
        .and_then(|dest| dest.as_str())
        .ok_or_else(|| MediaEditError::BadRequest.message())?;
    let request_revision = value
        .get("request_revision")
        .and_then(|revision| revision.as_u64())
        .unwrap_or(1);
    plan_for_recipe(
        recipe,
        converter_id,
        dest_dir,
        u32::try_from(request_revision).map_err(|_| MediaEditError::BadRequest.message())?,
    )
}

/// Starts one recipe export job (`E3`). A missing pack fails before a job.
#[tauri::command]
pub async fn media_recipe_export_start(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, Arc<MediaRecipeExport>>,
    request_id: String,
    snapshot_id: String,
    request: convert::ConversionRequest,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    let state = state.inner().clone();
    if state.backend().is_none() {
        return Err(EngineError::PackMissing.message());
    }
    let jobs = app.state::<crate::jobs::Jobs>();
    let token = jobs.begin(&request_id, 1)?;
    let id = request_id.clone();
    spawn_job(app.clone(), id, token, move |context| {
        let plan = state.plan(&snapshot_id, &request)?;
        state.export_value(plan, context.token())
    });
    Ok(())
}

#[cfg(test)]
#[path = "media_export_step15_tests.rs"]
mod step15_tests;
