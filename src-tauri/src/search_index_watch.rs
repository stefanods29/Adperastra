//! Incremental index updates from the OS watcher (Step 11a T3). One notify
//! watcher per root feeds the crate's `WatchRouter`: events are coalesced for
//! 100 ms, capped at 1024 per batch, and routed to the subscription that owns
//! the root. A rename is identity-checked; an unpaired rename, a full queue
//! or a notify overflow becomes a bounded rescan of that one root, while
//! other notify errors are routed with their code and change nothing. The
//! shared store slot is only borrowed to take the connection, never held
//! while a root is scanned.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use fs_service::CancellationToken;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use search_index::content_extractors::{default_registry, ContentExtractorRegistry};
use search_index::index_watch::{
    from_notify, from_notify_error, WatchAction, WatchEvent, WatchKind, WatchRouter,
    WatchSubscription,
};
use search_index::limits::path_is_under;
use search_index::scan::{scan_one, scan_root, ScanOptions};
use search_index::store::SearchStore;
use search_index::types::{IndexRoot, SearchSettings};

const BATCH_EVENTS: usize = 1024;
const BATCH_MS: u64 = 100;
const QUEUE_EVENTS: usize = 1024;

pub struct WatchHandle {
    watchers: Vec<RecommendedWatcher>,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl WatchHandle {
    /// Stop delivering events, close the watcher channels and join the
    /// worker. Scans observe the same token, so the join stays bounded even
    /// when a batch was in progress.
    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        self.watchers.clear();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// Everything the worker needs besides the routed events. The store slot is
/// shared with the commands; the watcher only holds the connection for the
/// duration of one batch.
struct WatchContext {
    roots: Vec<IndexRoot>,
    settings: SearchSettings,
    store: Arc<Mutex<Option<SearchStore>>>,
    profile_dir: PathBuf,
    limit_bytes: u64,
}

pub fn start(
    roots: Vec<IndexRoot>,
    settings: SearchSettings,
    store: Arc<Mutex<Option<SearchStore>>>,
    profile_dir: PathBuf,
    limit_bytes: u64,
) -> Result<WatchHandle, String> {
    let (sender, receiver) = std::sync::mpsc::sync_channel::<WatchEvent>(QUEUE_EVENTS);
    let mut router = WatchRouter::new();
    let mut watchers = Vec::with_capacity(roots.len());
    let mut overflow = Vec::with_capacity(roots.len());
    let mut subscriptions = Vec::with_capacity(roots.len());
    let mut generations = Vec::with_capacity(roots.len());
    for root in &roots {
        // One subscription per root: a notify error or a full queue is
        // bounded to this root instead of rescanning every configured root.
        let subscription = router.subscribe(&root.id, Path::new(&root.path));
        let flag = Arc::new(AtomicBool::new(false));
        let generation = Arc::new(AtomicU64::new(router.generation()));
        let callback_sender = sender.clone();
        let callback_subscription = subscription.clone();
        let callback_flag = flag.clone();
        let callback_generation = generation.clone();
        let mut watcher =
            notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
                let mut event = match result {
                    Ok(event) => match from_notify(&event, &callback_subscription) {
                        Some(event) => event,
                        None => return,
                    },
                    Err(error) => from_notify_error(&error, &callback_subscription),
                };
                // The worker rotates the generation after an overflow; a
                // callback always stamps the live one, so later events are
                // not mistaken for stale ones.
                event.generation = callback_generation.load(Ordering::SeqCst);
                if callback_sender.try_send(event).is_err() {
                    // The bounded queue is full. One flag per root turns the
                    // backlog into one rescan of that root.
                    callback_flag.store(true, Ordering::SeqCst);
                }
            })
            .map_err(|_| "search.unavailable".to_string())?;
        watcher
            .watch(Path::new(&root.path), RecursiveMode::Recursive)
            .map_err(|_| "search.unavailable".to_string())?;
        watchers.push(watcher);
        overflow.push(flag);
        subscriptions.push(subscription);
        generations.push(generation);
    }
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = stop.clone();
    let context = WatchContext {
        roots,
        settings,
        store,
        profile_dir,
        limit_bytes,
    };
    let thread = std::thread::spawn(move || {
        run(
            receiver,
            router,
            subscriptions,
            overflow,
            generations,
            context,
            thread_stop,
        );
    });
    Ok(WatchHandle {
        watchers,
        stop,
        thread: Some(thread),
    })
}

