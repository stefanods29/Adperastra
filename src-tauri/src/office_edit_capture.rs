//! Native Office capture/export commands (Step 20a E5/T7).
//!
//! Each job writes exactly one bounded output, then publishes it as one new
//! immutable 08a snapshot. The requested public revision and its content ID
//! are frozen before the engine starts; later edits do not change the
//! captured identity. Sensitive sessions use zeroizing memory and the 08a
//! sensitive authority only. No output path is accepted and no source file is
//! replaced: 08a stages an owned output and publishes a new snapshot.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use convert::PageRange;
use tauri::{Manager, State, WebviewWindow};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::engine_types::OfficeFormat;
use crate::export_snapshot_types::{
    ExportSnapshot, SnapshotBeginRequest, StoragePolicy, MAX_SNAPSHOT_BYTES, MAX_SNAPSHOT_CHUNK,
};
use crate::export_snapshots::ExportSnapshots;
use crate::jobs::{spawn_job, Jobs};
use crate::office_edit_sessions::OfficeEditState;
use crate::office_edit_types::{
    EncodedOfficeInfo, OfficeCapability, OfficeEditError, OfficeExportFormat,
};
use crate::office_edit_validation::{code, parse_id};
use crate::office_edit_values::MAX_SAFE_INTEGER;
use crate::{ensure_main, valid_request_id};

/// A snapshot may not exceed 08a's per-snapshot bound. This is the single
/// output bound of a capture/export job; 08a reserves the matching budget once
/// in `begin` and moves it to the immutable retention handle in `finish`.
const OFFICE_SNAPSHOT_OUTPUT_BYTES: u64 = MAX_SNAPSHOT_BYTES;

fn office_format_mime(format: OfficeFormat) -> Option<&'static str> {
    match format {
        OfficeFormat::Docx => Some(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
        OfficeFormat::Xlsx => {
            Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        }
        OfficeFormat::Pptx => {
            Some("application/vnd.openxmlformats-officedocument.presentationml.presentation")
        }
        OfficeFormat::Odt => Some("application/vnd.oasis.opendocument.text"),
        OfficeFormat::Ods => Some("application/vnd.oasis.opendocument.spreadsheet"),
        OfficeFormat::Odp => Some("application/vnd.oasis.opendocument.presentation"),
        OfficeFormat::Rtf => Some("application/rtf"),
        OfficeFormat::Doc => Some("application/msword"),
        OfficeFormat::Xls => Some("application/vnd.ms-excel"),
        OfficeFormat::Ppt => Some("application/vnd.ms-powerpoint"),
        // Templates are inspection inputs only; they never become editable
        // sessions and therefore never a capture.
        OfficeFormat::Potx | OfficeFormat::Otp => None,
    }
}

fn export_mime(format: OfficeExportFormat) -> &'static str {
    match format {
        OfficeExportFormat::Pdf => "application/pdf",
        OfficeExportFormat::Png => "image/png",
        OfficeExportFormat::Jpeg => "image/jpeg",
    }
}

fn export_capability(format: OfficeExportFormat) -> OfficeCapability {
    match format {
        OfficeExportFormat::Pdf => OfficeCapability::ExportPdf,
        OfficeExportFormat::Png | OfficeExportFormat::Jpeg => OfficeCapability::ExportImages,
    }
}

/// PDF accepts an empty range list (all pages) and ordered ranges. An image
/// export is exactly one selected page or slide per snapshot, as E5 fixes.
fn valid_export_ranges(format: OfficeExportFormat, ranges: &[PageRange]) -> bool {
    if ranges.len() > 1_000 {
        return false;
    }
    let mut total: u64 = 0;
    for range in ranges {
        if range.first == 0 || range.last < range.first {
            return false;
        }
        total = total.saturating_add(u64::from(range.last - range.first) + 1);
    }
    if total > 10_000 {
        return false;
    }
    match format {
        OfficeExportFormat::Pdf => true,
        OfficeExportFormat::Png | OfficeExportFormat::Jpeg => {
            ranges.len() == 1 && ranges[0].first == ranges[0].last
        }
    }
}

