//! Bounded streams to one engine child (Step 12b T2).
//!
//! Every stream is read on its own thread into bounded messages. A child that
//! writes more than the cap is a bounded failure, not a reason to grow memory;
//! its pipe keeps being drained so it can never block the parent while it is
//! being stopped.
//!
//! Nothing here interprets document text. stdout of the Office actor is
//! protocol only (see `engine_session_protocol`), and stderr is reduced to the
//! stable `EngineDiagnostic` codes of `engine_types`.
#![allow(dead_code)]

use std::io::Read;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::Duration;

use crate::engine_types::EngineDiagnostic;

/// The most stderr text one invocation may produce (D4: 1 MiB).
pub const MAX_STDERR_BYTES: usize = 1024 * 1024;
/// One protocol or progress line is at most 64 KiB.
pub const MAX_LINE_BYTES: usize = 64 * 1024;

/// One thing a bounded reader saw.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamItem {
    /// One line without its line ending.
    Line(String),
    /// The stream ended.
    Closed,
    /// More bytes arrived than the caller allowed.
    Overflow,
}

/// Read `reader` line by line on a thread of its own.
///
/// At most `cap` bytes are kept; after that the reader keeps draining and
/// discards, and reports `StreamItem::Overflow` exactly once.
pub fn spawn_line_reader<R: Read + Send + 'static>(
    mut reader: R,
    cap: usize,
) -> Receiver<StreamItem> {
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut pending: Vec<u8> = Vec::new();
        let mut kept = 0usize;
        let mut overflowed = false;
        let mut buffer = [0u8; 8192];
        loop {
            let read = match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => read,
                Err(_) => {
                    let _ = sender.send(StreamItem::Closed);
                    return;
                }
            };
            for byte in &buffer[..read] {
                if overflowed {
                    // Drain without keeping anything more.
                    if *byte == b'\n' {
                        pending.clear();
                    }
                    continue;
                }
                if kept >= cap {
                    overflowed = true;
                    pending.clear();
                    if sender.send(StreamItem::Overflow).is_err() {
                        return;
                    }
                    continue;
                }
                kept += 1;
                if *byte == b'\n' {
                    let mut line = std::mem::take(&mut pending);
                    if line.last() == Some(&b'\r') {
                        line.pop();
                    }
                    let text = String::from_utf8_lossy(&line).into_owned();
                    if sender.send(StreamItem::Line(text)).is_err() {
                        return;
                    }
                    continue;
                }
                pending.push(*byte);
                if pending.len() > MAX_LINE_BYTES {
                    overflowed = true;
                    pending.clear();
                    if sender.send(StreamItem::Overflow).is_err() {
                        return;
                    }
                }
            }
        }
        if !overflowed && !pending.is_empty() {
            let text = String::from_utf8_lossy(&pending).into_owned();
            let _ = sender.send(StreamItem::Line(text));
        }
        let _ = sender.send(StreamItem::Closed);
    });
    receiver
}

/// The next item, or `None` while the reader stayed silent within `wait`.
pub fn next_item(receiver: &Receiver<StreamItem>, wait: Duration) -> Option<StreamItem> {
    match receiver.recv_timeout(wait) {
        Ok(item) => Some(item),
        Err(RecvTimeoutError::Timeout) => None,
        Err(RecvTimeoutError::Disconnected) => Some(StreamItem::Closed),
    }
}

/// The next frame, or `None` while the reader stayed silent within `wait`.
pub fn next_frame(receiver: &Receiver<FrameItem>, wait: Duration) -> Option<FrameItem> {
    match receiver.recv_timeout(wait) {
        Ok(item) => Some(item),
        Err(RecvTimeoutError::Timeout) => None,
        Err(RecvTimeoutError::Disconnected) => Some(FrameItem::Closed),
    }
}

/// One item of a framed stream (the Office actor's stdout).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FrameItem {
    /// One complete frame: its kind and its bounded payload.
    Frame { kind: u8, payload: Vec<u8> },
    /// The stream ended.
    Closed,
    /// A frame was oversized or truncated: the actor is not trustworthy.
    Invalid,
}

/// Read framed messages on a thread of its own. The Office actor's stdout is
/// binary (`kind u8` + `length u32LE`), so it is never split on newlines.
pub fn spawn_frame_reader<R: Read + Send + 'static>(
    mut reader: R,
    max_payload: usize,
) -> Receiver<FrameItem> {
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || loop {
        match crate::engine_session_protocol::read_frame(&mut reader, max_payload) {
            Ok(Some((kind, payload))) => {
                if sender.send(FrameItem::Frame { kind, payload }).is_err() {
                    return;
                }
            }
            Ok(None) => {
                let _ = sender.send(FrameItem::Closed);
                return;
            }
            Err(_) => {
                let _ = sender.send(FrameItem::Invalid);
                return;
            }
        }
    });
    receiver
}

