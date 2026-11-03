//! Gallery source watchers (Step 07c, decision D9).
//!
//! One recursive watcher per authorized source, coalesced to at most one
//! notification every 250 ms. The watcher only reports that something changed;
//! the UI then refreshes the scan. It is dropped when the Gallery session
//! closes (the UI closes it after 30 s inactive), so no watch outlives the
//! photo view.

use notify::{RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, RecvTimeoutError};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Notifications inside this window collapse into one refresh.
pub const GALLERY_WATCH_DEBOUNCE: Duration = Duration::from_millis(250);

struct WatchThread {
    stop: Arc<AtomicBool>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl Drop for WatchThread {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

/// A live set of source watchers. Dropping it stops every watch.
pub struct GalleryWatch {
    _watcher: notify::RecommendedWatcher,
    _thread: WatchThread,
    _roots: Vec<fs_service::owned_io::PinnedDirectory>,
}

impl GalleryWatch {
    /// Starts watching `(root, recursive)` pairs. A root that cannot be
    /// watched is skipped: an unavailable drive must not stop the Gallery.
    pub fn start(
        roots: &[(PathBuf, bool)],
        on_change: impl Fn() + Send + 'static,
    ) -> Result<Self, String> {
        let (sender, receiver) = sync_channel(1);
        let mut watcher = notify::recommended_watcher(move |result| {
            let _ = sender.try_send(result);
        })
        .map_err(|error| error.to_string())?;
        let mut guards = Vec::new();
        for (root, recursive) in roots {
            let Ok(guard) = crate::gallery_source::guard_directory(root) else {
                continue;
            };
            let mode = if *recursive {
                RecursiveMode::Recursive
            } else {
                RecursiveMode::NonRecursive
            };
            if watcher.watch(guard.path(), mode).is_ok() {
                guards.push(guard);
            }
        }
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = stop.clone();
        let handle = std::thread::spawn(move || {
            let mut pending = false;
            let mut deadline = Instant::now();
            loop {
                if thread_stop.load(Ordering::Relaxed) {
                    break;
                }
                match receiver.recv_timeout(Duration::from_millis(100)) {
                    Ok(_) => {
                        if !pending {
                            deadline = Instant::now() + GALLERY_WATCH_DEBOUNCE;
                        }
                        pending = true;
                    }
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }
                if pending && Instant::now() >= deadline {
                    pending = false;
                    on_change();
                }
            }
        });
        Ok(Self {
            _watcher: watcher,
            _roots: guards,
            _thread: WatchThread {
                stop,
                handle: Some(handle),
            },
        })
    }
}
