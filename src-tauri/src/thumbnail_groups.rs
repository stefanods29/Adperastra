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
    pub outcome: Option<Result<RenderOutcome, String>>,
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
                        waiter.consumer.cancelled.store(true, Ordering::Relaxed);
                    }
                    waiter.consumer.cancelled.load(Ordering::Relaxed)
                })
            })
            .unwrap_or(true)
    }
    pub async fn wait_admission(&self, consumer: &consumers::Consumer) -> Result<(), String> {
        std::future::poll_fn(|context| {
            let state = match self.state.lock() {
                Ok(state) => state,
                Err(_) => return Poll::Ready(Err("thumbnail.failed".into())),
            };
            if consumer.cancelled.load(Ordering::Relaxed) {
                return Poll::Ready(Err("background.cancelled".into()));
            }
            if state.admitted {
                return Poll::Ready(Ok(()));
            }
            if let Some(Err(code)) = &state.outcome {
                return Poll::Ready(Err(code.clone()));
            }
            let Ok(mut waiters) = self.wake.0.lock() else {
                return Poll::Ready(Err("thumbnail.failed".into()));
            };
            if !waiters.iter().any(|waker| waker.will_wake(context.waker())) {
                waiters.push(context.waker().clone());
            }
            Poll::Pending
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn releasing_one_member_does_not_cancel_other_member() {
        let entries = consumers::Consumers::default();
        let first = entries.register(Uuid::new_v4()).unwrap();
        let second = entries.register(Uuid::new_v4()).unwrap();
        let group = Group::new();
        group.state.lock().unwrap().waiters = vec![
            Waiter {
                id: "first".into(),
                consumer: Arc::clone(&first),
                job_token: None,
            },
            Waiter {
                id: "second".into(),
                consumer: Arc::clone(&second),
                job_token: None,
            },
        ];
        first.cancelled.store(true, Ordering::Relaxed);
        assert!(!group.all_cancelled());
        second.cancelled.store(true, Ordering::Relaxed);
        assert!(group.all_cancelled());
    }
    #[test]
    fn removed_generation_cannot_consume_replacement_group() {
        let old = Arc::new(Group::new());
        let replacement = Arc::new(Group::new());
        let groups = HashMap::from([("same-key", Arc::clone(&replacement))]);
        old.state.lock().unwrap().outcome =
            Some(Ok(RenderOutcome::State(ThumbnailState::Unsupported)));
        assert_eq!(groups["same-key"].id, replacement.id);
        assert!(groups["same-key"].state.lock().unwrap().outcome.is_none());
    }
}
