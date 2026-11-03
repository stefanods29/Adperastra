//! Source-bound sessions for the extra viewers (Step 07f D4/D5, E1-E5).
//!
//! A session remembers the exact source stamp, owns one parser backend and
//! refuses every page after the file changed. Closing is idempotent and
//! frees the helper, its cursors, its leases and its app-owned work folder.
//! The module has no Tauri types, so the stale-source, eviction and
//! background-read rules are unit-testable.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use fs_service::SourceStamp;
use uuid::Uuid;

use crate::extra_view_types::{
    page_within_budget, parse_cursor, parse_session_id, source_limit, validate_page_request,
    BookContentsPage, ExtraPageRequest, ExtraViewKind, ExtraViewPage, ExtraViewSession,
    MAX_BOOK_SESSIONS, MAX_LIVE_CURSORS, MAX_NATIVE_SESSIONS,
};

/// The title/count/partial summary a parser reports before any page.
#[derive(Debug, Clone)]
pub struct ExtraViewSummary {
    pub title: String,
    pub item_count: u32,
    pub partial: bool,
}

/// One parser backend. Production backends own a helper process; tests own a
/// small fake. The manager never inspects a backend's private state.
pub trait ExtraViewBackend: Send {
    fn page(&mut self, request: &ExtraPageRequest) -> Result<ExtraViewPage, String>;
    fn contents(&mut self, _cursor: Option<&str>) -> Result<BookContentsPage, String> {
        Err("extra_view.bad_request".to_string())
    }
    fn attachment(&mut self, _attachment_id: &str) -> Result<PathBuf, String> {
        Err("extra_view.bad_request".to_string())
    }
    /// The bounded schema list of a SQLite session (additive companion of
    /// E3; the table picker cannot work without it).
    fn tables(&mut self) -> Result<Vec<crate::extra_view_types::SqliteTableInfo>, String> {
        Err("extra_view.bad_request".to_string())
    }
    fn close(&mut self);
}

/// Opens a parser backend after the manager has validated the source.
pub trait ExtraViewBackendFactory: Send + Sync {
    fn open(
        &self,
        kind: ExtraViewKind,
        path: &Path,
        stamp: &SourceStamp,
        session_id: &str,
        work_dir: &Path,
    ) -> Result<(Box<dyn ExtraViewBackend>, ExtraViewSummary), String>;
}

/// Captures the current source stamp. Production uses the 07a fs-service
/// helper; tests inject a value.
pub trait SourceStampProvider: Send + Sync {
    fn stamp(&self, path: &Path) -> Result<SourceStamp, String>;
}

/// The production stamp provider (07a E9).
pub struct FsStampProvider;

impl SourceStampProvider for FsStampProvider {
    fn stamp(&self, path: &Path) -> Result<SourceStamp, String> {
        fs_service::capture_source_stamp(path).map_err(|_| "extra_view.unavailable".to_string())
    }
}

/// A background read may only start when the policy agrees and the source is
/// not an online-only placeholder (R-FS-1). The caller checks both before
/// asking for a preview.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)] // Producer gate for the background preview path.
pub struct BackgroundPermission {
    pub online_only: bool,
    pub allowed: bool,
}

#[allow(dead_code)]
impl BackgroundPermission {
    pub fn allowed(self) -> bool {
        self.allowed && !self.online_only
    }
}

struct SessionEntry {
    public: ExtraViewSession,
    path: PathBuf,
    work_dir: PathBuf,
    /// Taken out while a parser request runs so no session lock is held
    /// during helper or disk work (P-20).
    backend: Option<Box<dyn ExtraViewBackend>>,
    cursors: VecDeque<Uuid>,
    cursor_set: HashSet<Uuid>,
    last_used: u64,
}

struct State {
    sessions: HashMap<String, SessionEntry>,
}

/// The live extra-view sessions (managed state).
pub struct ExtraViewSessions {
    state: Mutex<State>,
    factory: Box<dyn ExtraViewBackendFactory>,
    stamps: Box<dyn SourceStampProvider>,
    work_root: PathBuf,
    clock: Mutex<u64>,
}

impl ExtraViewSessions {
    pub fn new(
        factory: Box<dyn ExtraViewBackendFactory>,
        stamps: Box<dyn SourceStampProvider>,
        work_root: PathBuf,
    ) -> Self {
        Self {
            state: Mutex::new(State {
                sessions: HashMap::new(),
            }),
            factory,
            stamps,
            work_root,
            clock: Mutex::new(0),
        }
    }

