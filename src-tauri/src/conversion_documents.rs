//! Bounded document extraction and HTML/PDF conversion through the trusted
//! PDF-write child (Step 08b).
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use convert::{
    ConversionInput, ConversionWarningCode, ConvertOptions, ConvertOutputSink, OutputDraft,
    OutputNamePart, PreparedOutput,
};
use fs_service::owned_io::{PinnedSource, SourceIdentity};
use serde_json::json;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use uuid::Uuid;

use crate::conversion_document_types::{validate_page, HtmlBlock, HtmlBlockPage};
use crate::export_snapshots::{ExportSnapshots, SnapshotLease};
use crate::jobs::{spawn_job, JobContext, Jobs};
use crate::webview_helper_types::*;

const MAX_DOCUMENT_BYTES: u64 = 16 * 1024 * 1024;
const MAX_CURSOR_BYTES: usize = 32 * 1024 * 1024;
const MAX_DOCUMENT_OUTPUT_BYTES: u64 = 512 * 1024 * 1024;

struct Continuation {
    blocks: Vec<HtmlBlock>,
    expires: Instant,
}

#[derive(Default)]
pub struct DocumentBlockPages(Mutex<HashMap<Uuid, Continuation>>);

impl DocumentBlockPages {
    fn page(&self, blocks: Vec<HtmlBlock>) -> Result<HtmlBlockPage, String> {
        let mut table = self.0.lock().map_err(|_| "convert.io")?;
        table.retain(|_, page| page.expires > Instant::now());
        let mut blocks = blocks;
        let tail = if blocks.len() > 256 {
            blocks.split_off(256)
        } else {
            Vec::new()
        };
        let next_cursor = if tail.is_empty() {
            None
        } else {
            if table.len() >= 32 {
                return Err("convert.too_large".into());
            }
            let bytes = table
                .values()
                .map(|page| {
                    serde_json::to_vec(&page.blocks)
                        .map(|value| value.len())
                        .unwrap_or(MAX_CURSOR_BYTES)
                })
                .sum::<usize>();
            if bytes
                .checked_add(serde_json::to_vec(&tail).map_err(|_| "convert.io")?.len())
                .is_none_or(|size| size > MAX_CURSOR_BYTES)
            {
                return Err("convert.too_large".into());
            }
            let id = Uuid::new_v4();
            table.insert(
                id,
                Continuation {
                    blocks: tail,
                    expires: Instant::now() + Duration::from_secs(300),
                },
            );
            Some(id.to_string())
        };
        let page = HtmlBlockPage {
            blocks,
            complete: next_cursor.is_none(),
            next_cursor,
        };
        validate_page(&page).map_err(|_| "convert.bad_request".to_string())?;
        Ok(page)
    }

    fn next(&self, cursor: &str) -> Result<HtmlBlockPage, String> {
        let id = Uuid::parse_str(cursor).map_err(|_| "convert.bad_request")?;
        let continuation = self
            .0
            .lock()
            .map_err(|_| "convert.io")?
            .remove(&id)
            .ok_or("convert.changed")?;
        if continuation.expires <= Instant::now() {
            return Err("convert.changed".into());
        }
        self.page(continuation.blocks)
    }
}

struct AuthorizedDocument {
    grant: HelperInputGrant,
    name: String,
    lease: Option<SnapshotLease>,
}

struct ExtractedDocument {
    name: String,
    kind: String,
    blocks: Vec<HtmlBlock>,
    layout_loss: bool,
}

