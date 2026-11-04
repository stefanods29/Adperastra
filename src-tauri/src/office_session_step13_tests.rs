//! Office view session tests (Step 13 T1). Included from
//! `office_view_sessions.rs` with `#[cfg(test)]`; the test module keeps
//! private access to the bounded registry and uses injected runtime/lease
//! fakes. No engine, disk or network work happens here.
#![allow(dead_code)]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use uuid::Uuid;

use super::*;
use crate::office_view_types::{
    OfficeCapabilities, OfficeCellPage, OfficeCommentPage, OfficeFormat, OfficePage, OfficeQuality,
    OfficeSection, OfficeSectionKind, OfficeSession,
};

struct FakeLease {
    closes: Arc<AtomicUsize>,
}

impl OfficeDocumentLease for FakeLease {
    fn close(&self) {
        self.closes.fetch_add(1, Ordering::SeqCst);
    }
}

struct FakeRuntime {
    page: Mutex<Option<OfficePage>>,
    closes: Arc<AtomicUsize>,
}

impl FakeRuntime {
    fn new(page: Option<OfficePage>) -> (Self, Arc<AtomicUsize>) {
        let closes = Arc::new(AtomicUsize::new(0));
        (
            Self {
                page: Mutex::new(page),
                closes: closes.clone(),
            },
            closes,
        )
    }
}

impl OfficeViewRuntime for FakeRuntime {
    fn page(
        &self,
        section_id: &str,
        page: u32,
        _scale: f64,
        _work: &dyn OfficeWork,
    ) -> Result<OfficePage, String> {
        let mut stored = self.page.lock().unwrap();
        if let Some(value) = stored.as_mut() {
            value.section_id = section_id.to_string();
            value.page = page;
            return Ok(value.clone());
        }
        Err("office.not_found".to_string())
    }

    fn comments(
        &self,
        _section_id: &str,
        _cursor: Option<Uuid>,
    ) -> Result<OfficeCommentPage, String> {
        Ok(OfficeCommentPage {
            items: Vec::new(),
            next_cursor: None,
            complete: true,
        })
    }

    fn cells(
        &self,
        section_id: &str,
        row_start: u32,
        _row_count: u32,
        _column_start: u32,
        _column_count: u32,
    ) -> Result<OfficeCellPage, String> {
        Ok(OfficeCellPage {
            section_id: section_id.to_string(),
            row_start,
            column_start: 0,
            rows: Vec::new(),
            total_rows: 0,
            columns: 0,
            column_count: 0,
            truncated: false,
            next_cursor: None,
        })
    }

    fn close(&self) {
        self.closes.fetch_add(1, Ordering::SeqCst);
    }
}

fn format(name: &str) -> OfficeFormat {
    serde_json::from_str(&format!("\"{name}\"")).unwrap()
}

fn section(id: &str, index: u32) -> OfficeSection {
    OfficeSection {
        id: id.to_string(),
        name: "Section".to_string(),
        kind: OfficeSectionKind::Document,
        index,
        page_count: 10,
        rows: None,
        columns: None,
    }
}

fn session(id: Uuid, revision: u64) -> OfficeSession {
    OfficeSession {
        session_id: id,
        format: format("docx"),
        source_revision: revision,
        engine_version: "test-1".to_string(),
        quality: OfficeQuality::Accurate,
        section_count: 1,
        read_only: true,
        capabilities: OfficeCapabilities {
            comments: true,
            presentation: false,
            exact_render: true,
        },
    }
}

fn opened(
    id: Uuid,
    revision: u64,
    lease_closes: Arc<AtomicUsize>,
    runtime_closes: Arc<AtomicUsize>,
    page: Option<OfficePage>,
) -> OfficeOpenedDocument {
    let runtime = Arc::new(FakeRuntime {
        page: Mutex::new(page),
        closes: runtime_closes,
    });
    let lease = Arc::new(FakeLease {
        closes: lease_closes,
    });
    OfficeOpenedDocument {
        session: session(id, revision),
        sections: vec![section("document:0", 0)],
        source_revision: revision,
        source_content_id: None,
        runtime,
        lease,
    }
}

