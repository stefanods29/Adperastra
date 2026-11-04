use super::*;
use std::time::{Duration, Instant};
pub(super) struct Consumer {
    pub token: CancellationToken,
    pub started: std::sync::atomic::AtomicBool,
    created: Instant,
}
impl Consumer {
    fn new() -> Self {
        Self {
            token: fs_service::new_cancellation_token(),
            started: std::sync::atomic::AtomicBool::new(false),
            created: Instant::now(),
        }
    }
}
#[derive(Default)]
pub(super) struct Consumers(Mutex<HashMap<Uuid, Arc<Consumer>>>);
impl Consumers {
    pub fn register(&self, id: Uuid) -> Result<Arc<Consumer>, String> {
        let mut entries = self.0.lock().map_err(|_| "metadata.failed")?;
        entries.retain(|_, c| {
            !c.token.load(Ordering::Relaxed)
                || Arc::strong_count(c) > 1
                || c.created.elapsed() < Duration::from_secs(30)
        });
        if let Some(c) = entries.get(&id) {
            if c.token.load(Ordering::Relaxed) {
                return Err("background.cancelled".into());
            }
            return Ok(Arc::clone(c));
        }
        if entries
            .values()
            .filter(|c| !c.token.load(Ordering::Relaxed))
            .count()
            >= MAX_ACTIVE_CONSUMERS
            || entries.len() >= 4096
        {
            return Err("background.busy".into());
        }
        let c = Arc::new(Consumer::new());
        entries.insert(id, Arc::clone(&c));
        Ok(c)
    }
    pub fn release(&self, id: Uuid) {
        let Ok(mut entries) = self.0.lock() else {
            return;
        };
        if entries.len() < 4096 {
            entries
                .entry(id)
                .or_insert_with(|| Arc::new(Consumer::new()));
        }
        if let Some(c) = entries.get(&id) {
            c.token.store(true, Ordering::Relaxed);
        }
    }
}
