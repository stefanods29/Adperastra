//! Book sessions on the 07d parser-only WebView host (Step 07f T3/U3).
//!
//! The native side prepares bounded EPUB entry grants or one MOBI range
//! grant, then a persistent `WebviewHelperSession` runs the trusted
//! `book-helper.html`. Pages come back as inert HTML plus resource names;
//! this module turns only those names into memory cache leases.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use fs_service::{new_cancellation_token, CancellationToken};
use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Manager};
use zeroize::Zeroizing;

use crate::book_loader::{prepare_book, prepare_section, BookFormat, BookPreparation};
use crate::cache::CacheService;
use crate::extra_view_sessions::{ExtraViewBackend, ExtraViewBackendFactory, ExtraViewSummary};
use crate::extra_view_types::{
    BookContentsItem, BookContentsPage, BookDirection, BookPage, ExtraPageRequest, ExtraViewKind,
    ExtraViewPage, ExtraViewPayload, MAX_BOOK_CONTENTS_ITEMS, MAX_BOOK_RESOURCES,
};
use crate::webview_helper::{start_webview_helper, WebviewHelperSession};
use crate::webview_helper_types::{
    HelperAction, HelperInputGrant, HelperWindowPlacement, WebviewHelperConfig, WebviewHelperKind,
    WebviewHelperRequest,
};

/// The exact helper entry of this feature (no input chooses it).
pub const BOOK_HELPER_ENTRY: &str = "book-helper.html";
/// The helper request/response body cap.
pub const BOOK_HELPER_BODY_BYTES: usize = 768 * 1024;
/// The helper output cap; this feature reserves no output bodies.
pub const BOOK_HELPER_OUTPUT_BYTES: u64 = 768 * 1024;
#[derive(Debug, Clone, Deserialize)]
struct BookOpenReply {
    title: String,
    section_count: u32,
    #[serde(default)]
    partial: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct BookContentsWire {
    id: String,
    label: String,
    section: u32,
    #[serde(default)]
    children: Vec<BookContentsWire>,
}

#[derive(Debug, Clone, Deserialize)]
struct BookPageReply {
    section: u32,
    page: u32,
    page_count: u32,
    html: String,
    #[serde(default)]
    resource_ids: Vec<String>,
    #[serde(default)]
    direction: String,
}

#[derive(Debug, Clone, Deserialize)]
struct BookContentsReply {
    items: Vec<BookContentsWire>,
    next_cursor: Option<String>,
    complete: bool,
}

/// The narrow part of the 07d host this feature needs. Keeping it behind a
/// trait makes the page/lease rules testable without a WebView.
pub trait BookHost: Send {
    fn request(
        &mut self,
        action: &str,
        payload: serde_json::Value,
    ) -> Result<serde_json::Value, String>;
    fn update_inputs(&mut self, inputs: Vec<HelperInputGrant>) -> Result<(), String>;
    fn close(&mut self);
}

/// Production host over `WebviewHelperSession`.
struct WebviewBookHost {
    session: WebviewHelperSession,
    cancel: CancellationToken,
}

impl WebviewBookHost {
    fn start(preparation: &BookPreparation) -> Result<Self, String> {
        let cancel = new_cancellation_token();
        let config = WebviewHelperConfig {
            kind: WebviewHelperKind::Book,
            entry: BOOK_HELPER_ENTRY,
            max_body_bytes: BOOK_HELPER_BODY_BYTES,
            max_output_bytes: BOOK_HELPER_OUTPUT_BYTES,
            data_dir: crate::resolve_data_dir().join("book-helper"),
            placement: HelperWindowPlacement::Hidden,
        };
        let session = start_webview_helper(config, preparation.grants.clone(), cancel.clone())?;
        Ok(Self { session, cancel })
    }
}

impl BookHost for WebviewBookHost {
    fn request(
        &mut self,
        action: &str,
        payload: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let request = WebviewHelperRequest {
            request_id: uuid::Uuid::new_v4(),
            action: book_action(action)?,
            payload,
            output_specs: Vec::new(),
        };
        let result = self.session.request(request, self.cancel.clone())?;
        Ok(result.reply)
    }

    fn update_inputs(&mut self, inputs: Vec<HelperInputGrant>) -> Result<(), String> {
        self.session.update_inputs(inputs, self.cancel.clone())
    }

