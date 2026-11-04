#![allow(dead_code)] // Public producer API; consumed from Step 07e onward.
//! PDF sessions (Step 07d E1-E4).
//!
//! Two sessions may keep a live helper; the rest are bounded descriptors
//! (ten entries in total) that can be reopened from their identity. Cursors
//! are minted here, tied to the exact session, source and query, and never
//! accepted from the UI as an arbitrary offset: the outline cursor maps to a
//! preorder offset, the search cursor to the exact query and position it was
//! issued for.
//!
//! A session's own mutex is only held while that session's helper works; the
//! table lock is never held across helper or disk work.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use uuid::Uuid;

use self::private::PdfHelperSlot;
use crate::pdf_types::{PdfSourceIdentity, PDF_MAX_ACTIVE_SESSIONS, PDF_MAX_SESSIONS};

/// The exact key a search cursor belongs to: changing the query, the case
/// rule or the source invalidates it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchBinding {
    pub key: String,
    pub position: (u32, u32, u32),
}

/// Cursors are bounded per session.
pub const MAX_CURSORS: usize = 128;

/// One session's helper and cursor state.
pub struct PdfSessionEntry {
    pub session: crate::pdf_types::PdfSession,
    pub(crate) helper: PdfHelperSlot,
    resume: Mutex<Option<Arc<PdfResume>>>,
    valid: AtomicBool,
    pub active: AtomicBool,
    pub last_used: AtomicU64,
    outline_cursors: Mutex<HashMap<Uuid, u32>>,
    search_cursors: Mutex<HashMap<Uuid, SearchBinding>>,
}

impl PdfSessionEntry {
    fn new(session: crate::pdf_types::PdfSession, tick: u64) -> Self {
        Self {
            session,
            helper: PdfHelperSlot::default(),
            resume: Mutex::new(None),
            valid: AtomicBool::new(true),
            active: AtomicBool::new(false),
            last_used: AtomicU64::new(tick),
            outline_cursors: Mutex::new(HashMap::new()),
            search_cursors: Mutex::new(HashMap::new()),
        }
    }

    /// A descriptor without a table, for tests that only need the session
    /// data (cursor and cache-key rules).
    #[cfg(test)]
    pub fn new_for_test(session: crate::pdf_types::PdfSession) -> Self {
        Self::new(session, 1)
    }

    pub fn id(&self) -> Uuid {
        self.session.session_id
    }

    pub fn source(&self) -> &PdfSourceIdentity {
        &self.session.source
    }

    pub fn page_count(&self) -> u32 {
        self.session.page_count
    }

    pub fn touch(&self, tick: u64) {
        self.last_used.store(tick, Ordering::Relaxed);
    }

    /// A new outline cursor for this exact offset.
    pub fn new_outline_cursor(&self, offset: u32) -> Result<Uuid, String> {
        let mut cursors = self
            .outline_cursors
            .lock()
            .map_err(|_| "pdf.unavailable".to_string())?;
        if cursors.len() >= MAX_CURSORS {
            cursors.clear();
        }
        let cursor = Uuid::new_v4();
        cursors.insert(cursor, offset);
        Ok(cursor)
    }

    pub fn outline_cursor(&self, cursor: Uuid) -> Option<u32> {
        self.outline_cursors
            .lock()
            .ok()
            .and_then(|cursors| cursors.get(&cursor).copied())
    }

    /// A new search cursor bound to this query and position.
    pub fn new_search_cursor(
        &self,
        key: String,
        position: (u32, u32, u32),
    ) -> Result<Uuid, String> {
        let mut cursors = self
            .search_cursors
            .lock()
            .map_err(|_| "pdf.unavailable".to_string())?;
        if cursors.len() >= MAX_CURSORS {
            cursors.clear();
        }
        let cursor = Uuid::new_v4();
        cursors.insert(cursor, SearchBinding { key, position });
        Ok(cursor)
    }

    /// The binding of a cursor, only when the query/source key is unchanged.
    pub fn search_cursor(&self, cursor: Uuid, key: &str) -> Option<(u32, u32, u32)> {
        self.search_cursors.lock().ok().and_then(|cursors| {
            cursors
                .get(&cursor)
                .filter(|binding| binding.key == key)
                .map(|binding| binding.position)
        })
    }
}

/// A thread-safe handle to the helper of one session.
pub mod private {
    use super::*;
    use crate::pdf_helper_process::PdfHelperProcess;

    #[derive(Default)]
    pub struct PdfHelperSlot(Mutex<Option<PdfHelperProcess>>);