    fn lock(&self) -> Result<MutexGuard<'_, State>, String> {
        self.state
            .lock()
            .map_err(|_| "extra_view.unavailable".to_string())
    }

    fn tick(&self) -> u64 {
        let mut clock = match self.clock.lock() {
            Ok(clock) => clock,
            Err(poisoned) => poisoned.into_inner(),
        };
        *clock = clock.saturating_add(1);
        *clock
    }

    /// Open a source that the user explicitly asked for. For a background or
    /// hover request use `background_open`, which checks the cloud policy
    /// before any byte is read.
    pub fn open(&self, path: &Path, kind: ExtraViewKind) -> Result<ExtraViewSession, String> {
        validate_source_path(path)?;
        let metadata = std::fs::metadata(path).map_err(|_| "extra_view.unavailable".to_string())?;
        if !metadata.is_file() {
            return Err("extra_view.bad_request".to_string());
        }
        if metadata.len() > source_limit(kind) {
            return Err("extra_view.too_large".to_string());
        }
        let stamp = self.stamps.stamp(path)?;
        let session_id = Uuid::new_v4().to_string();
        let work_dir = self.work_root.join(&session_id);
        std::fs::create_dir_all(&work_dir).map_err(|_| "extra_view.unavailable".to_string())?;
        let (mut backend, summary) =
            match self
                .factory
                .open(kind, path, &stamp, &session_id, &work_dir)
            {
                Ok(result) => result,
                Err(error) => {
                    let _ = remove_owned_dir(&work_dir);
                    return Err(error);
                }
            };
        // Opening may take seconds; a file replaced meanwhile must not become
        // a live session with an old summary.
        match self.stamps.stamp(path) {
            Ok(after) if after == stamp => {}
            _ => {
                backend.close();
                let _ = remove_owned_dir(&work_dir);
                return Err("extra_view.changed".to_string());
            }
        }
        let public = ExtraViewSession {
            session_id: session_id.clone(),
            source: stamp,
            kind,
            title: summary.title.clone(),
            item_count: summary.item_count,
            partial: summary.partial,
        };
        let entry = SessionEntry {
            public: public.clone(),
            path: path.to_path_buf(),
            work_dir,
            backend: Some(backend),
            cursors: VecDeque::new(),
            cursor_set: HashSet::new(),
            last_used: self.tick(),
        };
        let evicted = {
            let mut state = self.lock()?;
            state.sessions.insert(session_id, entry);
            Self::evict(&mut state)
        };
        for mut old in evicted {
            if let Some(mut backend) = old.backend.take() {
                backend.close();
            }
            let _ = remove_owned_dir(&old.work_dir);
        }
        Ok(public)
    }

    /// A background preview of this format: no parser is started when the
    /// policy is inactive or the item is online-only.
    #[allow(dead_code)] // Kept for the background preview path (Step 07g/12a).
    pub fn background_open(
        &self,
        path: &Path,
        kind: ExtraViewKind,
        permission: BackgroundPermission,
    ) -> Result<ExtraViewSession, String> {
        if !permission.allowed() {
            return Err("extra_view.unavailable".to_string());
        }
        self.open(path, kind)
    }

    /// Read one session's path and stamp without holding the state lock during
    /// any disk work (P-20).
    fn locate(
        &self,
        session_id: &str,
        kind: ExtraViewKind,
    ) -> Result<(PathBuf, SourceStamp, PathBuf), String> {
        let state = self.lock()?;
        let entry = state
            .sessions
            .get(session_id)
            .ok_or_else(|| "extra_view.changed".to_string())?;
        if entry.public.kind != kind {
            return Err("extra_view.bad_request".to_string());
        }
        Ok((
            entry.path.clone(),
            entry.public.source.clone(),
            entry.work_dir.clone(),
        ))
    }

    fn verify_stamp(&self, path: &Path, expected: &SourceStamp) -> Result<(), String> {
        let current = self.stamps.stamp(path)?;
        if current != *expected {
            return Err("extra_view.changed".to_string());
        }
        Ok(())
    }

    pub fn page(&self, request: &ExtraPageRequest) -> Result<ExtraViewPage, String> {
        let id = request.session_id.clone();
        let kind = {
            let state = self.lock()?;
            state
                .sessions
                .get(&id)
                .map(|entry| entry.public.kind)
                .ok_or_else(|| "extra_view.changed".to_string())?
        };
        validate_page_request(request, kind)?;
        let (path, expected, _work_dir) = self.locate(&id, kind)?;
        // Disk work happens with no session lock held.
        self.verify_stamp(&path, &expected)?;
        let now = self.tick();
        let mut backend = {
            let mut state = self.lock()?;
            let entry = state
                .sessions
                .get_mut(&id)
                .ok_or_else(|| "extra_view.changed".to_string())?;
            if entry.public.source != expected {
                return Err("extra_view.changed".to_string());
            }
            if let Some(cursor) = parse_cursor(request.cursor.as_deref())? {
                if !entry.cursor_set.contains(&cursor) {
                    return Err("extra_view.bad_request".to_string());
                }
                entry.cursors.retain(|value| value != &cursor);
                entry.cursors.push_back(cursor);
            }
            entry.last_used = now;
            entry
                .backend
                .take()
                .ok_or_else(|| "extra_view.unavailable".to_string())?
        };
        let result = backend.page(request);
        let mut state = self.lock()?;
        let Some(entry) = state.sessions.get_mut(&id) else {
            backend.close();
            return Err("extra_view.changed".to_string());
        };
        if entry.public.source != expected {
            entry.backend = Some(backend);
            return Err("extra_view.changed".to_string());
        }
        entry.backend = Some(backend);
        let mut page = result?;
        page.session_id = id.clone();
        page_within_budget(&page)?;
        if let Some(cursor) = page.next_cursor.as_deref() {
            let cursor =
                parse_cursor(Some(cursor))?.ok_or_else(|| "extra_view.bad_request".to_string())?;
            if !entry.cursor_set.contains(&cursor) {
                entry.cursor_set.insert(cursor);
                entry.cursors.push_back(cursor);
                while entry.cursors.len() > MAX_LIVE_CURSORS as usize {
                    if let Some(oldest) = entry.cursors.pop_front() {
                        entry.cursor_set.remove(&oldest);
                    }
                }
            }
        }
        Ok(page)
    }

    pub fn contents(
        &self,
        session_id: &str,
        cursor: Option<&str>,
    ) -> Result<BookContentsPage, String> {
        parse_session_id(session_id)?;
        let (path, expected, _) = self.locate(session_id, ExtraViewKind::Book)?;
        self.verify_stamp(&path, &expected)?;
        let mut backend = self.take_backend(session_id)?;
        let result = backend.contents(cursor);
        self.restore_backend(session_id, backend)?;
        let page = result?;
        let size = serde_json::to_vec(&page)
            .map_err(|_| "extra_view.unavailable".to_string())?
            .len();
        if size > crate::extra_view_types::MAX_PAGE_BYTES {
            return Err("extra_view.too_large".to_string());
        }
        Ok(page)
    }

    pub fn sqlite_tables(
        &self,
        session_id: &str,
    ) -> Result<Vec<crate::extra_view_types::SqliteTableInfo>, String> {
        parse_session_id(session_id)?;
        let (path, expected, _) = self.locate(session_id, ExtraViewKind::Sqlite)?;
        self.verify_stamp(&path, &expected)?;
        let mut backend = self.take_backend(session_id)?;
        let result = backend.tables();
        self.restore_backend(session_id, backend)?;
        let tables = result?;
        let size = serde_json::to_vec(&tables)
            .map_err(|_| "extra_view.unavailable".to_string())?
            .len();
        if size > crate::extra_view_types::MAX_PAGE_BYTES {
            return Err("extra_view.too_large".to_string());
        }
        Ok(tables)
    }

    pub fn attachment(&self, session_id: &str, attachment_id: &str) -> Result<PathBuf, String> {
        parse_session_id(session_id)?;
        Uuid::parse_str(attachment_id).map_err(|_| "extra_view.bad_request".to_string())?;
        let (path, expected, work_dir) = self.locate(session_id, ExtraViewKind::Email)?;
        self.verify_stamp(&path, &expected)?;
        let mut backend = self.take_backend(session_id)?;
        let result = backend.attachment(attachment_id);
        self.restore_backend(session_id, backend)?;
        let opened = result?;
        if !opened.starts_with(&work_dir) {
            return Err("extra_view.bad_request".to_string());
        }
        let metadata =
            std::fs::symlink_metadata(&opened).map_err(|_| "extra_view.unavailable".to_string())?;
        if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
            return Err("extra_view.bad_request".to_string());
        }
        Ok(opened)
    }

    fn take_backend(&self, session_id: &str) -> Result<Box<dyn ExtraViewBackend>, String> {
        let now = self.tick();
        let mut state = self.lock()?;
        let entry = state
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| "extra_view.changed".to_string())?;
        entry.last_used = now;
        entry
            .backend
            .take()
            .ok_or_else(|| "extra_view.unavailable".to_string())
    }

    fn restore_backend(
        &self,
        session_id: &str,
        backend: Box<dyn ExtraViewBackend>,
    ) -> Result<(), String> {
        let mut state = self.lock()?;
        match state.sessions.get_mut(session_id) {
            Some(entry) => {
                entry.backend = Some(backend);
                Ok(())
            }
            None => {
                // The tab closed while the helper answered; free now.
                let mut backend = backend;
                backend.close();
                Err("extra_view.changed".to_string())
            }
        }
    }

    #[allow(dead_code)] // Session inspection for later consumers and diagnostics.
    pub fn session(&self, session_id: &str) -> Option<ExtraViewSession> {
        let state = self.lock().ok()?;
        state
            .sessions
            .get(session_id)
            .map(|entry| entry.public.clone())
    }

    /// Idempotent: an unknown or already closed session is a success (E4).
    pub fn close(&self, session_id: &str) -> Result<(), String> {
        let removed = {
            let mut state = self.lock()?;
            state.sessions.remove(session_id)
        };
        if let Some(mut entry) = removed {
            if let Some(mut backend) = entry.backend.take() {
                backend.close();
            }
            let _ = remove_owned_dir(&entry.work_dir);
        }
        Ok(())
    }

    fn evict(state: &mut State) -> Vec<SessionEntry> {
        let mut removed = Vec::new();
        loop {
            let native = state
                .sessions
                .values()
                .filter(|entry| entry.public.kind != ExtraViewKind::Book)
                .count();
            let books = state
                .sessions
                .values()
                .filter(|entry| entry.public.kind == ExtraViewKind::Book)
                .count();
            if native <= MAX_NATIVE_SESSIONS && books <= MAX_BOOK_SESSIONS {
                return removed;
            }
            let oldest = state
                .sessions
                .iter()
                .min_by_key(|(_, entry)| entry.last_used)
                .map(|(id, _)| id.clone());
            let Some(id) = oldest else {
                return removed;
            };
            if let Some(entry) = state.sessions.remove(&id) {
                removed.push(entry);
            }
        }
    }
}

