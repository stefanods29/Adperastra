//! Listener-order tests (Step 09j T4).

use super::{
    capture_once, open_with_retries, CaptureOutcome, CaptureSkip, ClipboardImage, ClipboardProbe,
    PrivateMarker, ProbeSnapshot, OPEN_ATTEMPTS,
};
use crate::clipboard_history_types::CapturedPayload;

struct FakeProbe {
    snapshot: ProbeSnapshot,
    text: Option<String>,
    files: Option<Vec<String>>,
    image: Option<ClipboardImage>,
    after_sequence: u32,
    log: Vec<&'static str>,
}

impl FakeProbe {
    fn new(private: Option<PrivateMarker>) -> Self {
        FakeProbe {
            snapshot: ProbeSnapshot {
                sequence: 1,
                private,
                has_text: false,
                has_files: false,
                has_image: false,
            },
            text: None,
            files: None,
            image: None,
            after_sequence: 1,
            log: Vec::new(),
        }
    }
}

impl ClipboardProbe for FakeProbe {
    fn snapshot(&mut self) -> Result<ProbeSnapshot, String> {
        self.log.push("snapshot");
        Ok(self.snapshot)
    }

    fn read_text(&mut self) -> Result<Option<String>, String> {
        self.log.push("read_text");
        Ok(self.text.clone())
    }

    fn read_files(&mut self) -> Result<Option<Vec<String>>, String> {
        self.log.push("read_files");
        Ok(self.files.clone())
    }

    fn read_image(&mut self) -> Result<Option<ClipboardImage>, String> {
        self.log.push("read_image");
        Ok(self.image.clone())
    }

    fn sequence(&self) -> u32 {
        self.after_sequence
    }
}

#[test]
fn a_private_marker_is_checked_before_any_payload_read() {
    let mut probe = FakeProbe::new(Some(PrivateMarker::ExcludeFromMonitor));
    probe.snapshot.has_text = true;
    probe.text = Some("private text".to_string());
    let outcome = capture_once(&mut probe, true);
    assert!(matches!(outcome, CaptureOutcome::Skipped(CaptureSkip::Private)));
    assert_eq!(probe.log, ["snapshot"]);
}

#[test]
fn a_sensitive_app_marker_is_skipped() {
    let mut probe = FakeProbe::new(Some(PrivateMarker::ClipboardViewerIgnore));
    probe.snapshot.has_text = true;
    let outcome = capture_once(&mut probe, true);
    assert!(matches!(outcome, CaptureOutcome::Skipped(CaptureSkip::Private)));
    assert_eq!(probe.log, ["snapshot"]);
}

#[test]
fn a_changed_sequence_discards_the_capture() {
    let mut probe = FakeProbe::new(None);
    probe.snapshot.has_text = true;
    probe.text = Some("text".to_string());
    probe.after_sequence = 2;
    let outcome = capture_once(&mut probe, true);
    assert!(matches!(outcome, CaptureOutcome::Skipped(CaptureSkip::Changed)));
    assert_eq!(probe.log, ["snapshot", "read_text"]);
}

#[test]
fn open_clipboard_tries_exactly_three_times() {
    let mut attempts = 0;
    let mut waits = 0;
    let opened = open_with_retries(
        || {
            attempts += 1;
            false
        },
        || waits += 1,
    );
    assert!(!opened);
    assert_eq!(attempts, OPEN_ATTEMPTS);
    assert_eq!(waits, OPEN_ATTEMPTS - 1);

    let mut attempts = 0;
    let opened = open_with_retries(
        || {
            attempts += 1;
            attempts == 2
        },
        || {},
    );
    assert!(opened);
    assert_eq!(attempts, 2);
}

#[test]
fn an_image_over_sixteen_megapixels_is_refused() {
    let mut probe = FakeProbe::new(None);
    probe.snapshot.has_image = true;
    probe.image = Some(ClipboardImage {
        mime: "image/png".to_string(),
        width: 4000,
        height: 4001,
        bytes: vec![1, 2, 3],
    });
    let outcome = capture_once(&mut probe, true);
    assert!(matches!(outcome, CaptureOutcome::Skipped(CaptureSkip::TooLarge)));
    assert_eq!(probe.log, ["snapshot", "read_image"]);
}

#[test]
fn files_win_over_text_and_an_image_only_bitmap_is_last() {
    let mut probe = FakeProbe::new(None);
    probe.snapshot.has_files = true;
    probe.snapshot.has_text = true;
    probe.files = Some(vec![r"C:\a.txt".to_string()]);
    let outcome = capture_once(&mut probe, true);
    match outcome {
        CaptureOutcome::Captured(CapturedPayload::Files(paths)) => {
            assert_eq!(paths, [r"C:\a.txt".to_string()]);
        }
        _ => panic!("files expected"),
    }
    assert_eq!(probe.log, ["snapshot", "read_files"]);

    let mut image = FakeProbe::new(None);
    image.snapshot.has_image = true;
    image.image = Some(ClipboardImage {
        mime: "image/png".to_string(),
        width: 2,
        height: 2,
        bytes: vec![1, 2, 3],
    });
    assert!(matches!(
        capture_once(&mut image, true),
        CaptureOutcome::Captured(CapturedPayload::Image { .. })
    ));
}

#[test]
fn disabled_capture_never_touches_the_clipboard() {
    let mut probe = FakeProbe::new(None);
    probe.snapshot.has_text = true;
    let outcome = capture_once(&mut probe, false);
    assert!(matches!(outcome, CaptureOutcome::Skipped(CaptureSkip::Disabled)));
    assert!(probe.log.is_empty());
}

#[test]
fn an_oversized_text_is_skipped_not_truncated() {
    let mut probe = FakeProbe::new(None);
    probe.snapshot.has_text = true;
    probe.text = Some("a".repeat(crate::clipboard_history_types::MAX_TEXT_SCALARS + 1));
    let outcome = capture_once(&mut probe, true);
    assert!(matches!(outcome, CaptureOutcome::Skipped(CaptureSkip::TooLarge)));
}
