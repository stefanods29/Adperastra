//! Live Gallery scans (Step 07c, export E4).
//!
//! `GallerySessions` is a bounded managed map (at most four scans). Admitting
//! a fifth cancels the least-recently used scan first. A session owns its
//! cancellation token, its cursor table and its source watchers; closing it
//! stops all three. Nothing here persists file grants or results.

use crate::gallery_pages::{build_page, CursorBook};
use crate::gallery_scan::GalleryScanShared;
use crate::gallery_types::{
    GalleryDateSource, GalleryPage, GallerySource, MAX_GALLERY_PAGE_BYTES, MAX_GALLERY_PAGE_ROWS,
};
use crate::gallery_watch::GalleryWatch;
use fs_service::CancellationToken;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// At most four scans at once (export E4).
pub const MAX_GALLERY_SESSIONS: usize = 4;
/// How long the start request waits for the first page (R-FS-5 listing limit).
pub const FIRST_PAGE_TIMEOUT: Duration = Duration::from_secs(15);
/// Once something is found, the first page may leave after this short grace so
/// a slow second root cannot delay a usable grid.
pub const FIRST_PAGE_GRACE: Duration = Duration::from_millis(250);

/// Event payload for `gallery-changed`.
#[derive(Debug, Clone, Serialize)]
pub struct GalleryChanged {
    pub generation: String,
}

struct SessionState {
    cursors: CursorBook,
    watchers: Option<GalleryWatch>,
    last_used: Instant,
    closed: bool,
    active: bool,
    snapshot: Option<Vec<crate::gallery_types::GalleryItem>>,
    snapshot_complete: bool,
}

/// One scan the UI can page through.
pub struct GallerySession {
    pub generation: String,
    pub date_source: GalleryDateSource,
    pub token: CancellationToken,
    pub scan: Arc<GalleryScanShared>,
    state: Mutex<SessionState>,
}

impl GallerySession {
    fn new(
        generation: String,
        date_source: GalleryDateSource,
        sources: Vec<GallerySource>,
        token: CancellationToken,
        app: Option<AppHandle>,
    ) -> Self {
        let watchers = app.and_then(|app| {
            let roots: Vec<(PathBuf, bool)> = sources
                .iter()
                .map(|source| (PathBuf::from(&source.path), source.recursive))
                .collect();
            let event_generation = generation.clone();
            GalleryWatch::start(&roots, move || {
                let _ = app.emit(
                    "gallery-changed",
                    GalleryChanged {
                        generation: event_generation.clone(),
                    },
                );
            })
            .ok()
        });
        Self {
            generation,
            date_source,
            token,
            scan: Arc::new(GalleryScanShared::new()),
            state: Mutex::new(SessionState {
                cursors: CursorBook::new(),
                watchers,
                last_used: Instant::now(),
                closed: false,
                active: true,
                snapshot: None,
                snapshot_complete: false,
            }),
        }
    }

