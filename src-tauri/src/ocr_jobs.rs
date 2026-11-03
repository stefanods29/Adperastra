#![allow(dead_code)] // Public producer API; consumed from later steps.
//! Bounded retained OCR pages and the completion gate (Step 07e plan D5).
//!
//! A recognition result is kept under its `consumer_id` so `ocr_page` can
//! return bounded chunks. At most 16 pages and 64 consumers are retained;
//! a page nobody touched for 30 minutes is dropped. `ocr_release` is
//! idempotent and frees the page immediately.
//!
//! `complete_recognition` is the only path that publishes a cache entry:
//! a failed or cancelled recognition never reaches the store, and a source
//! that changed after decoding is rejected instead of being published.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::ocr_types::{
    page_chunk, validate_ocr_page, OcrPage, ERR_BAD_REQUEST, ERR_CANCELLED, ERR_CHANGED,
    ERR_FAILED, ERR_TOO_LARGE, MAX_OCR_CONSUMERS, MAX_OCR_RETAINED, OCR_RETAIN_SECONDS,
};

/// Largest rendered page PNG accepted from 07d (plan D5).
pub const MAX_RENDERED_PAGE_BYTES: u64 = 8 * 1024 * 1024;

struct Retained {
    page: OcrPage,
    touched: Instant,
}

#[derive(Default)]
struct RetainedState {
    pages: HashMap<String, Retained>,
    /// Oldest first.
    order: Vec<String>,
}

/// The retained results of one app run (managed inside `OcrService`).
#[derive(Default)]
pub struct RetainedPages {
    state: std::sync::Mutex<RetainedState>,
}

impl RetainedPages {
    pub fn len(&self) -> usize {
        self.state
            .lock()
            .map(|state| state.pages.len())
            .unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Keep one result. The oldest page makes room; a repeated consumer
    /// replaces its old page.
    pub fn insert(&self, consumer_id: &str, page: OcrPage) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "ocr lock poisoned".to_string())?;
        prune_locked(&mut state, Instant::now());
        if state.pages.len() >= MAX_OCR_CONSUMERS && !state.pages.contains_key(consumer_id) {
            return Err(ERR_BAD_REQUEST.to_string());
        }
        state.pages.remove(consumer_id);
        state.order.retain(|id| id != consumer_id);
        while state.order.len() >= MAX_OCR_RETAINED {
            let oldest = state.order.remove(0);
            state.pages.remove(&oldest);
        }
        state.order.push(consumer_id.to_string());
        state.pages.insert(
            consumer_id.to_string(),
            Retained {
                page,
                touched: Instant::now(),
            },
        );
        Ok(())
    }

    /// One bounded chunk of a retained page.
    pub fn page(&self, consumer_id: &str, after_word: Option<u32>) -> Result<OcrPage, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "ocr lock poisoned".to_string())?;
        let now = Instant::now();
        let Some(was_touched) = state
            .pages
            .get(consumer_id)
            .map(|retained| retained.touched)
        else {
            return Err(ERR_BAD_REQUEST.to_string());
        };
        if expired(was_touched, now) {
            state.pages.remove(consumer_id);
            state.order.retain(|id| id != consumer_id);
            return Err(ERR_BAD_REQUEST.to_string());
        }
        let Some(retained) = state.pages.get_mut(consumer_id) else {
            return Err(ERR_BAD_REQUEST.to_string());
        };
        retained.touched = now;
        page_chunk(&retained.page, after_word)
    }

    /// Idempotent: an unknown consumer changes nothing.
    pub fn release(&self, consumer_id: &str) {
        if let Ok(mut state) = self.state.lock() {
            state.pages.remove(consumer_id);
            state.order.retain(|id| id != consumer_id);
        }
    }

    /// Drop pages whose last use is older than the retention window.
    pub fn prune(&self) {
        if let Ok(mut state) = self.state.lock() {
            prune_locked(&mut state, Instant::now());
        }
    }
}

fn prune_locked(state: &mut RetainedState, now: Instant) {
    let expired_ids: Vec<String> = state
        .pages
        .iter()
        .filter(|(_, retained)| expired(retained.touched, now))
        .map(|(id, _)| id.clone())
        .collect();
    for id in expired_ids {
        state.pages.remove(&id);
        state.order.retain(|entry| entry != &id);
    }
}

/// True once a page has not been touched for the retention window.
pub fn expired(touched: Instant, now: Instant) -> bool {
    now.saturating_duration_since(touched) >= Duration::from_secs(OCR_RETAIN_SECONDS)
}