fn run(
    receiver: Receiver<WatchEvent>,
    mut router: WatchRouter,
    subscriptions: Vec<WatchSubscription>,
    overflow: Vec<Arc<AtomicBool>>,
    generations: Vec<Arc<AtomicU64>>,
    context: WatchContext,
    stop: CancellationToken,
) {
    let mut pending: Vec<WatchEvent> = Vec::new();
    let mut overflows: Vec<WatchSubscription> = Vec::new();
    let mut last = Instant::now();
    loop {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        match receiver.recv_timeout(Duration::from_millis(25)) {
            Ok(event) => pending.push(event),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        for (subscription, flag) in subscriptions.iter().zip(&overflow) {
            if flag.swap(false, Ordering::SeqCst)
                && !overflows.iter().any(|queued| queued.root_id == subscription.root_id)
            {
                overflows.push(subscription.clone());
            }
        }
        // Bounded backlog: more than one batch collapses into one rescan per
        // root. Events queued before the rotation are then stale and ignored
        // by the router.
        if pending.len() > BATCH_EVENTS {
            pending.clear();
            let missing: Vec<_> = subscriptions
                .iter()
                .filter(|subscription| {
                    !overflows
                        .iter()
                        .any(|queued| queued.root_id == subscription.root_id)
                })
                .cloned()
                .collect();
            overflows.extend(missing);
        }
        let due = pending.len() >= BATCH_EVENTS
            || !overflows.is_empty()
            || (!pending.is_empty() && last.elapsed() >= Duration::from_millis(BATCH_MS));
        if !due {
            continue;
        }
        let Some(mut index) =
            try_take_index(&context.store, &context.profile_dir, context.limit_bytes)
        else {
            // A command or a rebuild currently owns the slot. Keep the batch
            // queued and retry without blocking on the mutex.
            std::thread::sleep(Duration::from_millis(25));
            continue;
        };
        process_batch(
            &pending,
            &overflows,
            &generations,
            &mut router,
            &context,
            &mut index,
            &stop,
        );
        return_index(&context.store, index);
        pending.clear();
        overflows.clear();
        last = Instant::now();
    }
}

/// Borrow the index connection without holding the slot lock during scans.
/// Commands that arrive meanwhile open their own short-lived connection, so
/// a long batch never delays search, status or pause.
fn try_take_index(
    store: &Arc<Mutex<Option<SearchStore>>>,
    profile_dir: &Path,
    limit_bytes: u64,
) -> Option<SearchStore> {
    let mut guard = store.try_lock().ok()?;
    let stale = guard
        .as_ref()
        .is_some_and(|existing| existing.limit_bytes() != limit_bytes);
    if stale {
        *guard = None;
    }
    if guard.is_none() {
        let path = profile_dir.join("search").join("index.sqlite3");
        *guard = Some(SearchStore::open(&path, limit_bytes).ok()?);
    }
    guard.take()
}

fn return_index(store: &Arc<Mutex<Option<SearchStore>>>, index: SearchStore) {
    // Never block the worker (and therefore `stop`) behind a command that
    // holds the slot; the batch is already committed on disk.
    if let Ok(mut guard) = store.try_lock() {
        if guard.is_none() {
            *guard = Some(index);
        }
        // Otherwise a command opened a connection while the batch ran; keep
        // that one and let this handle close.
    }
}

fn overflow_event(subscription: &WatchSubscription, generation: u64) -> WatchEvent {
    WatchEvent {
        subscription_id: subscription.subscription_id.clone(),
        root_id: subscription.root_id.clone(),
        root: subscription.root.clone(),
        generation,
        kind: WatchKind::Overflow,
        path: None,
        old_path: None,
        error_code: Some("overflow".to_string()),
    }
}

fn process_batch(
    events: &[WatchEvent],
    overflows: &[WatchSubscription],
    generations: &[Arc<AtomicU64>],
    router: &mut WatchRouter,
    context: &WatchContext,
    index: &mut SearchStore,
    stop: &CancellationToken,
) {
    let options = ScanOptions {
        content_max_chars: context.settings.content_max_chars,
        excluded_paths: context.settings.excluded_paths.clone(),
        denied_roots: Vec::new(),
        ocr_allowed: true,
    };
    let registry = default_registry();
    for event in events {
        if stop.load(Ordering::Relaxed) {
            return;
        }
        match router.route(event) {
            WatchAction::Upsert { root_id, path } => {
                let Some(root) = root_for(&context.roots, &root_id) else {
                    continue;
                };
                if std::fs::metadata(&path)
                    .map(|meta| meta.is_dir())
                    .unwrap_or(false)
                {
                    rescan_root(index, root, &options, &registry, stop);
                } else {
                    let _ = scan_one(index, root, &path, &options, &registry, stop);
                }
            }
            WatchAction::Remove { root_id, path } => {
                let _ = index.remove_prefix(&root_id, &path.to_string_lossy());
            }
            WatchAction::Rename {
                root_id,
                old_path,
                new_path,
            } => {
                let Some(root) = root_for(&context.roots, &root_id) else {
                    continue;
                };
                let new_inside = path_is_under(&new_path.to_string_lossy(), &root.path);
                let renamed = new_inside
                    && fs_service::source_stamp::capture_file_identity(&new_path)
                        .ok()
                        .zip(fs_service::source_stamp::capture_source_stamp(&new_path).ok())
                        .is_some_and(|(identity, stamp)| {
                            index
                                .rename_path(
                                    &root.id,
                                    &old_path.to_string_lossy(),
                                    &new_path.to_string_lossy(),
                                    &identity,
                                    &stamp,
                                )
                                .is_ok()
                        });
                if !renamed {
                    if std::fs::metadata(&new_path)
                        .map(|meta| meta.is_dir())
                        .unwrap_or(false)
                    {
                        // A directory move cannot be represented by the
                        // file-row rename path; rebuild the moved subtree.
                        let _ = index.remove_prefix(&root.id, &old_path.to_string_lossy());
                        rescan_root(index, root, &options, &registry, stop);
                    } else {
                        let _ = index.remove_path(&root.id, &old_path.to_string_lossy());
                        if new_inside {
                            let _ = scan_one(index, root, &new_path, &options, &registry, stop);
                        }
                    }
                }
            }
            WatchAction::Rescan { root_id, .. } => {
                let Some(root) = root_for(&context.roots, &root_id) else {
                    continue;
                };
                rescan_root(index, root, &options, &registry, stop);
            }
            WatchAction::Ignore => {}
        }
        // An overflow may have rotated the generation; publish it at once so
        // events arriving during the rescan are not stamped as stale.
        refresh_generations(router, generations);
    }
    // Overflow last: queued events that are older than the overflow are
    // applied first, then the bounded rescan replaces them. The router
    // rotates its generation here, so only the queue behind it goes stale.
    for subscription in overflows {
        if stop.load(Ordering::Relaxed) {
            return;
        }
        let event = overflow_event(subscription, router.generation());
        let action = router.route(&event);
        refresh_generations(router, generations);
        if let WatchAction::Rescan { root_id, .. } = action {
            let Some(root) = root_for(&context.roots, &root_id) else {
                continue;
            };
            rescan_root(index, root, &options, &registry, stop);
        }
    }
}

fn refresh_generations(router: &WatchRouter, generations: &[Arc<AtomicU64>]) {
    let current = router.generation();
    for generation in generations {
        generation.store(current, Ordering::SeqCst);
    }
}

fn root_for<'a>(roots: &'a [IndexRoot], root_id: &str) -> Option<&'a IndexRoot> {
    roots.iter().find(|root| root.id == root_id)
}

