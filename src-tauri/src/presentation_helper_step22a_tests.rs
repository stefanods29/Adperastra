//! Exact Step 22a T7 transport/policy tests.
//!
//! These tests exercise the bounded native helpers: the owner/lease checks,
//! PNG header validation, frame-lease bookkeeping, audience payload shape and
//! the private-profile gate. They do **not** prove a real dual-monitor run,
//! real frame performance or a sensitive disk-leak check; those remain
//! coordinator runtime evidence. The audience queue tests are executed in
//! `src/__tests__/presentationHelper.test.ts`; the native mirror below only
//! checks that the retained queue contract is present.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use uuid::Uuid;
use zeroize::Zeroizing;

use crate::file_grant_backing::GrantedBacking;
use crate::office_edit_values::{OfficeBinaryLease, OfficeStoragePolicy};
use crate::presentation::BindingPresentationFrame;
use crate::presentation_helper_types::{
    frame_grant_of, PresentationAudienceFrame, PresentationEndAck,
};
use crate::presentation_inputs::{
    prepare_audience_frame_input_with, AudienceLeaseResolver, FrameLeaseTracker,
};
use crate::presentation_session::{intent_is_new, sensitive_frame_allowed};
use crate::webview_helper_types::{HelperAction, HelperGrantDTO};

const TOKEN: &str = "0123456789abcdef0123456789abcdef";

struct FakeResolver {
    backing: Result<Arc<GrantedBacking>, String>,
    calls: AtomicUsize,
}

impl AudienceLeaseResolver for FakeResolver {
    fn resolve(&self, _session_id: Uuid, _lease_id: Uuid) -> Result<Arc<GrantedBacking>, String> {
        self.calls.fetch_add(1, Ordering::Relaxed);
        self.backing.clone()
    }
}

fn png(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    bytes.extend_from_slice(&13u32.to_be_bytes());
    bytes.extend_from_slice(b"IHDR");
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes
}

fn backing(bytes: Vec<u8>, sensitive: bool) -> Arc<GrantedBacking> {
    let length = bytes.len() as u64;
    Arc::new(GrantedBacking::Memory {
        bytes: Arc::new(Zeroizing::new(bytes)),
        length,
        sensitive,
    })
}

fn frame(lease_id: Uuid, width: u32, height: u32, byte_len: u64, sensitive: bool) -> BindingPresentationFrame {
    BindingPresentationFrame {
        slide_id: Uuid::new_v4(),
        step_index: 0,
        has_next_step: false,
        image: OfficeBinaryLease {
            lease_id,
            token: TOKEN.to_string(),
            name: "frame.png".to_string(),
            mime: "image/png".to_string(),
            byte_len,
            width: Some(width),
            height: Some(height),
            storage_policy: if sensitive {
                OfficeStoragePolicy::Sensitive
            } else {
                OfficeStoragePolicy::Ordinary
            },
        },
        width,
        height,
        frame_revision: 1,
    }
}

fn valid() -> (FakeResolver, Uuid, Uuid, BindingPresentationFrame) {
    let lease = Uuid::new_v4();
    let bytes = png(1280, 720);
    let frame = frame(lease, 1280, 720, bytes.len() as u64, false);
    (
        FakeResolver { backing: Ok(backing(bytes, false)), calls: AtomicUsize::new(0) },
        Uuid::new_v4(),
        Uuid::new_v4(),
        frame,
    )
}

#[test]
fn frame_after_update_has_matching_grant() {
    let (resolver, session, presentation, frame) = valid();
    let grant = prepare_audience_frame_input_with(&resolver, true, session, presentation, &frame).unwrap();
    let dto = HelperGrantDTO {
        grant_id: grant.grant_id,
        token_url: format!("http://adpfile.localhost/{TOKEN}/frame.png"),
        name: grant.name.clone(),
        mime: grant.mime.clone(),
        byte_len: frame.image.byte_len,
        sensitive: false,
    };
    let audience = PresentationAudienceFrame {
        presentation_id: presentation,
        slide_id: frame.slide_id,
        frame_revision: frame.frame_revision,
        image_grant_id: grant.grant_id,
        width: frame.width,
        height: frame.height,
        black: false,
        paused: false,
    };
    assert_eq!(
        frame_grant_of(&[dto], &audience).map(|entry| entry.grant_id),
        Some(grant.grant_id)
    );
}

#[test]
fn office_lease_from_other_session_refused_before_update() {
    let (resolver, session, presentation, frame) = valid();
    let result = prepare_audience_frame_input_with(&resolver, false, session, presentation, &frame);
    assert!(result.is_err());
    assert_eq!(resolver.calls.load(Ordering::Relaxed), 0);
}

#[test]
fn revoked_office_lease_refused() {
    let lease = Uuid::new_v4();
    let frame = frame(lease, 1280, 720, 24, false);
    let resolver = FakeResolver {
        backing: Err("office_edit.changed".to_string()),
        calls: AtomicUsize::new(0),
    };
    let result = prepare_audience_frame_input_with(&resolver, true, Uuid::new_v4(), Uuid::new_v4(), &frame);
    assert!(result.is_err());
    assert_eq!(resolver.calls.load(Ordering::Relaxed), 1);
}

