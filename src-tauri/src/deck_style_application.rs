//! Native-authoritative style preview records and one-transaction apply
//! authorization (Step 22b T4).
//!
//! The approved 20a/22a document authority is injected as `DeckStyleHost`;
//! when it is absent the command reports `office_edit.engine_missing` instead
//! of inventing a successful preview. The UI never supplies warnings or
//! revisions.
#![allow(dead_code)]


use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock, RwLock};

use serde::{Deserialize, Serialize};
use tauri::WebviewWindow;
use uuid::Uuid;

use crate::deck_style_types::{
    changed, invalid, validate_deck_style, DeckStyle, StyleWarning, MAX_STYLE_PREVIEW_WARNINGS,
    STYLE_PREVIEW_TTL_SECONDS,
};
use crate::ensure_main;
use crate::office_edit_values::DeckTheme;

/// Facts the approved document binding supplies for one preview. Nothing here
/// is accepted from the browser request except `session_id`/scope/style.
#[derive(Debug, Clone)]
pub struct DeckStylePrepareFacts {
    pub revision: u64,
    pub slide_width_pt: f64,
    pub slide_height_pt: f64,
    pub existing_slide_ids: Vec<Uuid>,
    pub overflow: Vec<(Uuid, Uuid)>,
    pub manual_preserved: Vec<Uuid>,
    pub available_font_assets: Vec<String>,
    pub template_content_omitted: bool,
}

/// Implemented only by the coordinator's adapter over the approved 20a/22a
/// session and engine binding.
pub trait DeckStyleHost: Send + Sync {
    fn prepare_facts(
        &self,
        _session_id: Uuid,
        slide_ids: Option<&[Uuid]>,
    ) -> Result<DeckStylePrepareFacts, String>;
    fn verify_apply(
        &self,
        session_id: Uuid,
        style_id: Uuid,
        expected_revision: u64,
    ) -> Result<(), String>;
}

static HOST: OnceLock<RwLock<Option<Arc<dyn DeckStyleHost>>>> = OnceLock::new();

fn host_slot() -> &'static RwLock<Option<Arc<dyn DeckStyleHost>>> {
    HOST.get_or_init(|| RwLock::new(None))
}

pub fn register_deck_style_host(host: Arc<dyn DeckStyleHost>) {
    if let Ok(mut slot) = host_slot().write() {
        *slot = Some(host);
    }
}

