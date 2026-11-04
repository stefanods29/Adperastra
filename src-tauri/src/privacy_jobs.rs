//! Privacy Tauri commands: inspect, page, closure, clean, release
//! (Step 08c E1/T5). Long work runs as the shared job table.
#![allow(dead_code)]


use std::collections::HashSet;
use std::path::Path;

use convert::{ConversionInput, MetadataCategory};
use privacy::{
    inspect::closure_for, sorted_categories, validate_requested_categories, validate_uuid,
    Coverage, MetadataCount, PrivacyClosure, PrivacyInspectionPage, PrivacyRequest, PrivacyResult,
};
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::jobs::{spawn_job, Jobs};
use crate::native_privacy::{
    adapter_for, clean_one, counts_before, inspect_one, read_guarded, read_snapshot, report,
    result, validate_categories_for_adapter,
};
use crate::privacy_helper::privacy_progress;
use crate::privacy_sessions::{PrivacySessions, StoredInspection, INSPECTION_LIFETIME_SECS};
use crate::{ensure_main, validate_absolute_path};

fn mime_for_path(path: &str) -> String {
    match Path::new(path)
        .extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .as_deref()
    {
        Some("pdf") => "application/pdf".to_string(),
        Some("png") => "image/png".to_string(),
        Some("webp") => "image/webp".to_string(),
        Some("tif" | "tiff") => "image/tiff".to_string(),
        Some("jpg" | "jpeg") => "image/jpeg".to_string(),
        _ => "application/octet-stream".to_string(),
    }
}

fn source_now(stored: &StoredInspection) -> Result<(), String> {
    if let ConversionInput::File { path, .. } = &stored.inspection.input {
        let current = fs_service::source_stamp::capture_source_stamp(Path::new(path))
            .map_err(|_| "privacy.changed".to_string())?;
        if stored.source.as_ref() != Some(&current) {
            return Err("privacy.changed".to_string());
        }
    }
    Ok(())
}

fn merge_counts(target: &mut Vec<MetadataCount>, source: Vec<MetadataCount>) {
    for count in source {
        if let Some(existing) = target
            .iter_mut()
            .find(|item| item.category == count.category)
        {
            existing.count = existing.count.saturating_add(count.count);
            existing.coverage = existing.coverage.weaker(count.coverage);
        } else {
            target.push(count);
        }
    }
}

/// After-counts for the selected categories that this file actually stored.
/// A category absent from the file is absent from the result, never a
/// fabricated zero (D3).
fn zero_selected(fields: &[privacy::PrivacyField], categories: &[MetadataCategory]) -> Vec<MetadataCount> {
    privacy::sorted_categories(categories)
        .into_iter()
        .filter(|category| fields.iter().any(|field| &field.category == category))
        .map(|category| MetadataCount {
            category,
            count: 0,
            coverage: Coverage::Complete,
        })
        .collect()
}

fn read_input(
    app: &AppHandle,
    input: &ConversionInput,
) -> Result<(Vec<u8>, Option<fs_service::SourceStamp>, String, String), String> {
    match input {
        ConversionInput::File { path, .. } => {
            validate_absolute_path(path).map_err(|_| "privacy.bad_request".to_string())?;
            let (bytes, source) = read_guarded(Path::new(path))?;
            let name = Path::new(path)
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| "file".to_string());
            Ok((bytes, source, name, mime_for_path(path)))
        }
        ConversionInput::Snapshot {
            snapshot_id,
            document_id,
            revision,
        } => {
            validate_uuid(snapshot_id, "snapshot_id")
                .map_err(|_| "privacy.bad_request".to_string())?;
            if document_id.is_empty() || document_id.len() > 128 {
                return Err("privacy.bad_request".to_string());
            }
            let (bytes, name, mime) = read_snapshot(app, snapshot_id, document_id, *revision)?;
            Ok((bytes, None, name, mime))
        }
    }
}

