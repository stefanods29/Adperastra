use super::{BackgroundError, BackgroundPriority, BackgroundScheduler, MAX_ACTIVE, MAX_WAITING};
use crate::background::BackgroundTaskKind;
use fs_service::new_cancellation_token;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use uuid::Uuid;

#[test]
fn only_two_tasks_run_at_once() {
    let scheduler = Arc::new(BackgroundScheduler::with_limits(MAX_ACTIVE, MAX_WAITING));
    let first = scheduler.force_active(
        BackgroundTaskKind::Thumbnails,
        Uuid::new_v4(),
        BackgroundPriority::Visible,
        new_cancellation_token(),
    );
    let second = scheduler.force_active(
        BackgroundTaskKind::Thumbnails,
        Uuid::new_v4(),
        BackgroundPriority::Visible,
        new_cancellation_token(),
    );
    assert_eq!(scheduler.counts(), (2, 0));
    let _third = scheduler
        .enqueue_waiting(
            BackgroundTaskKind::Thumbnails,
            Uuid::new_v4(),
            BackgroundPriority::Visible,
            new_cancellation_token(),
        )
        .unwrap();
    assert_eq!(scheduler.counts(), (2, 1));
    drop(first);
    assert_eq!(scheduler.counts().0, 1);
    drop(second);
}

#[test]
fn the_257th_waiter_is_refused_without_work() {
    let scheduler = Arc::new(BackgroundScheduler::with_limits(MAX_ACTIVE, MAX_WAITING));
    let _first = scheduler.force_active(
        BackgroundTaskKind::Thumbnails,
        Uuid::new_v4(),
        BackgroundPriority::Visible,
        new_cancellation_token(),
    );
    let _second = scheduler.force_active(
        BackgroundTaskKind::Thumbnails,
        Uuid::new_v4(),
        BackgroundPriority::Visible,
        new_cancellation_token(),
    );
    for _ in 0..MAX_WAITING {
        scheduler
            .enqueue_waiting(
                BackgroundTaskKind::Thumbnails,
                Uuid::new_v4(),
                BackgroundPriority::Overscan,
                new_cancellation_token(),
            )
            .unwrap();
    }
    assert_eq!(
        scheduler.enqueue_waiting(
            BackgroundTaskKind::Thumbnails,
            Uuid::new_v4(),
            BackgroundPriority::Visible,
            new_cancellation_token(),
        ),
        Err(BackgroundError::Busy)
    );
}

#[test]
fn pause_cancels_only_background_tokens() {
    let scheduler = Arc::new(BackgroundScheduler::with_limits(MAX_ACTIVE, MAX_WAITING));
    let visible = new_cancellation_token();
    let user = new_cancellation_token();
    let _visible = scheduler.force_active(
        BackgroundTaskKind::Thumbnails,
        Uuid::new_v4(),
        BackgroundPriority::Visible,
        visible.clone(),
    );
    let _user = scheduler.force_active(
        BackgroundTaskKind::Thumbnails,
        Uuid::new_v4(),
        BackgroundPriority::User,
        user.clone(),
    );
    scheduler.pause_all();
    assert!(visible.load(Ordering::Relaxed));
    assert!(!user.load(Ordering::Relaxed));
}

#[test]
fn pause_then_immediate_resume_cannot_strand_a_waiter() {
    let scheduler = Arc::new(BackgroundScheduler::with_limits(1, 256));
    let _active = scheduler.force_active(
        BackgroundTaskKind::Thumbnails,
        Uuid::new_v4(),
        BackgroundPriority::Visible,
        new_cancellation_token(),
    );
    let waiting = Arc::clone(&scheduler);
    let thread = std::thread::spawn(move || {
        waiting.wait(
            BackgroundTaskKind::Thumbnails,
            Uuid::new_v4(),
            BackgroundPriority::Visible,
            new_cancellation_token(),
        )
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    while scheduler.counts().1 == 0 {
        assert!(std::time::Instant::now() < deadline);
        std::thread::yield_now();
    }
    scheduler.pause_all();
    scheduler.resume();
    assert!(matches!(
        thread.join().unwrap(),
        Err(BackgroundError::Cancelled) | Err(BackgroundError::Paused)
    ));
    assert_eq!(scheduler.counts(), (1, 0));
}