fn validate_source_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("extra_view.bad_request".to_string());
    }
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("extra_view.bad_request".to_string());
    }
    Ok(())
}

/// Remove only the app-owned work folder this session created. Links are
/// never followed or removed; the recursion is bounded, and the caller
/// ignores a missing folder.
fn remove_owned_dir(path: &Path) -> std::io::Result<()> {
    fn clear(directory: &Path, depth: usize) -> std::io::Result<()> {
        if depth > 64 {
            return Ok(());
        }
        for entry in std::fs::read_dir(directory)?.flatten() {
            let metadata = std::fs::symlink_metadata(entry.path())?;
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                clear(&entry.path(), depth + 1)?;
            } else if metadata.is_file() {
                std::fs::remove_file(entry.path())?;
            }
        }
        Ok(())
    }
    clear(path, 0)?;
    std::fs::remove_dir(path)
}

/// The summary the manager stores is not serialized; callers see only
/// `ExtraViewSession`. The field is kept for diagnostics and tests.
impl std::fmt::Debug for ExtraViewSessions {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ExtraViewSessions")
            .field("work_root", &self.work_root)
            .finish()
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    pub struct MutableStamp {
        pub value: Mutex<SourceStamp>,
    }

    impl MutableStamp {
        pub fn new(stamp: SourceStamp) -> Arc<Self> {
            Arc::new(Self {
                value: Mutex::new(stamp),
            })
        }
    }

