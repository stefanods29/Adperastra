//! Step 16 T3 tests: the dirty-safe resident state machine. Included by
//! `resident_state.rs`; the fake host records calls and never touches a real
//! window or document.

use std::sync::{Arc, Mutex};

use super::{
    ActivationTicket, CloseDecision, CloseReason, ResidentCoordinator, ResidentHost,
    ResidentState,
};

#[test]
fn confirmed_after_dirty_approval_hides() {
    let host = FakeHost::new(&[]);
    let coordinator = ResidentCoordinator::new(host.clone(), true, false);
    // First close asks the UI: the synchronous path stops and stays visible.
    host.set_dirty(false);
    assert_eq!(
        coordinator.request_close_now().expect("kept visible"),
        CloseDecision::KeepVisible
    );
    // The UI settled the dirty documents and confirms the same close.
    host.set_dirty(true);
    assert_eq!(
        coordinator
            .confirmed(CloseReason::WindowClose)
            .expect("confirmed close"),
        CloseDecision::Hide
    );
    assert_eq!(coordinator.state(), ResidentState::Resident);
}

#[derive(Default)]
struct HostState {
    dirty_approved: bool,
    pending_choosing_job: bool,
    hide_calls: u32,
    show_calls: u32,
    release_calls: u32,
    retain_calls: u32,
    retained: Vec<Vec<String>>,
    forwarded: Vec<ActivationTicket>,
    start_with_windows_writes: Vec<bool>,
    quit_calls: u32,
    windows: u32,
    enabled_background: Vec<String>,
}

struct FakeHost {
    state: Mutex<HostState>,
    configured_background: Vec<String>,
}

impl FakeHost {
    fn new(configured_background: &[&str]) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(HostState {
                dirty_approved: true,
                windows: 1,
                enabled_background: configured_background
                    .iter()
                    .map(|task| (*task).to_string())
                    .collect(),
                ..HostState::default()
            }),
            configured_background: configured_background
                .iter()
                .map(|task| (*task).to_string())
                .collect(),
        })
    }

    fn set_dirty(&self, approved: bool) {
        self.state.lock().expect("host lock").dirty_approved = approved;
    }

    fn set_pending_choice(&self, pending: bool) {
        self.state.lock().expect("host lock").pending_choosing_job = pending;
    }

    fn snapshot(&self) -> HostState {
        let state = self.state.lock().expect("host lock");
        HostState {
            dirty_approved: state.dirty_approved,
            pending_choosing_job: state.pending_choosing_job,
            hide_calls: state.hide_calls,
            show_calls: state.show_calls,
            release_calls: state.release_calls,
            retain_calls: state.retain_calls,
            retained: state.retained.clone(),
            forwarded: state.forwarded.clone(),
            start_with_windows_writes: state.start_with_windows_writes.clone(),
            quit_calls: state.quit_calls,
            windows: state.windows,
            enabled_background: state.enabled_background.clone(),
        }
    }
}

impl ResidentHost for FakeHost {
    fn settle_dirty(&self, _reason: CloseReason) -> Result<bool, String> {
        Ok(self.state.lock().expect("host lock").dirty_approved)
    }

    fn has_pending_foreground_choice(&self) -> bool {
        self.state
            .lock()
            .expect("host lock")
            .pending_choosing_job
    }

    fn hide_main_window(&self) -> Result<(), String> {
        let mut state = self.state.lock().expect("host lock");
        state.hide_calls += 1;
        state.windows = 0;
        Ok(())
    }

    fn show_main_window(&self) -> Result<(), String> {
        let mut state = self.state.lock().expect("host lock");
        state.show_calls += 1;
        state.windows = 1;
        Ok(())
    }

    fn release_heavy_resources(&self) -> Result<(), String> {
        self.state.lock().expect("host lock").release_calls += 1;
        Ok(())
    }

    fn retain_explicit_background(&self) -> Result<(), String> {
        let mut state = self.state.lock().expect("host lock");
        state.retain_calls += 1;
        state.retained.push(self.configured_background.clone());
        Ok(())
    }

    fn forward_activation(&self, ticket: &ActivationTicket) -> Result<(), String> {
        self.state
            .lock()
            .expect("host lock")
            .forwarded
            .push(ticket.clone());
        Ok(())
    }

    fn set_start_with_windows(&self, enabled: bool) -> Result<(), String> {
        self.state
            .lock()
            .expect("host lock")
            .start_with_windows_writes
            .push(enabled);
        Ok(())
    }

    fn quit_app(&self) -> Result<(), String> {
        self.state.lock().expect("host lock").quit_calls += 1;
        Ok(())
    }

    fn window_count(&self) -> u32 {
        self.state.lock().expect("host lock").windows
    }
}