/// Monotonic completed time of one export, in microseconds (D4).
#[derive(Debug, Default, Clone, Copy)]
pub struct ProgressTracker {
    completed_us: u64,
}

impl ProgressTracker {
    /// Read one `-progress pipe:1` line. Unknown keys are ignored, a value
    /// that goes backwards is clamped, and a non-number is ignored.
    pub fn observe(&mut self, line: &str) {
        let Some((key, value)) = line.split_once('=') else {
            return;
        };
        let value = value.trim();
        if key.trim() == "out_time_us" {
            if let Ok(reported) = value.parse::<u64>() {
                self.completed_us = self.completed_us.max(reported);
            }
        }
    }

    /// The monotonic completed time seen so far.
    pub fn completed_us(&self) -> u64 {
        self.completed_us
    }
}

/// Reduce bounded stderr text to the stable codes the UI may show. This is
/// evidence only: success never comes from stderr (D8).
pub fn classify_stderr(text: &str) -> Vec<EngineDiagnostic> {
    let lowered = text.to_lowercase();
    let mut codes: Vec<EngineDiagnostic> = Vec::new();
    fn remember(codes: &mut Vec<EngineDiagnostic>, code: EngineDiagnostic) {
        if codes.len() < crate::engine_types::MAX_STDERR_CODES && !codes.contains(&code) {
            codes.push(code);
        }
    }
    if lowered.contains("permission denied")
        || lowered.contains("access is denied")
        || lowered.contains("sandbox")
    {
        remember(&mut codes, EngineDiagnostic::SandboxDenied);
    }
    if lowered.contains("no space left") || lowered.contains("disk full") {
        remember(&mut codes, EngineDiagnostic::NoSpace);
    }
    if lowered.contains("unknown encoder") || lowered.contains("encoder not found") {
        remember(&mut codes, EngineDiagnostic::UnsupportedCodec);
    }
    if lowered.contains("unknown decoder") || lowered.contains("decoder not found") {
        remember(&mut codes, EngineDiagnostic::DecoderFailed);
    }
    if lowered.contains("invalid argument") || lowered.contains("unrecognized option") {
        remember(&mut codes, EngineDiagnostic::BadArguments);
    }
    if lowered.contains("no such file") {
        remember(&mut codes, EngineDiagnostic::MissingInput);
    }
    if lowered.contains("macro") && lowered.contains("disab") {
        remember(&mut codes, EngineDiagnostic::MacrosBlocked);
    }
    if lowered.contains("external") && lowered.contains("block") {
        remember(&mut codes, EngineDiagnostic::ExternalLinkBlocked);
    }
    if codes.is_empty() && !text.trim().is_empty() {
        codes.push(EngineDiagnostic::Unknown);
    }
    codes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readers_stop_keeping_bytes_past_the_cap() {
        let payload = "a".repeat(64) + "\n";
        let text = payload.repeat(8);
        let receiver = spawn_line_reader(std::io::Cursor::new(text.into_bytes()), 96);
        let mut saw_overflow = false;
        let mut lines = 0usize;
        while let Some(item) = next_item(&receiver, Duration::from_millis(50)) {
            match item {
                StreamItem::Line(_) => lines += 1,
                StreamItem::Overflow => saw_overflow = true,
                StreamItem::Closed => break,
            }
        }
        assert!(saw_overflow, "past the cap the reader reports overflow");
        assert!(lines >= 1, "the bounded prefix is still reported");
    }

    #[test]
    fn progress_is_monotonic() {
        let mut tracker = ProgressTracker::default();
        tracker.observe("out_time_us=2000");
        assert_eq!(tracker.completed_us(), 2000);
        tracker.observe("out_time_us=1000");
        assert_eq!(tracker.completed_us(), 2000, "never goes backwards");
        tracker.observe("frame=9");
        tracker.observe("out_time_us=not-a-number");
        assert_eq!(tracker.completed_us(), 2000);
    }

    #[test]
    fn stderr_never_becomes_a_success_signal() {
        assert!(classify_stderr("").is_empty());
        assert_eq!(
            classify_stderr("Permission denied"),
            vec![EngineDiagnostic::SandboxDenied]
        );
        assert_eq!(
            classify_stderr("something odd happened"),
            vec![EngineDiagnostic::Unknown]
        );
    }
}