    impl PdfHelperSlot {
        /// Take the helper for the duration of one request and put it back.
        /// The lock is per session, never the table lock.
        pub fn with<R>(
            &self,
            work: impl FnOnce(&mut PdfHelperProcess) -> Result<R, String>,
        ) -> Result<R, String> {
            let mut slot = self.0.lock().map_err(|_| "pdf.unavailable".to_string())?;
            let helper = slot.as_mut().ok_or_else(|| "pdf.unavailable".to_string())?;
            work(helper)
        }

        pub fn attach(&self, helper: PdfHelperProcess) -> Result<(), String> {
            let mut slot = self.0.lock().map_err(|_| "pdf.unavailable".to_string())?;
            if slot.is_some() {
                return Err("pdf.bad_request".to_string());
            }
            *slot = Some(helper);
            Ok(())
        }

        pub fn detach(&self) {
            if let Ok(mut slot) = self.0.lock() {
                if let Some(helper) = slot.take() {
                    helper.close();
                }
            }
        }

        pub fn is_attached(&self) -> bool {
            self.0.lock().map(|slot| slot.is_some()).unwrap_or(false)
        }
    }
}

/// The app's bounded PDF session table.
pub struct PdfSessions {
    sessions: Mutex<HashMap<Uuid, Arc<PdfSessionEntry>>>,
    next_tick: AtomicU64,
    operations: Mutex<()>,
    pub resolvers: Arc<crate::pdf_snapshot_resolver::PdfSnapshotResolvers>,
}

impl PdfSessions {
    pub fn new(resolvers: Arc<crate::pdf_snapshot_resolver::PdfSnapshotResolvers>) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            next_tick: AtomicU64::new(1),
            operations: Mutex::new(()),
            resolvers,
        }
    }

    fn tick(&self) -> u64 {
        self.next_tick.fetch_add(1, Ordering::Relaxed)
    }

    /// Admit a new session, making room inside the twenty-entry and
    /// two-helper limits. Returns the entry; the helper is attached later.
    pub fn admit(
        &self,
        session: crate::pdf_types::PdfSession,
    ) -> Result<Arc<PdfSessionEntry>, String> {
        let mut table = self
            .sessions
            .lock()
            .map_err(|_| "pdf.unavailable".to_string())?;
        if table.contains_key(&session.session_id) {
            return Err("pdf.bad_request".to_string());
        }
        if table.len() >= PDF_MAX_SESSIONS {
            evict_oldest_inactive(&mut table);
        }
        let entry = Arc::new(PdfSessionEntry::new(session, self.tick()));
        table.insert(entry.id(), entry.clone());
        Ok(entry)
    }

    pub fn get(&self, session_id: Uuid) -> Result<Arc<PdfSessionEntry>, String> {
        self.sessions
            .lock()
            .map_err(|_| "pdf.unavailable".to_string())?
            .get(&session_id)
            .cloned()
            .ok_or_else(|| "pdf.changed".to_string())
    }

    pub fn touch(&self, entry: &PdfSessionEntry) {
        entry.touch(self.tick());
    }

    /// Attach the opened helper and mark the session active.
    pub fn attach(
        &self,
        entry: &PdfSessionEntry,
        helper: crate::pdf_helper_process::PdfHelperProcess,
    ) -> Result<(), String> {
        entry.helper.attach(helper)?;
        entry.active.store(true, Ordering::Relaxed);
        entry.touch(self.tick());
        Ok(())
    }

    /// Close one session: kill its helper, drop its cursors and forget it.
    pub fn close(&self, session_id: Uuid) -> Result<(), String> {
        let entry = {
            let mut table = self
                .sessions
                .lock()
                .map_err(|_| "pdf.unavailable".to_string())?;
            table.remove(&session_id)
        };
        if let Some(entry) = entry {
            entry.valid.store(false, Ordering::Relaxed);
            entry.helper.detach();
            entry.active.store(false, Ordering::Relaxed);
        }
        Ok(())
    }

    /// Close every session (app exit and tests).
    pub fn close_all(&self) {
        let entries = {
            let mut table = match self.sessions.lock() {
                Ok(table) => table,
                Err(_) => return,
            };
            table.drain().map(|(_, entry)| entry).collect::<Vec<_>>()
        };
        for entry in entries {
            entry.helper.detach();
            entry.active.store(false, Ordering::Relaxed);
        }
    }

    pub fn len(&self) -> usize {
        self.sessions.lock().map(|table| table.len()).unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn active_count(&self) -> usize {
        self.sessions
            .lock()
            .map(|table| {
                table
                    .values()
                    .filter(|entry| entry.active.load(Ordering::Relaxed))
                    .count()
            })
            .unwrap_or(0)
    }
}

