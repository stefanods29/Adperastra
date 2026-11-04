//! Bounded read-only Office view sessions (Step 13 T1/T4).
//!
//! A session owns one opened source, its stable section descriptors and the
//! runtime that can answer page/comment/cell requests. The table lock is
//! only held for map bookkeeping: no render, disk read or engine call ever
//! runs under it.
//!
//! Sessions are bounded at eight, close after ten idle minutes, and never
//! accept a page from a different source revision. Closing is idempotent and
//! drops the runtime before releasing the engine/pack lease.
#![allow(dead_code)]

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use uuid::Uuid;

use crate::office_view_types::{
    parse_cursor, validate_page_request, OfficeCommentPage, OfficePage, OfficeSection,
    OfficeSectionPage, OfficeSession, OFFICE_IDLE_SECONDS, OFFICE_MAX_SECTION_PAGE,
    OFFICE_MAX_SESSIONS,
};

pub use crate::office_view_opened::{OfficeOpenedDocument, SectionCursor};
pub use crate::office_view_runtime::{OfficeDocumentLease, OfficeViewRuntime, OfficeWork};

/// One live session. `sections` and the runtime are immutable after admit;
/// only the cursor/last-used state is mutable.
pub struct OfficeSessionEntry {
    pub session: OfficeSession,
    pub sections: Vec<OfficeSection>,
    pub source_revision: u64,
    pub source_content_id: Option<Uuid>,
    runtime: Arc<dyn OfficeViewRuntime>,
    lease: Arc<dyn OfficeDocumentLease>,
    last_used: AtomicU64,
    cursors: Mutex<HashMap<Uuid, SectionCursor>>,
    closed: Mutex<bool>,
}

impl OfficeSessionEntry {
    pub fn id(&self) -> Uuid {
        self.session.session_id
    }

    pub fn touch(&self, now: u64) {
        self.last_used.store(now, Ordering::Relaxed);
    }

    pub fn last_used(&self) -> u64 {
        self.last_used.load(Ordering::Relaxed)
    }

    /// One stable limit of 200 sections per answer. Cursors are session-bound
    /// and cannot be reused by another session.
    pub fn sections_page(&self, cursor: Option<Uuid>) -> Result<OfficeSectionPage, String> {
        let offset = match cursor {
            None => 0,
            Some(cursor) => {
                let cursors = self
                    .cursors
                    .lock()
                    .map_err(|_| "office.engine_failed".to_string())?;
                let binding = cursors
                    .get(&cursor)
                    .ok_or_else(|| "office.bad_request".to_string())?;
                if binding.session_id != self.session.session_id {
                    return Err("office.bad_request".to_string());
                }
                binding.offset
            }
        };
        if offset >= self.sections.len() {
            return Ok(OfficeSectionPage {
                items: Vec::new(),
                next_cursor: None,
                complete: true,
            });
        }
        let end = (offset + OFFICE_MAX_SECTION_PAGE).min(self.sections.len());
        let next_cursor = if end < self.sections.len() {
            let mut cursors = self
                .cursors
                .lock()
                .map_err(|_| "office.engine_failed".to_string())?;
            if cursors.len() >= 128 {
                cursors.clear();
            }
            let cursor = Uuid::new_v4();
            cursors.insert(
                cursor,
                SectionCursor {
                    session_id: self.session.session_id,
                    offset: end,
                },
            );
            Some(cursor)
        } else {
            None
        };
        Ok(OfficeSectionPage {
            items: self.sections[offset..end].to_vec(),
            next_cursor,
            complete: end == self.sections.len(),
        })
    }

    /// A page is displayed only when it belongs to this exact revision and
    /// section. A late result from an older revision is discarded, not shown.
    pub fn accept_page(&self, page: OfficePage) -> Result<OfficePage, String> {
        if page.source_revision != self.source_revision {
            return Err("office.changed".to_string());
        }
        let section = self
            .sections
            .iter()
            .find(|section| section.id == page.section_id)
            .ok_or_else(|| "office.bad_request".to_string())?;
        if page.page == 0 || page.page > section.page_count || !page.is_valid() {
            return Err("office.bad_request".to_string());
        }
        Ok(page)
    }

