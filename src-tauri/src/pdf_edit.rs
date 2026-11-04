//! Native PDF edit host (Step 14a, `pdf-edit-1`).
//!
//! Two jobs own the `pdf.edit.inspect` and `pdf.edit.serialize` helper calls.
//! Sources, the bounded model descriptor and signature rasters arrive as
//! guarded helper grants; the helper returns its answer through one reserved
//! output. A serialized copy is published through the Step 08a snapshot
//! authority for the exact captured document/revision/content tuple. No
//! command in this module writes a user file, so the existing-target Save
//! stays unavailable and Save a copy remains the only route.

use std::io::{Read, Seek, SeekFrom};
use std::sync::Arc;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::export_snapshot_types::{
    ExportSnapshot, SnapshotBeginRequest, StoragePolicy, MAX_SNAPSHOT_CHUNK,
};
use crate::export_snapshots::{ExportSnapshots, SnapshotLease};
use crate::jobs::{spawn_job, Jobs};
use crate::pdf_edit_types::{
    map_inspection, map_serialize_inspection, HelperInspectReply, HelperSerializeReply,
    PdfEditInspectRequest, PdfEditInspection, PdfEditSerializeOutcome, PdfEditSerializeRequest,
    PDF_EDIT_MAX_ANNOTATIONS, PDF_EDIT_MAX_FORMS, PDF_EDIT_MAX_PAGES, PDF_EDIT_MAX_SIGNATURE_BYTES,
    PDF_EDIT_MAX_SOURCE_BYTES, PDF_EDIT_MAX_WIRE_BYTES,
};
use crate::webview_helper::run_webview_helper;
use crate::webview_helper_types::{
    HelperAction, HelperInputGrant, HelperInputSource, HelperOutputSpec, HelperOutputStorage,
    WebviewHelperConfig, WebviewHelperKind, WebviewHelperRequest, WebviewHelperResult, MAX_INPUTS,
};
use crate::{ensure_main, valid_request_id};

#[derive(Debug, Deserialize)]
struct WireModel {
    schema_version: u32,
    document_id: String,
    content_id: String,
    pages: Vec<WirePage>,
    annotations: Vec<WireAnnotation>,
    #[serde(default)]
    forms: Vec<Value>,
    source_snapshot: ExportSnapshot,
}

#[derive(Debug, Deserialize)]
struct WirePage {
    origin_source: ExportSnapshot,
}

#[derive(Debug, Deserialize)]
struct WireAnnotation {
    id: String,
    #[serde(default)]
    image: Option<ExportSnapshot>,
}

struct ResolvedSource {
    grant_id: Uuid,
    snapshot_id: String,
    lease: SnapshotLease,
}

struct ResolvedImage {
    grant_id: Uuid,
    snapshot_id: String,
    mime: String,
    lease: SnapshotLease,
}

fn helper_config(app: &AppHandle) -> WebviewHelperConfig {
    WebviewHelperConfig {
        kind: WebviewHelperKind::PdfWrite,
        entry: WebviewHelperKind::PdfWrite.entry(),
        max_body_bytes: 16 * 1024 * 1024,
        max_output_bytes: PDF_EDIT_MAX_SOURCE_BYTES,
        data_dir: app
            .state::<crate::AppState>()
            .data_dir()
            .join("webview-helper")
            .join("pdf-edit"),
        placement: crate::webview_helper_types::HelperWindowPlacement::Hidden,
    }
}

fn canonical_uuid(value: &str) -> Result<Uuid, String> {
    Uuid::parse_str(value).map_err(|_| "pdf_edit.bad_request".to_string())
}