/// Finish a recognition: validate it, reject a changed source, publish the
/// cache entry if possible. Cache errors are ignored (the cache is an
/// optimization); source changes are not.
pub fn complete_recognition(
    outcome: Result<OcrPage, String>,
    revalidate: impl FnOnce() -> Result<(), String>,
    publish: impl FnOnce(&OcrPage) -> Result<(), String>,
) -> Result<OcrPage, String> {
    let page = outcome?;
    validate_ocr_page(&page)?;
    revalidate()?;
    let _ = publish(&page);
    Ok(page)
}

/// Releases a lease exactly once, including on every early return while a
/// rendered PDF page is being decoded or recognised.
pub struct LeaseRelease<F: FnMut(&str)> {
    lease_id: Option<String>,
    release: F,
}

impl<F: FnMut(&str)> LeaseRelease<F> {
    pub fn new(lease_id: String, release: F) -> Self {
        Self {
            lease_id: Some(lease_id),
            release,
        }
    }

    /// Release now; the later `Drop` becomes a no-op.
    pub fn release_now(&mut self) {
        if let Some(lease_id) = self.lease_id.take() {
            (self.release)(&lease_id);
        }
    }
}

impl<F: FnMut(&str)> Drop for LeaseRelease<F> {
    fn drop(&mut self) {
        self.release_now();
    }
}

/// Only one OCR helper may run at once (plan D6).
pub(crate) struct BusyGuard<'a> {
    busy: &'a std::sync::atomic::AtomicBool,
}

impl<'a> BusyGuard<'a> {
    pub(crate) fn enter(busy: &'a std::sync::atomic::AtomicBool) -> Result<Self, String> {
        use std::sync::atomic::Ordering;
        busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| ERR_FAILED.to_string())?;
        Ok(Self { busy })
    }
}

impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        use std::sync::atomic::Ordering;
        self.busy.store(false, Ordering::Release);
    }
}

/// Read the bounded PNG behind a 07d page lease. The lease itself is
/// released by the caller's `LeaseRelease` guard.
pub(crate) fn read_lease_bytes(
    grants: &crate::files::FileGrants,
    lease: &cache_store::CacheLease,
) -> Result<zeroize::Zeroizing<Vec<u8>>, String> {
    let backing = grants
        .resolve_backing(&lease.token)
        .ok_or_else(|| ERR_CHANGED.to_string())?;
    if lease.byte_len == 0 || lease.byte_len > MAX_RENDERED_PAGE_BYTES {
        return Err(ERR_TOO_LARGE.to_string());
    }
    if !backing.is_consistent() || backing.length() != lease.byte_len {
        return Err(ERR_CHANGED.to_string());
    }
    let length = usize::try_from(lease.byte_len).map_err(|_| ERR_TOO_LARGE.to_string())?;
    let bytes = backing
        .read_range(0, length)
        .map_err(|_| ERR_CHANGED.to_string())?;
    if bytes.len() != length {
        return Err(ERR_CHANGED.to_string());
    }
    Ok(zeroize::Zeroizing::new(bytes))
}

/// True when automatic (background) OCR may read a page right now. Only a
/// visible page uses this; user Copy/Search always starts a foreground job.
pub fn background_eligible(app: &tauri::AppHandle) -> bool {
    use tauri::Manager;
    let enabled = app
        .state::<crate::AppState>()
        .settings
        .lock()
        .map(|settings| settings.ocr.enabled)
        .unwrap_or(false);
    if !enabled {
        return false;
    }
    let Some(policy) = app.try_state::<std::sync::Arc<crate::background::BackgroundPolicy>>()
    else {
        return false;
    };
    policy.eligible_now(crate::background::BackgroundTaskKind::Ocr)
}

/// Run one helper process. `body` is the bounded memory image for a PDF
/// page; the file mode sends no body.
pub(crate) fn run_helper(
    request: &crate::ocr_helper::OcrHelperRequest,
    body: Option<&[u8]>,
    token: &fs_service::CancellationToken,
    idle: std::time::Duration,
) -> Result<crate::ocr_helper::OcrHelperReply, String> {
    use crate::helper::{drive, DriveEnd, DriveTimings, HelperProcess};
    use crate::ocr_types::{OCR_CANCEL_GRACE_MS, OCR_HELPER_MEMORY_LIMIT};
    use std::sync::atomic::Ordering;
    let mut helper = HelperProcess::spawn(crate::ocr_helper::HELPER_FLAG, OCR_HELPER_MEMORY_LIMIT)?;
    let line = serde_json::to_string(request).map_err(|_| ERR_BAD_REQUEST.to_string())?;
    helper.send_line(&line)?;
    if let Some(body) = body {
        helper.write_all(body)?;
    }
    let timings = DriveTimings {
        tick: std::time::Duration::from_millis(25),
        idle,
        grace: std::time::Duration::from_millis(OCR_CANCEL_GRACE_MS),
    };
    let mut reply: Option<crate::ocr_helper::OcrHelperReply> = None;
    let end = drive(&mut helper, token, timings, &mut |line| {
        let parsed: crate::ocr_helper::OcrHelperReply =
            serde_json::from_str(line).map_err(|_| ERR_FAILED.to_string())?;
        if parsed.status == "error" {
            return Err(parsed.error.unwrap_or_else(|| ERR_FAILED.to_string()));
        }
        reply = Some(parsed);
        Ok(true)
    })?;
    if end == DriveEnd::Cancelled || token.load(Ordering::Relaxed) {
        return Err(ERR_CANCELLED.to_string());
    }
    reply.ok_or_else(|| ERR_FAILED.to_string())
}