    fn lock(&self) -> Result<MutexGuard<'_, SessionState>, String> {
        self.state
            .lock()
            .map_err(|_| "gallery.unavailable".to_string())
    }

    pub fn is_active(&self) -> bool {
        self.lock().map(|state| state.active).unwrap_or(true)
    }
    pub fn set_active(&self, active: bool) {
        if let Ok(mut state) = self.state.lock() {
            state.active = active;
            state.last_used = Instant::now();
        }
        if !active {
            self.token.store(true, Ordering::Relaxed);
        }
    }
    pub fn last_used(&self) -> Instant {
        self.lock()
            .map(|state| state.last_used)
            .unwrap_or_else(|_| Instant::now())
    }

    /// Builds the requested page. A missing, expired or foreign cursor is
    /// `gallery.changed`; the UI then offers Refresh.
    pub fn page(&self, cursor: Option<&str>) -> Result<GalleryPage, String> {
        let mut state = self.lock()?;
        if state.closed {
            return Err("gallery.changed".to_string());
        }
        state.last_used = Instant::now();
        let now = Instant::now();
        let complete = self.scan.is_complete();
        if state.snapshot.is_none() || (complete && !state.snapshot_complete) {
            state.snapshot = Some(self.scan.snapshot(self.date_source));
            state.snapshot_complete = complete;
            state.cursors.clear();
        }
        let (offset, _) = match cursor {
            Some(cursor) => {
                state
                    .cursors
                    .resolve(cursor, &self.generation, self.date_source, now)?
            }
            None => (0, None),
        };
        let (_, partial, skipped_count, limit_reason) = self.scan.flags();
        let data = crate::gallery_pages::snapshot_page(
            state.snapshot.as_deref().unwrap_or(&[]),
            offset,
            MAX_GALLERY_PAGE_ROWS,
            MAX_GALLERY_PAGE_BYTES,
            crate::gallery_scan::ScanOutcome {
                complete: state.snapshot_complete,
                partial,
                skipped_count,
                limit_reason,
            },
        )?;
        Ok(build_page(
            &self.generation,
            data,
            self.date_source,
            &mut state.cursors,
            now,
        ))
    }

    /// Waits for the first page (or for the scan to finish / fail). A source
    /// that does not answer within the listing timeout returns what is known
    /// with `partial` and the `drive` reason instead of hanging the UI.
    pub fn wait_for_first_page(&self, timeout: Duration) -> Result<GalleryPage, String> {
        let started = Instant::now();
        let deadline = started + timeout;
        loop {
            if self.token.load(Ordering::Relaxed) {
                return Err("gallery.changed".to_string());
            }
            if let Some(error) = self.scan.start_error() {
                return Err(error);
            }
            let found = self.scan.count();
            if found >= MAX_GALLERY_PAGE_ROWS
                || self.scan.is_complete()
                || (found > 0 && started.elapsed() >= FIRST_PAGE_GRACE)
            {
                return self.page(None);
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                let mut page = self.page(None)?;
                page.partial = true;
                if page.limit_reason.is_none() {
                    page.limit_reason = Some("drive".to_string());
                }
                return Ok(page);
            }
            self.scan
                .wait_changed(remaining.min(Duration::from_millis(50)));
        }
    }

    pub fn set_start_error(&self, code: String) {
        self.scan.set_start_error(code);
    }

    /// Stops the scan, drops its cursors and releases the source watchers.
    pub fn close(&self) {
        self.token.store(true, Ordering::Relaxed);
        let watcher = self.state.lock().ok().and_then(|mut state| {
            state.closed = true;
            state.cursors.clear();
            state.snapshot = None;
            state.watchers.take()
        });
        drop(watcher);
    }
}

/// The managed, bounded scan map (export E4).
#[derive(Default, Clone)]
pub struct GallerySessions {
    sessions: Arc<Mutex<HashMap<String, Arc<GallerySession>>>>,
}