fn same_uuid(left: &str, right: &str) -> bool {
    match (Uuid::parse_str(left), Uuid::parse_str(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

fn map_helper_error(code: String) -> String {
    if code.starts_with("pdf_edit.") || code == "helper.sensitive_unsupported" {
        return code;
    }
    match code.as_str() {
        "pdf.bad_request" | "helper.invalid_config" | "helper.invalid_placement" => {
            "pdf_edit.bad_request".to_string()
        }
        "pdf.too_large" | "helper.too_large" => "pdf_edit.too_large".to_string(),
        "pdf.changed" | "helper.timeout" | "helper.busy" => "pdf_edit.changed".to_string(),
        "pdf.unsupported_feature" => "pdf_edit.unsupported".to_string(),
        _ => "pdf_edit.failed".to_string(),
    }
}

fn map_snapshot_error(code: String) -> String {
    match code.as_str() {
        "snapshot.too_large" => "pdf_edit.too_large".to_string(),
        "snapshot.changed" | "snapshot.bad_request" => "pdf_edit.changed".to_string(),
        _ => "pdf_edit.failed".to_string(),
    }
}

fn resolve_exact(
    snapshots: &ExportSnapshots,
    snapshot_id: &str,
    document_id: &str,
    revision: u64,
    content_id: &str,
) -> Result<SnapshotLease, String> {
    canonical_uuid(snapshot_id)?;
    canonical_uuid(content_id)?;
    let document_id = canonical_uuid(document_id)?.to_string();
    if revision == 0 {
        return Err("pdf_edit.bad_request".to_string());
    }
    let lease = snapshots
        .resolve_exact(snapshot_id, &document_id, revision, content_id)
        .map_err(map_snapshot_error)?;
    if lease.snapshot.byte_len == 0 || lease.snapshot.byte_len > PDF_EDIT_MAX_SOURCE_BYTES {
        return Err("pdf_edit.too_large".to_string());
    }
    Ok(lease)
}

fn resolve_snapshot(
    snapshots: &ExportSnapshots,
    source: &ExportSnapshot,
) -> Result<SnapshotLease, String> {
    resolve_exact(
        snapshots,
        &source.snapshot_id,
        &source.document_id,
        source.revision,
        &source.content_id.to_string(),
    )
}

fn resolve_pdf_snapshot(
    snapshots: &ExportSnapshots,
    source: &ExportSnapshot,
) -> Result<SnapshotLease, String> {
    let lease = resolve_snapshot(snapshots, source)?;
    if lease.snapshot.mime != "application/pdf" {
        return Err("pdf_edit.unsupported".to_string());
    }
    Ok(lease)
}

fn image_mime(value: &str) -> Result<&str, String> {
    match value {
        "image/png" | "image/jpeg" => Ok(value),
        _ => Err("pdf_edit.unsupported".to_string()),
    }
}

fn read_output(storage: HelperOutputStorage, max_bytes: u64) -> Result<Vec<u8>, String> {
    match storage {
        HelperOutputStorage::Memory(bytes) => {
            if bytes.len() as u64 > max_bytes {
                return Err("pdf_edit.too_large".to_string());
            }
            Ok(bytes.to_vec())
        }
        HelperOutputStorage::OwnedFile(mut output) => {
            let file = output.file_mut();
            file.seek(SeekFrom::Start(0))
                .map_err(|_| "pdf_edit.failed".to_string())?;
            let mut bytes = Vec::new();
            file.take(max_bytes.saturating_add(1))
                .read_to_end(&mut bytes)
                .map_err(|_| "pdf_edit.failed".to_string())?;
            if bytes.len() as u64 > max_bytes {
                return Err("pdf_edit.too_large".to_string());
            }
            Ok(bytes)
        }
    }
}

/// Exactly one output with the announced MIME and length, plus the helper's
/// validated control reply.
fn take_result(
    result: WebviewHelperResult,
    mime: &str,
    max_bytes: u64,
) -> Result<(Value, Vec<u8>), String> {
    let WebviewHelperResult { reply, outputs, .. } = result;
    if outputs.len() != 1 {
        return Err("pdf_edit.failed".to_string());
    }
    let output = outputs
        .into_iter()
        .next()
        .ok_or_else(|| "pdf_edit.failed".to_string())?;
    if output.mime != mime || output.byte_len == 0 || output.byte_len > max_bytes {
        return Err("pdf_edit.failed".to_string());
    }
    let bytes = read_output(output.storage, max_bytes)?;
    if bytes.len() as u64 != output.byte_len {
        return Err("pdf_edit.failed".to_string());
    }
    Ok((reply, bytes))
}

/// Publish exactly the helper bytes through the 08a upload protocol. The
/// document/revision/content tuple comes from the captured model, never from
/// a filename or a live source stamp.
fn publish_snapshot(
    snapshots: &ExportSnapshots,
    document_id: Uuid,
    revision: u64,
    content_id: Uuid,
    bytes: &[u8],
) -> Result<ExportSnapshot, String> {
    if bytes.is_empty() || bytes.len() as u64 > PDF_EDIT_MAX_SOURCE_BYTES || revision == 0 {
        return Err("pdf_edit.too_large".to_string());
    }
    snapshots
        .authorities()
        .permit_capture_mime(document_id, "application/pdf")
        .map_err(map_snapshot_error)?;
    let begin = snapshots
        .begin(SnapshotBeginRequest {
            document_id,
            revision,
            content_id,
            mime: "application/pdf".to_string(),
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
                .ok_or_else(|| "pdf_edit.too_large".to_string())?;
        }
        snapshots.finish(&begin.snapshot_id)
    })();
    if publish.is_err() {
        let _ = snapshots.abort_upload(&begin.snapshot_id);
    }
    publish
}

fn parse_model(
    request: &PdfEditSerializeRequest,
) -> Result<(WireModel, Vec<u8>, Vec<String>), String> {
    let model_bytes =
        serde_json::to_vec(&request.model).map_err(|_| "pdf_edit.bad_request".to_string())?;
    if model_bytes.is_empty() || model_bytes.len() > PDF_EDIT_MAX_WIRE_BYTES {
        return Err("pdf_edit.too_large".to_string());
    }
    let model: WireModel = serde_json::from_value(request.model.clone())
        .map_err(|_| "pdf_edit.bad_request".to_string())?;
    if model.schema_version != 1
        || model.pages.is_empty()
        || model.pages.len() > PDF_EDIT_MAX_PAGES
        || model.annotations.len() > PDF_EDIT_MAX_ANNOTATIONS
        || model.forms.len() > PDF_EDIT_MAX_FORMS
    {
        return Err("pdf_edit.bad_request".to_string());
    }
    canonical_uuid(&model.document_id)?;
    canonical_uuid(&model.content_id)?;
    if !same_uuid(&model.document_id, &request.document_id)
        || !same_uuid(&model.content_id, &request.content_id)
        || !same_uuid(&model.source_snapshot.snapshot_id, &request.snapshot_id)
        || !same_uuid(&model.source_snapshot.document_id, &request.document_id)
    {
        return Err("pdf_edit.changed".to_string());
    }

    let mut model_ids = std::collections::HashSet::new();
    for annotation in &model.annotations {
        model_ids.insert(canonical_uuid(&annotation.id)?.to_string());
    }
    let mut owned = Vec::new();
    let mut owned_set = std::collections::HashSet::new();
    for value in &request.owned_annotation_ids {
        let id = canonical_uuid(value)?.to_string();
        if model_ids.contains(&id) && owned_set.insert(id.clone()) {
            owned.push(id);
        }
    }
    Ok((model, model_bytes, owned))
}

fn pdf_edit_inspect(
    app: &AppHandle,
    cancel: fs_service::CancellationToken,
    request: &PdfEditInspectRequest,
) -> Result<PdfEditInspection, String> {
    canonical_uuid(&request.document_id)?;
    canonical_uuid(&request.content_id)?;
    let snapshots = app.state::<Arc<ExportSnapshots>>();
    let lease = resolve_exact(
        snapshots.inner().as_ref(),
        &request.snapshot_id,
        &request.document_id,
        request.revision,
        &request.content_id,
    )?;
    if lease.snapshot.mime != "application/pdf" {
        return Err("pdf_edit.unsupported".to_string());
    }
    let sensitive = lease.snapshot.storage_policy == StoragePolicy::Sensitive;
    let grant_id = Uuid::new_v4();
    let grant = HelperInputGrant {
        grant_id,
        name: "source.pdf".to_string(),
        mime: "application/pdf".to_string(),
        source: HelperInputSource::Snapshot {
            backing: lease.backing.clone(),
            document_id: lease.snapshot.document_id.clone(),
            revision: lease.snapshot.revision,
            content_id: lease.snapshot.content_id,
            sensitive,
        },
    };
    let built = WebviewHelperRequest {
        request_id: Uuid::new_v4(),
        action: HelperAction::PdfEditInspect,
        payload: json!({ "grant_id": grant_id.to_string() }),
        output_specs: vec![HelperOutputSpec {
            mime: "application/json".to_string(),
            max_bytes: PDF_EDIT_MAX_WIRE_BYTES as u64,
        }],
    };
    let result = run_webview_helper(helper_config(app), vec![grant], built, cancel)
        .map_err(map_helper_error)?;
    let (reply_value, bytes) =
        take_result(result, "application/json", PDF_EDIT_MAX_WIRE_BYTES as u64)?;
    let reply: HelperInspectReply =
        serde_json::from_value(reply_value).map_err(|_| "pdf_edit.failed".to_string())?;
    // The helper computes `byte_len` before it adds that field to the JSON,
    // so it may be a few bytes smaller than the uploaded body; it may never
    // be larger than the bounded output.
    if reply.byte_len > bytes.len() as u64 {
        return Err("pdf_edit.changed".to_string());
    }
    map_inspection(reply, &lease.snapshot)
}

fn pdf_edit_serialize(
    app: &AppHandle,
    cancel: fs_service::CancellationToken,
    request: &PdfEditSerializeRequest,
) -> Result<PdfEditSerializeOutcome, String> {
    let document_id = canonical_uuid(&request.document_id)?;
    let content_id = canonical_uuid(&request.content_id)?;
    if request.revision == 0 {
        return Err("pdf_edit.bad_request".to_string());
    }
    let (model, model_bytes, owned) = parse_model(request)?;
    let snapshots = app.state::<Arc<ExportSnapshots>>();

    let base = resolve_pdf_snapshot(snapshots.inner().as_ref(), &model.source_snapshot)?;
    let base_sensitive = base.snapshot.storage_policy == StoragePolicy::Sensitive;
    let mut sources: Vec<ResolvedSource> = Vec::new();
    let mut source_ids = std::collections::HashSet::new();
    sources.push(ResolvedSource {
        grant_id: Uuid::new_v4(),
        snapshot_id: base.snapshot.snapshot_id.clone(),
        lease: base,
    });
    source_ids.insert(sources[0].snapshot_id.clone());
    for page in &model.pages {
        let snapshot_id = canonical_uuid(&page.origin_source.snapshot_id)?.to_string();
        if !source_ids.insert(snapshot_id.clone()) {
            continue;
        }
        let lease = resolve_pdf_snapshot(snapshots.inner().as_ref(), &page.origin_source)?;
        if lease.snapshot.storage_policy == StoragePolicy::Sensitive && !base_sensitive {
            return Err("pdf_edit.unsupported".to_string());
        }
        sources.push(ResolvedSource {
            grant_id: Uuid::new_v4(),
            snapshot_id,
            lease,
        });
    }

    let mut images: Vec<ResolvedImage> = Vec::new();
    let mut image_ids = std::collections::HashSet::new();
    for annotation in &model.annotations {
        let Some(image) = annotation.image.as_ref() else {
            continue;
        };
        let mime = image_mime(&image.mime)?.to_string();
        let snapshot_id = canonical_uuid(&image.snapshot_id)?.to_string();
        if !image_ids.insert(snapshot_id.clone()) {
            continue;
        }
        let lease = resolve_snapshot(snapshots.inner().as_ref(), image)?;
        if lease.snapshot.mime != mime {
            return Err("pdf_edit.changed".to_string());
        }
        if lease.snapshot.byte_len > PDF_EDIT_MAX_SIGNATURE_BYTES {
            return Err("pdf_edit.too_large".to_string());
        }
        if lease.snapshot.storage_policy == StoragePolicy::Sensitive && !base_sensitive {
            return Err("pdf_edit.unsupported".to_string());
        }
        images.push(ResolvedImage {
            grant_id: Uuid::new_v4(),
            snapshot_id,
            mime,
            lease,
        });
    }
    let model_grant_id = Uuid::new_v4();
    if 1 + sources.len() + images.len() > MAX_INPUTS {
        return Err("pdf_edit.too_large".to_string());
    }

    let mut inputs = Vec::with_capacity(1 + sources.len() + images.len());
    let mut source_grants = Vec::with_capacity(sources.len());
    for source in &sources {
        source_grants.push(json!({
            "snapshot_id": source.snapshot_id,
            "grant_id": source.grant_id.to_string(),
        }));
        inputs.push(HelperInputGrant {
            grant_id: source.grant_id,
            name: "source.pdf".to_string(),
            mime: "application/pdf".to_string(),
            source: HelperInputSource::Snapshot {
                backing: source.lease.backing.clone(),
                document_id: source.lease.snapshot.document_id.clone(),
                revision: source.lease.snapshot.revision,
                content_id: source.lease.snapshot.content_id,
                sensitive: base_sensitive,
            },
        });
    }
    let mut image_grants = Vec::with_capacity(images.len());
    for image in &images {
        image_grants.push(json!({
            "snapshot_id": image.snapshot_id,
            "grant_id": image.grant_id.to_string(),
        }));
        inputs.push(HelperInputGrant {
            grant_id: image.grant_id,
            name: if image.mime == "image/png" {
                "image.png"
            } else {
                "image.jpg"
            }
            .to_string(),
            mime: image.mime.clone(),
            source: HelperInputSource::Snapshot {
                backing: image.lease.backing.clone(),
                document_id: image.lease.snapshot.document_id.clone(),
                revision: image.lease.snapshot.revision,
                content_id: image.lease.snapshot.content_id,
                sensitive: base_sensitive,
            },
        });
    }
    inputs.push(HelperInputGrant {
        grant_id: model_grant_id,
        name: "model.json".to_string(),
        mime: "application/json".to_string(),
        source: HelperInputSource::Memory {
            data: Arc::new(Zeroizing::new(model_bytes)),
            document_id: request.document_id.clone(),
            revision: request.revision,
            content_id,
            sensitive: base_sensitive,
        },
    });

    let built = WebviewHelperRequest {
        request_id: Uuid::new_v4(),
        action: HelperAction::PdfEditSerialize,
        payload: json!({
            "model_grant_id": model_grant_id.to_string(),
            "revision": request.revision,
            "content_id": request.content_id,
            "owned_annotation_ids": owned,
            "source_grants": source_grants,
            "image_grants": image_grants,
        }),
        output_specs: vec![HelperOutputSpec {
            mime: "application/pdf".to_string(),
            max_bytes: PDF_EDIT_MAX_SOURCE_BYTES,
        }],
    };
    let result =
        run_webview_helper(helper_config(app), inputs, built, cancel).map_err(map_helper_error)?;
    let (reply_value, bytes) = take_result(result, "application/pdf", PDF_EDIT_MAX_SOURCE_BYTES)?;
    let reply: HelperSerializeReply =
        serde_json::from_value(reply_value).map_err(|_| "pdf_edit.failed".to_string())?;
    if reply.byte_len != bytes.len() as u64 {
        return Err("pdf_edit.changed".to_string());
    }
    let inspection = map_serialize_inspection(reply, model.pages.len(), model.annotations.len())?;
    let snapshot = publish_snapshot(
        snapshots.inner().as_ref(),
        document_id,
        request.revision,
        content_id,
        &bytes,
    )?;
    Ok(PdfEditSerializeOutcome {
        snapshot,
        inspection,
    })
}

#[tauri::command]
pub fn pdf_edit_inspect_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    app: AppHandle,
    request_id: String,
    request: PdfEditInspectRequest,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id).map_err(|_| "pdf_edit.bad_request".to_string())?;
    canonical_uuid(&request.document_id)?;
    canonical_uuid(&request.snapshot_id)?;
    canonical_uuid(&request.content_id)?;
    if request.revision == 0 {
        return Err("pdf_edit.bad_request".to_string());
    }
    let token = jobs
        .begin(&request_id, 1)
        .map_err(|_| "pdf_edit.bad_request".to_string())?;
    let work_app = app.clone();
    let work_token = token.clone();
    spawn_job(app, request_id, token, move |_ctx| {
        let inspection = pdf_edit_inspect(&work_app, work_token.clone(), &request)?;
        serde_json::to_value(inspection).map_err(|_| "pdf_edit.failed".to_string())
    });
    Ok(())
}

#[tauri::command]
pub fn pdf_edit_serialize_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    app: AppHandle,
    request_id: String,
    request: PdfEditSerializeRequest,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id).map_err(|_| "pdf_edit.bad_request".to_string())?;
    canonical_uuid(&request.document_id)?;
    canonical_uuid(&request.snapshot_id)?;
    canonical_uuid(&request.content_id)?;
    if request.revision == 0 {
        return Err("pdf_edit.bad_request".to_string());
    }
    let token = jobs
        .begin(&request_id, 1)
        .map_err(|_| "pdf_edit.bad_request".to_string())?;
    let work_app = app.clone();
    let work_token = token.clone();
    spawn_job(app, request_id, token, move |_ctx| {
        let outcome = pdf_edit_serialize(&work_app, work_token.clone(), &request)?;
        serde_json::to_value(outcome).map_err(|_| "pdf_edit.failed".to_string())
    });
    Ok(())
}