    impl SourceStampProvider for Arc<MutableStamp> {
        fn stamp(&self, _path: &Path) -> Result<SourceStamp, String> {
            Ok(self.value.lock().unwrap().clone())
        }
    }

    pub struct FakeBackend {
        pub closed: Arc<AtomicUsize>,
    }

    impl ExtraViewBackend for FakeBackend {
        fn page(&mut self, request: &ExtraPageRequest) -> Result<ExtraViewPage, String> {
            Ok(ExtraViewPage {
                session_id: String::new(),
                kind: ExtraViewKind::Notebook,
                payload: crate::extra_view_types::ExtraViewPayload::Notebook { cells: Vec::new() },
                next_cursor: request.cursor.clone(),
                complete: false,
                partial: false,
            })
        }

        fn close(&mut self) {
            self.closed.fetch_add(1, Ordering::Relaxed);
        }
    }

    pub struct FakeFactory {
        pub opens: Arc<AtomicUsize>,
        pub closed: Arc<AtomicUsize>,
    }

    impl ExtraViewBackendFactory for FakeFactory {
        fn open(
            &self,
            _kind: ExtraViewKind,
            _path: &Path,
            _stamp: &SourceStamp,
            _session_id: &str,
            _work_dir: &Path,
        ) -> Result<(Box<dyn ExtraViewBackend>, ExtraViewSummary), String> {
            self.opens.fetch_add(1, Ordering::Relaxed);
            Ok((
                Box::new(FakeBackend {
                    closed: Arc::clone(&self.closed),
                }),
                ExtraViewSummary {
                    title: "fake".to_string(),
                    item_count: 0,
                    partial: false,
                },
            ))
        }
    }