#[tauri::command]
pub async fn privacy_inspect_start(
    window: WebviewWindow,
    app: AppHandle,
    request_id: String,
    inputs: Vec<ConversionInput>,
    categories: Vec<MetadataCategory>,
) -> Result<(), String> {
    ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    if inputs.is_empty() || inputs.len() > 10_000 {
        return Err("privacy.bad_request".to_string());
    }
    if !categories.is_empty() {
        validate_requested_categories(&categories).map_err(|error| error.code().to_string())?;
    }
    let total = inputs.len();
    let token = app.state::<Jobs>().begin(&request_id, total)?;
    let app_clone = app.clone();
    spawn_job(app.clone(), request_id, token, move |context| {
        let sessions = app_clone.state::<PrivacySessions>();
        let mut ids = Vec::new();
        let mut done = 0usize;
        for (index, input) in inputs.into_iter().enumerate() {
            let (bytes, source, name, mime) = read_input(&app_clone, &input)?;
            let adapter = adapter_for(
                match &input {
                    ConversionInput::File { path, .. } => Some(Path::new(path)),
                    ConversionInput::Snapshot { .. } => None,
                },
                &mime,
            )?;
            if !categories.is_empty() {
                validate_categories_for_adapter(adapter, &categories)?;
            }
            let content_hash = *blake3::hash(&bytes).as_bytes();
            let inspection = inspect_one(
                input,
                &bytes,
                source.clone(),
                categories.clone(),
                adapter,
                context.token(),
            )?;
            let id = inspection.inspection_id.clone();
            let fields = inspection.fields.clone();
            sessions.store(
                inspection,
                fields,
                source,
                name,
                content_hash,
                adapter.to_string(),
                index as u32,
            )?;
            ids.push(id);
            done += 1;
            context.set_progress(&privacy_progress(done, total, ""));
        }
        let page = sessions.first_page(&ids)?;
        serde_json::to_value(page).map_err(|_| "privacy.serialize".to_string())
    });
    Ok(())
}

#[tauri::command]
pub fn privacy_inspection_page(
    window: WebviewWindow,
    sessions: State<'_, PrivacySessions>,
    cursor: String,
) -> Result<PrivacyInspectionPage, String> {
    ensure_main(window.label())?;
    validate_uuid(&cursor, "cursor").map_err(|_| "privacy.bad_request".to_string())?;
    sessions.next_page(&cursor)
}

#[tauri::command]
pub fn privacy_effective_categories(
    window: WebviewWindow,
    sessions: State<'_, PrivacySessions>,
    inspection_ids: Vec<String>,
    categories: Vec<MetadataCategory>,
) -> Result<PrivacyClosure, String> {
    ensure_main(window.label())?;
    if inspection_ids.is_empty() || inspection_ids.len() > 10_000 {
        return Err("privacy.bad_request".to_string());
    }
    validate_requested_categories(&categories).map_err(|error| error.code().to_string())?;
    let mut effective = Vec::new();
    let mut content_affecting = false;
    let mut appearance_affecting = false;
    let mut signatures_present = false;
    let mut seen = HashSet::new();
    for id in &inspection_ids {
        validate_uuid(id, "inspection_id").map_err(|_| "privacy.bad_request".to_string())?;
        if !seen.insert(id.clone()) {
            return Err("privacy.bad_request".to_string());
        }
        let stored = sessions.get(id)?;
        source_now(&stored)?;
        validate_categories_for_adapter(&stored.adapter, &categories)?;
        // Union per-inspection closures instead of retaining every field in
        // memory; the fixed point is distributive over disjoint inspections.
        let current = closure_for(
            &stored.fields,
            stored.inspection.signatures_present,
            &categories,
        )
        .map_err(|error| error.code().to_string())?;
        content_affecting |= current.content_affecting;
        appearance_affecting |= current.appearance_affecting;
        signatures_present |= current.signatures_present;
        for category in current.effective_categories {
            if !effective.contains(&category) {
                effective.push(category);
            }
        }
    }
    Ok(PrivacyClosure {
        requested_categories: sorted_categories(&categories),
        effective_categories: sorted_categories(&effective),
        content_affecting,
        appearance_affecting,
        signatures_present,
    })
}