    pub fn page(
        &self,
        section_id: &str,
        page: u32,
        scale: f64,
        work: &dyn OfficeWork,
    ) -> Result<OfficePage, String> {
        validate_page_request(page, scale)?;
        let section = self.section(section_id)?;
        if page > section.page_count {
            return Err("office.bad_request".to_string());
        }
        let result = self.runtime.page(section_id, page, scale, work)?;
        self.accept_page(result)
    }

    pub fn text(
        &self,
        section: &str,
        page: u32,
        work: &dyn OfficeWork,
    ) -> Result<crate::office_view_types::OfficeLayoutText, String> {
        validate_page_request(page, 1.0)?;
        if page > self.section(section)?.page_count {
            return Err("office.bad_request".into());
        }
        self.runtime.text(section, page, work)
    }

    pub fn comments(
        &self,
        section_id: &str,
        cursor: Option<Uuid>,
    ) -> Result<OfficeCommentPage, String> {
        let section = self.section(section_id)?;
        if !section.is_valid() {
            return Err("office.bad_request".to_string());
        }
        let page = self.runtime.comments(section_id, cursor)?;
        if !page.is_valid() {
            return Err("office.too_large".to_string());
        }
        Ok(page)
    }

    pub fn cells(
        &self,
        section_id: &str,
        row_start: u32,
        row_count: u32,
        column_start: u32,
        column_count: u32,
    ) -> Result<crate::office_view_types::OfficeCellPage, String> {
        let section = self.section(section_id)?;
        if section.kind != crate::office_view_types::OfficeSectionKind::Sheet {
            return Err("office.bad_request".to_string());
        }
        let page =
            self.runtime
                .cells(section_id, row_start, row_count, column_start, column_count)?;
        if page.section_id != section_id {
            return Err("office.changed".to_string());
        }
        if !page.is_valid() {
            return Err("office.too_large".to_string());
        }
        Ok(page)
    }

    pub fn section(&self, section_id: &str) -> Result<&OfficeSection, String> {
        self.sections
            .iter()
            .find(|section| section.id == section_id)
            .ok_or_else(|| "office.bad_request".to_string())
    }

    pub fn source_identity_matches(&self, revision: u64, content_id: Option<Uuid>) -> bool {
        self.source_revision == revision
            && (content_id.is_none() || content_id == self.source_content_id)
    }

    fn close(&self) {
        let mut closed = match self.closed.lock() {
            Ok(closed) => closed,
            Err(_) => return,
        };
        if *closed {
            return;
        }
        *closed = true;
        self.runtime.close();
        self.lease.close();
    }
}

impl Drop for OfficeSessionEntry {
    fn drop(&mut self) {
        self.close();
    }
}

/// The app-managed registry.
#[derive(Default)]
pub struct OfficeViewSessions {
    entries: Mutex<HashMap<Uuid, Arc<OfficeSessionEntry>>>,
    reservations: Mutex<usize>,
}

