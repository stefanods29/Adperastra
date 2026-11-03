#![allow(dead_code)] // Public producer API; consumed from Step 07e onward.
//! The work behind the PDF jobs (Step 07d E1-E4).
//!
//! Opening, rendering, searching and printing all run on a job: they own a
//! helper request, they can be cancelled, and they never block the UI. The
//! identity a session was opened with is the identity every later page is
//! checked against: a changed file, a stale session or an evicted helper
//! fails with `pdf.changed` instead of showing other bytes.

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, Manager};
use uuid::Uuid;

use fs_service::owned_io::PinnedSource;

use cache_store::{CacheKey, CacheKind, CacheLease};

use crate::cache::CacheService;
use crate::pdf_helper::session_data_dir;
use crate::pdf_sessions::{PdfResume, PdfSessionEntry, PdfSessions};
use crate::pdf_snapshot_resolver::PdfSnapshotRetention;
use crate::pdf_types::{
    page_of, valid_pdf_path, PdfInput, PdfPageImage, PdfRenderRequest, PdfSearchPage, PdfSession,
    PdfSourceIdentity, PdfTextPage, PDF_MAX_BYTES, PDF_MAX_PNG_BYTES, PDF_PROVIDER_ID,
    PDF_PROVIDER_VERSION,
};
use crate::webview_helper_types::{HelperInputGrant, HelperInputSource};

/// The cache handler id and version of a PDF page (D6).
pub const PDF_CACHE_HANDLER: &str = PDF_PROVIDER_ID;
pub const PDF_CACHE_VERSION: u32 = 1;
/// Most text chunks one page answer may assemble before it reports partial.
pub const PDF_MAX_TEXT_CHUNKS: usize = 8;

type GrantedPdfInput = (
    HelperInputGrant,
    PdfSourceIdentity,
    Option<Arc<dyn PdfSnapshotRetention>>,
);

/// Turn a granted input into the child's grant and the session identity.
fn grant_for_input(
    cache: &CacheService,
    input: &PdfInput,
    sessions: &PdfSessions,
) -> Result<GrantedPdfInput, String> {
    match input {
        PdfInput::File { path, expected } => {
            if !valid_pdf_path(path) {
                return Err("pdf.bad_request".to_string());
            }
            let path_buf = PathBuf::from(path);
            let stamp = cache.source_stamp(&path_buf)?;
            if let Some(expected) = expected {
                if expected != &stamp {
                    return Err("pdf.changed".to_string());
                }
            }
            if stamp.size_bytes > PDF_MAX_BYTES {
                return Err("pdf.too_large".to_string());
            }
            if stamp.size_bytes == 0 {
                return Err("pdf.corrupt".to_string());
            }
            let identity = fs_service::owned_io::SourceIdentity::capture(&path_buf)
                .map_err(|_| "pdf.changed".to_string())?;
            let pinned =
                PinnedSource::open(&path_buf, &identity).map_err(|_| "pdf.changed".to_string())?;
            let name = path_buf
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_else(|| "document.pdf".to_string());
            let grant = HelperInputGrant {
                grant_id: Uuid::new_v4(),
                name,
                mime: "application/pdf".to_string(),
                source: HelperInputSource::Disk {
                    path: path_buf,
                    expected: stamp.clone(),
                    pinned: Arc::new(pinned),
                },
            };
            if !grant.is_valid() {
                return Err("pdf.bad_request".to_string());
            }
            Ok((grant, PdfSourceIdentity::Disk { stamp }, None))
        }
        PdfInput::Snapshot { reference } => {
            if !reference.is_valid() {
                return Err("pdf.bad_request".to_string());
            }
            let resolved = sessions.resolvers.resolve(reference)?;
            if !resolved.is_valid() {
                return Err("pdf.snapshot_unavailable".to_string());
            }
            let sensitive = resolved.backing.is_sensitive() || resolved.identity.is_sensitive();
            let grant = HelperInputGrant {
                grant_id: Uuid::new_v4(),
                name: format!("{}.pdf", reference.document_id),
                mime: "application/pdf".to_string(),
                source: HelperInputSource::Snapshot {
                    backing: resolved.backing.clone(),
                    document_id: reference.document_id.clone(),
                    revision: reference.revision,
                    content_id: reference.content_id,
                    sensitive,
                },
            };
            if !grant.is_valid() {
                return Err("pdf.bad_request".to_string());
            }
            // The retention handle travels with the helper: the snapshot's
            // lease ends exactly when the child closes (E9).
            Ok((
                grant,
                PdfSourceIdentity::Snapshot {
                    document_id: reference.document_id.clone(),
                    revision: reference.revision,
                    content_id: reference.content_id,
                    sensitive,
                },
                Some(resolved.retain),
            ))
        }
    }
}

