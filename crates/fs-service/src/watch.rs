use crate::{FsError, Result};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher as _};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver};

/// A burst larger than this collapses into one `Rescan` event so the UI
/// reloads once instead of processing thousands of events (rules.md s.3).
pub const MAX_WATCH_BATCH: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FsEventKind {
    Created,
    Removed,
    Modified,
    Renamed,
    Rescan,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct FsEvent {
    pub kind: FsEventKind,
    pub path: PathBuf,
}

/// De-duplicate identical (kind, path) events keeping first-seen order;
/// collapse oversized bursts to a single Rescan event.
pub fn coalesce_events(events: Vec<FsEvent>, max: usize) -> Vec<FsEvent> {
    let mut seen: HashSet<(FsEventKind, PathBuf)> = HashSet::new();
    let mut out: Vec<FsEvent> = Vec::new();
    for event in events {
        if seen.insert((event.kind, event.path.clone())) {
            out.push(event);
        }
    }
    if out.len() > max {
        return vec![FsEvent {
            kind: FsEventKind::Rescan,
            path: PathBuf::new(),
        }];
    }
    out
}

fn map_event(event: notify::Event) -> Vec<FsEvent> {
    let kind = match event.kind {
        EventKind::Create(_) => FsEventKind::Created,
        EventKind::Remove(_) => FsEventKind::Removed,
        EventKind::Modify(notify::event::ModifyKind::Name(_)) => FsEventKind::Renamed,
        EventKind::Modify(_) => FsEventKind::Modified,
        EventKind::Access(_) => return Vec::new(),
        _ => FsEventKind::Modified,
    };
    event
        .paths
        .into_iter()
        .map(|path| FsEvent { kind, path })
        .collect()
}

/// Watches exactly one folder at a time (non-recursive). Calling `watch`
/// again replaces the previous folder; `unwatch` (or drop) stops it, so
/// leaving a folder always stops its watcher.
pub struct FsWatcher {
    watcher: Option<RecommendedWatcher>,
    receiver: Receiver<notify::Result<notify::Event>>,
    current: Option<PathBuf>,
}

impl FsWatcher {
    pub fn new() -> Result<Self> {
        let (sender, receiver) = channel();
        let watcher = notify::recommended_watcher(move |result| {
            // The receiver is dropped with the watcher; ignore send errors.
            let _ = sender.send(result);
        })
        .map_err(|e| FsError::Validation(format!("watcher unavailable: {e}")))?;
        Ok(Self {
            watcher: Some(watcher),
            receiver,
            current: None,
        })
    }

    pub fn watch(&mut self, path: &std::path::Path) -> Result<()> {
        if self.current.as_deref() == Some(path) && self.watcher.is_some() {
            return Ok(());
        }
        self.unwatch();
        let (sender, receiver) = channel();
        let mut watcher = notify::recommended_watcher(move |result| {
            let _ = sender.send(result);
        })
        .map_err(|e| FsError::Validation(format!("watcher unavailable: {e}")))?;
        watcher
            .watch(path, RecursiveMode::NonRecursive)
            .map_err(|e| FsError::Validation(format!("cannot watch {}: {e}", path.display())))?;
        self.watcher = Some(watcher);
        self.receiver = receiver;
        self.current = Some(path.to_path_buf());
        Ok(())
    }

    pub fn unwatch(&mut self) {
        // Dropping the RecommendedWatcher unregisters the watch.
        self.watcher = None;
        self.current = None;
    }

    pub fn current(&self) -> Option<&PathBuf> {
        self.current.as_ref()
    }

    /// Non-blocking: returns everything pending right now, coalesced.
    /// The caller owns the batching interval (Slice 2 uses 250 ms).
    pub fn drain_batched(&self) -> Vec<FsEvent> {
        let mut events = Vec::new();
        while let Ok(result) = self.receiver.try_recv() {
            match result {
                Ok(event) => events.extend(map_event(event)),
                Err(_) => events.push(FsEvent {
                    kind: FsEventKind::Rescan,
                    path: PathBuf::new(),
                }),
            }
            if events.len() > MAX_WATCH_BATCH {
                break;
            }
        }
        coalesce_events(events, MAX_WATCH_BATCH)
    }
}