    fn close(&mut self) {
        let _ = self.session.close();
    }
}

fn book_action(action: &str) -> Result<HelperAction, String> {
    match action {
        "book.open" => Ok(HelperAction::BookOpen),
        "book.page" => Ok(HelperAction::BookPage),
        "book.contents" => Ok(HelperAction::BookContents),
        _ => Err("extra_view.bad_request".to_string()),
    }
}

/// foliate's parser and the native OPF loader both walk the spine in reading
/// order, but the native loader keeps only HTML/XML items. A different count
/// means one of them skipped an item the other kept, so a section index would
/// name the wrong chapter; refuse instead of showing the wrong text. MOBI has
/// no native sections: the parser discovers them while reading its ranges.
fn check_section_count(
    format: BookFormat,
    helper_count: usize,
    native_count: usize,
) -> Result<(), String> {
    if helper_count == 0 {
        return Err("extra_view.corrupt".to_string());
    }
    if helper_count > crate::extra_view_types::MAX_BOOK_SECTIONS {
        return Err("extra_view.too_large".to_string());
    }
    if format == BookFormat::Epub && helper_count != native_count {
        return Err("extra_view.unsupported".to_string());
    }
    Ok(())
}

pub struct BookBackend {
    host: Box<dyn BookHost>,
    app: AppHandle,
    session_id: String,
    preparation: BookPreparation,
    section_count: usize,
    current_section: Option<usize>,
    current_grants: Vec<HelperInputGrant>,
    current_entries: Vec<(String, String)>,
    leases: Vec<String>,
}

impl BookBackend {
    fn open(
        host: Box<dyn BookHost>,
        app: AppHandle,
        preparation: BookPreparation,
        reply: BookOpenReply,
    ) -> Result<Self, String> {
        let section_count = reply.section_count as usize;
        check_section_count(
            preparation.format,
            section_count,
            preparation.sections.len(),
        )?;
        let initial_grants = preparation.grants.clone();
        let initial_entries = preparation.grant_entries.clone();
        Ok(Self {
            host,
            app,
            session_id: String::new(),
            preparation,
            section_count,
            current_section: Some(0),
            current_grants: initial_grants,
            current_entries: initial_entries,
            leases: Vec::new(),
        })
    }

    fn page_response(
        &mut self,
        reply: BookPageReply,
        resources: &[HelperInputGrant],
        entries: &[(String, String)],
    ) -> Result<ExtraViewPage, String> {
        let mut leases = Vec::new();
        for id in &reply.resource_ids {
            if leases.len() >= MAX_BOOK_RESOURCES {
                break;
            }
            let Some((_, grant_name)) = entries.iter().find(|(entry, _)| entry == id) else {
                continue;
            };
            let Some(grant) = resources.iter().find(|grant| &grant.name == grant_name) else {
                continue;
            };
            if !grant.mime.starts_with("image/") {
                continue;
            }
            let path = grant_path(grant);
            let bytes = std::fs::read(&path).map_err(|_| "extra_view.unavailable".to_string())?;
            if bytes.len() as u64 > crate::extra_view_types::MAX_BOOK_IMAGE_ENCODED_BYTES {
                return Err("extra_view.too_large".to_string());
            }
            let cache = self.app.state::<CacheService>();
            let lease = cache.lease_memory(
                Arc::new(Zeroizing::new(bytes)),
                id,
                &grant.mime,
                None,
                None,
                false,
            )?;
            self.leases.push(lease.lease_id.clone());
            leases.push(lease);
        }
        let direction = if reply.direction == "rtl" {
            BookDirection::Rtl
        } else {
            BookDirection::Ltr
        };
        Ok(ExtraViewPage {
            session_id: self.session_id.clone(),
            kind: ExtraViewKind::Book,
            payload: ExtraViewPayload::Book {
                page: BookPage {
                    section: reply.section,
                    page: reply.page,
                    page_count: reply.page_count,
                    html: reply.html,
                    resource_refs: leases,
                    contents: Vec::new(),
                    direction,
                },
            },
            next_cursor: None,
            complete: true,
            partial: self.preparation.partial,
        })
    }

    fn release_page_leases(&mut self) {
        let cache = self.app.state::<CacheService>();
        for lease in self.leases.drain(..) {
            let _ = cache.release(&lease);
        }
    }
}

impl ExtraViewBackend for BookBackend {
    fn page(&mut self, request: &ExtraPageRequest) -> Result<ExtraViewPage, String> {
        let section = request.section.unwrap_or(0) as usize;
        let page = request.page.unwrap_or(0);
        if section >= self.section_count {
            return Err("extra_view.bad_request".to_string());
        }
        self.release_page_leases();
        if self.preparation.format == BookFormat::Epub && self.current_section != Some(section) {
            let cancel = new_cancellation_token();
            let (grants, entries) = prepare_section(&self.preparation, section, &cancel)?;
            self.host.update_inputs(grants.clone())?;
            self.current_grants = grants;
            self.current_entries = entries;
            self.current_section = Some(section);
        }
        let available: Vec<serde_json::Value> = self
            .current_grants
            .iter()
            .filter(|grant| grant.mime.starts_with("image/"))
            .map(|grant| json!({ "id": grant.name }))
            .collect();
        let entry_pairs: Vec<serde_json::Value> = self
            .current_entries
            .iter()
            .map(|(entry, grant)| json!({ "entry": entry, "grant": grant }))
            .collect();
        let payload = json!({
            "section": section,
            "page": page,
            "font_px": 18,
            "theme": "app",
            "resources": available,
            "entries": entry_pairs,
        });
        let reply = self.host.request("book.page", payload)?;
        let reply: BookPageReply =
            serde_json::from_value(reply).map_err(|_| "extra_view.corrupt".to_string())?;
        let grants = self.current_grants.clone();
        let entries = self.current_entries.clone();
        let page = self.page_response(reply, &grants, &entries)?;
        Ok(page)
    }