fn current_host() -> Result<Arc<dyn DeckStyleHost>, String> {
    host_slot()
        .read()
        .map_err(|_| "deck_style.failed".to_string())?
        .clone()
        .ok_or_else(|| "office_edit.engine_missing".to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeckStylePreview {
    pub id: Uuid,
    pub style_id: Uuid,
    pub theme: DeckTheme,
    pub expected_revision: u64,
    pub slide_ids: Option<Vec<Uuid>>,
    pub warnings: Vec<StyleWarning>,
    pub expires_unix: u64,
}

#[derive(Debug, Clone)]
struct StoredPreview {
    preview: DeckStylePreview,
    session_id: Uuid,
}

static PREVIEWS: OnceLock<Mutex<HashMap<Uuid, StoredPreview>>> = OnceLock::new();

fn previews() -> &'static Mutex<HashMap<Uuid, StoredPreview>> {
    PREVIEWS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn scaled_text(size_pt: f64, scale_x: f64, scale_y: f64) -> f64 {
    (size_pt * scale_x.min(scale_y)).clamp(8.0, 96.0)
}

/// D3: keep the current slide size and scale rectangles; text follows the
/// smaller ratio, clamped 8-96 pt.
pub fn scale_theme(theme: &DeckTheme, width_pt: f64, height_pt: f64) -> Result<DeckTheme, String> {
    if !width_pt.is_finite() || !height_pt.is_finite() || width_pt <= 0.0 || height_pt <= 0.0 {
        return Err(invalid());
    }
    let scale_x = width_pt / theme.slide_width_pt;
    let scale_y = height_pt / theme.slide_height_pt;
    let mut scaled = theme.clone();
    scaled.slide_width_pt = width_pt;
    scaled.slide_height_pt = height_pt;
    for layout in &mut scaled.layouts {
        for placeholder in &mut layout.placeholders {
            placeholder.rect.x_pt *= scale_x;
            placeholder.rect.y_pt *= scale_y;
            placeholder.rect.width_pt *= scale_x;
            placeholder.rect.height_pt *= scale_y;
            placeholder.text.size_pt = scaled_text(placeholder.text.size_pt, scale_x, scale_y);
        }
    }
    Ok(scaled)
}

fn validated_scope(facts: &DeckStylePrepareFacts, slide_ids: Option<&[Uuid]>) -> Result<Option<Vec<Uuid>>, String> {
    let Some(ids) = slide_ids else { return Ok(None) };
    if ids.is_empty() || ids.len() > 1000 {
        return Err(invalid());
    }
    let existing: HashSet<Uuid> = facts.existing_slide_ids.iter().copied().collect();
    let mut unique = HashSet::new();
    for id in ids {
        if !unique.insert(*id) || !existing.contains(id) {
            return Err(invalid());
        }
    }
    Ok(Some(ids.to_vec()))
}

fn build_warnings(
    style: &DeckStyle,
    facts: &DeckStylePrepareFacts,
) -> Vec<StyleWarning> {
    let mut warnings = Vec::new();
    for (slide_id, shape_id) in &facts.overflow {
        if warnings.len() >= MAX_STYLE_PREVIEW_WARNINGS {
            break;
        }
        warnings.push(StyleWarning::Overflow {
            id: Uuid::new_v4(),
            slide_id: *slide_id,
            shape_id: *shape_id,
        });
    }
    for asset_id in ["inter-regular", "inter-bold"] {
        if warnings.len() >= MAX_STYLE_PREVIEW_WARNINGS {
            break;
        }
        if !facts.available_font_assets.iter().any(|item| item == asset_id) {
            warnings.push(StyleWarning::FontMissing {
                id: Uuid::new_v4(),
                asset_id: asset_id.to_string(),
            });
        }
    }
    for slide_id in &facts.manual_preserved {
        if warnings.len() >= MAX_STYLE_PREVIEW_WARNINGS {
            break;
        }
        warnings.push(StyleWarning::ManualFormatPreserved {
            id: Uuid::new_v4(),
            slide_id: *slide_id,
        });
    }
    if facts.template_content_omitted && warnings.len() < MAX_STYLE_PREVIEW_WARNINGS {
        warnings.push(StyleWarning::TemplateContentOmitted { id: Uuid::new_v4() });
    }
    let _ = style;
    warnings
}

pub fn build_preview(
    _session_id: Uuid,
    style: &DeckStyle,
    slide_ids: Option<&[Uuid]>,
    facts: &DeckStylePrepareFacts,
    now: u64,
) -> Result<DeckStylePreview, String> {
    validate_deck_style(style)?;
    let scope = validated_scope(facts, slide_ids)?;
    let theme = scale_theme(&style.theme, facts.slide_width_pt, facts.slide_height_pt)?;
    Ok(DeckStylePreview {
        id: Uuid::new_v4(),
        style_id: style.id,
        theme,
        expected_revision: facts.revision,
        slide_ids: scope,
        warnings: build_warnings(style, facts),
        expires_unix: now.saturating_add(STYLE_PREVIEW_TTL_SECONDS),
    })
}

pub fn prepare_preview(
    host: &dyn DeckStyleHost,
    session_id: Uuid,
    style: &DeckStyle,
    slide_ids: Option<&[Uuid]>,
    now: u64,
) -> Result<DeckStylePreview, String> {
    let facts = host.prepare_facts(session_id, slide_ids)?;
    let preview = build_preview(session_id, style, slide_ids, &facts, now)?;
    let mut map = previews().lock().map_err(|_| "deck_style.failed".to_string())?;
    map.retain(|_, stored| stored.preview.expires_unix > now);
    if map.len() >= 8 {
        return Err("deck_style.too_large".to_string());
    }
    map.insert(
        preview.id,
        StoredPreview {
            preview: preview.clone(),
            session_id,
        },
    );
    Ok(preview)
}

/// Revalidate and consume one preview. Overflow blocks; every other warning
/// must be acknowledged by its exact native ID. The returned record is the
/// authorization for the 22a `applyDeckTheme` call.
pub fn authorize_apply(
    host: &dyn DeckStyleHost,
    preview_id: Uuid,
    acknowledged: &[Uuid],
    now: u64,
) -> Result<DeckStylePreview, String> {
    let stored = {
        let mut map = previews().lock().map_err(|_| "deck_style.failed".to_string())?;
        map.remove(&preview_id).ok_or_else(changed)?
    };
    if stored.preview.expires_unix <= now {
        return Err(changed());
    }
    if stored.preview.warnings.iter().any(|warning| !warning.is_acknowledgeable()) {
        return Err("deck_style.unsupported".to_string());
    }
    let required: HashSet<Uuid> = stored.preview.warnings.iter().map(StyleWarning::id).collect();
    let provided: HashSet<Uuid> = acknowledged.iter().copied().collect();
    if !required.is_subset(&provided) || provided.len() != required.len() {
        return Err(invalid());
    }
    host.verify_apply(
        stored.session_id,
        stored.preview.style_id,
        stored.preview.expected_revision,
    )?;
    Ok(stored.preview)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeckStylePrepareRequest {
    pub session_id: Uuid,
    pub style: DeckStyle,
    pub slide_ids: Option<Vec<Uuid>>,
}

#[tauri::command]
pub async fn deck_style_prepare(
    window: WebviewWindow,
    request: DeckStylePrepareRequest,
) -> Result<DeckStylePreview, String> {
    ensure_main(window.label())?;
    let host = current_host()?;
    tauri::async_runtime::spawn_blocking(move || {
        prepare_preview(
            host.as_ref(),
            request.session_id,
            &request.style,
            request.slide_ids.as_deref(),
            now_unix(),
        )
    })
    .await
    .map_err(|_| "deck_style.failed".to_string())?
}

#[tauri::command]
pub async fn deck_style_apply(
    window: WebviewWindow,
    preview_id: String,
    acknowledged_warning_ids: Vec<String>,
) -> Result<DeckStylePreview, String> {
    ensure_main(window.label())?;
    let preview_id = Uuid::parse_str(&preview_id).map_err(|_| invalid())?;
    let acknowledged = acknowledged_warning_ids
        .iter()
        .map(|id| Uuid::parse_str(id).map_err(|_| invalid()))
        .collect::<Result<Vec<_>, _>>()?;
    let host = current_host()?;
    tauri::async_runtime::spawn_blocking(move || {
        authorize_apply(host.as_ref(), preview_id, &acknowledged, now_unix())
    })
    .await
    .map_err(|_| "deck_style.failed".to_string())?
}