fn cache_lease() -> cache_store::CacheLease {
    cache_store::CacheLease {
        lease_id: Uuid::new_v4().to_string(),
        token: "0123456789abcdef0123456789abcdef".to_string(),
        name: "page.png".to_string(),
        mime: "image/png".to_string(),
        byte_len: 4,
        width: Some(1),
        height: Some(1),
        sensitive: false,
    }
}

fn page(revision: u64) -> OfficePage {
    OfficePage {
        section_id: "document:0".to_string(),
        page: 1,
        image: cache_lease(),
        width_pt: 595.0,
        height_pt: 842.0,
        quality: OfficeQuality::Accurate,
        source_revision: revision,
    }
}

#[test]
fn session9_refused() {
    let sessions = OfficeViewSessions::default();
    for _ in 0..OFFICE_MAX_SESSIONS {
        sessions
            .admit(
                opened(
                    Uuid::new_v4(),
                    1,
                    Arc::new(AtomicUsize::new(0)),
                    Arc::new(AtomicUsize::new(0)),
                    None,
                ),
                1,
            )
            .unwrap();
    }
    assert_eq!(sessions.len(), OFFICE_MAX_SESSIONS);
    match sessions.reserve() {
        Ok(_) => panic!("ninth session must be refused"),
        Err(error) => assert_eq!(error, "office.too_large".to_string()),
    }
    assert_eq!(sessions.len(), OFFICE_MAX_SESSIONS);
}

#[test]
fn close_releases_pack() {
    let sessions = OfficeViewSessions::default();
    let lease_closes = Arc::new(AtomicUsize::new(0));
    let runtime_closes = Arc::new(AtomicUsize::new(0));
    let id = Uuid::new_v4();
    sessions
        .admit(
            opened(id, 1, lease_closes.clone(), runtime_closes.clone(), None),
            1,
        )
        .unwrap();
    sessions.close(id);
    assert_eq!(lease_closes.load(Ordering::SeqCst), 1);
    assert_eq!(runtime_closes.load(Ordering::SeqCst), 1);
    // Idempotent: a stale tab must not release anything twice.
    sessions.close(id);
    assert_eq!(lease_closes.load(Ordering::SeqCst), 1);
    assert_eq!(runtime_closes.load(Ordering::SeqCst), 1);
}

#[test]
fn stale_revision_not_displayed() {
    let sessions = OfficeViewSessions::default();
    let id = Uuid::new_v4();
    let entry = sessions
        .admit(
            opened(
                id,
                7,
                Arc::new(AtomicUsize::new(0)),
                Arc::new(AtomicUsize::new(0)),
                None,
            ),
            1,
        )
        .unwrap();
    assert_eq!(
        entry.accept_page(page(6)).unwrap_err(),
        "office.changed".to_string()
    );
    assert_eq!(entry.accept_page(page(7)).unwrap().source_revision, 7);
}

#[test]
fn idle_session_closes_after_ten_minutes() {
    let sessions = OfficeViewSessions::default();
    let lease_closes = Arc::new(AtomicUsize::new(0));
    sessions
        .admit(
            opened(
                Uuid::new_v4(),
                1,
                lease_closes.clone(),
                Arc::new(AtomicUsize::new(0)),
                None,
            ),
            100,
        )
        .unwrap();
    assert_eq!(sessions.sweep_idle(100 + OFFICE_IDLE_SECONDS - 1), 0);
    assert_eq!(sessions.sweep_idle(100 + OFFICE_IDLE_SECONDS), 1);
    assert_eq!(lease_closes.load(Ordering::SeqCst), 1);
    assert!(sessions.is_empty());
}
