//! Reference and cancellation ownership survives admission and reply races.
use crate::cache::CacheService;
use fs_service::{new_cancellation_token, CancellationToken};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use uuid::Uuid;

pub(super) struct Consumer {
    pub cancelled: CancellationToken,
    pub started: AtomicBool,
    lease: Mutex<Option<String>>,
    created: Instant,
}
impl Consumer {
    fn new() -> Self {
        Self {
            cancelled: new_cancellation_token(),
            started: AtomicBool::new(false),
            lease: Mutex::new(None),
            created: Instant::now(),
        }
    }
    pub fn install(&self, cache: &CacheService, lease: String) -> bool {
        let Ok(mut slot) = self.lease.lock() else {
            let _ = cache.release(&lease);
            return false;
        };
        if self.cancelled.load(Ordering::Relaxed) {
            let _ = cache.release(&lease);
            return false;
        }
        if let Some(old) = slot.replace(lease) {
            let _ = cache.release(&old);
        }
        true
    }
    fn release(&self, cache: &CacheService) {
        self.cancelled.store(true, Ordering::Relaxed);
        let lease = self.lease.lock().ok().and_then(|mut slot| slot.take());
        if let Some(lease) = lease {
            let _ = cache.release(&lease);
        }
    }
}
#[derive(Default)]
pub(super) struct Consumers(Mutex<HashMap<Uuid, Arc<Consumer>>>);
impl Consumers {
    pub fn register(&self, id: Uuid) -> Result<Arc<Consumer>, String> {
        let mut entries = self.0.lock().map_err(|_| "thumbnail.failed".to_string())?;
        entries.retain(|_, entry| {
            !entry.cancelled.load(Ordering::Relaxed)
                || Arc::strong_count(entry) > 1
                || entry.created.elapsed() < Duration::from_secs(30)
        });
        if let Some(entry) = entries.get(&id) {
            if entry.cancelled.load(Ordering::Relaxed) {
                return Err("background.cancelled".into());
            }
            return Ok(Arc::clone(entry));
        }
        if entries.len() >= 1024 {
            return Err("thumbnail.busy".into());
        }
        let entry = Arc::new(Consumer::new());
        entries.insert(id, Arc::clone(&entry));
        Ok(entry)
    }
    pub fn release(&self, id: Uuid, cache: &CacheService) {
        let entry = {
            let Ok(mut entries) = self.0.lock() else {
                return;
            };
            // Keep a bounded tombstone when release races ahead of start.
            if !entries.contains_key(&id) && entries.len() < 1024 {
                entries.insert(id, Arc::new(Consumer::new()));
            }
            entries.get(&id).cloned()
        };
        if let Some(entry) = entry {
            entry.release(cache);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::files::FileGrants;
    #[test]
    fn release_racing_ahead_of_start_cannot_resurrect_consumer() {
        let data = tempfile::tempdir().unwrap();
        let cache = CacheService::new(data.path().to_path_buf(), Arc::new(FileGrants::default()));
        let consumers = Consumers::default();
        let id = Uuid::new_v4();
        consumers.release(id, &cache);
        assert!(matches!(consumers.register(id),Err(code) if code=="background.cancelled"));
    }
    #[test]
    fn release_reaches_reference_already_waiting_for_admission() {
        let data = tempfile::tempdir().unwrap();
        let cache = CacheService::new(data.path().to_path_buf(), Arc::new(FileGrants::default()));
        let consumers = Consumers::default();
        let id = Uuid::new_v4();
        let reference = consumers.register(id).unwrap();
        consumers.release(id, &cache);
        assert!(reference.cancelled.load(Ordering::Relaxed));
    }
}
