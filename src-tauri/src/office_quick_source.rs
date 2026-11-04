//! Quick-page producer backed by the 07d isolated WebView helper.
//!
//! The parent only sends approved bounded XML memory grants. The child returns
//! plain bounded records and PNG reservations; no document bytes or arbitrary
//! URL enters the app DOM. A helper failure is reported separately from an
//! unavailable preview or pack.
#![allow(dead_code)]

use std::io::Read;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::cache::CacheService;
use crate::office_quick::{QuickEntry, QuickPackage};
use crate::office_view_runtime_impl::OfficeQuickPageSource;
use crate::office_view_types::{
    OfficeComment, OfficeCommentPage, OfficePage, OfficeQuality, OfficeSection,
};
use crate::webview_helper::{start_webview_helper, WebviewHelperSession};
use crate::webview_helper_types::{
    HelperAction, HelperInputGrant, HelperInputSource, HelperOutputSpec, HelperOutputStorage,
    HelperWindowPlacement, WebviewHelperConfig, WebviewHelperKind, WebviewHelperRequest,
};

const QUICK_HELPER_ENTRY: &str = "office-quick-helper.html";
const QUICK_OUTPUT_BYTES: u64 = 8 * 1024 * 1024;
const QUICK_BODY_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Deserialize)]
struct QuickOpenReply {
    document_page_count: u32,
    #[serde(default)]
    comments: Vec<OfficeComment>,
    #[serde(default)]
    outline: Vec<serde_json::Value>,
    #[serde(default)]
    warnings: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct QuickPageReply {
    section_id: String,
    page: u32,
    width_pt: f64,
    height_pt: f64,
}

pub struct WebviewQuickSource {
    pub document_page_count: u32,
    session: Mutex<Option<WebviewHelperSession>>,
    cache: Arc<CacheService>,
    comments: Vec<OfficeComment>,
    source_revision: u64,
}

impl WebviewQuickSource {
    pub fn start(
        package: &QuickPackage,
        data_dir: PathBuf,
        cache: Arc<CacheService>,
        source_revision: u64,
    ) -> Result<Self, String> {
        let mut grants = Vec::with_capacity(package.entries.len());
        let mut entries = Vec::with_capacity(package.entries.len());
        for entry in &package.entries {
            let name = grant_name(entry);
            let document_id = format!("office-quick-{}", Uuid::new_v4());
            let grant = HelperInputGrant {
                grant_id: Uuid::new_v4(),
                name: name.clone(),
                mime: "text/xml".to_string(),
                source: HelperInputSource::Memory {
                    data: Arc::new(Zeroizing::new(entry.bytes.clone())),
                    document_id,
                    revision: source_revision.max(1),
                    content_id: Uuid::new_v4(),
                    sensitive: false,
                },
            };
            if !grant.is_valid() {
                return Err("office.bad_request".to_string());
            }
            entries.push(serde_json::json!({
                "part": part_name(entry),
                "grant_id": grant.grant_id,
                "name": name,
                "section_id": entry.section_id,
                "index": entry.index,
            }));
            grants.push(grant);
        }
        let data_dir = data_dir
            .join("office-quick")
            .join(Uuid::new_v4().to_string());
        std::fs::create_dir_all(&data_dir).map_err(|_| "office.engine_failed".to_string())?;
        let config = WebviewHelperConfig {
            kind: WebviewHelperKind::OfficeQuick,
            entry: QUICK_HELPER_ENTRY,
            max_body_bytes: QUICK_BODY_BYTES,
            max_output_bytes: QUICK_OUTPUT_BYTES,
            data_dir,
            placement: HelperWindowPlacement::Hidden,
        };
        let cancel = fs_service::new_cancellation_token();
        let mut session = start_webview_helper(config, grants, cancel.clone())?;
        let payload = serde_json::json!({
            "format": serde_json::to_value(package.format).map_err(|_| "office.engine_failed".to_string())?,
            "sections": package.sections,
            "entries": entries,
        });
        let result = session.request(
            WebviewHelperRequest {
                request_id: Uuid::new_v4(),
                action: HelperAction::OfficeQuickOpen,
                payload,
                output_specs: Vec::new(),
            },
            cancel,
        )?;
        let reply: QuickOpenReply =
            serde_json::from_value(result.reply).map_err(|_| "office.unsupported".to_string())?;
        if !(1..=crate::office_view_types::OFFICE_MAX_PAGES).contains(&reply.document_page_count) {
            return Err("office.too_large".to_string());
        }
        let _ = reply.outline;
        let _ = reply.warnings;
        Ok(Self {
            document_page_count: reply.document_page_count,
            session: Mutex::new(Some(session)),
            cache,
            comments: reply.comments.into_iter().take(200).collect(),
            source_revision,
        })
    }

