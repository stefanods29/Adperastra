//! Native Office render command (Step 20a E4/T6).
//!
//! Rendering is content-neutral: it never commits state, consumes Undo or
//! changes the source. A result must belong to the exact live session, public
//! revision and requested view generation. Every returned image lease must
//! already be owned by the native lease registry; a sensitive session only
//! accepts sensitive memory-backed leases. Without an approved engine binding
//! the command fails with `office_edit.engine_missing` and invents no page.

use std::sync::atomic::Ordering;

use tauri::{Manager, State, WebviewWindow};
use uuid::Uuid;

use crate::jobs::{spawn_job, Jobs};
use crate::office_edit_sessions::OfficeEditState;
use crate::office_edit_types::{OfficeEditError, OfficeRenderPage, OfficeResultPage};
use crate::office_edit_validation::{code, parse_id};
use crate::office_edit_values::{OfficeStoragePolicy, OfficeViewport};
use crate::{ensure_main, valid_request_id};

const MAX_RENDER_PAGES: usize = 256;

/// Release every lease of a result the caller must not display.
fn release_pages(session_id: Uuid, pages: &[OfficeRenderPage]) {
    for page in pages {
        let _ = crate::office_edit_leases::release_office_lease_in_session(
            session_id,
            page.image.lease_id,
        );
    }
}

fn validate_page(
    session_id: Uuid,
    sensitive: bool,
    view_revision: u32,
    page: &OfficeRenderPage,
) -> Result<(), OfficeEditError> {
    if !page.is_valid()
        || page.session_id != session_id
        || page.view_revision != view_revision
    {
        return Err(OfficeEditError::Failed);
    }
    if page.image.byte_len == 0
        || page.image.width == Some(0)
        || page.image.height == Some(0)
    {
        return Err(OfficeEditError::Failed);
    }
    // Tiles are raster images. HTML, SVG or script MIME never reaches the
    // WebView, so an engine cannot inject markup through the render channel.
    if !matches!(page.image.mime.as_str(), "image/png" | "image/jpeg") {
        return Err(OfficeEditError::Failed);
    }
    if sensitive && page.image.storage_policy != OfficeStoragePolicy::Sensitive {
        return Err(OfficeEditError::SensitiveUnsupported);
    }
    // The registry, not the DTO, proves the lease belongs to this exact live
    // session and that sensitive bytes are memory-only.
    crate::office_edit_leases::resolve_office_lease(session_id, page.image.lease_id)?;
    Ok(())
}

fn validate_page_result(
    session_id: Uuid,
    sensitive: bool,
    revision: u64,
    view_revision: u32,
    result: &OfficeResultPage<OfficeRenderPage>,
) -> Result<(), OfficeEditError> {
    if result.revision != revision || result.items.len() > MAX_RENDER_PAGES {
        return Err(OfficeEditError::Changed);
    }
    for page in &result.items {
        validate_page(session_id, sensitive, view_revision, page)?;
        if page.accessibility.iter()
            .flat_map(|node| node.deck_text.iter().chain(node.document_text.iter()))
            .any(|target| !target.span.is_current(revision))
        {
            return Err(OfficeEditError::Changed);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn office_edit_render_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    edit: State<'_, OfficeEditState>,
    request_id: String,
    session_id: String,
    viewport: OfficeViewport,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id).map_err(|_| code(OfficeEditError::Invalid))?;
    edit.current_profile().map_err(code)?;
    let session_id = parse_id(&session_id)?;
    if !viewport.is_valid() {
        return Err(code(OfficeEditError::Invalid));
    }
    let session = edit.session(session_id).map_err(code)?;
    let current = session.snapshot().map_err(code)?;
    if current.busy {
        return Err(code(OfficeEditError::Busy));
    }
    let sensitive = session.is_sensitive();
    // Fail closed before a job exists when no approved binding is installed.
    let engine = edit.engine().map_err(code)?;
    let token = jobs.begin(&request_id, 0)?;
    let app = window.app_handle().clone();
    spawn_job(app, request_id, token, move |context| {
        let state = context.app().state::<OfficeEditState>();
        let session = state.session(session_id).map_err(code)?;
        let baseline = session.snapshot().map_err(code)?;
        if baseline.busy {
            return Err(code(OfficeEditError::Busy));
        }
        if baseline.revision != current.revision || baseline.content_id != current.content_id {
            return Err(code(OfficeEditError::Changed));
        }
        if context.token().load(Ordering::Relaxed) {
            return Err(code(OfficeEditError::Cancelled));
        }
        let page = engine.render(session_id, &viewport).map_err(code)?;
        let cancelled = context.token().load(Ordering::Relaxed);
        let latest = match session.snapshot() {
            Ok(value) => value,
            Err(error) => {
                release_pages(session_id, &page.items);
                return Err(code(error));
            }
        };
        if cancelled
            || latest.revision != current.revision
            || latest.content_id != current.content_id
        {
            release_pages(session_id, &page.items);
            return Err(code(if cancelled {
                OfficeEditError::Cancelled
            } else {
                OfficeEditError::Changed
            }));
        }
        if let Err(error) = validate_page_result(
            session_id,
            sensitive,
            current.revision,
            viewport.view_revision,
            &page,
        ) {
            release_pages(session_id, &page.items);
            return Err(code(error));
        }
        match serde_json::to_value(&page) {
            Ok(value) => Ok(value),
            Err(_) => {
                release_pages(session_id, &page.items);
                Err(code(OfficeEditError::Failed))
            }
        }
    });
    Ok(())
}
