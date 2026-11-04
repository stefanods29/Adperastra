//! One bounded admission/result state per immutable cache key.
use super::*;
use std::task::{Poll, Waker};
#[derive(Default)]
pub(super) struct AdmissionWake(Mutex<Vec<Waker>>);
impl AdmissionWake {
    pub fn notify_all(&self) {
        let waiting = self
            .0
            .lock()
            .map(|mut list| std::mem::take(&mut *list))
            .unwrap_or_default();
        for waker in waiting {
            waker.wake();
        }
    }
}

#[derive(Clone)]
pub(super) struct Waiter {
    pub id: String,
    pub consumer: Arc<consumers::Consumer>,
    pub job_token: Option<CancellationToken>,
}
pub(super) struct GroupState {
    pub admitted: bool,
    pub outcome: Option<Result<MetadataInfo, String>>,
    pub waiters: Vec<Waiter>,
}
pub(super) struct Group {
    pub id: Uuid,
    pub token: CancellationToken,
    pub state: Mutex<GroupState>,
    pub wake: AdmissionWake,
}
impl Group {
    pub fn new() -> Self {
        Self {
            id: Uuid::new_v4(),
            token: fs_service::new_cancellation_token(),
            state: Mutex::new(GroupState {
                admitted: false,
                outcome: None,
                waiters: Vec::new(),
            }),
            wake: AdmissionWake::default(),
        }
    }
    pub fn admit_waiter(
        &self,
        jobs: &Jobs,
        id: &str,
        consumer: &Arc<consumers::Consumer>,
    ) -> Result<Option<Result<MetadataInfo, String>>, String> {
        let mut state = self.state.lock().map_err(|_| "metadata.failed")?;
        if consumer.token.load(Ordering::Relaxed) {
            return Err("background.cancelled".into());
        }
        if !state.admitted {
            return Err(state
                .outcome
                .as_ref()
                .and_then(|v| v.as_ref().err())
                .cloned()
                .unwrap_or_else(|| "background.unavailable".into()));
        }
        let token = match jobs.begin(id, 1) {
            Ok(token) => token,
            Err(error) => {
                consumer.token.store(true, Ordering::Relaxed);
                return Err(error);
            }
        };
        let Some(waiter) = state
            .waiters
            .iter_mut()
            .find(|w| w.id == id && Arc::ptr_eq(&w.consumer, consumer))
        else {
            jobs.finish(id, Err("metadata.failed".into()));
            return Err("metadata.failed".into());
        };
        waiter.job_token = Some(token);
        Ok(state.outcome.clone())
    }
    pub fn all_cancelled(&self) -> bool {
        self.state
            .lock()
            .map(|state| {
                state.waiters.iter().all(|waiter| {
                    if waiter
                        .job_token
                        .as_ref()
                        .is_some_and(|token| token.load(Ordering::Relaxed))
                    {
                        waiter.consumer.token.store(true, Ordering::Relaxed);
                    }
                    waiter.consumer.token.load(Ordering::Relaxed)
                })
            })
            .unwrap_or(true)
    }
    pub async fn wait_admission(&self, consumer: &consumers::Consumer) -> Result<(), String> {
        std::future::poll_fn(|context| {
            let state = match self.state.lock() {
                Ok(state) => state,
                Err(_) => return Poll::Ready(Err("metadata.failed".into())),
            };
            if consumer.token.load(Ordering::Relaxed) {
                return Poll::Ready(Err("background.cancelled".into()));
            }
            if state.admitted {
                return Poll::Ready(Ok(()));
            }
            if let Some(Err(code)) = &state.outcome {
                return Poll::Ready(Err(code.clone()));
            }
            let Ok(mut waiters) = self.wake.0.lock() else {
                return Poll::Ready(Err("metadata.failed".into()));
            };
            if !waiters.iter().any(|waker| waker.will_wake(context.waker())) {
                waiters.push(context.waker().clone());
            }
            Poll::Pending
        })
        .await
    }
}