#[test]
fn png_header_must_match_frame_dimensions() {
    let lease = Uuid::new_v4();
    let bytes = png(640, 360);
    let frame = frame(lease, 1280, 720, bytes.len() as u64, false);
    let resolver = FakeResolver { backing: Ok(backing(bytes, false)), calls: AtomicUsize::new(0) };
    let result = prepare_audience_frame_input_with(&resolver, true, Uuid::new_v4(), Uuid::new_v4(), &frame);
    assert_eq!(result.unwrap_err(), "presentation.invalid");
}

#[test]
fn fresh_grant_id_independent_of_office_lease() {
    let (resolver, session, presentation, frame) = valid();
    let grant = prepare_audience_frame_input_with(&resolver, true, session, presentation, &frame).unwrap();
    assert_ne!(grant.grant_id, frame.image.lease_id);
}

#[test]
fn one_shot_runner_not_used() {
    let source = include_str!("presentation_session.rs");
    let worker = include_str!("presentation_worker.rs");
    assert!(source.contains("start_webview_helper"));
    assert!(!source.contains("run_webview_helper"));
    assert!(!worker.contains("run_webview_helper"));
}

#[test]
fn old_frame_lease_released_after_ack() {
    let mut tracker = FrameLeaseTracker::default();
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    let c = Uuid::new_v4();
    tracker.acknowledge(a);
    tracker.acknowledge(b);
    assert_eq!(tracker.acknowledge(c), vec![a]);
}

#[test]
fn max_two_frame_leases() {
    let mut tracker = FrameLeaseTracker::default();
    for _ in 0..5 {
        tracker.acknowledge(Uuid::new_v4());
    }
    assert_eq!(tracker.len(), 2);
}

#[test]
fn notes_field_rejected_from_audience_payload() {
    let value = serde_json::json!({
        "presentation_id": Uuid::new_v4().to_string(),
        "slide_id": Uuid::new_v4().to_string(),
        "frame_revision": 1,
        "image_grant_id": Uuid::new_v4().to_string(),
        "width": 1280,
        "height": 720,
        "black": false,
        "paused": false,
        "notes": "PRIVATE NOTES"
    });
    assert!(serde_json::from_value::<PresentationAudienceFrame>(value).is_err());
}

#[test]
fn audience_registry_never_gets_next_slide_or_notes() {
    let frame = PresentationAudienceFrame {
        presentation_id: Uuid::new_v4(),
        slide_id: Uuid::new_v4(),
        frame_revision: 1,
        image_grant_id: Uuid::new_v4(),
        width: 1280,
        height: 720,
        black: false,
        paused: false,
    };
    let value = serde_json::to_value(frame).unwrap();
    let keys: Vec<&str> = value.as_object().unwrap().keys().map(|key| key.as_str()).collect();
    assert!(!keys.contains(&"notes"));
    assert!(!keys.contains(&"next_slide"));
    assert_eq!(keys.len(), 8);
    assert!(serde_json::from_value::<PresentationEndAck>(serde_json::json!({
        "presentation_id": Uuid::new_v4().to_string(), "ended": true
    })).unwrap().is_valid());
}

#[test]
fn repeated_intent_sequence_applies_once() {
    assert!(!intent_is_new(5, 5));
    assert!(!intent_is_new(4, 5));
    assert!(intent_is_new(6, 5));
}

#[test]
fn queue16_keeps_end() {
    // The executable queue lives in the audience frontend; its exact
    // retained-entry rule (16 entries, Escape/end wins) is checked in
    // `presentationHelper.test.ts`. This test guards the shared bound and
    // that the end action is part of the audience transport.
    let source = include_str!("../../src/presentation-helper/intents.ts");
    assert!(source.contains("PRESENTATION_MAX_QUEUE"));
    assert!(source.contains("newestNonEndIndex"));
    assert!(source.contains("\"end\""));
}

#[test]
fn private_preflight_before_sensitive_frame() {
    assert!(!sensitive_frame_allowed(false, true));
    assert!(sensitive_frame_allowed(false, false));
    assert!(sensitive_frame_allowed(true, true));
    let source = include_str!("presentation_worker.rs");
    let preflight = source.find("sensitive_frame_allowed").unwrap();
    let update = source.find("update_inputs").unwrap();
    assert!(preflight < update);
}

#[test]
fn cancelled_input_update_releases_both_frames() {
    let mut tracker = FrameLeaseTracker::default();
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    tracker.acknowledge(a);
    tracker.acknowledge(b);
    assert_eq!(tracker.clear(), vec![a, b]);
    assert!(tracker.is_empty());
}

#[test]
fn unknown_parent_command_refused() {
    assert!(serde_json::from_str::<HelperAction>("\"presentation.eval\"").is_err());
    assert!(serde_json::from_str::<HelperAction>("\"presentation.frame\"").is_ok());
}
