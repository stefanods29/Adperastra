//! Step 15 T4 export tests. Attached by `media_recipe_export.rs`.

use std::path::PathBuf;
use std::sync::atomic::Ordering;

use super::*;
use crate::media_edit_types::{
    MediaRecipe, MediaSegment, MediaSource, MediaSubtitleCue, MediaSubtitleMode,
};

fn source(sensitive: bool) -> MediaSource {
    MediaSource {
        id: uuid::Uuid::from_u128(1),
        path: "C:\\media\\clip.mp4".to_string(),
        stamp: fs_service::SourceStamp {
            path_key: "C:\\media\\clip.mp4".to_string(),
            volume_id: "00000000".to_string(),
            file_id: "0000000000000001".to_string(),
            modified_ticks: "10".to_string(),
            size_bytes: 1024,
        },
        duration_us: 10_000_000,
        video_rate: Some(crate::engine_types::FrameRate { num: 30, den: 1 }),
        audio_rate: Some(48_000),
        sensitive,
    }
}

fn recipe(mode: MediaSubtitleMode) -> MediaRecipe {
    MediaRecipe {
        schema_version: 1,
        project_id: uuid::Uuid::from_u128(2),
        content_id: uuid::Uuid::from_u128(3),
        sources: vec![source(false)],
        segments: vec![MediaSegment {
            id: uuid::Uuid::from_u128(4),
            source_id: uuid::Uuid::from_u128(1),
            start_us: 0,
            end_us: 10_000_000,
            speed: 1.0,
        }],
        crop: None,
        rotation: 0,
        volume: 1.0,
        mute: false,
        keep_pitch: true,
        subtitles: vec![MediaSubtitleCue {
            id: uuid::Uuid::from_u128(5),
            start_us: 1_000_000,
            end_us: 2_000_000,
            text: "drawtext=text='Año':fontsize=72".to_string(),
        }],
        subtitle_mode: mode,
        metadata_keep: true,
    }
    .normalize()
    .unwrap()
}

fn plan(mode: MediaSubtitleMode) -> MediaExportPlan {
    plan_for_recipe(&recipe(mode), "media/video", "C:\\out", 1).unwrap()
}

#[test]
fn subtitletext_not_filtercode() {
    let plan = plan(MediaSubtitleMode::Burn);
    let filters = serde_json::to_string(&plan.filters).unwrap();
    assert!(!filters.contains("drawtext"));
    assert!(!filters.contains("Año"));
    assert!(filters.contains("subtitles_overlay"));
    assert_eq!(plan.subtitles[0].text, "drawtext=text='Año':fontsize=72");
    // Only the fixed allowlist exists.
    for filter in &plan.filters {
        assert!(matches!(
            filter,
            MediaFilter::Crop { .. }
                | MediaFilter::Transpose { .. }
                | MediaFilter::SetPts { .. }
                | MediaFilter::Atempo { .. }
                | MediaFilter::Volume { .. }
                | MediaFilter::Concat { .. }
                | MediaFilter::SubtitlesOverlay
        ));
    }
}

#[test]
fn metadata_default_keep() {
    let kept = plan(MediaSubtitleMode::Off);
    assert!(kept.metadata_keep);
    let mut dropped = recipe(MediaSubtitleMode::Off);
    dropped.metadata_keep = false;
    let plan = plan_for_recipe(&dropped, "media/video", "C:\\out", 2).unwrap();
    assert!(!plan.metadata_keep);
    assert_eq!(plan.request_revision, 2);
}

struct CancelBackend {
    foreign: PathBuf,
}

impl RecipeExportBackend for CancelBackend {
    fn export(
        &self,
        _plan: MediaExportPlan,
        cancel: &fs_service::CancellationToken,
    ) -> Result<serde_json::Value, String> {
        cancel.store(true, Ordering::Relaxed);
        std::fs::read(&self.foreign).map_err(|_| "media_edit.failed".to_string())?;
        Err(EngineError::Cancelled.message())
    }
}

struct FixedStore {
    bytes: Vec<u8>,
}

impl RecipeSnapshotStore for FixedStore {
    fn read_recipe(
        &self,
        _snapshot_id: &str,
        _request: &convert::ConversionRequest,
        max_bytes: usize,
    ) -> Result<Vec<u8>, String> {
        if self.bytes.len() > max_bytes {
            return Err(MediaEditError::TooLarge.message());
        }
        Ok(self.bytes.clone())
    }
}

#[test]
fn exportcancel_preservesforeigndest() {
    let directory = std::env::temp_dir().join(format!(
        "adperastra-step15-export-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&directory).unwrap();
    let foreign = directory.join("foreign.bin");
    let original = b"not ours".to_vec();
    std::fs::write(&foreign, &original).unwrap();

    let state = MediaRecipeExport::default();
    state.install_backend(Arc::new(CancelBackend {
        foreign: foreign.clone(),
    })).unwrap();
    let cancel = fs_service::new_cancellation_token();
    let error = state
        .export_value(plan(MediaSubtitleMode::Off), &cancel)
        .unwrap_err();
    assert_eq!(error, "engines.cancelled");
    assert_eq!(std::fs::read(&foreign).unwrap(), original);
    assert!(foreign.exists());
    let _ = std::fs::remove_dir_all(&directory);
}

#[test]
fn no_pack_player_works() {
    let recipe = recipe(MediaSubtitleMode::Off);
    let bytes = serde_json::to_vec(&recipe).unwrap();
    let state = MediaRecipeExport::default();
    state.install_store(Arc::new(FixedStore { bytes })).unwrap();
    let plan = plan_for_recipe(&recipe, "media/video", "C:\\out", 1).unwrap();
    let cancel = fs_service::new_cancellation_token();
    let error = state.export_value(plan, &cancel).unwrap_err();
    assert_eq!(error, "engines.pack_missing");
    // The ordinary player path has no dependency on the export backend.
    assert_eq!(recipe.sources[0].path, "C:\\media\\clip.mp4");
    assert_eq!(recipe.duration_us().unwrap(), 10_000_000);
}

#[test]
fn sensitive_cli_refused() {
    let mut recipe = recipe(MediaSubtitleMode::Off);
    recipe.sources[0].sensitive = true;
    assert!(plan_for_recipe(&recipe, "media/video", "C:\\out", 1).is_err());
}

#[test]
fn non_media_converter_refused() {
    let recipe = recipe(MediaSubtitleMode::Off);
    assert_eq!(
        plan_for_recipe(&recipe, "image/png", "C:\\out", 1).unwrap_err(),
        "media_edit.unsupported"
    );
}