/// Open a PDF and keep its helper until the session closes.
pub fn open_input(
    app: &AppHandle,
    cancel: &fs_service::CancellationToken,
    input: &PdfInput,
    password: Option<String>,
) -> Result<PdfSession, String> {
    let cache = app.state::<Arc<CacheService>>();
    let sessions = app.state::<PdfSessions>();
    let data_dir = app.state::<crate::AppState>().data_dir().to_path_buf();
    let _operation = sessions.operation(cancel)?;
    sessions.make_room_for_helper(None)?;
    let (grant, identity, retention) = grant_for_input(cache.inner(), input, sessions.inner())?;
    let session_id = Uuid::new_v4();
    let resume = Arc::new(PdfResume {
        grant,
        identity: identity.clone(),
        data_dir: session_data_dir(&data_dir, session_id),
        password: password.map(zeroize::Zeroizing::new),
        retention,
    });
    let helper = resume.start(cancel.clone())?;
    let session = PdfSession {
        session_id,
        page_count: helper.page_count,
        permissions: helper.permissions,
        password_required: false,
        source: identity,
    };
    let entry = match sessions.admit(session.clone()) {
        Ok(entry) => entry,
        Err(error) => {
            helper.close();
            return Err(error);
        }
    };
    entry.set_resume(resume)?;
    if let Err(error) = sessions.attach(&entry, helper) {
        let _ = sessions.close(session_id);
        return Err(error);
    }
    Ok(entry.session.clone())
}

/// The cache key of one page result (D6).
pub fn page_key(
    source: &PdfSourceIdentity,
    page: u32,
    request: &PdfRenderRequest,
) -> Result<CacheKey, String> {
    let stamp = match source {
        PdfSourceIdentity::Disk { stamp } => stamp.clone(),
        PdfSourceIdentity::Snapshot { .. } => {
            // Snapshot results never reach the disk cache.
            return Err("pdf.bad_request".to_string());
        }
    };
    Ok(CacheKey {
        source: stamp,
        kind: CacheKind::PdfPage,
        handler_id: PDF_CACHE_HANDLER.to_string(),
        handler_version: PDF_CACHE_VERSION,
        options_key: format!(
            "ver={};page={};rot={};{}",
            PDF_PROVIDER_VERSION,
            page,
            request.rotation.value(),
            request.raster.cache_option()
        ),
    })
}

/// Render one page and give the caller a lease: disk cache for an ordinary
/// document, a memory lease for a sensitive snapshot (E8).
pub fn render_page(
    app: &AppHandle,
    cancel: &fs_service::CancellationToken,
    request: &PdfRenderRequest,
) -> Result<PdfPageImage, String> {
    if !request.is_valid() {
        return Err("pdf.bad_request".to_string());
    }
    let cache = app.state::<Arc<CacheService>>();
    let sessions = app.state::<PdfSessions>();
    let entry = sessions.get(request.session_id)?;
    sessions.touch(&entry);
    let page = page_of(&entry.session, request.page)?;
    let sensitive = entry.session.source.is_sensitive();
    let memory_result = matches!(entry.session.source, PdfSourceIdentity::Snapshot { .. });
    let mut rendered = sessions.with_helper(&entry, cancel, |helper| {
        helper.render(
            page,
            request.raster,
            request.rotation,
            request.request_revision,
            cancel.clone(),
        )
    })?;
    if rendered.request_revision != request.request_revision {
        return Err("pdf.changed".to_string());
    }
    let image: CacheLease = if memory_result {
        let bytes = rendered.png.read_vec()?;
        cache.lease_memory(
            Arc::new(zeroize::Zeroizing::new(bytes)),
            &format!("page-{page}.png"),
            "image/png",
            Some(rendered.width),
            Some(rendered.height),
            sensitive,
        )?
    } else {
        let key = page_key(&entry.session.source, page, request)?;
        let file = rendered
            .png
            .as_file()
            .ok_or_else(|| "pdf.corrupt".to_string())?;
        let record = cache.publish_result(
            &key,
            file,
            "image/png",
            Some(rendered.width),
            Some(rendered.height),
            PDF_MAX_PNG_BYTES,
        )?;
        cache.lease(&record)?
    };
    Ok(PdfPageImage {
        info: rendered.info,
        image,
        render_width: rendered.width,
        render_height: rendered.height,
        resolved_scale: rendered.scale,
        rendered_rotation: rendered.rotation,
        request_revision: rendered.request_revision,
    })
}

