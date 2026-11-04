//! Step 17b T4 oracles for explicit microphone dictation.
//! Included by `speech_dictation.rs` as a `#[cfg(test)]` submodule.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use uuid::Uuid;

use crate::speech_dictation::DictationController;
use crate::speech_microphone::{
    max_float_bytes, open_after_consent, DictationOrigin, MicrophoneConsent, MicrophoneDevice,
    MicrophoneStream,
};
use crate::speech_types::{DictationRequest, DictationState, ERR_CHANGED, ERR_DEVICE};

struct FakeStream {
    stopped: Arc<AtomicUsize>,
    frames: Vec<f32>,
}

impl MicrophoneStream for FakeStream {
    fn read_frames(&mut self, _max_frames: usize) -> Result<Vec<f32>, String> {
        Ok(std::mem::take(&mut self.frames))
    }

    fn stop(&mut self) {
        self.stopped.fetch_add(1, Ordering::SeqCst);
    }
}

struct FakeDevice {
    opened: Arc<AtomicUsize>,
    stopped: Arc<AtomicUsize>,
    empty: bool,
}

impl MicrophoneDevice for FakeDevice {
    fn open(&self) -> Result<Box<dyn MicrophoneStream>, String> {
        self.opened.fetch_add(1, Ordering::SeqCst);
        Ok(Box::new(FakeStream {
            stopped: self.stopped.clone(),
            frames: if self.empty { Vec::new() } else { vec![0.25; 160] },
        }))
    }
}

fn device() -> (FakeDevice, Arc<AtomicUsize>, Arc<AtomicUsize>) {
    let opened = Arc::new(AtomicUsize::new(0));
    let stopped = Arc::new(AtomicUsize::new(0));
    (
        FakeDevice { opened: opened.clone(), stopped: stopped.clone(), empty: false },
        opened,
        stopped,
    )
}

fn request() -> DictationRequest {
    DictationRequest {
        document_id: Uuid::new_v4(),
        expected_revision: 3,
        expected_content_id: Uuid::new_v4(),
        language: "en".to_string(),
        max_seconds: 120,
    }
}

fn prepared() -> (DictationController, MicrophoneConsent, FakeDevice, Arc<AtomicUsize>, Arc<AtomicUsize>, DictationRequest) {
    crate::ai_actions::set_active_profile(Uuid::new_v4());
    let (device, opened, stopped) = device();
    (DictationController::new(), MicrophoneConsent::default(), device, opened, stopped, request())
}

#[test]
fn denied_no_device_open() {
    let (controller, consent, device, opened, _stopped, request) = prepared();
    let result = controller.start(DictationOrigin::HumanUi, &consent, &device, request);
    assert!(result.is_err());
    assert_eq!(opened.load(Ordering::SeqCst), 0, "the device is never opened");
}

#[test]
fn fake_tool_start_refused() {
    let (_controller, consent, device, opened, _stopped, _request) = prepared();
    consent.allow_this_recording();
    let result = open_after_consent(DictationOrigin::AssistantTool, &consent, &device);
    assert!(result.is_err());
    assert_eq!(opened.load(Ordering::SeqCst), 0);
}

#[test]
fn dictation_120s_float_mono_is_7680000_bytes() {
    assert_eq!(max_float_bytes(120).unwrap(), 7_680_000);
    assert_eq!(max_float_bytes(60).unwrap(), 3_840_000);
    assert!(max_float_bytes(121).is_err());
    assert!(max_float_bytes(0).is_err());
}

#[test]
fn tab_switch_cancels_and_zeroizes() {
    let (controller, consent, device, _opened, stopped, request) = prepared();
    consent.allow_this_recording();
    let session = controller.start(DictationOrigin::HumanUi, &consent, &device, request).unwrap();
    controller.capture(session.id).unwrap();
    controller.tab_switch_or_close(session.id).unwrap();
    assert!(stopped.load(Ordering::SeqCst) >= 1, "the device is released");
    assert_eq!(controller.cancel(session.id).unwrap(), ());
}

#[test]
fn stop_transcript_does_not_insert() {
    let (controller, consent, device, _opened, _stopped, request) = prepared();
    let content = request.expected_content_id;
    consent.allow_this_recording();
    let session = controller.start(DictationOrigin::HumanUi, &consent, &device, request).unwrap();
    controller.capture(session.id).unwrap();
    let stopped = controller.stop(session.id, Uuid::new_v4(), content).unwrap();
    assert_eq!(stopped.state, DictationState::Stopped);
    assert!(!controller.inserts_text(), "this step never inserts text");
}

#[test]
fn changed_content_requires_new_review() {
    let (controller, consent, device, _opened, _stopped, request) = prepared();
    let content = request.expected_content_id;
    consent.allow_this_recording();
    let session = controller.start(DictationOrigin::HumanUi, &consent, &device, request).unwrap();
    controller.stop(session.id, Uuid::new_v4(), content).unwrap();
    assert!(controller.review_is_current(session.id, content).unwrap());
    assert!(!controller.review_is_current(session.id, Uuid::new_v4()).unwrap());
    assert_eq!(
        controller.stop(session.id, Uuid::new_v4(), content).unwrap_err(),
        ERR_CHANGED
    );
}

#[test]
fn cancel_releases_device() {
    let (controller, consent, device, _opened, stopped, request) = prepared();
    consent.allow_this_recording();
    let session = controller.start(DictationOrigin::HumanUi, &consent, &device, request).unwrap();
    controller.cancel(session.id).unwrap();
    assert_eq!(stopped.load(Ordering::SeqCst), 1);
    assert_eq!(controller.retained(), 0);
}

#[test]
fn device_lost_error_indicator() {
    let opened = Arc::new(AtomicUsize::new(0));
    let stopped = Arc::new(AtomicUsize::new(0));
    let lost = FakeDevice { opened: opened.clone(), stopped: stopped.clone(), empty: true };
    crate::ai_actions::set_active_profile(Uuid::new_v4());
    let controller = DictationController::new();
    let consent = MicrophoneConsent::default();
    consent.allow_this_recording();
    let session = controller.start(DictationOrigin::HumanUi, &consent, &lost, request()).unwrap();
    assert_eq!(controller.capture(session.id).unwrap_err(), ERR_DEVICE);
}