    fn contents(&mut self, cursor: Option<&str>) -> Result<BookContentsPage, String> {
        let reply = self
            .host
            .request("book.contents", json!({ "cursor": cursor, "limit": 256 }))?;
        let reply: BookContentsReply =
            serde_json::from_value(reply).map_err(|_| "extra_view.corrupt".to_string())?;
        Ok(BookContentsPage {
            items: reply
                .items
                .into_iter()
                .take(MAX_BOOK_CONTENTS_ITEMS)
                .enumerate()
                .map(|(index, item)| contents_item(item, 0, index))
                .collect(),
            next_cursor: reply.next_cursor,
            complete: reply.complete,
        })
    }

    fn close(&mut self) {
        self.release_page_leases();
        self.host.close();
    }
}

fn contents_item(value: BookContentsWire, depth: usize, index: usize) -> BookContentsItem {
    let children = if depth >= 31 {
        Vec::new()
    } else {
        value
            .children
            .into_iter()
            .take(64)
            .enumerate()
            .map(|(child, item)| contents_item(item, depth + 1, child))
            .collect()
    };
    BookContentsItem {
        id: if value.id.is_empty() {
            format!("toc-{depth}-{index}")
        } else {
            value.id.chars().take(128).collect()
        },
        label: value.label.chars().take(512).collect(),
        section: value.section,
        children,
    }
}

fn grant_path(grant: &HelperInputGrant) -> PathBuf {
    match &grant.source {
        crate::webview_helper_types::HelperInputSource::Disk { path, .. } => path.clone(),
        _ => PathBuf::new(),
    }
}

/// Starts a book session after the native loader prepared its bounded grants.
pub struct BookBackendFactory {
    pub app: AppHandle,
}

impl ExtraViewBackendFactory for BookBackendFactory {
    fn open(
        &self,
        kind: ExtraViewKind,
        path: &Path,
        _stamp: &fs_service::SourceStamp,
        session_id: &str,
        work_dir: &Path,
    ) -> Result<(Box<dyn ExtraViewBackend>, ExtraViewSummary), String> {
        if kind != ExtraViewKind::Book {
            return Err("extra_view.bad_request".to_string());
        }
        let cancel = new_cancellation_token();
        let preparation = prepare_book(path, work_dir, &cancel)?;
        let host = WebviewBookHost::start(&preparation)?;
        let entry_pairs: Vec<serde_json::Value> = preparation
            .grant_entries
            .iter()
            .map(|(entry, grant)| json!({ "entry": entry, "grant": grant }))
            .collect();
        let payload = json!({
            "format": match preparation.format {
                BookFormat::Epub => "epub",
                BookFormat::Mobi => "mobi",
            },
            "entry_name": preparation.entry_name.clone(),
            "opf_path": preparation.opf_path.clone(),
            "entries": entry_pairs,
        });
        let mut host = host;
        let reply = host.request("book.open", payload)?;
        let reply: BookOpenReply =
            serde_json::from_value(reply).map_err(|_| "extra_view.corrupt".to_string())?;
        let summary = ExtraViewSummary {
            title: reply.title.clone(),
            item_count: reply.section_count,
            partial: reply.partial || preparation.partial,
        };
        let mut backend = BookBackend::open(Box::new(host), self.app.clone(), preparation, reply)?;
        backend.session_id = session_id.to_string();
        Ok((Box::new(backend), summary))
    }
}

/// The combined factory routes each kind to its real producer: native parser
/// helper for five formats, the 07d parser-only host for books.
pub struct ExtraViewFactory {
    pub native: crate::extra_view_backend::NativeBackendFactory,
    pub book: BookBackendFactory,
}

impl ExtraViewBackendFactory for ExtraViewFactory {
    fn open(
        &self,
        kind: ExtraViewKind,
        path: &Path,
        stamp: &fs_service::SourceStamp,
        session_id: &str,
        work_dir: &Path,
    ) -> Result<(Box<dyn ExtraViewBackend>, ExtraViewSummary), String> {
        if kind == ExtraViewKind::Book {
            self.book.open(kind, path, stamp, session_id, work_dir)
        } else {
            self.native.open(kind, path, stamp, session_id, work_dir)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_a_book_with_no_sections() {
        assert_eq!(
            check_section_count(BookFormat::Epub, 0, 0),
            Err("extra_view.corrupt".to_string())
        );
    }

    #[test]
    fn refuses_more_than_five_thousand_sections() {
        assert_eq!(
            check_section_count(BookFormat::Mobi, 5_001, 0),
            Err("extra_view.too_large".to_string())
        );
    }

    #[test]
    fn refuses_a_spine_the_native_loader_did_not_keep() {
        assert_eq!(
            check_section_count(BookFormat::Epub, 3, 2),
            Err("extra_view.unsupported".to_string())
        );
    }

    #[test]
    fn accepts_matching_epub_and_mobi_counts() {
        assert_eq!(check_section_count(BookFormat::Epub, 2, 2), Ok(()));
        assert_eq!(check_section_count(BookFormat::Mobi, 7, 0), Ok(()));
    }
}
