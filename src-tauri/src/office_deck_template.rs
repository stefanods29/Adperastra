//! Deck template inspection and theme import (Step 20a E15).
//!
//! The approved binding parses the template. This wrapper never opens a
//! remote URL, executes template content or builds a theme from guessed
//! bytes. No provider is installed by default, so both commands fail with
//! the stable `office_edit.unsupported` code instead of inventing themes.
#![allow(dead_code)]


use std::collections::HashSet;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use convert::ConversionInput;
use tauri::{Manager, State, WebviewWindow};
use uuid::Uuid;

use crate::jobs::{spawn_job, Jobs};
use crate::office_edit_presentation::{DeckTemplateInspection, DeckTheme, OfficeFontMapping};
use crate::office_edit_sessions::OfficeEditState;
use crate::office_edit_types::OfficeEditError;
use crate::office_edit_values::MAX_SAFE_INTEGER;
use crate::{ensure_main, valid_request_id};

/// A snapshot-bound inspection expires after five minutes.
pub const INSPECTION_TTL_SECONDS: u64 = 300;
pub const MAX_TEMPLATE_FONT_MAPPINGS: usize = 128;
pub const MAX_TEMPLATE_NAME_CHARS: usize = 60;
pub const MAX_TEMPLATE_WARNING_CHARS: usize = 512;

/// What the approved binding must provide. It owns the parsed template and
/// the inspection lifetime; `extract_theme` refuses an unknown, foreign or
/// expired inspection and any theme id that does not occur in it.
pub trait DeckTemplateProvider: Send + Sync {
    fn inspect_template(
        &self,
        input: &ConversionInput,
    ) -> Result<DeckTemplateInspection, OfficeEditError>;

    fn extract_theme(
        &self,
        inspection_id: Uuid,
        theme_id: Uuid,
        name: &str,
        font_mappings: &[OfficeFontMapping],
    ) -> Result<DeckTheme, OfficeEditError>;
}

/// Managed provider slot. Absence is a typed, stable unsupported answer.
#[derive(Default)]
pub struct DeckTemplateState {
    provider: Mutex<Option<Arc<dyn DeckTemplateProvider>>>,
}

impl DeckTemplateState {
    pub fn install_provider(
        &self,
        provider: Arc<dyn DeckTemplateProvider>,
    ) -> Result<(), OfficeEditError> {
        let mut slot = self.provider.lock().map_err(|_| OfficeEditError::Failed)?;
        if slot.is_some() {
            return Err(OfficeEditError::Busy);
        }
        *slot = Some(provider);
        Ok(())
    }

    pub fn provider(&self) -> Result<Arc<dyn DeckTemplateProvider>, OfficeEditError> {
        self.provider
            .lock()
            .map_err(|_| OfficeEditError::Failed)?
            .clone()
            .ok_or(OfficeEditError::Unsupported)
    }
}

fn code(error: OfficeEditError) -> String {
    error.code().to_string()
}

fn parse_id(value: &str) -> Result<Uuid, OfficeEditError> {
    let parsed = Uuid::parse_str(value).map_err(|_| OfficeEditError::Invalid)?;
    if parsed.is_nil() {
        return Err(OfficeEditError::Invalid);
    }
    Ok(parsed)
}

fn unix_now() -> Result<u64, OfficeEditError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| OfficeEditError::Failed)
}

/// Only a local deck template/snapshot reaches the provider. No remote URL,
/// double extension or relative path is accepted.
fn validate_template_input(input: &ConversionInput) -> Result<(), OfficeEditError> {
    match input {
        ConversionInput::File { path, .. } => {
            crate::validate_absolute_path(path).map_err(|_| OfficeEditError::Invalid)?;
            if path.contains('\0') {
                return Err(OfficeEditError::Invalid);
            }
            let name = path.rsplit(['\\', '/']).next().unwrap_or_default();
            let (stem, extension) = name.rsplit_once('.').ok_or(OfficeEditError::Invalid)?;
            if stem.is_empty() || stem.contains('.') {
                return Err(OfficeEditError::Invalid);
            }
            match extension.to_ascii_lowercase().as_str() {
                "pptx" | "potx" | "odp" | "otp" => Ok(()),
                _ => Err(OfficeEditError::Unsupported),
            }
        }
        ConversionInput::Snapshot {
            snapshot_id,
            document_id,
            revision,
        } => {
            let snapshot_id = parse_id(snapshot_id)?;
            let document_id = parse_id(document_id)?;
            if snapshot_id.is_nil()
                || document_id.is_nil()
                || *revision < 1
                || *revision > MAX_SAFE_INTEGER
            {
                return Err(OfficeEditError::Invalid);
            }
            Ok(())
        }
    }
}