/// One output per job. Bytes beyond the bound are refused as they are written,
/// so a buggy binding cannot grow the buffer past the 08a snapshot limit.
struct BoundedOfficeOutput {
    bytes: Zeroizing<Vec<u8>>,
    limit: u64,
}

impl BoundedOfficeOutput {
    fn new(limit: u64) -> Self {
        Self {
            bytes: Zeroizing::new(Vec::new()),
            limit,
        }
    }

    fn into_bytes(self) -> Zeroizing<Vec<u8>> {
        self.bytes
    }
}

fn overflow() -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::WriteZero, "office_edit.too_large")
}

impl std::io::Write for BoundedOfficeOutput {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        let next = (self.bytes.len() as u64)
            .checked_add(buffer.len() as u64)
            .ok_or_else(overflow)?;
        if next > self.limit {
            return Err(overflow());
        }
        self.bytes.extend_from_slice(buffer);
        Ok(buffer.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn map_snapshot_error(value: String) -> OfficeEditError {
    match value.as_str() {
        "snapshot.too_large" => OfficeEditError::TooLarge,
        "snapshot.changed" => OfficeEditError::Changed,
        "snapshot.bad_request" => OfficeEditError::Invalid,
        _ => OfficeEditError::Failed,
    }
}

fn expected_storage(sensitive: bool) -> StoragePolicy {
    if sensitive {
        StoragePolicy::Sensitive
    } else {
        StoragePolicy::Ordinary
    }
}

/// The native 08a authority, never a UI flag, decides whether output may touch
/// ordinary staging. A sensitive session with an ordinary authority is
/// refused before the engine writes one byte.
fn ensure_authority_policy(
    snapshots: &ExportSnapshots,
    document_id: Uuid,
    sensitive: bool,
) -> Result<(), OfficeEditError> {
    let record = snapshots
        .authorities()
        .get(document_id)
        .map_err(|_| OfficeEditError::Changed)?;
    if record.authority.document_id != document_id {
        return Err(OfficeEditError::Changed);
    }
    match (sensitive, record.authority.storage_policy) {
        (true, StoragePolicy::Sensitive) | (false, StoragePolicy::Ordinary) => Ok(()),
        (true, StoragePolicy::Ordinary) => Err(OfficeEditError::SensitiveUnsupported),
        (false, StoragePolicy::Sensitive) => Err(OfficeEditError::Changed),
    }
}

/// Publish exactly one immutable 08a snapshot with the frozen identity. 08a
/// `begin` owns a new staging file (ordinary) or zeroizing memory (sensitive);
/// `finish` makes the snapshot immutable and no existing file is replaced.
fn publish_snapshot(
    snapshots: &ExportSnapshots,
    document_id: Uuid,
    revision: u64,
    content_id: Uuid,
    mime: &str,
    sensitive: bool,
    bytes: &[u8],
) -> Result<ExportSnapshot, OfficeEditError> {
    if revision == 0 || revision > MAX_SAFE_INTEGER || bytes.len() as u64 > OFFICE_SNAPSHOT_OUTPUT_BYTES
    {
        return Err(OfficeEditError::TooLarge);
    }
    if bytes.is_empty() {
        return Err(OfficeEditError::Failed);
    }
    ensure_authority_policy(snapshots, document_id, sensitive)?;
    snapshots
        .authorities()
        .permit_capture_mime(document_id, mime)
        .map_err(|error| {
            if error.as_str() == "snapshot.too_large" {
                OfficeEditError::TooLarge
            } else {
                OfficeEditError::Changed
            }
        })?;
    let begin = snapshots
        .begin(SnapshotBeginRequest {
            document_id,
            revision,
            content_id,
            mime: mime.to_string(),
            byte_len: bytes.len() as u64,
            source: None,
        })
        .map_err(map_snapshot_error)?;
    let publish = (|| {
        let mut offset = 0u64;
        for chunk in bytes.chunks(MAX_SNAPSHOT_CHUNK) {
            snapshots.append(&begin.snapshot_id, &begin.upload_token, offset, chunk)?;
            offset = offset
                .checked_add(chunk.len() as u64)
                .ok_or_else(|| "snapshot.too_large".to_string())?;
        }
        snapshots.finish(&begin.snapshot_id)
    })();
    let snapshot = match publish {
        Ok(snapshot) => snapshot,
        Err(error) => {
            let _ = snapshots.abort_upload(&begin.snapshot_id);
            return Err(map_snapshot_error(error));
        }
    };
    if snapshot.document_id != document_id.to_string()
        || snapshot.revision != revision
        || snapshot.content_id != content_id
        || snapshot.mime != mime
        || snapshot.byte_len != bytes.len() as u64
        || snapshot.storage_policy != expected_storage(sensitive)
        || snapshot.expires_unix == 0
    {
        let _ = snapshots.release(&snapshot.snapshot_id);
        return Err(OfficeEditError::Changed);
    }
    Ok(snapshot)
}

/// The engine's declared identity must equal the frozen session tuple before
/// one byte reaches 08a.
fn validate_encoded_info(
    info: &EncodedOfficeInfo,
    revision: u64,
    content_id: Uuid,
    format: OfficeFormat,
    mime: &str,
    byte_len: u64,
) -> Result<(), OfficeEditError> {
    if info.source_revision != revision || info.content_id != content_id || info.format != format {
        return Err(OfficeEditError::Changed);
    }
    if info.byte_len == 0 {
        return Err(OfficeEditError::Failed);
    }
    if info.byte_len > OFFICE_SNAPSHOT_OUTPUT_BYTES {
        return Err(OfficeEditError::TooLarge);
    }
    if info.mime != mime || info.byte_len != byte_len {
        return Err(OfficeEditError::Failed);
    }
    if info.preserved_features.len() > 256
        || info
            .preserved_features
            .iter()
            .any(|feature| feature.is_empty() || feature.chars().count() > 256)
        || !info.compatibility.is_valid()
    {
        return Err(OfficeEditError::Failed);
    }
    Ok(())
}

#[tauri::command]
pub async fn office_edit_capture_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    edit: State<'_, OfficeEditState>,
    snapshots: State<'_, Arc<ExportSnapshots>>,
    request_id: String,
    session_id: String,
    expected_revision: u64,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id).map_err(|_| code(OfficeEditError::Invalid))?;
    edit.current_profile().map_err(code)?;
    let session_id = parse_id(&session_id)?;
    if !(1..=MAX_SAFE_INTEGER).contains(&expected_revision) {
        return Err(code(OfficeEditError::Invalid));
    }
    let session = edit.session(session_id).map_err(code)?;
    let current = session.snapshot().map_err(code)?;
    if current.busy {
        return Err(code(OfficeEditError::Busy));
    }
    if current.revision != expected_revision {
        return Err(code(OfficeEditError::Changed));
    }
    if current.compatibility.blocks_save {
        return Err(code(OfficeEditError::PreservationFailed));
    }
    let mime = office_format_mime(current.format)
        .ok_or_else(|| code(OfficeEditError::Unsupported))?
        .to_string();
    let sensitive = session.is_sensitive();
    let engine = edit.engine().map_err(code)?;
    ensure_authority_policy(snapshots.inner().as_ref(), current.document_id, sensitive)
        .map_err(code)?;
    let document_id = current.document_id;
    let content_id = current.content_id;
    let format = current.format;
    let token = jobs.begin(&request_id, 0)?;
    let app = window.app_handle().clone();
    let snapshots = snapshots.inner().clone();
    spawn_job(app, request_id, token, move |context| {
        let state = context.app().state::<OfficeEditState>();
        let session = state.session(session_id).map_err(code)?;
        let baseline = session.snapshot().map_err(code)?;
        if baseline.busy {
            return Err(code(OfficeEditError::Busy));
        }
        if context.token().load(Ordering::Relaxed) {
            return Err(code(OfficeEditError::Cancelled));
        }
        // expected_revision/content_id were frozen before this job started;
        // a later edit must not change what this capture encodes.
        let mut output = BoundedOfficeOutput::new(OFFICE_SNAPSHOT_OUTPUT_BYTES);
        let info = engine
            .capture(session_id, expected_revision, &mut output)
            .map_err(code)?;
        if context.token().load(Ordering::Relaxed) {
            return Err(code(OfficeEditError::Cancelled));
        }
        let bytes = output.into_bytes();
        validate_encoded_info(
            &info,
            expected_revision,
            content_id,
            format,
            &mime,
            bytes.len() as u64,
        )
        .map_err(code)?;
        // A capture can become the model for an ordinary save. If the engine
        // cannot preserve unknown content, publishing it would lose data.
        if info.compatibility.blocks_save {
            return Err(code(OfficeEditError::PreservationFailed));
        }
        let snapshot = publish_snapshot(
            &snapshots,
            document_id,
            expected_revision,
            content_id,
            &mime,
            sensitive,
            bytes.as_slice(),
        )
        .map_err(code)?;
        match serde_json::to_value(&snapshot) {
            Ok(value) => Ok(value),
            Err(_) => {
                let _ = snapshots.release(&snapshot.snapshot_id);
                Err(code(OfficeEditError::Failed))
            }
        }
    });
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn office_edit_export_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    edit: State<'_, OfficeEditState>,
    snapshots: State<'_, Arc<ExportSnapshots>>,
    request_id: String,
    session_id: String,
    expected_revision: u64,
    format: OfficeExportFormat,
    ranges: Vec<PageRange>,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id).map_err(|_| code(OfficeEditError::Invalid))?;
    edit.current_profile().map_err(code)?;
    let session_id = parse_id(&session_id)?;
    if !(1..=MAX_SAFE_INTEGER).contains(&expected_revision)
        || !valid_export_ranges(format, &ranges)
    {
        return Err(code(OfficeEditError::Invalid));
    }
    let session = edit.session(session_id).map_err(code)?;
    let current = session.snapshot().map_err(code)?;
    if current.busy {
        return Err(code(OfficeEditError::Busy));
    }
    if current.revision != expected_revision {
        return Err(code(OfficeEditError::Changed));
    }
    let mime = export_mime(format);
    let capability = export_capability(format);
    let sensitive = session.is_sensitive();
    let engine = edit.engine().map_err(code)?;
    if !current.capabilities.contains(&capability) {
        return Err(code(OfficeEditError::Unsupported));
    }
    ensure_authority_policy(snapshots.inner().as_ref(), current.document_id, sensitive)
        .map_err(code)?;
    let document_id = current.document_id;
    let content_id = current.content_id;
    let source_format = current.format;
    let token = jobs.begin(&request_id, 0)?;
    let app = window.app_handle().clone();
    let snapshots = snapshots.inner().clone();
    spawn_job(app, request_id, token, move |context| {
        let state = context.app().state::<OfficeEditState>();
        let session = state.session(session_id).map_err(code)?;
        let baseline = session.snapshot().map_err(code)?;
        if baseline.busy {
            return Err(code(OfficeEditError::Busy));
        }
        if context.token().load(Ordering::Relaxed) {
            return Err(code(OfficeEditError::Cancelled));
        }
        // The frozen content of expected_revision is exported even when newer
        // edits exist; an engine result with another identity is refused.
        let mut output = BoundedOfficeOutput::new(OFFICE_SNAPSHOT_OUTPUT_BYTES);
        let info = engine
            .export(
                session_id,
                expected_revision,
                format,
                &ranges,
                &mut output,
            )
            .map_err(code)?;
        if context.token().load(Ordering::Relaxed) {
            return Err(code(OfficeEditError::Cancelled));
        }
        let bytes = output.into_bytes();
        validate_encoded_info(
            &info,
            expected_revision,
            content_id,
            source_format,
            mime,
            bytes.len() as u64,
        )
        .map_err(code)?;
        let snapshot = publish_snapshot(
            &snapshots,
            document_id,
            expected_revision,
            content_id,
            mime,
            sensitive,
            bytes.as_slice(),
        )
        .map_err(code)?;
        match serde_json::to_value(&snapshot) {
            Ok(value) => Ok(value),
            Err(_) => {
                let _ = snapshots.release(&snapshot.snapshot_id);
                Err(code(OfficeEditError::Failed))
            }
        }
    });
    Ok(())
}