impl OfficeViewSessions {
    /// Reserve an open slot before slow disk/engine work starts. This keeps
    /// nine simultaneous opens from all passing the eight-session check.
    pub fn reserve(&self) -> Result<OfficeReservation<'_>, String> {
        let mut reservations = self
            .reservations
            .lock()
            .map_err(|_| "office.engine_failed".to_string())?;
        let live = self
            .entries
            .lock()
            .map_err(|_| "office.engine_failed".to_string())?
            .len();
        if live + *reservations >= OFFICE_MAX_SESSIONS {
            return Err("office.too_large".to_string());
        }
        *reservations += 1;
        Ok(OfficeReservation {
            sessions: self,
            active: true,
        })
    }

    fn release_reservation(&self) {
        if let Ok(mut reservations) = self.reservations.lock() {
            *reservations = reservations.saturating_sub(1);
        }
    }

    /// Store a completely opened document. The caller must have called
    /// `reserve()`; a validation failure leaves no entry behind.
    pub fn admit(
        &self,
        opened: OfficeOpenedDocument,
        now: u64,
    ) -> Result<Arc<OfficeSessionEntry>, String> {
        opened.validate()?;
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "office.engine_failed".to_string())?;
        if entries.len() >= OFFICE_MAX_SESSIONS {
            return Err("office.too_large".to_string());
        }
        if entries.contains_key(&opened.session.session_id) {
            return Err("office.bad_request".to_string());
        }
        let entry = Arc::new(OfficeSessionEntry {
            session: opened.session,
            sections: opened.sections,
            source_revision: opened.source_revision,
            source_content_id: opened.source_content_id,
            runtime: opened.runtime,
            lease: opened.lease,
            last_used: AtomicU64::new(now),
            cursors: Mutex::new(HashMap::new()),
            closed: Mutex::new(false),
        });
        entries.insert(entry.id(), entry.clone());
        Ok(entry)
    }

    pub fn get(&self, session_id: Uuid) -> Result<Arc<OfficeSessionEntry>, String> {
        self.entries
            .lock()
            .map_err(|_| "office.engine_failed".to_string())?
            .get(&session_id)
            .cloned()
            .ok_or_else(|| "office.not_found".to_string())
    }

    pub fn get_optional(&self, session_id: Uuid) -> Option<Arc<OfficeSessionEntry>> {
        self.entries.lock().ok()?.get(&session_id).cloned()
    }

    pub fn touch(&self, session_id: Uuid, now: u64) -> Result<(), String> {
        let entry = self.get(session_id)?;
        entry.touch(now);
        Ok(())
    }

    /// Idempotent. Unknown sessions are already closed.
    pub fn close(&self, session_id: Uuid) {
        let removed = self
            .entries
            .lock()
            .ok()
            .and_then(|mut entries| entries.remove(&session_id));
        if let Some(entry) = removed {
            entry.close();
        }
    }

    /// Close every session idle for at least ten minutes. The caller runs
    /// this from a bounded maintenance tick, never from a UI render path.
    pub fn sweep_idle(&self, now: u64) -> usize {
        let expired: Vec<Uuid> = match self.entries.lock() {
            Ok(entries) => entries
                .values()
                .filter(|entry| now.saturating_sub(entry.last_used()) >= OFFICE_IDLE_SECONDS)
                .map(|entry| entry.id())
                .collect(),
            Err(_) => return 0,
        };
        for session in &expired {
            self.close(*session);
        }
        expired.len()
    }

    pub fn len(&self) -> usize {
        self.entries
            .lock()
            .map(|entries| entries.len())
            .unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Parse a cursor field from the UI before looking at any session data.
    pub fn parse_cursor(cursor: Option<&str>) -> Result<Option<Uuid>, String> {
        parse_cursor(cursor)
    }
}

/// A reservation that must be released on every success/failure path.
pub struct OfficeReservation<'a> {
    sessions: &'a OfficeViewSessions,
    active: bool,
}

impl OfficeReservation<'_> {
    pub fn commit(
        mut self,
        opened: OfficeOpenedDocument,
        now: u64,
    ) -> Result<Arc<OfficeSessionEntry>, String> {
        let result = self.sessions.admit(opened, now);
        self.release();
        result
    }

    pub fn release(&mut self) {
        if self.active {
            self.active = false;
            self.sessions.release_reservation();
        }
    }
}

impl Drop for OfficeReservation<'_> {
    fn drop(&mut self) {
        self.release();
    }
}

#[cfg(test)]
#[path = "office_session_step13_tests.rs"]
mod step13_tests;