fn authorize_document(app: &AppHandle, input: &ConversionInput) -> Result<AuthorizedDocument, String> {
    match input {
        ConversionInput::File { path, expected } => {
            crate::validate_absolute_path(path)?;
            let pathbuf = std::path::PathBuf::from(path);
            let before = fs_service::capture_source_stamp(&pathbuf).map_err(|_| "convert.changed")?;
            if expected.as_ref().is_some_and(|stamp| stamp != &before) {
                return Err("convert.changed".into());
            }
            if before.size_bytes > MAX_DOCUMENT_BYTES {
                return Err("convert.too_large".into());
            }
            let identity = SourceIdentity::capture(&pathbuf).map_err(|_| "convert.changed")?;
            let pinned = Arc::new(PinnedSource::open(&pathbuf, &identity).map_err(|_| "convert.changed")?);
            let name = pathbuf
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or("convert.bad_request")?
                .to_string();
            let lower = name.to_ascii_lowercase();
            let mime = if lower.ends_with(".md") || lower.ends_with(".markdown") {
                "text/markdown"
            } else if lower.ends_with(".html") || lower.ends_with(".htm") {
                "text/html"
            } else {
                return Err("convert.unsupported".into());
            };
            Ok(AuthorizedDocument {
                grant: HelperInputGrant {
                    grant_id: Uuid::new_v4(),
                    name: name.clone(),
                    mime: mime.to_string(),
                    source: HelperInputSource::Disk {
                        path: pathbuf,
                        expected: before,
                        pinned,
                    },
                },
                name,
                lease: None,
            })
        }
        ConversionInput::Snapshot {
            snapshot_id,
            document_id,
            revision,
        } => {
            let snapshots = app.state::<Arc<ExportSnapshots>>();
            let lease = snapshots.resolve(snapshot_id, document_id, *revision)?;
            if lease.snapshot.byte_len > MAX_DOCUMENT_BYTES {
                return Err("convert.too_large".into());
            }
            if !matches!(lease.snapshot.mime.as_str(), "text/markdown" | "text/html") {
                return Err("convert.unsupported".into());
            }
            let document_uuid = Uuid::parse_str(document_id).map_err(|_| "convert.bad_request")?;
            let name = snapshots
                .authorities()
                .get(document_uuid)
                .map_err(|_| "convert.changed")?
                .authority
                .name;
            let source = HelperInputSource::Snapshot {
                backing: Arc::clone(&lease.backing),
                document_id: document_id.clone(),
                revision: *revision,
                content_id: lease.snapshot.content_id,
                sensitive: lease.backing.is_sensitive(),
            };
            Ok(AuthorizedDocument {
                grant: HelperInputGrant {
                    grant_id: Uuid::new_v4(),
                    name: name.clone(),
                    mime: lease.snapshot.mime.clone(),
                    source,
                },
                name,
                lease: Some(lease),
            })
        }
    }
}

fn helper_config(app: &AppHandle) -> WebviewHelperConfig {
    WebviewHelperConfig {
        kind: WebviewHelperKind::PdfWrite,
        entry: "pdf-write-helper.html",
        max_body_bytes: 16 * 1024 * 1024,
        max_output_bytes: MAX_DOCUMENT_OUTPUT_BYTES,
        data_dir: app
            .state::<crate::AppState>()
            .data_dir()
            .join("convert-input")
            .join(Uuid::new_v4().to_string()),
        placement: HelperWindowPlacement::Hidden,
    }
}

fn extract_document(
    app: &AppHandle,
    input: &ConversionInput,
    context: &JobContext,
) -> Result<ExtractedDocument, String> {
    let authorized = authorize_document(app, input)?;
    let name = authorized.name.clone();
    let kind = if authorized.grant.mime == "text/markdown" {
        "markdown"
    } else {
        "html"
    };
    let grant = authorized.grant;
    let request = WebviewHelperRequest {
        request_id: Uuid::new_v4(),
        action: HelperAction::PdfWriteBlocks,
        payload: json!({"mode":"blocks", "kind":kind}),
        output_specs: Vec::new(),
    };
    let result = crate::webview_helper::run_webview_helper(
        helper_config(app),
        vec![grant],
        request,
        context.token().clone(),
    )?;
    let payload = result
        .reply
        .get("payload")
        .cloned()
        .ok_or("convert.bad_request")?;
    let page: HtmlBlockPage = serde_json::from_value(payload.clone()).map_err(|_| "convert.bad_request")?;
    if !page.complete || page.next_cursor.is_some() {
        return Err("convert.bad_request".into());
    }
    if serde_json::to_vec(&page.blocks).map_err(|_| "convert.io")?.len() > MAX_CURSOR_BYTES {
        return Err("convert.too_large".into());
    }
    for block in &page.blocks {
        validate_page(&HtmlBlockPage {
            blocks: vec![block.clone()],
            next_cursor: None,
            complete: true,
        })
        .map_err(|_| "convert.bad_request")?;
    }
    let layout_loss = payload
        .get("layout_loss")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
        || payload
            .get("removed_images")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0)
            > 0
        || payload
            .get("removed_elements")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0)
            > 0;
    drop(authorized.lease);
    Ok(ExtractedDocument {
        name,
        kind: kind.to_string(),
        blocks: page.blocks,
        layout_loss,
    })
}

