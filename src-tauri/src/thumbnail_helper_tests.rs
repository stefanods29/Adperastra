use super::{drive_helper, png_size_bytes};
use crate::helper::{DriveTimings, HelperIo, HelperLine};
use fs_service::new_cancellation_token;
use std::sync::atomic::Ordering;
use std::time::Duration;

struct FakeIo {
    answers: std::collections::VecDeque<HelperLine>,
    killed: bool,
}

impl HelperIo for FakeIo {
    fn recv(&mut self, timeout: Duration) -> Option<HelperLine> {
        if let Some(answer) = self.answers.pop_front() {
            return Some(answer);
        }
        std::thread::sleep(timeout);
        None
    }

    fn send_line(&mut self, _text: &str) -> Result<(), String> {
        Ok(())
    }

    fn kill(&mut self) {
        self.killed = true;
    }
}

fn timings() -> DriveTimings {
    DriveTimings {
        tick: Duration::from_millis(1),
        idle: Duration::from_millis(20),
        grace: Duration::from_millis(10),
    }
}

#[test]
fn png_size_checks_signature_and_ihdr() {
    let mut png = vec![0u8; 24];
    png[..8].copy_from_slice(&[0x89, b'P', b'N', b'G', 13, 10, 26, 10]);
    png[8..12].copy_from_slice(&13u32.to_be_bytes());
    png[12..16].copy_from_slice(b"IHDR");
    png[16..20].copy_from_slice(&128u32.to_be_bytes());
    png[20..24].copy_from_slice(&64u32.to_be_bytes());
    assert_eq!(png_size_bytes(&png), Some((128, 64)));
    assert_eq!(png_size_bytes(&png[..20]), None);
    let mut wrong = png.clone();
    wrong[0] = 0;
    assert_eq!(png_size_bytes(&wrong), None);
}

#[test]
fn timeout_and_cancel_never_publish_and_keep_the_source() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source.png");
    std::fs::write(&source, b"unchanged").unwrap();

    let mut silent = FakeIo {
        answers: Default::default(),
        killed: false,
    };
    let token = new_cancellation_token();
    assert_eq!(
        drive_helper(&mut silent, &token, timings()),
        Err("thumbnail.failed".to_string())
    );
    assert!(silent.killed);

    let mut silent = FakeIo {
        answers: Default::default(),
        killed: false,
    };
    token.store(true, Ordering::Relaxed);
    assert_eq!(
        drive_helper(&mut silent, &token, timings()),
        Err("background.cancelled".to_string())
    );
    assert!(silent.killed);
    assert_eq!(std::fs::read(&source).unwrap(), b"unchanged");
}