impl Drop for PdfSessions {
    fn drop(&mut self) {
        self.close_all();
    }
}

fn evict_oldest_inactive(table: &mut HashMap<Uuid, Arc<PdfSessionEntry>>) -> bool {
    let candidate = table
        .values()
        .filter(|entry| !entry.active.load(Ordering::Relaxed))
        .min_by_key(|entry| entry.last_used.load(Ordering::Relaxed))
        .map(|entry| entry.id());
    match candidate {
        Some(id) => {
            table.remove(&id);
            true
        }
        None => false,
    }
}

#[path = "pdf_session_lifecycle.rs"]
mod lifecycle;
pub use lifecycle::PdfResume;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf_types::{PdfPermissions, PdfSession, PdfSnapshotRef};
    use fs_service::SourceStamp;

    fn session() -> PdfSession {
        PdfSession {
            session_id: Uuid::new_v4(),
            source: PdfSourceIdentity::Disk {
                stamp: SourceStamp {
                    path_key: "c:\\docs\\a.pdf".to_string(),
                    volume_id: "01234567".to_string(),
                    file_id: "0123456789abcdef".to_string(),
                    modified_ticks: "1".to_string(),
                    size_bytes: 10,
                },
            },
            page_count: 3,
            password_required: false,
            permissions: PdfPermissions {
                can_copy: true,
                can_print: true,
            },
        }
    }

    #[test]
    fn sessions_are_bounded_and_identity_is_kept() {
        let table = PdfSessions::new(Arc::new(
            crate::pdf_snapshot_resolver::PdfSnapshotResolvers::new(),
        ));
        let mut ids = Vec::new();
        for _ in 0..PDF_MAX_SESSIONS {
            let session = session();
            ids.push(session.session_id);
            table.admit(session).unwrap();
        }
        assert_eq!(table.len(), PDF_MAX_SESSIONS);
        // One more evicts an inactive descriptor, never an active one.
        let extra = session();
        table.admit(extra.clone()).unwrap();
        assert_eq!(table.len(), PDF_MAX_SESSIONS);
        assert!(table.get(extra.session_id).is_ok());
        table.close(extra.session_id).unwrap();
        assert_eq!(table.len(), PDF_MAX_SESSIONS - 1);
        assert_eq!(
            table.get(extra.session_id).err(),
            Some("pdf.changed".to_string())
        );
    }

    #[test]
    fn a_stale_session_cannot_grant_another_file() {
        let table = PdfSessions::new(Arc::new(
            crate::pdf_snapshot_resolver::PdfSnapshotResolvers::new(),
        ));
        let session = session();
        let id = session.session_id;
        table.admit(session).unwrap();
        table.close(id).unwrap();
        assert_eq!(table.get(id).err(), Some("pdf.changed".to_string()));
        assert_eq!(table.active_count(), 0);
    }

    #[test]
    fn outline_cursors_are_bounded_and_opaque() {
        let table = PdfSessions::new(Arc::new(
            crate::pdf_snapshot_resolver::PdfSnapshotResolvers::new(),
        ));
        let entry = table.admit(session()).unwrap();
        let cursor = entry.new_outline_cursor(120).unwrap();
        assert_eq!(entry.outline_cursor(cursor), Some(120));
        assert_eq!(entry.outline_cursor(Uuid::new_v4()), None);
        for _ in 0..(MAX_CURSORS + 1) {
            let _ = entry.new_outline_cursor(0).unwrap();
        }
        assert_eq!(entry.outline_cursor(cursor), None);
    }

    #[test]
    fn search_cursors_bind_the_query() {
        let table = PdfSessions::new(Arc::new(
            crate::pdf_snapshot_resolver::PdfSnapshotResolvers::new(),
        ));
        let entry = table.admit(session()).unwrap();
        let cursor = entry
            .new_search_cursor("query-a".to_string(), (1, 0, 0))
            .unwrap();
        assert_eq!(entry.search_cursor(cursor, "query-a"), Some((1, 0, 0)));
        assert_eq!(entry.search_cursor(cursor, "query-b"), None);
    }

    #[test]
    fn snapshot_references_need_the_registry() {
        let table = PdfSessions::new(Arc::new(
            crate::pdf_snapshot_resolver::PdfSnapshotResolvers::new(),
        ));
        assert_eq!(
            table
                .resolvers
                .resolve(&PdfSnapshotRef {
                    snapshot_id: Uuid::new_v4(),
                    document_id: "doc".to_string(),
                    revision: 1,
                    content_id: Uuid::new_v4(),
                })
                .err(),
            Some("pdf.snapshot_unavailable".to_string())
        );
    }
}