#[cfg(test)]
mod tests {
    use super::{complete_recognition, expired, LeaseRelease, RetainedPages};
    use crate::ocr_types::{OcrPage, OcrWord, ERR_CANCELLED, ERR_CHANGED, OCR_RETAIN_SECONDS};
    use crate::pdf_types::PdfSourceIdentity;
    use std::cell::RefCell;
    use std::time::{Duration, Instant};

    fn page() -> OcrPage {
        OcrPage {
            source: PdfSourceIdentity::Disk {
                stamp: crate::ocr_step07e_tests::test_stamp(),
            },
            page: 1,
            language: "en-US".to_string(),
            original_width: 10,
            original_height: 10,
            recognized_width: 10,
            recognized_height: 10,
            words: vec![OcrWord {
                text: "Hello".to_string(),
                x: 0.0,
                y: 0.0,
                width: 5.0,
                height: 5.0,
                line: 0,
                order: 0,
            }],
            text: "Hello".to_string(),
            partial: false,
            next_word: None,
            rotation: 0,
            text_angle: None,
        }
    }

    #[test]
    fn retained_pages_are_bounded_and_released() {
        let retained = RetainedPages::default();
        for index in 0..20 {
            retained
                .insert(&format!("consumer-{index}"), page())
                .unwrap();
        }
        assert_eq!(retained.len(), 16);
        assert!(retained.page("consumer-0", None).is_err());
        assert_eq!(retained.page("consumer-19", None).unwrap().text, "Hello");
        retained.release("consumer-19");
        retained.release("consumer-19");
        assert!(retained.page("consumer-19", None).is_err());
    }

    #[test]
    fn a_timed_out_recognition_never_publishes() {
        let mut revalidated = 0;
        let mut published = 0;
        let outcome = complete_recognition(
            Err(ERR_CANCELLED.to_string()),
            || {
                revalidated += 1;
                Ok(())
            },
            |_| {
                published += 1;
                Ok(())
            },
        );
        assert_eq!(outcome.err().as_deref(), Some(ERR_CANCELLED));
        assert_eq!((revalidated, published), (0, 0));
    }

    #[test]
    fn a_changed_source_is_not_published() {
        let mut published = 0;
        let outcome = complete_recognition(
            Ok(page()),
            || Err(ERR_CHANGED.to_string()),
            |_| {
                published += 1;
                Ok(())
            },
        );
        assert_eq!(outcome.err().as_deref(), Some(ERR_CHANGED));
        assert_eq!(published, 0);
    }

    #[test]
    fn a_failed_cache_publish_keeps_the_page() {
        let outcome = complete_recognition(
            Ok(page()),
            || Ok(()),
            |_| Err("cache.unavailable".to_string()),
        );
        assert_eq!(outcome.unwrap().text, "Hello");
    }

    #[test]
    fn a_lease_is_released_exactly_once() {
        let released = RefCell::new(Vec::new());
        {
            let _guard = LeaseRelease::new("lease-1".to_string(), |id| {
                released.borrow_mut().push(id.to_string());
            });
        }
        assert_eq!(released.borrow().as_slice(), ["lease-1"]);
        let mut guard = LeaseRelease::new("lease-2".to_string(), |id| {
            released.borrow_mut().push(id.to_string());
        });
        guard.release_now();
        drop(guard);
        assert_eq!(released.borrow().as_slice(), ["lease-1", "lease-2"]);
    }

    #[test]
    fn retention_expires_after_the_window() {
        let now = Instant::now();
        assert!(!expired(now - Duration::from_secs(60), now));
        assert!(expired(
            now - Duration::from_secs(OCR_RETAIN_SECONDS + 1),
            now
        ));
    }
}