fn enabled_coordinator(host: &Arc<FakeHost>) -> ResidentCoordinator {
    let coordinator = ResidentCoordinator::new(host.clone(), true, false);
    assert_eq!(
        coordinator.request_close_now().expect("close proceeds"),
        CloseDecision::Hide
    );
    assert_eq!(coordinator.state(), ResidentState::Resident);
    coordinator
}

fn ticket() -> ActivationTicket {
    ActivationTicket {
        request_id: "b50a4a4e-5a5f-4a6e-9a0a-0b1c2d3e4f50".to_string(),
        paths: vec![r"C:\Work\report.txt".to_string()],
        intent: None,
    }
}

#[test]
fn dirtycancel_keepsvisible() {
    let host = FakeHost::new(&["thumbnails"]);
    host.set_dirty(false);
    let coordinator = ResidentCoordinator::new(host.clone(), true, false);

    assert_eq!(
        coordinator.request_close_now().expect("cancel is not an error"),
        CloseDecision::KeepVisible
    );
    assert_eq!(coordinator.state(), ResidentState::Visible);
    let snapshot = host.snapshot();
    assert_eq!(snapshot.hide_calls, 0, "the window is never hidden");
    assert_eq!(snapshot.quit_calls, 0, "the app does not quit");
    assert_eq!(snapshot.release_calls, 0);
}

#[test]
fn pending_choice_keepsvisible() {
    let host = FakeHost::new(&[]);
    host.set_pending_choice(true);
    let coordinator = ResidentCoordinator::new(host.clone(), true, false);
    assert_eq!(
        coordinator.request_close_now().expect("kept visible"),
        CloseDecision::KeepVisible
    );
    assert_eq!(coordinator.state(), ResidentState::Visible);
    assert_eq!(host.snapshot().hide_calls, 0);
}

#[test]
fn activation_resident_onewindow() {
    let host = FakeHost::new(&[]);
    let coordinator = enabled_coordinator(&host);
    assert_eq!(host.snapshot().hide_calls, 1);

    coordinator
        .activate_ticket(ticket())
        .expect("activation from the resident shell");
    assert_eq!(coordinator.state(), ResidentState::Visible);
    let after_first = host.snapshot();
    assert_eq!(after_first.show_calls, 1, "the one window is shown");
    assert_eq!(after_first.forwarded.len(), 1, "the normal open pipeline runs");
    assert_eq!(after_first.windows, 1, "no duplicate window is created");

    coordinator
        .activate_ticket(ticket())
        .expect("activation while visible");
    let after_second = host.snapshot();
    assert_eq!(after_second.show_calls, 1, "a visible window is not re-created");
    assert_eq!(after_second.forwarded.len(), 2);
    assert_eq!(after_second.windows, 1);
}

#[test]
fn turnoff_exits_after_safeclose() {
    let host = FakeHost::new(&["thumbnails"]);
    let coordinator = enabled_coordinator(&host);

    host.set_dirty(false);
    assert!(!coordinator.turn_off().expect("cancel is not an error"));
    assert_eq!(coordinator.state(), ResidentState::Resident);
    assert_eq!(host.snapshot().quit_calls, 0);

    host.set_dirty(true);
    assert!(coordinator.turn_off().expect("turn off succeeds"));
    assert_eq!(coordinator.state(), ResidentState::Quitting);
    assert_eq!(host.snapshot().quit_calls, 1);
}

#[test]
fn no_tasks_enabled_by_residence() {
    let host = FakeHost::new(&["thumbnails", "index"]);
    let coordinator = enabled_coordinator(&host);
    let snapshot = host.snapshot();
    assert_eq!(snapshot.retain_calls, 1);
    assert_eq!(
        snapshot.retained,
        vec![vec!["thumbnails".to_string(), "index".to_string()]]
    );
    assert_eq!(
        snapshot.enabled_background,
        vec!["thumbnails".to_string(), "index".to_string()],
        "residency keeps exactly the tasks the user enabled"
    );
    assert_eq!(snapshot.release_calls, 1, "engines unload while resident");
    assert_eq!(coordinator.state(), ResidentState::Resident);
}

#[test]
fn quit_does_not_discard_dirty() {
    let host = FakeHost::new(&[]);
    let coordinator = enabled_coordinator(&host);
    host.set_dirty(false);
    assert!(!coordinator.quit().expect("the cancel is not an error"));
    assert_eq!(coordinator.state(), ResidentState::Resident);
    assert_eq!(host.snapshot().quit_calls, 0);
}

#[test]
fn mode_change_is_written_before_the_flags_change() {
    let host = FakeHost::new(&[]);
    let coordinator = ResidentCoordinator::new(host.clone(), false, false);
    coordinator
        .set_mode(true, true)
        .expect("the mode change succeeds");
    assert!(coordinator.enabled());
    assert!(coordinator.start_with_windows());
    assert_eq!(host.snapshot().start_with_windows_writes, vec![true]);
}