pub fn extract_blocks(
    app: &AppHandle,
    input: &ConversionInput,
    context: &JobContext,
) -> Result<Vec<HtmlBlock>, String> {
    Ok(extract_document(app, input, context)?.blocks)
}

/// Convert Markdown to sanitized HTML, or Markdown/HTML to PDF. The helper
/// receives only authorized grants and plain blocks; raw markup never enters
/// the main window or an output path.
pub fn convert_document(
    input: &ConversionInput,
    converter_id: &str,
    options: &ConvertOptions,
    sink: &mut dyn ConvertOutputSink,
    context: &JobContext,
    max_output_bytes: u64,
) -> Result<PreparedOutput, String> {
    let ConvertOptions::Document(options) = options else {
        return Err("convert.bad_request".into());
    };
    if !matches!(converter_id, "markdown/html" | "markdown/pdf" | "html/pdf")
        || !options.sanitize
    {
        return Err("convert.unsupported".into());
    }
    ConvertOptions::Document(options.clone())
        .validate()
        .map_err(|error| error.code().to_string())?;
    let extracted = extract_document(context.app(), input, context)?;
    let expected_kind = if converter_id == "html/pdf" {
        "html"
    } else {
        "markdown"
    };
    if extracted.kind != expected_kind {
        return Err("convert.unsupported".into());
    }
    let html = converter_id == "markdown/html";
    if !html && extracted.blocks.is_empty() {
        return Err("convert.bad_request".into());
    }
    let mode = if html { "html" } else { "pdf" };
    let mime = if html { "text/html" } else { "application/pdf" };
    let payload = json!({
        "mode": mode,
        "blocks": extracted.blocks,
        "page_size": options.page_size,
        "margin_mm": options.margin_mm,
        "title": options.title,
    });
    if serde_json::to_vec(&payload).map_err(|_| "convert.io")?.len() > 16 * 1024 * 1024 {
        return Err("convert.too_large".into());
    }
    let request = WebviewHelperRequest {
        request_id: Uuid::new_v4(),
        action: HelperAction::PdfWriteBlocks,
        payload,
        output_specs: vec![HelperOutputSpec {
            mime: mime.to_string(),
            max_bytes: max_output_bytes.min(MAX_DOCUMENT_OUTPUT_BYTES),
        }],
    };
    let result = crate::webview_helper::run_webview_helper(
        helper_config(context.app()),
        Vec::new(),
        request,
        context.token().clone(),
    )?;
    if result.outputs.len() != 1 {
        return Err("convert.changed".into());
    }
    let reply_loss = result
        .reply
        .get("payload")
        .and_then(|value| value.get("layout_loss"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let missing_image = result
        .reply
        .get("payload")
        .and_then(|value| value.get("missing_image"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let warnings = if extracted.layout_loss || reply_loss || missing_image {
        vec![ConversionWarningCode::LayoutLoss]
    } else {
        Vec::new()
    };
    let output = result.outputs.into_iter().next().ok_or("convert.changed")?;
    crate::conversion_pdf::publish_helper_output(
        output,
        OutputDraft {
            name_hint: extracted.name,
            name_part: OutputNamePart::None,
            mime: mime.to_string(),
            input_indices: vec![0],
        },
        warnings,
        sink,
        context,
        max_output_bytes.min(MAX_DOCUMENT_OUTPUT_BYTES),
    )
}

#[tauri::command]
pub fn doc_blocks_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    request_id: String,
    input: ConversionInput,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    let token = jobs.begin(&request_id, 1)?;
    spawn_job(app, request_id, token, move |context| {
        let blocks = extract_blocks(context.app(), &input, context)?;
        serde_json::to_value(context.app().state::<DocumentBlockPages>().page(blocks)?)
            .map_err(|_| "convert.io".into())
    });
    Ok(())
}

#[tauri::command]
pub fn doc_blocks_page(
    window: WebviewWindow,
    pages: State<'_, DocumentBlockPages>,
    cursor: String,
) -> Result<HtmlBlockPage, String> {
    crate::ensure_main(window.label())?;
    pages.next(&cursor)
}
