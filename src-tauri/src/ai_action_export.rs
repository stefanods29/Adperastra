//! Safe exports of AI results (D12, `ai-actions-1` E2).
//!
//! A saved copy is always a new owned file: CREATE_NEW, no replacement, no
//! rename of an existing item. Text results become TXT/SRT/VTT through the
//! same timestamps the 15 editor uses; images are encoded by 08a and never
//! written by this module.
#![allow(dead_code)]


use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use uuid::Uuid;

use crate::ai_action_results::{AiActionResult, AiActionPayload};
use crate::ai_action_types::{
    ERR_FAILED, ERR_INVALID, ERR_SOURCE_CHANGED, ERR_TOO_LARGE, ERR_UNSUPPORTED,
};
use crate::ai_actions::{active_profile, result_store};
use crate::jobs::{spawn_job, Jobs};
use crate::speech_transcripts::{to_plain_text, to_srt, to_vtt};
use crate::speech_types::TranscriptSegment;

pub const MAX_EXPORT_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    Text,
    Srt,
    Vtt,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PreparedExport {
    pub suggested_name: String,
    pub bytes: Vec<u8>,
}

/// Exact file name for a result; never derived from a path the model chose.
pub fn suggested_name(result: &AiActionResult, format: ExportFormat, base: &str) -> Result<String, String> {
    let base = base.trim();
    if base.is_empty() || base.len() > 200 || base.contains(['\\', '/', ':', '*', '?', '"', '<', '>', '|']) {
        return Err(ERR_INVALID.to_string());
    }
    let extension = match format {
        ExportFormat::Text => "txt",
        ExportFormat::Srt => "srt",
        ExportFormat::Vtt => "vtt",
    };
    let stem = base.trim_end_matches('.').trim();
    if stem.is_empty() {
        return Err(ERR_INVALID.to_string());
    }
    let _ = result;
    Ok(format!("{stem}.{extension}"))
}

/// Text-form results only; an image is saved through the 08a converter.
pub fn prepare_export(
    result: &AiActionResult,
    format: ExportFormat,
    segments: &[TranscriptSegment],
    base: &str,
) -> Result<PreparedExport, String> {
    if result.sensitive {
        // Sensitive results never become a plaintext file by accident.
        return Err(ERR_UNSUPPORTED.to_string());
    }
    if matches!(result.payload, AiActionPayload::Image { .. }) {
        return Err(ERR_UNSUPPORTED.to_string());
    }
    let body = match (&result.payload, format) {
        (AiActionPayload::Transcript { .. }, ExportFormat::Srt) => to_srt(segments)?,
        (AiActionPayload::Transcript { .. }, ExportFormat::Vtt) => to_vtt(segments)?,
        (AiActionPayload::Transcript { .. }, ExportFormat::Text) => to_plain_text(segments),
        (_, ExportFormat::Text) => plain_text_body(result)?,
        _ => return Err(ERR_UNSUPPORTED.to_string()),
    };
    let bytes = body.into_bytes();
    if bytes.len() > MAX_EXPORT_BYTES {
        return Err(ERR_TOO_LARGE.to_string());
    }
    Ok(PreparedExport { suggested_name: suggested_name(result, format, base)?, bytes })
}

fn plain_text_body(result: &AiActionResult) -> Result<String, String> {
    let mut lines = Vec::new();
    match &result.payload {
        AiActionPayload::Text { blocks } => lines.extend(blocks.iter().map(|block| block.plain_text.clone())),
        AiActionPayload::Faq { pairs } => {
            for pair in pairs {
                lines.push(pair.question.clone());
                lines.push(pair.answer.clone());
            }
        }
        AiActionPayload::Translation { pairs } => {
            for pair in pairs {
                lines.push(pair.translated_text.clone());
            }
        }
        AiActionPayload::KeyPoints { points, actions } => {
            lines.extend(points.iter().map(|point| point.plain_text.clone()));
            lines.extend(actions.iter().map(|action| action.text.clone()));
        }
        AiActionPayload::Moments { items } => lines.extend(items.iter().map(|moment| moment.label.clone())),
        AiActionPayload::Comparison { points } => {
            for point in points {
                lines.push(point.left_text.clone());
                lines.push(point.right_text.clone());
            }
        }
        AiActionPayload::FolderSummary { blocks, .. } => {
            lines.extend(blocks.iter().map(|block| block.plain_text.clone()))
        }
        AiActionPayload::Transcript { .. } | AiActionPayload::Image { .. } => {
            return Err(ERR_INVALID.to_string())
        }
    }
    Ok(lines.join("\n"))
}

/// Creates a brand-new file; an existing destination is left untouched.
pub fn publish_new_file(dir: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    if name.is_empty() || name.contains(['\\', '/']) || name == "." || name == ".." {
        return Err(ERR_INVALID.to_string());
    }
    let target = dir.join(name);
    let mut file = match std::fs::OpenOptions::new().write(true).create_new(true).open(&target) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err(ERR_SOURCE_CHANGED.to_string())
        }
        Err(_) => return Err(ERR_FAILED.to_string()),
    };
    use std::io::Write;
    if file.write_all(bytes).is_err() {
        drop(file);
        let _ = std::fs::remove_file(&target);
        return Err(ERR_FAILED.to_string());
    }
    if file.sync_all().is_err() {
        drop(file);
        let _ = std::fs::remove_file(&target);
        return Err(ERR_FAILED.to_string());
    }
    Ok(target)
}

