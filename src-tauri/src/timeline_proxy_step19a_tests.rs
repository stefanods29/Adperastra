//! Step 19a T4: proxy identity, scrub generations, inactive pause and lease
//! release. These are the pure parts of the native proxy job; the confined
//! engine run and real cache are coordinator evidence, not unit-test claims.

use fs_service::SourceStamp;

use super::{
    preview_should_run, proxy_identity_changes_with_source, thumbnail_window,
    thumbnail_window_complete, ProxyIdentity, ProxyLeases, ProxyQuality, SeekGate,
    TIMELINE_THUMBNAIL_MAX,
};

fn stamp(ticks: &str) -> SourceStamp {
    SourceStamp {
        path_key: "C:\\media\\clip.mp4".to_string(),
        volume_id: "0a1b2c3d".to_string(),
        file_id: "00112233445566aa".to_string(),
        modified_ticks: ticks.to_string(),
        size_bytes: 4096,
    }
}

/// `sourcechanged_cacheinvalid`: a subsecond source change is a new identity.
#[test]
fn sourcechanged_cacheinvalid() {
    let before = stamp("133000000000000001");
    let after = stamp("133000000000000002");
    assert!(proxy_identity_changes_with_source(
        &before,
        &after,
        ProxyQuality::Edge960,
        "9.0.2"
    ));
    assert!(!proxy_identity_changes_with_source(
        &before,
        &before,
        ProxyQuality::Edge960,
        "9.0.2"
    ));
    let identity = ProxyIdentity {
        stamp: before.clone(),
        stream: "video".to_string(),
        engine_version: "9.0.2".to_string(),
        quality: 960,
    };
    assert!(identity.options_key().len() <= 256);
    assert_ne!(
        identity.options_key(),
        ProxyIdentity {
            stamp: before,
            stream: "video".to_string(),
            engine_version: "9.0.2".to_string(),
            quality: 512,
        }
        .options_key()
    );
}

/// `stale_seekignored`: an older scrub generation never becomes current.
#[test]
fn stale_seekignored() {
    let gate = SeekGate::default();
    let first = gate.begin();
    let second = gate.begin();
    assert!(!gate.is_current(first));
    assert!(gate.is_current(second));
    let third = gate.begin();
    assert!(!gate.is_current(second));
    assert!(gate.is_current(third));
    gate.reset();
    assert!(!gate.is_current(third));
}

/// `inactive_pauses`: hidden or inactive timelines do not run preview work.
#[test]
fn inactive_pauses() {
    assert!(preview_should_run(true, false));
    assert!(!preview_should_run(false, false));
    assert!(!preview_should_run(true, true));
    assert!(!preview_should_run(false, true));
}

/// `proxycancel_releasesleases`: a cancelled job releases its lease once.
#[test]
fn proxycancel_releasesleases() {
    let leases = ProxyLeases::default();
    leases.begin("job-a");
    leases.attach("job-a", "5c2a1f0e-0d38-4f56-9a63-1f2b3c4d5e6f");
    assert_eq!(leases.live(), 1);
    assert_eq!(
        leases.cancel("job-a").as_deref(),
        Some("5c2a1f0e-0d38-4f56-9a63-1f2b3c4d5e6f")
    );
    assert_eq!(leases.live(), 0);
    // A second cancel does nothing and cannot release another lease.
    assert!(leases.cancel("job-a").is_none());

    leases.begin("job-b");
    leases.attach("job-b", "7d3b2a1f-1e49-4a67-8b74-2a3c4d5e6f70");
    assert_eq!(
        leases.complete("job-b").as_deref(),
        Some("7d3b2a1f-1e49-4a67-8b74-2a3c4d5e6f70")
    );
    assert!(leases.complete("job-b").is_none());
}

/// A thumbnail window is sorted, deduplicated and capped at 256 pictures.
#[test]
fn thumbnail_window_stays_bounded() {
    let times: Vec<u64> = (0..300u64).rev().chain([50, 50]).collect();
    let window = thumbnail_window(&times, 300);
    assert_eq!(window.len(), TIMELINE_THUMBNAIL_MAX);
    assert!(window.windows(2).all(|pair| pair[0] < pair[1]));
    assert!(!thumbnail_window_complete(300, window.len()));
    assert!(thumbnail_window_complete(256, 256));
}
