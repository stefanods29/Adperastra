//! Read-only Office view commands (Step 13 T4).
//!
//! The command layer owns only job validation and the session table. Quick
//! structural pages come from T2's isolated helper; accurate pages come from
//! T3's warm pool. Those producers are injected through the small source
//! traits below, so this module never invents a second engine/helper host.
//! If neither producer is installed, page requests return the honest
//! `office.pack_missing` error and the UI offers "Open in my chosen app".
#![allow(dead_code)]

use std::path::PathBuf;
use std::sync::Arc;

use convert::ConversionInput;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use uuid::Uuid;

use crate::cache::CacheService;
use crate::jobs::{spawn_job, Jobs};
use crate::office_quick::{inspect_quick_package, quick_fallback, QuickPackage};
use crate::office_quick_source::quick_source_for;
use crate::office_view_sessions::{OfficeDocumentLease, OfficeOpenedDocument, OfficeViewSessions};
use crate::office_view_types::{
    parse_cursor, validate_cell_request, OfficeCellPage, OfficeCommentPage, OfficeFormat,
    OfficeQuality, OfficeSection, OfficeSectionKind, OfficeSectionPage, OfficeSession,
    OFFICE_MAX_CELL_COLUMNS, OFFICE_MAX_SECTIONS,
};
use crate::{ensure_main, valid_request_id};

pub use crate::office_view_runtime_impl::{
    OfficeAccuratePageSource, OfficeQuickPageSource, OfficeRuntimeImpl,
};

use crate::office_view_runtime_impl::OfficeQuickPageSource as QuickPageSourceTrait;

struct NoLease;

impl OfficeDocumentLease for NoLease {
    fn close(&self) {}
}