/// Read one bounded chunk of a page's text (E3).
pub fn read_text(
    app: &AppHandle,
    cancel: &fs_service::CancellationToken,
    session_id: Uuid,
    page: u32,
    after_run: Option<u32>,
) -> Result<PdfTextPage, String> {
    let sessions = app.state::<PdfSessions>();
    let entry = sessions.get(session_id)?;
    sessions.touch(&entry);
    page_of(&entry.session, page)?;
    let answer = sessions.with_helper(&entry, cancel, |helper| {
        helper.text(page, after_run, cancel.clone())
    })?;
    let result = PdfTextPage {
        page,
        runs: answer.runs,
        next_run: answer.next_run,
        complete: answer.complete,
        source: entry.session.source.clone(),
    };
    if serde_json::to_vec(&result)
        .map_err(|_| "pdf.corrupt")?
        .len()
        > crate::pdf_types::PDF_MAX_ANSWER_BYTES
    {
        return Err("pdf.too_large".into());
    }
    Ok(result)
}

/// One bounded page of the outline, translated from an opaque cursor (E4).
pub fn read_outline(
    app: &AppHandle,
    cancel: &fs_service::CancellationToken,
    session_id: Uuid,
    cursor: Option<Uuid>,
) -> Result<crate::pdf_types::PdfOutlinePage, String> {
    let sessions = app.state::<PdfSessions>();
    let entry = sessions.get(session_id)?;
    sessions.touch(&entry);
    let offset = match cursor {
        Some(cursor) => entry
            .outline_cursor(cursor)
            .ok_or_else(|| "pdf.changed".to_string())?,
        None => 0,
    };
    let answer = sessions.with_helper(&entry, cancel, |helper| {
        helper.outline(offset, cancel.clone())
    })?;
    let next_cursor = match answer.next_offset {
        Some(next) => Some(entry.new_outline_cursor(next)?),
        None => None,
    };
    Ok(crate::pdf_types::PdfOutlinePage {
        nodes: answer
            .nodes
            .into_iter()
            .map(outline_node)
            .collect::<Vec<_>>(),
        next_cursor,
        complete: answer.complete,
    })
}

fn outline_node(
    node: crate::pdf_helper_types::PdfHelperOutlineNode,
) -> crate::pdf_types::PdfOutlineNode {
    crate::pdf_types::PdfOutlineNode {
        id: node.id,
        title: node.title.chars().take(512).collect(),
        page: node.page,
        children: node.children.into_iter().map(outline_node).collect(),
    }
}

/// The exact key a search cursor is bound to (query + case + source).
pub fn search_key(entry: &PdfSessionEntry, query: &str, match_case: bool) -> String {
    let source = match entry.source() {
        PdfSourceIdentity::Disk { stamp } => format!(
            "d:{}:{}:{}:{}",
            stamp.volume_id, stamp.file_id, stamp.modified_ticks, stamp.size_bytes
        ),
        PdfSourceIdentity::Snapshot {
            document_id,
            revision,
            content_id,
            ..
        } => format!("s:{document_id}:{revision}:{content_id}"),
    };
    format!("{}|{}|{}", source, if match_case { 1 } else { 0 }, query)
}

/// Search bounded pages; the cursor continues exactly where the last answer
/// stopped, and only for the same query and source (E4).
pub fn search(
    app: &AppHandle,
    cancel: &fs_service::CancellationToken,
    session_id: Uuid,
    query: &str,
    match_case: bool,
    cursor: Option<Uuid>,
) -> Result<PdfSearchPage, String> {
    if query.trim().is_empty() || query.chars().count() > crate::pdf_types::PDF_MAX_SEARCH_QUERY {
        return Err("pdf.bad_request".to_string());
    }
    let sessions = app.state::<PdfSessions>();
    let entry = sessions.get(session_id)?;
    sessions.touch(&entry);
    let key = search_key(&entry, query, match_case);
    let position = match cursor {
        Some(cursor) => entry
            .search_cursor(cursor, &key)
            .ok_or_else(|| "pdf.changed".to_string())?,
        None => (1u32, 0u32, 0u32),
    };
    let answer = sessions.with_helper(&entry, cancel, |helper| {
        helper.search(query.to_string(), match_case, position, cancel.clone())
    })?;
    let next_cursor = match answer.next_position {
        Some(next) => Some(entry.new_search_cursor(key, (next.page, next.run, next.offset))?),
        None => None,
    };
    let page = PdfSearchPage {
        matches: answer.matches,
        next_cursor,
        complete: answer.complete,
        scanned_pages: answer.scanned_pages.min(entry.page_count()),
        total_pages: entry.page_count(),
    };
    if !page.is_valid() {
        return Err("pdf.too_large".to_string());
    }
    Ok(page)
}