impl GallerySessions {
    fn lock(&self) -> Result<MutexGuard<'_, HashMap<String, Arc<GallerySession>>>, String> {
        self.sessions
            .lock()
            .map_err(|_| "gallery.unavailable".to_string())
    }

    /// Adds a scan, cancelling the least-recently used one when full.
    pub fn admit(
        &self,
        generation: &str,
        date_source: GalleryDateSource,
        sources: Vec<GallerySource>,
        token: CancellationToken,
        app: AppHandle,
    ) -> Result<Arc<GallerySession>, String> {
        self.admit_inner(generation, date_source, sources, token, Some(app))
    }

    fn admit_inner(
        &self,
        generation: &str,
        date_source: GalleryDateSource,
        sources: Vec<GallerySource>,
        token: CancellationToken,
        app: Option<AppHandle>,
    ) -> Result<Arc<GallerySession>, String> {
        let session = Arc::new(GallerySession::new(
            generation.to_string(),
            date_source,
            sources,
            token,
            app,
        ));
        let mut sessions = self.lock()?;
        let previous = if sessions.len() >= MAX_GALLERY_SESSIONS {
            let oldest = sessions
                .iter()
                .filter(|(_, session)| !session.is_active())
                .min_by_key(|(_, session)| session.last_used())
                .map(|(id, _)| id.clone());
            let Some(oldest) = oldest else {
                drop(sessions);
                session.close();
                return Err("gallery.unavailable".into());
            };
            sessions.remove(&oldest)
        } else {
            None
        };
        sessions.insert(generation.to_string(), session.clone());
        drop(sessions);
        if let Some(previous) = previous {
            previous.close();
        }
        Ok(session)
    }

    pub fn get(&self, generation: &str) -> Result<Option<Arc<GallerySession>>, String> {
        Ok(self.lock()?.get(generation).cloned())
    }

    pub fn set_active(&self, generation: &str, active: bool) -> Result<(), String> {
        if let Some(session) = self.get(generation)? {
            session.set_active(active);
        }
        Ok(())
    }

    /// Idempotent: an unknown generation is not an error.
    pub fn close(&self, generation: &str) -> Result<(), String> {
        let removed = self.lock()?.remove(generation);
        if let Some(session) = removed {
            session.close();
        }
        Ok(())
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.sessions
            .lock()
            .map(|sessions| sessions.len())
            .unwrap_or(0)
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    #[cfg(test)]
    fn admit_detached(
        &self,
        generation: &str,
        date_source: GalleryDateSource,
        sources: Vec<GallerySource>,
        token: CancellationToken,
    ) -> Result<Arc<GallerySession>, String> {
        self.admit_inner(generation, date_source, sources, token, None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fs_service::new_cancellation_token;

    fn source(index: u32) -> GallerySource {
        GallerySource {
            id: format!("00000000-0000-4000-8000-{index:012}"),
            path: format!("C:\\Pictures\\set{index}"),
            recursive: true,
        }
    }

    #[test]
    fn at_most_four_scans_are_kept_and_the_oldest_is_closed() {
        let sessions = GallerySessions::default();
        let mut tokens = Vec::new();
        for index in 0..MAX_GALLERY_SESSIONS {
            let token = new_cancellation_token();
            tokens.push(token.clone());
            sessions
                .admit_detached(
                    &format!("scan-{index}"),
                    GalleryDateSource::Taken,
                    vec![source(index as u32)],
                    token,
                )
                .unwrap();
        }
        assert_eq!(sessions.len(), MAX_GALLERY_SESSIONS);
        assert!(!sessions.is_empty());
        sessions.get("scan-0").unwrap().unwrap().set_active(false);
        let extra = new_cancellation_token();
        sessions
            .admit_detached(
                "scan-extra",
                GalleryDateSource::Taken,
                vec![source(9)],
                extra,
            )
            .unwrap();
        assert_eq!(sessions.len(), MAX_GALLERY_SESSIONS);
        assert!(tokens[0].load(Ordering::Relaxed));
        assert!(sessions.get("scan-0").unwrap().is_none());
        assert!(sessions.get("scan-extra").unwrap().is_some());
    }

    #[test]
    fn closing_is_idempotent_and_stops_the_token() {
        let sessions = GallerySessions::default();
        let token = new_cancellation_token();
        sessions
            .admit_detached(
                "scan-a",
                GalleryDateSource::Modified,
                vec![source(1)],
                token.clone(),
            )
            .unwrap();
        sessions.close("scan-a").unwrap();
        sessions.close("scan-a").unwrap();
        assert!(token.load(Ordering::Relaxed));
        assert!(sessions.get("scan-a").unwrap().is_none());
    }

    #[test]
    fn page_errors_when_the_scan_is_closed() {
        let sessions = GallerySessions::default();
        let token = new_cancellation_token();
        let session = sessions
            .admit_detached("scan-a", GalleryDateSource::Taken, vec![source(1)], token)
            .unwrap();
        session.close();
        assert_eq!(session.page(None).unwrap_err(), "gallery.changed");
    }
}
