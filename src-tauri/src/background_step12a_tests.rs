//! Step 12a T5 tests: quiet hours, pause checkpoints and CPU validation.

use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use fs_service::new_cancellation_token;

use super::{
    evaluate, minute_of_day, quiet_hours_active, validate_cpu_percent, validate_quiet_hours,
    BackgroundGate, BackgroundRules, GateInputs, QuietHours,
};
use crate::background_limits::{BackgroundCheckpoint, CpuLimit, PauseGate};

fn inputs(_quiet: QuietHours) -> GateInputs {
    GateInputs {
        enabled: true,
        globally_paused: false,
        only_idle: false,
        only_ac: false,
        idle_ms: u64::MAX,
        ac: Some(true),
        fullscreen: false,
        local_minute: 0,
    }
}

#[test]
fn quiet_wraps_midnight() {
    let quiet = QuietHours {
        enabled: true,
        start_minute: minute_of_day(22, 0).unwrap(),
        end_minute: minute_of_day(7, 0).unwrap(),
    };
    assert_eq!(quiet.start_minute, 1320);
    assert_eq!(quiet.end_minute, 420);
    assert!(quiet_hours_active(&quiet, minute_of_day(23, 0).unwrap()));
    assert!(quiet_hours_active(&quiet, minute_of_day(0, 30).unwrap()));
    assert!(quiet_hours_active(&quiet, minute_of_day(6, 59).unwrap()));
    assert!(!quiet_hours_active(&quiet, minute_of_day(7, 0).unwrap()));
    assert!(!quiet_hours_active(&quiet, minute_of_day(21, 59).unwrap()));
    assert!(validate_quiet_hours(&quiet).is_ok());
}

#[test]
fn equal_hours_all_day() {
    let quiet = QuietHours {
        enabled: true,
        start_minute: 600,
        end_minute: 600,
    };
    for minute in [0, 1, 599, 600, 601, 1439] {
        assert!(quiet_hours_active(&quiet, minute), "minute {minute}");
    }
    let disabled = QuietHours {
        enabled: false,
        ..quiet
    };
    assert!(!quiet_hours_active(&disabled, 600));
    assert!(validate_quiet_hours(&QuietHours {
        enabled: true,
        start_minute: 1440,
        end_minute: 0,
    })
    .is_err());
}

#[test]
fn quiet_hours_pause_background_only() {
    let rules = BackgroundRules {
        quiet_hours: QuietHours {
            enabled: true,
            start_minute: 1320,
            end_minute: 420,
        },
        ..BackgroundRules::default()
    };
    let mut input = inputs(rules.quiet_hours);
    input.local_minute = 23 * 60;
    assert_eq!(evaluate(&rules, &input), BackgroundGate::QuietHours);

    input.fullscreen = true;
    assert_eq!(evaluate(&rules, &input), BackgroundGate::Fullscreen);
    input.fullscreen = false;
    input.globally_paused = true;
    assert_eq!(evaluate(&rules, &input), BackgroundGate::Paused);
    input.globally_paused = false;
    input.enabled = false;
    assert_eq!(evaluate(&rules, &input), BackgroundGate::Disabled);
    input.enabled = true;
    input.only_ac = true;
    input.ac = None;
    input.local_minute = 12 * 60;
    assert_eq!(evaluate(&rules, &input), BackgroundGate::Ac);
    input.only_ac = false;
    input.only_idle = true;
    input.idle_ms = 29_999;
    assert_eq!(evaluate(&rules, &input), BackgroundGate::Idle);
    input.idle_ms = 30_000;
    assert_eq!(evaluate(&rules, &input), BackgroundGate::Allowed);
}

#[test]
fn pause_all_checkpoints_within100ms() {
    let gate = Arc::new(PauseGate::new());
    let checkpoint =
        BackgroundCheckpoint::new(Arc::clone(&gate), new_cancellation_token(), false);
    let (sender, receiver) = mpsc::channel();
    let started = Instant::now();
    let worker = thread::spawn(move || {
        loop {
            if checkpoint.check().is_err() {
                let _ = sender.send(started.elapsed());
                return;
            }
            thread::sleep(Duration::from_millis(2));
        }
    });
    thread::sleep(Duration::from_millis(10));
    gate.pause_all();
    let elapsed = receiver
        .recv_timeout(Duration::from_millis(100))
        .expect("checkpoint did not observe the pause");
    assert!(elapsed < Duration::from_millis(100), "elapsed {elapsed:?}");
    worker.join().unwrap();
    assert!(gate.is_paused());
}

#[test]
fn foreground_export_not_silently_paused() {
    let gate = Arc::new(PauseGate::new());
    gate.pause_all();
    let token = new_cancellation_token();
    let checkpoint = BackgroundCheckpoint::new(Arc::clone(&gate), token.clone(), true);
    assert!(checkpoint.check().is_ok(), "foreground work was paused");

    token.store(true, std::sync::atomic::Ordering::Relaxed);
    assert_eq!(checkpoint.check().unwrap_err(), "background.cancelled");
}

#[test]
fn cpu_limit_is_validated_and_converted() {
    assert_eq!(validate_cpu_percent(4), Err("background.bad_request".to_string()));
    assert_eq!(validate_cpu_percent(5), Ok(5));
    assert_eq!(validate_cpu_percent(100), Ok(100));
    assert_eq!(validate_cpu_percent(101), Err("background.bad_request".to_string()));
    let limit = CpuLimit::new(25).unwrap();
    assert_eq!(limit.cpu_rate_hundredths(), 2500);
    assert!(CpuLimit::new(0).is_err());
}