fn format_from_extension(path: &str) -> Result<OfficeFormat, String> {
    let extension = PathBuf::from(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .ok_or_else(|| "office.unsupported".to_string())?;
    serde_json::from_str::<OfficeFormat>(&format!("\"{extension}\""))
        .map_err(|_| "office.unsupported".to_string())
}

fn source_revision_of(input: &ConversionInput) -> u64 {
    match input {
        ConversionInput::File { .. } => 1,
        ConversionInput::Snapshot { revision, .. } => *revision,
    }
}

#[allow(clippy::type_complexity)]
fn sections_for_quick(
    input: &ConversionInput,
    format: OfficeFormat,
) -> Result<(Vec<OfficeSection>, Option<PathBuf>, Option<QuickPackage>), String> {
    match input {
        ConversionInput::File { path, .. } => {
            let package = inspect_quick_package(std::path::Path::new(path), format)?;
            // The bounded ZIP parser is the only structural reader that runs
            // in the app process. Worksheet dimensions/cells come from the
            // 256 MiB `--office-sheet-helper` child when the grid asks for
            // them, so calamine never loads a user workbook here.
            let sections = package.sections.clone();
            Ok((sections, Some(PathBuf::from(path)), Some(package)))
        }
        ConversionInput::Snapshot { .. } => {
            // A snapshot is opened through the accurate source; a structural
            // quick parser never invents a disk path for it.
            Ok((
                vec![OfficeSection {
                    id: "document".to_string(),
                    name: String::new(),
                    kind: OfficeSectionKind::Document,
                    index: 0,
                    page_count: 1,
                    rows: None,
                    columns: None,
                }],
                None,
                None,
            ))
        }
    }
}

fn open_session(
    input: ConversionInput,
    revision: u64,
    app: &AppHandle,
    sessions: &OfficeViewSessions,
    work: &crate::jobs::JobContext,
) -> Result<OfficeSession, String> {
    let _ = app;
    let format = match &input {
        ConversionInput::File { path, .. } => format_from_extension(path)?,
        ConversionInput::Snapshot {
            snapshot_id,
            document_id,
            revision,
        } => {
            let snapshots = app.state::<Arc<crate::export_snapshots::ExportSnapshots>>();
            let lease = snapshots
                .resolve(snapshot_id, document_id, *revision)
                .map_err(|_| "office.changed")?;
            OfficeFormat::from_mime(&lease.snapshot.mime).ok_or("office.unsupported")?
        }
    };
    let (mut sections, sheet_path, package) = sections_for_quick(&input, format)?;
    let has_comments = package
        .as_ref()
        .map(|package| {
            package
                .warnings
                .iter()
                .any(|warning| warning == "office.comments_quick")
        })
        .unwrap_or(false);
    if sections.is_empty() || sections.len() > OFFICE_MAX_SECTIONS {
        return Err("office.too_large".to_string());
    }
    let session_id = Uuid::new_v4();
    sessions.sweep_idle(unix_now());
    let reservation = sessions.reserve()?;
    let mut session = OfficeSession {
        session_id,
        format,
        source_revision: revision,
        engine_version: "structural".to_string(),
        quality: OfficeQuality::Quick,
        section_count: sections.len() as u32,
        read_only: true,
        capabilities: crate::office_view_types::OfficeCapabilities {
            comments: has_comments,
            presentation: sections
                .iter()
                .any(|section| section.kind == OfficeSectionKind::Slide),
            exact_render: false,
        },
    };
    let accurate =
        crate::office_accurate_source::AccurateOfficeSource::open(&input, format, &sections, work)?;
    if let Some(source) = &accurate {
        source.update_sections(&mut sections);
        session.section_count = sections.len() as u32;
        session.capabilities.presentation = sections
            .iter()
            .any(|section| section.kind == OfficeSectionKind::Slide);
        session.quality = OfficeQuality::Accurate;
        session.engine_version = source.engine_version.clone();
        session.capabilities.exact_render = true;
        // Whole-workbook and unindexed presentation pages have no stable
        // mapping to structural comments.
        session.capabilities.comments = has_comments
            && (format.family() == crate::engine_types::OfficeFamily::Writer
                || session.capabilities.presentation);
    }
    let quick = if accurate.is_some() && !session.capabilities.comments {
        None
    } else if let Some(cache) = app.try_state::<Arc<CacheService>>() {
        match quick_source_for(
            package.as_ref(),
            crate::resolve_data_dir(),
            cache.inner().clone(),
            revision,
        ) {
            Ok(source) => source,
            // An optional text/comment extractor must not prevent opening
            // a successfully rendered document.
            Err(_) if accurate.is_some() => None,
            Err(error) => return Err(error),
        }
    } else {
        None
    };
    if let Some(source) = quick.as_ref().filter(|_| accurate.is_none()) {
        if let Some(section) = sections
            .iter_mut()
            .find(|section| section.kind == OfficeSectionKind::Document)
        {
            section.page_count = source.document_page_count;
        }
    }
    session.capabilities.comments &= quick.is_some();
    let quick = quick.map(|source| source as Arc<dyn QuickPageSourceTrait>);
    let runtime = Arc::new(OfficeRuntimeImpl::new(
        sections.clone(),
        sheet_path,
        quick,
        accurate.map(|source| Arc::new(source) as Arc<dyn OfficeAccuratePageSource>),
    ));
    let opened = OfficeOpenedDocument {
        session: session.clone(),
        sections,
        source_revision: revision,
        source_content_id: None,
        runtime,
        lease: Arc::new(NoLease),
    };
    reservation.commit(opened, unix_now())?;
    Ok(session)
}

fn parse_session(id: &str) -> Result<Uuid, String> {
    Uuid::parse_str(id).map_err(|_| "office.bad_request".to_string())
}

/// Open one read-only Office view (E1).
#[tauri::command]
pub fn office_view_open_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    app: AppHandle,
    request_id: String,
    input: ConversionInput,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id).map_err(|_| "office.bad_request".to_string())?;
    if !valid_conversion_input(&input) {
        return Err("office.bad_request".to_string());
    }
    let revision = source_revision_of(&input);
    let token = jobs
        .begin(&request_id, 1)
        .map_err(|_| "office.bad_request".to_string())?;
    let app_for_work = app.clone();
    spawn_job(app, request_id, token, move |context| {
        let session_state = app_for_work.state::<OfficeViewSessions>();
        let session = open_session(
            input,
            revision,
            &app_for_work,
            session_state.inner(),
            context,
        )?;
        serde_json::to_value(session).map_err(|_| "office.engine_failed".to_string())
    });
    Ok(())
}

/// Render/retrieve one page (E2).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn office_view_page_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    app: AppHandle,
    request_id: String,
    session_id: String,
    section_id: String,
    page: u32,
    scale: f64,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id).map_err(|_| "office.bad_request".to_string())?;
    let session = parse_session(&session_id)?;
    crate::office_view_types::validate_page_request(page, scale)?;
    if !valid_section_id_any(&section_id) {
        return Err("office.bad_request".to_string());
    }
    let token = jobs
        .begin(&request_id, 1)
        .map_err(|_| "office.bad_request".to_string())?;
    let app_for_work = app.clone();
    spawn_job(app, request_id, token, move |context| {
        let session_state = app_for_work.state::<OfficeViewSessions>();
        session_state.inner().sweep_idle(unix_now());
        let entry = session_state.inner().get(session)?;
        entry.touch(unix_now());
        let work = crate::office_pool::JobContextWork(context);
        let result = entry.page(&section_id, page, scale, &work)?;
        serde_json::to_value(result).map_err(|_| "office.engine_failed".to_string())
    });
    Ok(())
}