fn rescan_root(
    index: &mut SearchStore,
    root: &IndexRoot,
    options: &ScanOptions,
    registry: &ContentExtractorRegistry,
    cancel: &CancellationToken,
) {
    let mut progress = |_done: u64| {};
    let _ = scan_root(index, root, options, registry, cancel, &mut progress);
}

#[cfg(test)]
mod tests {
    use super::{
        overflow_event, refresh_generations, return_index, try_take_index,
    };
    use search_index::index_watch::{WatchAction, WatchEvent, WatchKind, WatchRouter};
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};

    #[test]
    fn an_overflow_rescans_only_its_own_root() {
        let mut router = WatchRouter::new();
        let one = router.subscribe("one", Path::new(r"C:\One"));
        let _two = router.subscribe("two", Path::new(r"C:\Two"));
        let generation = router.generation();
        match router.route(&overflow_event(&one, generation)) {
            WatchAction::Rescan { root_id, root } => {
                assert_eq!(root_id, "one");
                assert_eq!(root, PathBuf::from(r"C:\One"));
            }
            other => panic!("unexpected action {other:?}"),
        }
        assert!(router.generation() > generation);
    }

    #[test]
    fn events_after_an_overflow_use_the_new_generation() {
        let mut router = WatchRouter::new();
        let one = router.subscribe("one", Path::new(r"C:\One"));
        let live = Arc::new(AtomicU64::new(router.generation()));
        let overflow = overflow_event(&one, live.load(Ordering::SeqCst));
        assert!(matches!(
            router.route(&overflow),
            WatchAction::Rescan { .. }
        ));
        refresh_generations(&router, std::slice::from_ref(&live));
        let event = WatchEvent {
            subscription_id: one.subscription_id.clone(),
            root_id: one.root_id.clone(),
            root: one.root.clone(),
            generation: live.load(Ordering::SeqCst),
            kind: WatchKind::Change,
            path: Some(PathBuf::from(r"C:\One\a.txt")),
            old_path: None,
            error_code: None,
        };
        assert!(matches!(router.route(&event), WatchAction::Upsert { .. }));
    }

    #[test]
    fn a_batch_does_not_hold_the_store_slot_while_it_scans() {
        let directory = tempfile::tempdir().unwrap();
        let slot = Arc::new(Mutex::new(None));
        let index =
            try_take_index(&slot, directory.path(), 64 * 1024 * 1024).expect("index opens");
        assert!(
            slot.try_lock().is_ok(),
            "the slot must stay usable during a batch"
        );
        assert!(slot.lock().unwrap().is_none());
        return_index(&slot, index);
        assert!(slot.lock().unwrap().is_some());
    }
}


