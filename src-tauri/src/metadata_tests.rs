use super::*;
use crate::helper::HelperLine;
use crate::metadata_types::{MetadataField, MetadataFieldId, MetadataValue};
use std::collections::VecDeque;

struct FakeIo {
    answers: VecDeque<HelperLine>,
    sent: Vec<String>,
    killed: bool,
}

impl FakeIo {
    fn new(answers: Vec<HelperLine>) -> Self {
        Self {
            answers: answers.into(),
            sent: Vec::new(),
            killed: false,
        }
    }
}

impl HelperIo for FakeIo {
    fn recv(&mut self, timeout: Duration) -> Option<HelperLine> {
        if let Some(answer) = self.answers.pop_front() {
            return Some(answer);
        }
        std::thread::sleep(timeout);
        None
    }

    fn send_line(&mut self, text: &str) -> Result<(), String> {
        self.sent.push(text.to_string());
        Ok(())
    }

    fn kill(&mut self) {
        self.killed = true;
    }
}

fn timings() -> DriveTimings {
    DriveTimings {
        tick: Duration::from_millis(1),
        idle: Duration::from_millis(30),
        grace: Duration::from_millis(10),
    }
}

fn stamp() -> SourceStamp {
    SourceStamp {
        path_key: r"c:\pictures\a.jpg".to_string(),
        volume_id: "00112233".to_string(),
        file_id: "8899aabbccddeeff".to_string(),
        modified_ticks: "133000000000000000".to_string(),
        size_bytes: 400,
    }
}

fn info_line() -> String {
    let mut info = MetadataInfo::new(stamp());
    info.push(MetadataField {
        id: MetadataFieldId::Width,
        value: MetadataValue::Integer { value: 400 },
    });
    let message = HelperMessage::Info {
        info: Box::new(info.finalize()),
    };
    serde_json::to_string(&message).expect("the message serializes")
}

#[test]
fn a_helper_reply_is_parsed_and_bounded() {
    let token = fs_service::new_cancellation_token();
    let mut io = FakeIo::new(vec![HelperLine::Line(info_line())]);
    let info = drive_metadata(&mut io, &token, timings()).expect("the reply is valid");
    assert_eq!(info.fields.len(), 1);
    assert_eq!(info.fields[0].id, MetadataFieldId::Width);
    assert_eq!(info.fields[0].value, MetadataValue::Integer { value: 400 });
}

#[test]
fn malformed_helper_output_is_an_error() {
    let token = fs_service::new_cancellation_token();
    let mut io = FakeIo::new(vec![HelperLine::Line("not json".to_string())]);
    assert_eq!(
        drive_metadata(&mut io, &token, timings()).err().as_deref(),
        Some("metadata.failed")
    );
    assert!(io.killed);
}

#[test]
fn a_helper_that_crashes_or_hangs_fails_without_taking_the_app_down() {
    let token = fs_service::new_cancellation_token();
    let mut crashed = FakeIo::new(vec![HelperLine::Closed]);
    assert_eq!(
        drive_metadata(&mut crashed, &token, timings())
            .err()
            .as_deref(),
        Some("metadata.failed")
    );
    let mut silent = FakeIo::new(Vec::new());
    assert_eq!(
        drive_metadata(&mut silent, &token, timings())
            .err()
            .as_deref(),
        Some("metadata.failed")
    );
    assert!(silent.killed);
}

#[test]
fn a_helper_failure_code_reaches_the_caller() {
    let token = fs_service::new_cancellation_token();
    let message = HelperMessage::Failed {
        code: "metadata.changed".to_string(),
    };
    let line = serde_json::to_string(&message).expect("the message serializes");
    let mut io = FakeIo::new(vec![HelperLine::Line(line)]);
    assert_eq!(
        drive_metadata(&mut io, &token, timings()).err().as_deref(),
        Some("metadata.changed")
    );
}

#[test]
fn a_cancelled_helper_reports_background_cancelled() {
    let token = fs_service::new_cancellation_token();
    token.store(true, std::sync::atomic::Ordering::Relaxed);
    let mut io = FakeIo::new(Vec::new());
    assert_eq!(
        drive_metadata(&mut io, &token, timings()).err().as_deref(),
        Some("background.cancelled")
    );
    assert_eq!(io.sent, ["cancel"]);
    assert!(io.killed);
}

#[test]
fn unknown_helper_errors_are_not_forwarded() {
    let token = fs_service::new_cancellation_token();
    let mut io = FakeIo::new(vec![HelperLine::Line(
        serde_json::to_string(&HelperMessage::Failed {
            code: "untrusted arbitrary error".into(),
        })
        .unwrap(),
    )]);
    assert_eq!(
        drive_metadata(&mut io, &token, timings()).unwrap_err(),
        "metadata.failed"
    );
}
#[test]
fn oversized_helper_reply_is_killed_before_deserialization() {
    let token = fs_service::new_cancellation_token();
    let mut io = FakeIo::new(vec![HelperLine::Line(
        "x".repeat(crate::metadata_helper::MAX_REPLY_BYTES + 1),
    )]);
    assert_eq!(
        drive_metadata(&mut io, &token, timings()).unwrap_err(),
        "metadata.too_large"
    );
    assert!(io.killed);
}