/// Print a range through the trusted print view (E6).
pub fn print(
    app: &AppHandle,
    cancel: &fs_service::CancellationToken,
    session_id: Uuid,
    first_page: u32,
    last_page: u32,
) -> Result<(), String> {
    let sessions = app.state::<PdfSessions>();
    let entry = sessions.get(session_id)?;
    sessions.touch(&entry);
    if !entry.session.permissions.can_print {
        return Err("pdf.permissions".to_string());
    }
    if first_page < 1 || last_page < first_page || last_page > entry.page_count() {
        return Err("pdf.bad_request".to_string());
    }
    if last_page - first_page + 1 > crate::pdf_types::PDF_MAX_PRINT_PAGES {
        return Err("pdf.too_large".to_string());
    }
    sessions.with_helper(&entry, cancel, |helper| {
        helper.print(first_page, last_page, cancel.clone())
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use fs_service::SourceStamp;
    use uuid::Uuid;

    fn stamp(path: &str, ticks: &str) -> SourceStamp {
        SourceStamp {
            path_key: path.to_string(),
            volume_id: "01234567".to_string(),
            file_id: "0123456789abcdef".to_string(),
            modified_ticks: ticks.to_string(),
            size_bytes: 100,
        }
    }

    fn request(page: u32, revision: u32) -> PdfRenderRequest {
        PdfRenderRequest {
            session_id: Uuid::new_v4(),
            page,
            raster: crate::pdf_types::PdfRasterSpec::Bucket { edge: 1024 },
            rotation: crate::pdf_types::PdfRotation::Deg0,
            request_revision: revision,
        }
    }

    #[test]
    fn cache_keys_change_with_page_rotation_and_bucket() {
        let source = PdfSourceIdentity::Disk {
            stamp: stamp("c:\\docs\\a.pdf", "10"),
        };
        let first = page_key(&source, 1, &request(1, 1)).unwrap();
        let other_page = page_key(&source, 2, &request(2, 1)).unwrap();
        let mut rotated = request(1, 1);
        rotated.rotation = crate::pdf_types::PdfRotation::Deg90;
        let other_rotation = page_key(&source, 1, &rotated).unwrap();
        let mut dpi = request(1, 1);
        dpi.raster = crate::pdf_types::PdfRasterSpec::Dpi { value: 150 };
        let other_raster = page_key(&source, 1, &dpi).unwrap();
        assert_ne!(first.options_key, other_page.options_key);
        assert_ne!(first.options_key, other_rotation.options_key);
        assert_ne!(first.options_key, other_raster.options_key);
        assert!(first.options_key.contains("ver=6.4.299"));
        assert_eq!(first.kind, CacheKind::PdfPage);
        assert_eq!(first.handler_id, "pdfjs");
    }

    #[test]
    fn a_snapshot_never_produces_a_disk_cache_key() {
        let source = PdfSourceIdentity::Snapshot {
            document_id: "doc".to_string(),
            revision: 1,
            content_id: Uuid::new_v4(),
            sensitive: false,
        };
        assert_eq!(
            page_key(&source, 1, &request(1, 1)).err(),
            Some("pdf.bad_request".to_string())
        );
    }

    #[test]
    fn search_keys_bind_the_query_and_the_source() {
        let entry = crate::pdf_sessions::PdfSessionEntry::new_for_test(PdfSession {
            session_id: Uuid::new_v4(),
            source: PdfSourceIdentity::Disk {
                stamp: stamp("c:\\docs\\a.pdf", "10"),
            },
            page_count: 3,
            password_required: false,
            permissions: crate::pdf_types::PdfPermissions::default(),
        });
        let a = search_key(&entry, "hello", false);
        let b = search_key(&entry, "hello", true);
        let c = search_key(&entry, "other", false);
        assert_ne!(a, b);
        assert_ne!(a, c);
    }
}
