//! Multiplexed directory watchers (Step 09a E8).
//!
//! One native watcher per root, shared by reference count; every consumer
//! gets its own routing subscription id and generation. At most 128
//! subscriptions; events batch to at most 1,024 per 100 ms and 768 KiB,
//! and an overflow asks the consumer for a bounded rescan instead of
//! streaming without limit. The legacy single watcher keeps its own
//! subscription and is never stopped by a folder tab.
//!
//! Events only carry paths and a stable code: nothing here opens a file,
//! reads its content or hydrates an online-only placeholder.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use notify::event::{ModifyKind, RenameMode};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, WebviewWindow};
use uuid::Uuid;

/// Most live subscriptions.
pub const MAX_WATCH_SUBSCRIPTIONS: usize = 128;
/// Most events in one batch.
pub const MAX_WATCH_BATCH_EVENTS: usize = 1024;
/// Largest serialized batch.
pub const MAX_WATCH_BATCH_BYTES: usize = 768 * 1024;
/// Longest accepted root, in UTF-16 units (Step 09a D1).
pub const MAX_WATCH_ROOT_UNITS: usize = 32_768;

const FLUSH_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WatchOptions {
    #[serde(default)]
    pub recursive: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WatchSubscription {
    pub subscription_id: Uuid,
    pub root: String,
    pub generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FsWatchEvent {
    pub subscription_id: Uuid,
    pub root: String,
    pub generation: u64,
    /// `create`, `change`, `remove`, `rename`, `overflow` or `error`.
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Only when the watcher paired the old path; never assumed present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

/// One consumer's delivery callback. The Tauri command emits `fs-watch`;
/// tests collect events in memory.
pub type FsWatchEmitter = Arc<dyn Fn(FsWatchEvent) + Send + Sync + 'static>;

struct Consumer {
    emitter: FsWatchEmitter,
}

struct RootWatch {
    generation: u64,
    consumers: Arc<Mutex<HashMap<Uuid, Consumer>>>,
    driver: Option<RootDriver>,
}

/// Stops the OS watcher and joins its worker. Dropping the watcher closes
/// the event channel, so the worker also exits without the stop flag.
struct RootDriver {
    watcher: Option<RecommendedWatcher>,
    worker: Option<JoinHandle<()>>,
    stop: Arc<AtomicBool>,
}

impl Drop for RootDriver {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = self.watcher.take();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

/// Managed watcher sessions (one OS watcher per normalized root).
pub struct WatcherSessions {
    roots: Mutex<HashMap<String, RootWatch>>,
    by_subscription: Mutex<HashMap<Uuid, String>>,
    next_generation: AtomicU64,
    start_watchers: bool,
}

impl Default for WatcherSessions {
    fn default() -> Self {
        Self::new()
    }
}

fn root_key(path: &Path, recursive: bool) -> String {
    let mut text = path.to_string_lossy().replace('/', "\\");
    if let Some(stripped) = text.strip_prefix("\\\\?\\") {
        text = stripped.to_string();
    }
    let mut text = text.to_lowercase();
    if text.len() > 3 && text.ends_with('\\') {
        text.pop();
    }
    format!("{}|{text}", if recursive { 'r' } else { 'n' })
}

impl WatcherSessions {
    /// Production sessions: every root gets a real notify watcher.
    pub fn new() -> Self {
        WatcherSessions {
            roots: Mutex::new(HashMap::new()),
            by_subscription: Mutex::new(HashMap::new()),
            next_generation: AtomicU64::new(0),
            start_watchers: true,
        }
    }

    /// Routing/refcount tests run without touching the file system.
    #[cfg(test)]
    fn routing_only() -> Self {
        WatcherSessions {
            roots: Mutex::new(HashMap::new()),
            by_subscription: Mutex::new(HashMap::new()),
            next_generation: AtomicU64::new(0),
            start_watchers: false,
        }
    }

    /// Subscribe one consumer to a root. The same normalized root shares
    /// one OS watcher and one stable generation; each consumer keeps its
    /// own routing id. Recursive and non-recursive requests for the same
    /// path are different roots, so neither silently widens the other.
    #[allow(dead_code)] // Test/library entry; the Tauri command uses subscribe_with.
    pub fn subscribe(
        &self,
        path: &Path,
        options: WatchOptions,
    ) -> Result<WatchSubscription, String> {
        self.subscribe_with(path, options, Arc::new(|_| {}))
    }

    pub fn subscribe_with(
        &self,
        path: &Path,
        options: WatchOptions,
        emitter: FsWatchEmitter,
    ) -> Result<WatchSubscription, String> {
        let root = path.to_string_lossy().into_owned();
        if !path.is_absolute() || root.encode_utf16().count() > MAX_WATCH_ROOT_UNITS {
            return Err("watch.invalid".to_string());
        }
        let key = root_key(path, options.recursive);
        let mut by_subscription = self
            .by_subscription
            .lock()
            .map_err(|_| "watch.failed".to_string())?;
        if by_subscription.len() >= MAX_WATCH_SUBSCRIPTIONS {
            return Err("watch.limit".to_string());
        }
        let mut roots = self.roots.lock().map_err(|_| "watch.failed".to_string())?;
        if !roots.contains_key(&key) {
            let generation = self.next_generation.fetch_add(1, Ordering::SeqCst) + 1;
            let consumers = Arc::new(Mutex::new(HashMap::new()));
            let driver = if self.start_watchers {
                Some(start_root(
                    path,
                    options.recursive,
                    root.clone(),
                    generation,
                    Arc::clone(&consumers),
                )?)
            } else {
                None
            };
            roots.insert(key.clone(), RootWatch { generation, consumers, driver });
        }
        let generation = roots
            .get(&key)
            .ok_or_else(|| "watch.failed".to_string())?
            .generation;
        let subscription_id = Uuid::new_v4();
        roots
            .get(&key)
            .ok_or_else(|| "watch.failed".to_string())?
            .consumers
            .lock()
            .map_err(|_| "watch.failed".to_string())?
            .insert(subscription_id, Consumer { emitter });
        by_subscription.insert(subscription_id, key);
        Ok(WatchSubscription {
            subscription_id,
            root,
            generation,
        })
    }

    /// Unsubscribe one consumer (idempotent). The shared root watcher
    /// stops and its worker joins only when its last consumer leaves.
    pub fn unsubscribe(&self, subscription_id: Uuid) -> bool {
        let Ok(mut by_subscription) = self.by_subscription.lock() else {
            return false;
        };
        let Some(key) = by_subscription.remove(&subscription_id) else {
            return false;
        };
        let driver = {
            let Ok(mut roots) = self.roots.lock() else {
                return true;
            };
            let empty = {
                let Some(root) = roots.get_mut(&key) else {
                    return true;
                };
                match root.consumers.lock() {
                    Ok(mut consumers) => {
                        consumers.remove(&subscription_id);
                        consumers.is_empty()
                    }
                    Err(_) => true,
                }
            };
            if empty {
                roots.remove(&key).and_then(|mut root| root.driver.take())
            } else {
                None
            }
        };
        drop(by_subscription);
        drop(driver);
        true
    }

    /// Live subscription count.
    #[allow(dead_code)] // Diagnostics for the folder-tab and watcher tests.
    pub fn len(&self) -> usize {
        self.by_subscription.lock().map(|map| map.len()).unwrap_or(0)
    }

    #[allow(dead_code)] // Diagnostics for the folder-tab and watcher tests.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Live shared roots (tests and diagnostics).
    #[allow(dead_code)] // Diagnostics for the folder-tab and watcher tests.
    pub fn root_count(&self) -> usize {
        self.roots.lock().map(|roots| roots.len()).unwrap_or(0)
    }

    /// Stop every watcher and join every worker (app shutdown).
    pub fn stop_all(&self) {
        let drivers = match self.roots.lock() {
            Ok(mut roots) => roots
                .drain()
                .filter_map(|(_, mut root)| root.driver.take())
                .collect::<Vec<_>>(),
            Err(_) => Vec::new(),
        };
        if let Ok(mut by_subscription) = self.by_subscription.lock() {
            by_subscription.clear();
        }
        for driver in drivers {
            drop(driver);
        }
    }

    /// Route one native event to its consumer. Events from a stale
    /// generation (the root was resubscribed) are dropped.
    #[allow(dead_code)] // Routing oracle for the stale-generation test.
    pub fn route(&self, event: &FsWatchEvent) -> bool {
        let Ok(by_subscription) = self.by_subscription.lock() else {
            return false;
        };
        let Some(key) = by_subscription.get(&event.subscription_id) else {
            return false;
        };
        let Ok(roots) = self.roots.lock() else {
            return false;
        };
        roots
            .get(key)
            .is_some_and(|root| root.generation == event.generation)
    }
}

impl Drop for WatcherSessions {
    fn drop(&mut self) {
        self.stop_all();
    }
}

fn start_root(
    path: &Path,
    recursive: bool,
    root: String,
    generation: u64,
    consumers: Arc<Mutex<HashMap<Uuid, Consumer>>>,
) -> Result<RootDriver, String> {
    let (sender, receiver) =
        std::sync::mpsc::sync_channel::<notify::Result<notify::Event>>(MAX_WATCH_BATCH_EVENTS);
    let overflow = Arc::new(AtomicBool::new(false));
    let callback_overflow = Arc::clone(&overflow);
    let mut watcher = notify::recommended_watcher(move |result| {
        if sender.try_send(result).is_err() {
            callback_overflow.store(true, Ordering::SeqCst);
        }
    })
    .map_err(|_| "watch.failed".to_string())?;
    let mode = if recursive {
        RecursiveMode::Recursive
    } else {
        RecursiveMode::NonRecursive
    };
    watcher
        .watch(path, mode)
        .map_err(|_| "watch.failed".to_string())?;
    let stop = Arc::new(AtomicBool::new(false));
    let worker_stop = Arc::clone(&stop);
    let worker = std::thread::Builder::new()
        .name("adperastra-fs-watch".to_string())
        .spawn(move || watch_worker(receiver, consumers, worker_stop, overflow, root, generation))
        .map_err(|_| "watch.failed".to_string())?;
    Ok(RootDriver {
        watcher: Some(watcher),
        worker: Some(worker),
        stop,
    })
}

fn watch_worker(
    receiver: Receiver<notify::Result<notify::Event>>,
    consumers: Arc<Mutex<HashMap<Uuid, Consumer>>>,
    stop: Arc<AtomicBool>,
    overflow: Arc<AtomicBool>,
    root: String,
    generation: u64,
) {
    let mut pending: Vec<MappedEvent> = Vec::new();
    let mut pending_bytes = 0usize;
    let mut last_flush = Instant::now();
    loop {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        match receiver.recv_timeout(FLUSH_INTERVAL) {
            Ok(Ok(event)) => {
                for mapped in map_notify_event(event) {
                    pending_bytes += mapped.weight();
                    pending.push(mapped);
                }
            }
            Ok(Err(_)) => emit_single(&consumers, &root, generation, "error", Some("watch.failed")),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        if overflow.swap(false, Ordering::SeqCst) {
            pending.clear();
            pending_bytes = 0;
            // The queue is full: drop its backlog too, so one `overflow`
            // marker really bounds this window instead of streaming 1,024
            // stale events afterwards. The consumer rescans instead.
            while receiver.try_recv().is_ok() {}
            emit_single(&consumers, &root, generation, "overflow", None);
            last_flush = Instant::now();
            continue;
        }
        let due = !pending.is_empty()
            && (pending.len() >= MAX_WATCH_BATCH_EVENTS
                || pending_bytes >= MAX_WATCH_BATCH_BYTES
                || last_flush.elapsed() >= FLUSH_INTERVAL);
        if due {
            flush_pending(&consumers, &root, generation, &mut pending);
            pending_bytes = 0;
            last_flush = Instant::now();
        }
    }
}

fn consumer_snapshot(consumers: &Mutex<HashMap<Uuid, Consumer>>) -> Vec<(Uuid, FsWatchEmitter)> {
    match consumers.lock() {
        Ok(map) => map
            .iter()
            .map(|(id, consumer)| (*id, Arc::clone(&consumer.emitter)))
            .collect(),
        Err(_) => Vec::new(),
    }
}

fn flush_pending(
    consumers: &Mutex<HashMap<Uuid, Consumer>>,
    root: &str,
    generation: u64,
    pending: &mut Vec<MappedEvent>,
) {
    if pending.is_empty() {
        return;
    }
    let snapshot = consumer_snapshot(consumers);
    let mapped = std::mem::take(pending);
    if snapshot.is_empty() {
        return;
    }
    for (subscription_id, emitter) in snapshot {
        let events = mapped
            .iter()
            .map(|mapped| FsWatchEvent {
                subscription_id,
                root: root.to_string(),
                generation,
                kind: mapped.kind.to_string(),
                path: mapped.path.clone(),
                old_path: mapped.old_path.clone(),
                error_code: None,
            })
            .collect();
        for batch in batch_events(events) {
            for event in batch {
                emitter(event);
            }
        }
    }
}

fn emit_single(
    consumers: &Mutex<HashMap<Uuid, Consumer>>,
    root: &str,
    generation: u64,
    kind: &str,
    error_code: Option<&str>,
) {
    for (subscription_id, emitter) in consumer_snapshot(consumers) {
        emitter(FsWatchEvent {
            subscription_id,
            root: root.to_string(),
            generation,
            kind: kind.to_string(),
            path: None,
            old_path: None,
            error_code: error_code.map(str::to_string),
        });
    }
}

#[derive(Clone)]
struct MappedEvent {
    kind: &'static str,
    path: Option<String>,
    old_path: Option<String>,
}

impl MappedEvent {
    fn one(kind: &'static str, path: PathBuf) -> Self {
        MappedEvent {
            kind,
            path: Some(path.to_string_lossy().into_owned()),
            old_path: None,
        }
    }

    /// Conservative wire-size estimate used to bound pending events.
    fn weight(&self) -> usize {
        self.kind.len()
            + 128
            + self.path.as_ref().map_or(0, String::len)
            + self.old_path.as_ref().map_or(0, String::len)
    }
}

/// Map a notify event to the six public kinds. Access events are ignored
/// because they cannot change a listing; an unpaired rename keeps only the
/// path notify gave us.
fn map_notify_event(event: notify::Event) -> Vec<MappedEvent> {
    if event.need_rescan() {
        return vec![MappedEvent {
            kind: "overflow",
            path: None,
            old_path: None,
        }];
    }
    let mut mapped = Vec::new();
    match event.kind {
        EventKind::Access(_) => {}
        EventKind::Create(_) => {
            for path in event.paths {
                mapped.push(MappedEvent::one("create", path));
            }
        }
        EventKind::Remove(_) => {
            for path in event.paths {
                mapped.push(MappedEvent::one("remove", path));
            }
        }
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => {
            let mut paths = event.paths;
            if paths.len() >= 2 {
                let new_path = paths.pop().unwrap_or_default();
                let old_path = paths.pop().unwrap_or_default();
                mapped.push(MappedEvent {
                    kind: "rename",
                    path: Some(new_path.to_string_lossy().into_owned()),
                    old_path: Some(old_path.to_string_lossy().into_owned()),
                });
            } else if let Some(path) = paths.pop() {
                mapped.push(MappedEvent::one("rename", path));
            }
        }
        EventKind::Modify(ModifyKind::Name(_)) => {
            for path in event.paths {
                mapped.push(MappedEvent::one("rename", path));
            }
        }
        EventKind::Modify(_) | EventKind::Any | EventKind::Other => {
            for path in event.paths {
                mapped.push(MappedEvent::one("change", path));
            }
        }
    }
    mapped
}

/// Split events into bounded batches; a full or too-large batch has its
/// last event replaced by one `overflow` marker asking for a rescan, so a
/// consumer never receives more than 1,024 events or 768 KiB at once.
pub fn batch_events(events: Vec<FsWatchEvent>) -> Vec<Vec<FsWatchEvent>> {
    let mut batches = Vec::new();
    let mut current: Vec<FsWatchEvent> = Vec::new();
    let mut bytes = 0usize;
    for event in events {
        let size = serde_json::to_vec(&event).map(|value| value.len()).unwrap_or(0);
        if size > MAX_WATCH_BATCH_BYTES {
            if current.is_empty() {
                batches.push(vec![overflow_marker(&event)]);
            } else {
                replace_last_with_overflow(&mut current);
                batches.push(std::mem::take(&mut current));
                bytes = 0;
                batches.push(vec![overflow_marker(&event)]);
            }
            continue;
        }
        if !current.is_empty()
            && (current.len() >= MAX_WATCH_BATCH_EVENTS || bytes + size > MAX_WATCH_BATCH_BYTES)
        {
            replace_last_with_overflow(&mut current);
            batches.push(std::mem::take(&mut current));
            bytes = 0;
        }
        bytes += size;
        current.push(event);
    }
    if !current.is_empty() {
        batches.push(current);
    }
    batches
}

fn overflow_marker(source: &FsWatchEvent) -> FsWatchEvent {
    FsWatchEvent {
        kind: "overflow".to_string(),
        path: None,
        old_path: None,
        error_code: None,
        ..source.clone()
    }
}

fn replace_last_with_overflow(current: &mut [FsWatchEvent]) {
    if let Some(index) = current.len().checked_sub(1) {
        let marker = overflow_marker(&current[index]);
        current[index] = marker;
    }
}

fn canonical_watch_root(path: &str) -> Result<PathBuf, String> {
    fs_service::validate_path_input(path).map_err(|_| "watch.invalid".to_string())?;
    let parsed = Path::new(path);
    if !parsed.is_absolute()
        || parsed.components().any(|part| matches!(part, Component::ParentDir))
        || path.encode_utf16().count() > MAX_WATCH_ROOT_UNITS
    {
        return Err("watch.invalid".to_string());
    }
    let canonical = std::fs::canonicalize(parsed).map_err(|_| "watch.failed".to_string())?;
    if !std::fs::metadata(&canonical).map(|meta| meta.is_dir()).unwrap_or(false) {
        return Err("watch.invalid".to_string());
    }
    Ok(canonical)
}

/// Subscribe a folder view. The UI routes events by `subscription_id` and
/// ignores a stale `generation`; at most 128 consumers are live.
#[allow(dead_code)] // Registered in main.rs generate_handler by the coordinator.
#[tauri::command]
pub async fn watch_subscribe(
    window: WebviewWindow,
    path: String,
    options: Option<WatchOptions>,
) -> Result<WatchSubscription, String> {
    crate::ensure_main(window.label())?;
    let app = window.app_handle().clone();
    let options = options.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let root = canonical_watch_root(&path)?;
        let emitter_app = app.clone();
        let emitter: FsWatchEmitter = Arc::new(move |event| {
            let _ = emitter_app.emit("fs-watch", &event);
        });
        app.state::<WatcherSessions>()
            .subscribe_with(&root, options, emitter)
    })
    .await
    .map_err(|_| "watch.failed".to_string())?
}

/// Release exactly one subscription. Unknown or already released ids are
/// ignored, and the legacy `watch_start` watcher is never touched.
#[allow(dead_code)] // Registered in main.rs generate_handler by the coordinator.
#[tauri::command]
pub async fn watch_unsubscribe(
    window: WebviewWindow,
    subscription_id: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    let app = window.app_handle().clone();
    let Ok(id) = Uuid::parse_str(&subscription_id) else {
        return Ok(());
    };
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<WatcherSessions>().unsubscribe(id);
    })
    .await
    .map_err(|_| "watch.failed".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{AccessKind, CreateKind, DataChange, RemoveKind};

    fn event(subscription: Uuid, generation: u64, kind: &str) -> FsWatchEvent {
        FsWatchEvent {
            subscription_id: subscription,
            root: "C:\\a".to_string(),
            generation,
            kind: kind.to_string(),
            path: Some("C:\\a\\file.txt".to_string()),
            old_path: None,
            error_code: None,
        }
    }

    #[test]
    fn two_roots_route_independently() {
        let sessions = WatcherSessions::routing_only();
        let a = sessions
            .subscribe(Path::new("C:\\a"), WatchOptions::default())
            .unwrap();
        let b = sessions
            .subscribe(Path::new("C:\\b"), WatchOptions::default())
            .unwrap();
        assert!(sessions.route(&event(a.subscription_id, a.generation, "create")));
        assert!(sessions.route(&event(b.subscription_id, b.generation, "create")));
        assert!(!sessions.route(&event(Uuid::new_v4(), 1, "create")));
    }

    #[test]
    fn one_unsubscribe_retains_the_other() {
        let sessions = WatcherSessions::routing_only();
        let a = sessions
            .subscribe(Path::new("C:\\a"), WatchOptions::default())
            .unwrap();
        let b = sessions
            .subscribe(Path::new("C:\\a"), WatchOptions::default())
            .unwrap();
        assert_eq!(a.generation, b.generation);
        assert_eq!(sessions.root_count(), 1);
        assert!(sessions.unsubscribe(a.subscription_id));
        assert!(sessions.route(&event(b.subscription_id, b.generation, "change")));
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions.root_count(), 1);
        // Idempotent: a second unsubscribe changes nothing.
        assert!(!sessions.unsubscribe(a.subscription_id));
        assert!(sessions.unsubscribe(b.subscription_id));
        assert_eq!(sessions.root_count(), 0);
    }

    #[test]
    fn same_root_dedups_but_recursive_is_separate() {
        let sessions = WatcherSessions::routing_only();
        let plain = sessions
            .subscribe(Path::new("C:\\A"), WatchOptions::default())
            .unwrap();
        let same = sessions
            .subscribe(Path::new("\\\\?\\c:\\a\\"), WatchOptions::default())
            .unwrap();
        assert_eq!(plain.generation, same.generation);
        assert_eq!(sessions.root_count(), 1);
        let recursive = sessions
            .subscribe(Path::new("C:\\a"), WatchOptions { recursive: true })
            .unwrap();
        assert_eq!(sessions.root_count(), 2);
        assert_ne!(plain.generation, recursive.generation);
    }

    #[test]
    fn stale_generation_is_ignored() {
        let sessions = WatcherSessions::routing_only();
        let first = sessions
            .subscribe(Path::new("C:\\a"), WatchOptions::default())
            .unwrap();
        assert!(!sessions.route(&event(first.subscription_id, first.generation + 1, "change")));
        assert!(sessions.unsubscribe(first.subscription_id));
        let second = sessions
            .subscribe(Path::new("C:\\a"), WatchOptions::default())
            .unwrap();
        assert!(second.generation > first.generation);
        assert!(!sessions.route(&event(second.subscription_id, first.generation, "change")));
        assert!(sessions.route(&event(second.subscription_id, second.generation, "change")));
    }

    #[test]
    fn overflow_batch_ends_with_a_rescan_marker() {
        let subscription = Uuid::new_v4();
        let events: Vec<FsWatchEvent> = (0..(MAX_WATCH_BATCH_EVENTS + 5))
            .map(|_| event(subscription, 1, "change"))
            .collect();
        let batches = batch_events(events);
        assert!(batches.len() >= 2);
        assert_eq!(batches[0].last().unwrap().kind, "overflow");
        assert!(batches[0].len() <= MAX_WATCH_BATCH_EVENTS);
    }

    #[test]
    fn batch_events_respects_the_byte_cap() {
        let subscription = Uuid::new_v4();
        let big = "a".repeat(MAX_WATCH_BATCH_BYTES / 2);
        let events: Vec<FsWatchEvent> = (0..4)
            .map(|index| FsWatchEvent {
                path: Some(format!("C:\\{big}\\{index}")),
                ..event(subscription, 1, "change")
            })
            .collect();
        let batches = batch_events(events);
        assert!(batches.iter().flatten().any(|event| event.kind == "overflow"));
        for batch in batches {
            let bytes: usize = batch
                .iter()
                .map(|event| serde_json::to_vec(event).unwrap().len())
                .sum();
            assert!(bytes <= MAX_WATCH_BATCH_BYTES, "{bytes}");
        }
    }

    #[test]
    fn stop_all_releases_every_root() {
        let sessions = WatcherSessions::routing_only();
        sessions
            .subscribe(Path::new("C:\\a"), WatchOptions::default())
            .unwrap();
        sessions
            .subscribe(Path::new("C:\\b"), WatchOptions::default())
            .unwrap();
        sessions.stop_all();
        assert!(sessions.is_empty());
        assert_eq!(sessions.root_count(), 0);
    }

    #[test]
    fn subscription_129_is_refused() {
        let sessions = WatcherSessions::routing_only();
        for index in 0..MAX_WATCH_SUBSCRIPTIONS {
            sessions
                .subscribe(
                    Path::new(&format!("C:\\root-{index}")),
                    WatchOptions::default(),
                )
                .unwrap();
        }
        assert_eq!(
            sessions.subscribe(Path::new("C:\\one-too-many"), WatchOptions::default()),
            Err("watch.limit".to_string())
        );
    }

    #[test]
    fn notify_events_map_to_bounded_kinds() {
        let created = map_notify_event(
            notify::Event::new(EventKind::Create(CreateKind::File))
                .add_path(PathBuf::from("C:\\a\\new.txt")),
        );
        assert_eq!(created.len(), 1);
        assert_eq!(created[0].kind, "create");
        assert_eq!(created[0].path.as_deref(), Some("C:\\a\\new.txt"));

        let removed = map_notify_event(
            notify::Event::new(EventKind::Remove(RemoveKind::File))
                .add_path(PathBuf::from("C:\\a\\gone.txt")),
        );
        assert_eq!(removed[0].kind, "remove");

        let changed = map_notify_event(
            notify::Event::new(EventKind::Modify(ModifyKind::Data(DataChange::Content)))
                .add_path(PathBuf::from("C:\\a\\file.txt")),
        );
        assert_eq!(changed[0].kind, "change");

        let renamed = map_notify_event(
            notify::Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
                .add_path(PathBuf::from("C:\\a\\old.txt"))
                .add_path(PathBuf::from("C:\\a\\new.txt")),
        );
        assert_eq!(renamed.len(), 1);
        assert_eq!(renamed[0].kind, "rename");
        assert_eq!(renamed[0].path.as_deref(), Some("C:\\a\\new.txt"));
        assert_eq!(renamed[0].old_path.as_deref(), Some("C:\\a\\old.txt"));

        let accessed = map_notify_event(
            notify::Event::new(EventKind::Access(AccessKind::Read))
                .add_path(PathBuf::from("C:\\a\\file.txt")),
        );
        assert!(accessed.is_empty());
    }

    #[test]
    fn real_watcher_reports_a_new_file_and_stops() {
        let dir = tempfile::tempdir().unwrap();
        let sessions = WatcherSessions::new();
        let (sender, receiver) = std::sync::mpsc::channel::<FsWatchEvent>();
        let emitter: FsWatchEmitter = Arc::new(move |event| {
            let _ = sender.send(event);
        });
        let subscription = sessions
            .subscribe_with(dir.path(), WatchOptions::default(), emitter)
            .unwrap();
        std::fs::write(dir.path().join("new.txt"), b"x").unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut saw = false;
        while Instant::now() < deadline {
            let received = receiver.recv_timeout(Duration::from_millis(100)).ok();
            if received.is_some_and(|event| {
                event.subscription_id == subscription.subscription_id
                    && event.kind == "create"
                    && event.path.as_deref().is_some_and(|path| path.ends_with("new.txt"))
            }) {
                saw = true;
                break;
            }
        }
        assert!(saw, "watcher did not report the new file within 5s");
        assert!(sessions.unsubscribe(subscription.subscription_id));
        assert!(sessions.is_empty());
        assert_eq!(sessions.root_count(), 0);
    }
}
