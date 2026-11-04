//! Volume-wait tests (Step 09j T2).

use super::{optical_device_number, physical_drive_number, wait_for_volumes};
use fs_service::new_cancellation_token;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

#[test]
fn physical_drive_paths_are_parsed() {
    assert_eq!(physical_drive_number(r"\\.\PhysicalDrive0"), Some(0));
    assert_eq!(physical_drive_number(r"\\.\PhysicalDrive12"), Some(12));
    assert_eq!(physical_drive_number(r"\\?\PhysicalDrive3"), Some(3));
    assert_eq!(physical_drive_number("physicaldrive7"), Some(7));
    assert_eq!(physical_drive_number(r"\\.\C:"), None);
    assert_eq!(physical_drive_number(r"\\.\PhysicalDrive"), None);
    assert_eq!(physical_drive_number(r"\\.\PhysicalDriveX"), None);
}

#[test]
fn optical_device_paths_are_parsed() {
    assert_eq!(optical_device_number(r"\\.\CdRom0"), Some(0));
    assert_eq!(optical_device_number(r"\\?\CDROM12"), Some(12));
    assert_eq!(optical_device_number("cdrom3"), Some(3));
    assert_eq!(optical_device_number(r"\\.\CdRom"), None);
    assert_eq!(optical_device_number(r"\\.\PhysicalDrive1"), None);
}

#[test]
fn the_first_nonempty_scan_wins() {
    let token = new_cancellation_token();
    let mut scans = 0;
    let roots = wait_for_volumes(
        || {
            scans += 1;
            if scans < 3 {
                Vec::new()
            } else {
                vec![r"Q:\".to_string(), r"F:\".to_string()]
            }
        },
        &token,
        Instant::now() + Duration::from_secs(5),
        Duration::from_millis(1),
        |_| {},
        |_| {},
    )
    .unwrap();
    assert_eq!(roots, [r"F:\".to_string(), r"Q:\".to_string()]);
    assert_eq!(scans, 3);
}

#[test]
fn a_cancel_stops_the_wait() {
    let token = new_cancellation_token();
    token.store(true, Ordering::Relaxed);
    let mut scans = 0;
    let error = wait_for_volumes(
        || {
            scans += 1;
            Vec::new()
        },
        &token,
        Instant::now() + Duration::from_secs(5),
        Duration::from_millis(1),
        |_| {},
        |_| {},
    )
    .unwrap_err();
    assert_eq!(error, "disk.cancelled");
    assert_eq!(scans, 0);
}

#[test]
fn a_slow_driver_times_out_without_freezing() {
    let token = new_cancellation_token();
    let started = Instant::now();
    let error = wait_for_volumes(
        Vec::new,
        &token,
        Instant::now() + Duration::from_millis(20),
        Duration::from_millis(1),
        |_| {},
        |_| {},
    )
    .unwrap_err();
    assert_eq!(error, "disk.timeout");
    assert!(started.elapsed() < Duration::from_secs(2));
}

#[test]
fn progress_never_runs_past_the_limit() {
    let token = new_cancellation_token();
    let mut seen = Vec::new();
    let _ = wait_for_volumes(
        Vec::new,
        &token,
        Instant::now() + Duration::from_millis(30),
        Duration::from_millis(5),
        |_| {},
        |seconds| seen.push(seconds),
    );
    assert!(!seen.is_empty());
    assert!(seen.iter().all(|seconds| *seconds <= 10));
}