    pub fn stamp(size: u64, ticks: &str) -> SourceStamp {
        SourceStamp {
            path_key: "C:\\fake\\book.epub".to_string(),
            volume_id: "00000000".to_string(),
            file_id: "0000000000000000".to_string(),
            modified_ticks: ticks.to_string(),
            size_bytes: size,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::*;
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    fn session_manager(
        directory: &tempfile::TempDir,
        stamp_value: Arc<MutableStamp>,
    ) -> (ExtraViewSessions, Arc<AtomicUsize>, Arc<AtomicUsize>) {
        let opens = Arc::new(AtomicUsize::new(0));
        let closed = Arc::new(AtomicUsize::new(0));
        let factory = FakeFactory {
            opens: Arc::clone(&opens),
            closed: Arc::clone(&closed),
        };
        (
            ExtraViewSessions::new(
                Box::new(factory),
                Box::new(stamp_value),
                directory.path().to_path_buf(),
            ),
            opens,
            closed,
        )
    }

    #[test]
    fn closing_twice_succeeds() {
        let directory = tempfile::tempdir().unwrap();
        let stamps = MutableStamp::new(stamp(10, "10"));
        let (sessions, _opens, closed) = session_manager(&directory, stamps);
        let path = directory.path().join("a.ipynb");
        std::fs::write(&path, b"{}").unwrap();
        let session = sessions.open(&path, ExtraViewKind::Notebook).unwrap();
        sessions.close(&session.session_id).unwrap();
        sessions.close(&session.session_id).unwrap();
        assert_eq!(closed.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn stale_session_cannot_read_replaced_source() {
        let directory = tempfile::tempdir().unwrap();
        let stamps = MutableStamp::new(stamp(10, "10"));
        let (sessions, _opens, _closed) = session_manager(&directory, stamps.clone());
        let path = directory.path().join("a.ipynb");
        std::fs::write(&path, b"{}").unwrap();
        let session = sessions.open(&path, ExtraViewKind::Notebook).unwrap();
        *stamps.value.lock().unwrap() = stamp(10, "11");
        let request = ExtraPageRequest {
            session_id: session.session_id,
            ..ExtraPageRequest::default()
        };
        assert_eq!(
            sessions.page(&request).unwrap_err(),
            "extra_view.changed".to_string()
        );
    }

    #[test]
    fn oversized_source_does_not_start_parser() {
        let directory = tempfile::tempdir().unwrap();
        let stamps = MutableStamp::new(stamp(1, "1"));
        let (sessions, opens, _closed) = session_manager(&directory, stamps);
        let path = directory.path().join("big.ipynb");
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(crate::extra_view_types::MAX_NOTEBOOK_SOURCE_BYTES + 1)
            .unwrap();
        assert_eq!(
            sessions.open(&path, ExtraViewKind::Notebook).unwrap_err(),
            "extra_view.too_large".to_string()
        );
        assert_eq!(opens.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn invalid_cursor_is_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let stamps = MutableStamp::new(stamp(10, "10"));
        let (sessions, _opens, _closed) = session_manager(&directory, stamps);
        let path = directory.path().join("a.ipynb");
        std::fs::write(&path, b"{}").unwrap();
        let session = sessions.open(&path, ExtraViewKind::Notebook).unwrap();
        let request = ExtraPageRequest {
            session_id: session.session_id,
            cursor: Some("c7f2f0a2-4f08-4f4e-a4f8-2f0f3f4f5a11".to_string()),
            ..ExtraPageRequest::default()
        };
        assert_eq!(
            sessions.page(&request).unwrap_err(),
            "extra_view.bad_request".to_string()
        );
    }

    #[test]
    fn online_only_background_read_count_is_zero() {
        let directory = tempfile::tempdir().unwrap();
        let stamps = MutableStamp::new(stamp(10, "10"));
        let (sessions, opens, _closed) = session_manager(&directory, stamps);
        let path = directory.path().join("a.ipynb");
        std::fs::write(&path, b"{}").unwrap();
        let permission = BackgroundPermission {
            online_only: true,
            allowed: true,
        };
        assert_eq!(
            sessions
                .background_open(&path, ExtraViewKind::Notebook, permission)
                .unwrap_err(),
            "extra_view.unavailable".to_string()
        );
        assert_eq!(opens.load(Ordering::Relaxed), 0);
    }
}