/// One bounded page of stable section descriptors (E3).
#[tauri::command]
pub async fn office_view_sections(
    window: WebviewWindow,
    sessions: State<'_, OfficeViewSessions>,
    session_id: String,
    cursor: Option<String>,
) -> Result<OfficeSectionPage, String> {
    ensure_main(window.label())?;
    let id = parse_session(&session_id)?;
    let cursor = parse_cursor(cursor.as_deref())?;
    let entry = sessions.get(id)?;
    entry.touch(unix_now());
    entry.sections_page(cursor)
}

/// Read supported comments; text is escaped by the UI, never HTML (E3).
#[tauri::command]
pub async fn office_view_comments(
    window: WebviewWindow,
    app: AppHandle,
    session_id: String,
    section_id: String,
    cursor: Option<String>,
) -> Result<OfficeCommentPage, String> {
    ensure_main(window.label())?;
    let id = parse_session(&session_id)?;
    let cursor = parse_cursor(cursor.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        let sessions = app.state::<OfficeViewSessions>();
        let entry = sessions.inner().get(id)?;
        entry.touch(unix_now());
        entry.comments(&section_id, cursor)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Read one bounded sheet cell page (E3). `column_start`/`column_count` are
/// optional and default to the first 200 columns; the visible window keeps a
/// wide sheet under the 768 KiB answer cap. Formulas are shown as saved text
/// and are never calculated.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn office_view_cells(
    window: WebviewWindow,
    app: AppHandle,
    session_id: String,
    section_id: String,
    row_start: u32,
    row_count: u32,
    column_start: Option<u32>,
    column_count: Option<u32>,
) -> Result<OfficeCellPage, String> {
    ensure_main(window.label())?;
    let id = parse_session(&session_id)?;
    let column_start = column_start.unwrap_or(0);
    let column_count = column_count.unwrap_or(OFFICE_MAX_CELL_COLUMNS as u32);
    validate_cell_request(row_start, row_count, column_start, column_count)?;
    tauri::async_runtime::spawn_blocking(move || {
        let sessions = app.state::<OfficeViewSessions>();
        let entry = sessions.inner().get(id)?;
        entry.touch(unix_now());
        entry.cells(
            &section_id,
            row_start,
            row_count,
            column_start,
            column_count,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Idempotent session close (E4).
#[tauri::command]
pub fn office_view_close(
    window: WebviewWindow,
    sessions: State<'_, OfficeViewSessions>,
    session_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    if let Ok(id) = Uuid::parse_str(&session_id) {
        sessions.close(id);
    }
    Ok(())
}

pub fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|age| age.as_secs())
        .unwrap_or(0)
}

/// The source `/` format pair is used by the coordinator when wiring T2/T3.
pub fn source_format(input: &ConversionInput) -> Result<OfficeFormat, String> {
    match input {
        ConversionInput::File { path, .. } => format_from_extension(path),
        ConversionInput::Snapshot { .. } => Err("office.unsupported".to_string()),
    }
}

/// Diagnostic helper used by coordinator tests; it is not an engine call.
pub fn fallback_source(format: OfficeFormat) -> bool {
    quick_fallback(format)
}

fn valid_conversion_input(input: &ConversionInput) -> bool {
    match input {
        ConversionInput::File { path, .. } => {
            crate::validate_absolute_path(path).is_ok() && path.encode_utf16().count() <= 32_768
        }
        ConversionInput::Snapshot {
            snapshot_id,
            document_id,
            revision,
        } => {
            !snapshot_id.is_empty()
                && snapshot_id.len() <= 64
                && !document_id.is_empty()
                && document_id.len() <= 128
                && *revision >= 1
                && *revision < (1u64 << 53)
        }
    }
}

fn valid_section_id_any(id: &str) -> bool {
    if id.is_empty() || id.len() > 64 {
        return false;
    }
    if id == "document" {
        return true;
    }
    let Some((prefix, number)) = id.split_once(':') else {
        return false;
    };
    matches!(prefix, "document" | "sheet" | "slide")
        && !number.is_empty()
        && number.bytes().all(|byte| byte.is_ascii_digit())
}

/// Keeps the native path checker visible to this module. The real command
/// validation remains `validate_absolute_path` in `main.rs`.
pub fn validate_input_path(path: &str) -> Result<(), String> {
    crate::validate_absolute_path(path).map_err(|_| "office.bad_request".to_string())
}

/// A stable diagnostic for the UI; the actual message is translated.
pub fn diagnostic_code(error: &str) -> &str {
    if error.starts_with("office.") || error.starts_with("engines.") {
        error
    } else {
        "office.engine_failed"
    }
}