#[tauri::command]
pub async fn privacy_clean_start(
    window: WebviewWindow,
    app: AppHandle,
    request_id: String,
    request: PrivacyRequest,
) -> Result<(), String> {
    ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    if request.replace {
        return Err("privacy.bad_request".to_string());
    }
    validate_requested_categories(&request.categories)
        .map_err(|error| error.code().to_string())?;
    // The accepted closure is the exact reviewed set; duplicates or an empty
    // set are not an exact acceptance.
    validate_requested_categories(&request.accepted_effective_categories)
        .map_err(|error| error.code().to_string())?;
    if request.inspection_ids.is_empty() || request.inspection_ids.len() > 10_000 {
        return Err("privacy.bad_request".to_string());
    }
    let mut unique_ids = HashSet::new();
    if request
        .inspection_ids
        .iter()
        .any(|id| !unique_ids.insert(id))
    {
        return Err("privacy.bad_request".to_string());
    }
    validate_absolute_path(&request.dest_dir)
        .map_err(|_| "privacy.bad_request".to_string())?;
    let token = app.state::<Jobs>().begin(&request_id, request.inspection_ids.len())?;
    let app_clone = app.clone();
    let suffix = request
        .cleaned_suffix
        .clone()
        .unwrap_or_else(|| " - Cleaned".to_string());
    spawn_job(app.clone(), request_id, token, move |context| {
        let sessions = app_clone.state::<PrivacySessions>();
        let mut items = Vec::new();
        let mut outputs = Vec::new();
        let mut before = Vec::new();
        let mut after = Vec::new();
        let mut cancelled = false;
        // Validate every inspection and every acknowledgement before any
        // output is staged, so a stale/missing acknowledgement can never
        // leave a partial batch behind. The closure is the union of the
        // per-inspection closures; after-counts stay per file (D3).
        let mut prepared = Vec::new();
        let mut effective = Vec::new();
        let mut content_affecting = false;
        let mut appearance_affecting = false;
        let mut signatures_present = false;
        for id in &request.inspection_ids {
            let stored = sessions.get(id)?;
            source_now(&stored)?;
            crate::native_privacy::validate_selection(&stored, &request.categories)?;
            let current = closure_for(
                &stored.fields,
                stored.inspection.signatures_present,
                &request.categories,
            )
            .map_err(|error| error.code().to_string())?;
            content_affecting |= current.content_affecting;
            appearance_affecting |= current.appearance_affecting;
            signatures_present |= current.signatures_present;
            for category in current.effective_categories {
                if !effective.contains(&category) {
                    effective.push(category);
                }
            }
            prepared.push(stored);
        }
        let closure = PrivacyClosure {
            requested_categories: sorted_categories(&request.categories),
            effective_categories: sorted_categories(&effective),
            content_affecting,
            appearance_affecting,
            signatures_present,
        };
        if !privacy::same_categories(
            &request.accepted_effective_categories,
            &closure.effective_categories,
        ) {
            return Err("privacy.bad_request".to_string());
        }
        if closure.content_affecting && !request.accepted_content_changes {
            return Err("privacy.bad_request".to_string());
        }
        if closure.appearance_affecting && !request.accepted_appearance_changes {
            return Err("privacy.bad_request".to_string());
        }
        if closure.signatures_present && !request.accepted_signature_change {
            return Err("privacy.bad_request".to_string());
        }
        for (index, stored) in prepared.iter().enumerate() {
            if context.token().load(std::sync::atomic::Ordering::Relaxed) {
                cancelled = true;
                for pending in prepared.iter().skip(index) {
                    items.push(convert::WorkItemResult {
                        input_index: pending.input_index,
                        source_path: None,
                        output_count: 0,
                        status: convert::WorkItemStatus::Cancelled,
                        reason: Some("privacy.cancelled".to_string()),
                        metadata_lost: Vec::new(),
                        bytes_written: 0,
                    });
                }
                break;
            }
            merge_counts(&mut before, counts_before(&stored.fields, &closure.effective_categories));
            let mut outcome = clean_one(
                &app_clone,
                stored,
                &request.categories,
                &request.dest_dir,
                &suffix,
                context.token(),
            );
            if outcome.result.status == convert::WorkItemStatus::Failed
                && outcome.result.reason.as_deref() == Some("privacy.cancelled")
            {
                outcome.result.status = convert::WorkItemStatus::Cancelled;
            }
            if outcome.result.status == convert::WorkItemStatus::Cancelled {
                cancelled = true;
            }
            if let Some(summary) = &outcome.summary {
                merge_counts(&mut after, summary.retained_category_counts.clone());
                merge_counts(
                    &mut after,
                    zero_selected(&stored.fields, &closure.effective_categories),
                );
            }
            items.push(outcome.result);
            if let Some(output) = outcome.output {
                outputs.push(output);
            }
            context.set_progress(&privacy_progress(
                index + 1,
                prepared.len(),
                "",
            ));
        }
        let report = report(items, outputs, cancelled);
        let value: PrivacyResult = result(before, after, report);
        serde_json::to_value(value).map_err(|_| "privacy.serialize".to_string())
    });
    Ok(())
}

#[tauri::command]
pub fn privacy_release(
    window: WebviewWindow,
    sessions: State<'_, PrivacySessions>,
    inspection_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    validate_uuid(&inspection_id, "inspection_id")
        .map_err(|_| "privacy.bad_request".to_string())?;
    sessions.release(&inspection_id);
    Ok(())
}

/// Expose the expiry for the settings/help tests without exposing a writer.
pub fn inspection_lifetime() -> u64 {
    INSPECTION_LIFETIME_SECS
}
