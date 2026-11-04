//! Crash markers and the safe-mode decision (Step 09h T4).
//!
//! A marker is written at launch, when the first window is ready and after a
//! clean close whose unsaved-close decision was accepted. Three launches that
//! never reached a clean close within five minutes start safe mode. The
//! marker contains no file content and never points at a user file.
#![allow(dead_code)]


use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A marker beyond this age is no longer evidence of a crash.
pub const FAILURE_WINDOW_SECONDS: u64 = 300;
/// How many failed starts in that window trigger safe mode.
pub const FAILED_START_LIMIT: u8 = 3;
/// A responsive first window must report ready within this time.
pub const READY_DEADLINE_SECONDS: u64 = 30;
/// The marker keeps a short bounded history.
pub const MAX_LAUNCHES: usize = 32;
/// File name below the app data folder.
pub const HEALTH_FILE: &str = "startup-health.json";
const HEALTH_SCHEMA: u32 = 1;
/// The marker is a short bounded history; a bigger or foreign file is not
/// read into memory and starts a fresh history instead.
pub const MAX_HEALTH_BYTES: u64 = 1_048_576;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LaunchState {
    Starting,
    Ready,
    Clean,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaunchRecord {
    pub launch_id: Uuid,
    pub started_unix: u64,
    pub state: LaunchState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartupHistory {
    pub schema_version: u32,
    pub launches: VecDeque<LaunchRecord>,
    /// Failures before this time are acknowledged; the rows stay as evidence.
    #[serde(default)]
    pub acknowledged_unix: u64,
}

impl Default for StartupHistory {
    fn default() -> Self {
        Self {
            schema_version: HEALTH_SCHEMA,
            launches: VecDeque::new(),
            acknowledged_unix: 0,
        }
    }
}

/// What one start decided before any window or settings file is touched.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StartupDecision {
    pub safe_mode: bool,
    pub failed_starts: u8,
    pub unclean_exit: bool,
}

pub struct StartupHealth {
    path: PathBuf,
    state: Mutex<HealthState>,
}

struct HealthState {
    history: StartupHistory,
    current: Option<LaunchRecord>,
    decision: StartupDecision,
}

impl StartupHealth {
    pub fn open(data_dir: &Path) -> Self {
        let path = data_dir.join(HEALTH_FILE);
        let history = std::fs::symlink_metadata(&path)
            .ok()
            .filter(|metadata| {
                metadata.is_file()
                    && !metadata.file_type().is_symlink()
                    && metadata.len() <= MAX_HEALTH_BYTES
            })
            .and_then(|_| std::fs::read(&path).ok())
            .and_then(|bytes| serde_json::from_slice::<StartupHistory>(&bytes).ok())
            .filter(|history| history.schema_version <= HEALTH_SCHEMA)
            .unwrap_or_default();
        Self {
            path,
            state: Mutex::new(HealthState {
                history,
                current: None,
                decision: StartupDecision {
                    safe_mode: false,
                    failed_starts: 0,
                    unclean_exit: false,
                },
            }),
        }
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, HealthState>, String> {
        self.state
            .lock()
            .map_err(|_| "startup.lock_poisoned".to_string())
    }

    /// Record this launch and count previous launches that did not close
    /// cleanly inside the five-minute window.
    pub fn begin_launch(&self, now: u64) -> Result<StartupDecision, String> {
        let mut state = self.lock()?;
        let failed = state
            .history
            .launches
            .iter()
            .filter(|record| {
                record.state != LaunchState::Clean
                    && record.started_unix >= state.history.acknowledged_unix
                    && now.saturating_sub(record.started_unix) <= FAILURE_WINDOW_SECONDS
            })
            .count()
            .min(u8::MAX as usize) as u8;
        let decision = StartupDecision {
            safe_mode: failed >= FAILED_START_LIMIT,
            failed_starts: failed,
            unclean_exit: failed > 0,
        };
        let record = LaunchRecord {
            launch_id: Uuid::new_v4(),
            started_unix: now,
            state: LaunchState::Starting,
        };
        state.history.launches.push_back(record.clone());
        while state.history.launches.len() > MAX_LAUNCHES {
            state.history.launches.pop_front();
        }
        state.current = Some(record);
        state.decision = decision;
        let history = state.history.clone();
        drop(state);
        self.save_history(&history)?;
        Ok(decision)
    }

    /// The first window painted: this launch is responsive. Recording a late
    /// ready does not rewrite history; callers report the deadline result.
    /// A webview reload or a repeated handshake must not rewrite the marker:
    /// an already ready or clean launch stays as it is, so a late reload can
    /// never downgrade a clean close.
    pub fn mark_ready(&self, now: u64) -> Result<bool, String> {
        let mut state = self.lock()?;
        let Some(current) = state.current.clone() else {
            return Ok(false);
        };
        let within = now.saturating_sub(current.started_unix) <= READY_DEADLINE_SECONDS;
        if current.state != LaunchState::Starting {
            // The launch already proved itself; a reload cannot make it late.
            return Ok(true);
        }
        if let Some(record) = state
            .history
            .launches
            .iter_mut()
            .find(|record| record.launch_id == current.launch_id)
        {
            record.state = LaunchState::Ready;
        }
        if let Some(record) = state.current.as_mut() {
            record.state = LaunchState::Ready;
        }
        let history = state.history.clone();
        drop(state);
        self.save_history(&history)?;
        Ok(within)
    }

    /// A launch marks clean only once the app is really gone: after the
    /// window was destroyed following the accepted unsaved-close decision,
    /// or after an accepted quit/restart. Never on a mere session read.
    pub fn mark_clean(&self, _now: u64) -> Result<(), String> {
        let mut state = self.lock()?;
        let Some(current) = state.current.clone() else {
            return Ok(());
        };
        // The readiness handshake may run again on a reload; an already
        // clean launch must not rewrite the marker each time.
        if current.state == LaunchState::Clean {
            return Ok(());
        }
        if let Some(record) = state
            .history
            .launches
            .iter_mut()
            .find(|record| record.launch_id == current.launch_id)
        {
            record.state = LaunchState::Clean;
        }
        if let Some(record) = state.current.as_mut() {
            record.state = LaunchState::Clean;
        }
        let history = state.history.clone();
        drop(state);
        self.save_history(&history)
    }

    /// "Restart normally" acknowledges the failures without deleting their
    /// rows, so the next start does not immediately re-enter safe mode.
    pub fn acknowledge_restart(&self, now: u64) -> Result<(), String> {
        let mut state = self.lock()?;
        state.history.acknowledged_unix = now;
        if let Some(record) = state.current.as_mut() {
            record.state = LaunchState::Clean;
        }
        if let Some(current) = state.current.clone() {
            if let Some(record) = state
                .history
                .launches
                .iter_mut()
                .find(|record| record.launch_id == current.launch_id)
            {
                record.state = LaunchState::Clean;
            }
        }
        let _ = state.decision;
        state.decision = StartupDecision {
            safe_mode: false,
            failed_starts: 0,
            unclean_exit: false,
        };
        let history = state.history.clone();
        drop(state);
        self.save_history(&history)
    }

    pub fn had_unclean_exit(&self) -> bool {
        self.lock().map(|state| state.decision.unclean_exit).unwrap_or(false)
    }

    pub fn failed_starts(&self) -> u8 {
        self.lock().map(|state| state.decision.failed_starts).unwrap_or(0)
    }

    pub fn decision(&self) -> StartupDecision {
        self.lock()
            .map(|state| state.decision)
            .unwrap_or(StartupDecision {
                safe_mode: false,
                failed_starts: 0,
                unclean_exit: false,
            })
    }

    /// Test/evidence helper: the marker text, exactly as stored.
    pub fn marker_text(&self) -> String {
        std::fs::read_to_string(&self.path).unwrap_or_default()
    }

    /// Write a snapshot without holding the state lock during disk work
    /// (plan/pitfalls.md P-20).
    fn save_history(&self, history: &StartupHistory) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|_| "startup.io".to_string())?;
        }
        let bytes = serde_json::to_vec_pretty(history).map_err(|_| "startup.io".to_string())?;
        fs_service::atomic_write(&self.path, &bytes).map_err(|_| "startup.io".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn three_unclean_starts_in_five_minutes_enter_safe_mode() {
        let folder = tempfile::tempdir().unwrap();
        let health = StartupHealth::open(folder.path());
        let first = health.begin_launch(1_000).unwrap();
        assert!(!first.safe_mode);
        assert_eq!(first.failed_starts, 0);

        let second = health.begin_launch(1_100).unwrap();
        assert!(!second.safe_mode);
        assert_eq!(second.failed_starts, 1);
        assert!(second.unclean_exit);

        let third = health.begin_launch(1_200).unwrap();
        assert!(!third.safe_mode);
        assert_eq!(third.failed_starts, 2);

        let fourth = health.begin_launch(1_300).unwrap();
        assert!(fourth.safe_mode);
        assert_eq!(fourth.failed_starts, 3);
    }

    #[test]
    fn two_unclean_starts_do_not_enter_safe_mode() {
        let folder = tempfile::tempdir().unwrap();
        let health = StartupHealth::open(folder.path());
        health.begin_launch(1_000).unwrap();
        health.mark_clean(1_010).unwrap();
        let second = health.begin_launch(1_100).unwrap();
        let third = health.begin_launch(1_200).unwrap();
        assert!(!second.safe_mode);
        assert!(!third.safe_mode);
        assert_eq!(third.failed_starts, 1);
    }

    #[test]
    fn an_old_failure_leaves_the_window() {
        let folder = tempfile::tempdir().unwrap();
        let health = StartupHealth::open(folder.path());
        health.begin_launch(1_000).unwrap();
        let later = health
            .begin_launch(1_000 + FAILURE_WINDOW_SECONDS + 1)
            .unwrap();
        assert_eq!(later.failed_starts, 0);
        assert!(!later.safe_mode);
    }

    #[test]
    fn ready_after_thirty_seconds_is_not_within_the_deadline() {
        let folder = tempfile::tempdir().unwrap();
        let health = StartupHealth::open(folder.path());
        health.begin_launch(1_000).unwrap();
        assert!(!health.mark_ready(1_031).unwrap());
        assert!(health.mark_ready(1_030).unwrap());
    }

    #[test]
    fn a_repeated_ready_handshake_never_downgrades_a_clean_launch() {
        let folder = tempfile::tempdir().unwrap();
        let health = StartupHealth::open(folder.path());
        health.begin_launch(1_000).unwrap();
        assert!(health.mark_ready(1_010).unwrap());
        let ready = health.marker_text();
        // A webview reload asks again; the marker must not be rewritten.
        assert!(health.mark_ready(1_020).unwrap());
        assert_eq!(health.marker_text(), ready);
        health.mark_clean(1_020).unwrap();
        let clean = health.marker_text();
        // A late ready after the close decision cannot turn the launch unclean.
        assert!(health.mark_ready(1_025).unwrap());
        assert_eq!(health.marker_text(), clean);
    }

    #[test]
    fn mark_clean_is_idempotent() {
        let folder = tempfile::tempdir().unwrap();
        let health = StartupHealth::open(folder.path());
        health.begin_launch(1_000).unwrap();
        health.mark_ready(1_010).unwrap();
        health.mark_clean(1_020).unwrap();
        let clean = health.marker_text();
        health.mark_clean(1_030).unwrap();
        assert_eq!(health.marker_text(), clean);
    }

    #[test]
    fn clean_requires_the_close_decision_and_restart_keeps_evidence() {
        let folder = tempfile::tempdir().unwrap();
        let health = StartupHealth::open(folder.path());
        health.begin_launch(1_000).unwrap();
        health.mark_ready(1_010).unwrap();
        // Still inside the five-minute failure window.
        let restart = health.begin_launch(1_100).unwrap();
        assert!(restart.unclean_exit);
        health.acknowledge_restart(1_110).unwrap();
        let after = health.begin_launch(1_200).unwrap();
        assert!(!after.unclean_exit);
        assert!(!after.safe_mode);
        let marker = health.marker_text();
        assert!(marker.contains("acknowledged_unix"));
        assert!(marker.contains("launch_id"));
    }

    #[test]
    fn entering_safe_mode_never_drops_recovery_evidence() {
        let folder = tempfile::tempdir().unwrap();
        let recovery = folder.path().join("recovery");
        std::fs::create_dir_all(&recovery).unwrap();
        let catalog = recovery.join("catalog.json");
        let record = recovery.join("record.adprec");
        std::fs::write(&catalog, b"catalog bytes").unwrap();
        std::fs::write(&record, b"encrypted bytes").unwrap();

        let health = StartupHealth::open(folder.path());
        for step in 0..4 {
            health.begin_launch(1_000 + step).unwrap();
        }
        assert!(health.decision().safe_mode);
        assert_eq!(std::fs::read(&catalog).unwrap(), b"catalog bytes");
        assert_eq!(std::fs::read(&record).unwrap(), b"encrypted bytes");
    }

    #[test]
    fn a_corrupt_marker_is_replaced_by_a_fresh_bounded_history() {
        let folder = tempfile::tempdir().unwrap();
        std::fs::write(folder.path().join(HEALTH_FILE), b"not json").unwrap();
        let health = StartupHealth::open(folder.path());
        health.begin_launch(1_000).unwrap();
        let text = health.marker_text();
        let parsed: StartupHistory = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed.launches.len(), 1);
    }
}