    fn page_inner(&self, section_id: &str, page: u32, scale: f64) -> Result<OfficePage, String> {
        let page_count = if section_id == "document" {
            self.document_page_count
        } else {
            1
        };
        if !(1..=page_count).contains(&page) || !(0.25..=4.0).contains(&scale) {
            return Err("office.bad_request".to_string());
        }
        let mut slot = self
            .session
            .lock()
            .map_err(|_| "office.engine_failed".to_string())?;
        let session = slot
            .as_mut()
            .ok_or_else(|| "office.pack_missing".to_string())?;
        let cancel = fs_service::new_cancellation_token();
        let result = session.request(
            WebviewHelperRequest {
                request_id: Uuid::new_v4(),
                action: HelperAction::OfficeQuickPage,
                payload: serde_json::json!({
                    "section_id": section_id,
                    "page": page,
                    "scale": scale,
                }),
                output_specs: vec![HelperOutputSpec {
                    mime: "image/png".to_string(),
                    max_bytes: QUICK_OUTPUT_BYTES,
                }],
            },
            cancel,
        )?;
        let reply: QuickPageReply =
            serde_json::from_value(result.reply).map_err(|_| "office.unsupported".to_string())?;
        if reply.section_id != section_id || reply.page != page {
            return Err("office.changed".to_string());
        }
        let output = result
            .outputs
            .into_iter()
            .next()
            .ok_or_else(|| "office.engine_failed".to_string())?;
        let bytes = match output.storage {
            HelperOutputStorage::Memory(bytes) => bytes,
            HelperOutputStorage::OwnedFile(mut file) => {
                let mut bytes = Zeroizing::new(Vec::new());
                file.file_mut()
                    .read_to_end(&mut bytes)
                    .map_err(|_| "office.engine_failed".to_string())?;
                bytes
            }
        };
        let image = self.cache.lease_memory(
            Arc::new(bytes),
            "office-quick-page.png",
            "image/png",
            None,
            None,
            false,
        )?;
        Ok(OfficePage {
            section_id: section_id.to_string(),
            page,
            image,
            width_pt: reply.width_pt,
            height_pt: reply.height_pt,
            quality: OfficeQuality::Quick,
            source_revision: self.source_revision,
        })
    }
}

impl OfficeQuickPageSource for WebviewQuickSource {
    fn page(&self, section_id: &str, page: u32, scale: f64) -> Result<OfficePage, String> {
        self.page_inner(section_id, page, scale)
    }

    fn comments(
        &self,
        _section_id: &str,
        _cursor: Option<Uuid>,
    ) -> Result<OfficeCommentPage, String> {
        Ok(OfficeCommentPage {
            items: self.comments.clone(),
            next_cursor: None,
            complete: true,
        })
    }

    fn close(&self) {
        if let Ok(mut slot) = self.session.lock() {
            if let Some(mut session) = slot.take() {
                let _ = session.close();
            }
        }
    }
}

impl Drop for WebviewQuickSource {
    fn drop(&mut self) {
        self.close();
    }
}

fn grant_name(entry: &QuickEntry) -> String {
    let base = entry
        .zip_name
        .rsplit('/')
        .next()
        .unwrap_or("part.xml")
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
        .take(120)
        .collect::<String>();
    if base.is_empty() {
        format!("part-{}.xml", entry.index)
    } else {
        base
    }
}

fn part_name(entry: &QuickEntry) -> &'static str {
    match entry.part {
        crate::office_quick::QuickPart::Document => "document",
        crate::office_quick::QuickPart::Styles => "styles",
        crate::office_quick::QuickPart::Comments => "comments",
        crate::office_quick::QuickPart::Notes => "notes",
        crate::office_quick::QuickPart::Relationships => "relationships",
        crate::office_quick::QuickPart::Slide => "slide",
        crate::office_quick::QuickPart::Sheet => "sheet",
        crate::office_quick::QuickPart::SharedStrings => "shared_strings",
    }
}

/// The coordinator installs this producer only after the 07d kind/action
/// extension and the static helper entry are built. Until then no quick
/// success is advertised.
pub fn quick_source_for(
    package: Option<&QuickPackage>,
    data_dir: PathBuf,
    cache: Arc<CacheService>,
    source_revision: u64,
) -> Result<Option<Arc<WebviewQuickSource>>, String> {
    package
        .filter(|package| !package.fallback && !package.entries.is_empty())
        .map(|package| {
            WebviewQuickSource::start(package, data_dir, cache, source_revision).map(Arc::new)
        })
        .transpose()
}

pub fn quick_sections(package: &QuickPackage) -> Vec<OfficeSection> {
    package.sections.clone()
}