fn validate_name(name: &str) -> Result<(), OfficeEditError> {
    let length = name.chars().count();
    if !(1..=MAX_TEMPLATE_NAME_CHARS).contains(&length)
        || name.trim() != name
        || name.chars().any(char::is_control)
    {
        return Err(OfficeEditError::Invalid);
    }
    Ok(())
}

fn validate_font_mappings(mappings: &[OfficeFontMapping]) -> Result<(), OfficeEditError> {
    if mappings.len() > MAX_TEMPLATE_FONT_MAPPINGS {
        return Err(OfficeEditError::TooLarge);
    }
    let mut families = HashSet::new();
    for mapping in mappings {
        let length = mapping.from_family.chars().count();
        if !(1..=128).contains(&length)
            || mapping.from_family.chars().any(char::is_control)
            || !families.insert(mapping.from_family.to_lowercase())
            || !mapping.to_font.is_valid()
            || !mapping.to_font.embeddable
        {
            return Err(OfficeEditError::Invalid);
        }
    }
    Ok(())
}

fn validate_inspection(inspection: &DeckTemplateInspection) -> Result<(), OfficeEditError> {
    if !inspection.is_valid()
        || inspection.source_revision > MAX_SAFE_INTEGER
        || inspection.themes.iter().any(|theme| !theme.is_valid())
        || inspection.warnings.iter().any(|warning| {
            warning.chars().count() > MAX_TEMPLATE_WARNING_CHARS
                || warning.chars().any(char::is_control)
        })
    {
        return Err(OfficeEditError::Failed);
    }
    let now = unix_now()?;
    if inspection.expires_unix <= now
        || inspection.expires_unix > now.saturating_add(INSPECTION_TTL_SECONDS)
    {
        return Err(OfficeEditError::ProposalExpired);
    }
    Ok(())
}

/// E15: inspect one local deck template as a polled job. Parsing, source
/// retention and the inspection lifetime belong to the approved binding.
#[tauri::command]
pub async fn office_deck_template_inspect_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    edit: State<'_, OfficeEditState>,
    templates: State<'_, DeckTemplateState>,
    request_id: String,
    input: ConversionInput,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id).map_err(|_| code(OfficeEditError::Invalid))?;
    let profile = edit.current_profile().map_err(code)?;
    validate_template_input(&input).map_err(code)?;
    let provider = templates.provider().map_err(code)?;
    let token = jobs.begin(&request_id, 1)?;
    let app = window.app_handle().clone();
    spawn_job(app, request_id, token, move |context| {
        let edit = context.app().state::<OfficeEditState>();
        if edit.current_profile().map_err(code)? != profile {
            return Err(code(OfficeEditError::Changed));
        }
        if context.token().load(Ordering::Relaxed) {
            return Err(code(OfficeEditError::Cancelled));
        }
        let inspection = provider.inspect_template(&input).map_err(code)?;
        if context.token().load(Ordering::Relaxed) {
            return Err(code(OfficeEditError::Cancelled));
        }
        validate_inspection(&inspection).map_err(code)?;
        serde_json::to_value(inspection).map_err(|_| code(OfficeEditError::Failed))
    });
    Ok(())
}

/// E15: extract exactly one inspected theme and apply the caller's explicit
/// font mappings. A missing provider or an unknown theme is refused.
#[tauri::command]
pub fn office_deck_template_import(
    window: WebviewWindow,
    edit: State<'_, OfficeEditState>,
    templates: State<'_, DeckTemplateState>,
    inspection_id: String,
    theme_id: String,
    name: String,
    font_mappings: Vec<OfficeFontMapping>,
) -> Result<DeckTheme, String> {
    ensure_main(window.label())?;
    edit.current_profile().map_err(code)?;
    let inspection_id = parse_id(&inspection_id).map_err(code)?;
    let theme_id = parse_id(&theme_id).map_err(code)?;
    validate_name(&name).map_err(code)?;
    validate_font_mappings(&font_mappings).map_err(code)?;
    let provider = templates.provider().map_err(code)?;
    let theme = provider
        .extract_theme(inspection_id, theme_id, &name, &font_mappings)
        .map_err(code)?;
    if !theme.is_valid() || theme.id != theme_id {
        return Err(code(OfficeEditError::Failed));
    }
    Ok(theme)
}