/// Validates the opaque result id before any export work begins.
pub fn parse_result_id(value: &str) -> Result<Uuid, String> {
    Uuid::parse_str(value).map_err(|_| ERR_INVALID.to_string())
}

/// The narrow part of `ConversionRequest` an export may read. The UI sends
/// the full conversion envelope; inputs, options and losses are ignored
/// because the bytes come from the retained result, never from a source file.
#[derive(Debug, Clone, Deserialize)]
pub struct AiActionExportRequest {
    pub dest_dir: String,
    #[serde(default)]
    pub keep_original: bool,
    #[serde(default)]
    pub naming: Option<AiActionExportNaming>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AiActionExportNaming {
    #[serde(default)]
    pub pattern: String,
}

fn export_directory(dest_dir: &str) -> Result<PathBuf, String> {
    crate::validate_absolute_path(dest_dir).map_err(|_| ERR_INVALID.to_string())?;
    let path = PathBuf::from(dest_dir);
    if !path.is_dir() || crate::operation_safety::protected_path(&path) {
        return Err(ERR_INVALID.to_string());
    }
    Ok(path)
}

fn export_segments(result: &AiActionResult, profile: Uuid) -> Result<Vec<TranscriptSegment>, String> {
    match &result.payload {
        AiActionPayload::Transcript { info } => crate::speech::transcript_store()
            .all_segments(info.id, profile)
            .map_err(|_| ERR_SOURCE_CHANGED.to_string()),
        _ => Ok(Vec::new()),
    }
}

/// Writes one new file and records it in the normal conversion report store.
fn run_export(
    context: &crate::jobs::JobContext,
    result: &AiActionResult,
    profile: Uuid,
    request: &AiActionExportRequest,
    directory: &Path,
) -> Result<Value, String> {
    if context.token().load(Ordering::Relaxed) {
        return Err(ERR_FAILED.to_string());
    }
    let base = request.naming.as_ref().map(|naming| naming.pattern.as_str()).unwrap_or("");
    let segments = export_segments(result, profile)?;
    let prepared = prepare_export(result, ExportFormat::Text, &segments, base)?;
    if context.token().load(Ordering::Relaxed) {
        return Err(ERR_FAILED.to_string());
    }
    let published = publish_new_file(directory, &prepared.suggested_name, &prepared.bytes)?;
    let byte_len = prepared.bytes.len() as u64;
    let item = convert::WorkItemResult {
        input_index: 0,
        source_path: None,
        output_count: 1,
        status: convert::WorkItemStatus::Done,
        reason: None,
        metadata_lost: Vec::new(),
        bytes_written: byte_len,
    };
    let output = convert::ConversionOutput {
        output_id: Uuid::new_v4().to_string(),
        input_indices: vec![0],
        output_index: 0,
        path: published.to_string_lossy().into_owned(),
        byte_len,
    };
    let report = crate::convert_reports::StoredReport::new(vec![item], vec![output], false);
    let report = context
        .app()
        .state::<crate::convert_reports::ConversionReports>()
        .insert(report)
        .map_err(|_| ERR_FAILED.to_string())?;
    context.set_progress(&fs_service::OpProgress {
        items_done: 1,
        items_total: 1,
        bytes_done: byte_len,
        bytes_total: byte_len,
        current: String::new(),
    });
    serde_json::to_value(report).map_err(|_| ERR_FAILED.to_string())
}

/// Starts one export of a retained result as a new owned file.
///
/// The destination is validated before any work; an existing file is never
/// replaced. The result lease is released when the job finishes, so closing
/// the result tab cannot cancel an export that was already accepted.
#[tauri::command]
pub fn ai_action_result_export_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    request_id: String,
    id: String,
    request: Value,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    let parsed_id = parse_result_id(&id)?;
    let export: AiActionExportRequest =
        serde_json::from_value(request).map_err(|_| ERR_INVALID.to_string())?;
    if !export.keep_original {
        return Err(ERR_INVALID.to_string());
    }
    let directory = export_directory(&export.dest_dir)?;
    let profile = active_profile()?;
    let result = result_store().acquire(parsed_id, profile)?;
    let token = match jobs.begin(&request_id, 1) {
        Ok(token) => token,
        Err(error) => {
            result_store().release_lease(parsed_id);
            return Err(error);
        }
    };
    spawn_job(app, request_id, token, move |context| {
        let outcome = run_export(context, &result, profile, &export, &directory);
        result_store().release_lease(parsed_id);
        outcome
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn existing_destination_is_never_replaced() {
        let temp = tempfile::tempdir().unwrap();
        publish_new_file(temp.path(), "report.txt", b"first").unwrap();
        assert_eq!(
            publish_new_file(temp.path(), "report.txt", b"second").unwrap_err(),
            ERR_SOURCE_CHANGED
        );
        assert_eq!(std::fs::read(temp.path().join("report.txt")).unwrap(), b"first");
    }

    #[test]
    fn names_never_carry_paths() {
        let result = AiActionResult {
            id: Uuid::new_v4(),
            action: crate::ai_action_types::AiActionId::Summarize,
            inputs: vec![],
            payload: AiActionPayload::Text { blocks: vec![] },
            backend: "local".to_string(),
            provider_id: None,
            model_id: "m".to_string(),
            model_revision: "1".to_string(),
            citations: vec![],
            warnings: vec![],
            sensitive: false,
            created_unix: 1,
            expires_unix: 2,
            generation: 1,
        };
        assert_eq!(suggested_name(&result, ExportFormat::Srt, "meeting").unwrap(), "meeting.srt");
        assert!(suggested_name(&result, ExportFormat::Text, "..\\evil").is_err());
    }
}
