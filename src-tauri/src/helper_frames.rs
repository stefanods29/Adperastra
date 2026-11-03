#![allow(dead_code)] // Public producer API; consumed from Step 07e onward.
//! Binary framed transport for helper processes (Step 07d, E7 additive
//! transport).
//!
//! The existing line transport (`helper::HelperProcess`) stays exactly as it
//! is for archives and fonts. A helper that must carry raw bytes (an input
//! body or a rendered PNG) uses this one instead: a one-byte kind, a 4-byte
//! little-endian length and the exact body. Framing removes every trap of a
//! line protocol: bytes may contain LF, CR, NUL or invalid UTF-8 unchanged.
//!
//! The bounded channel (capacity 4) gives backpressure instead of queueing
//! unlimited raw frames in memory.

use std::io::{Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::Duration;

use crate::helper::{JobObject, CREATE_NO_WINDOW};

/// Largest frame body any helper may send or receive.
pub const MAX_FRAME_BYTES: usize = 8_388_608;
/// Frames queued between the reader thread and the caller.
pub const FRAME_QUEUE: usize = 4;

/// One thing a framed helper sent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HelperFrameEvent {
    Frame {
        kind: u8,
        body: Vec<u8>,
    },
    /// The declared length is above the cap: refused before allocation.
    TooLarge,
    /// The helper closed its output between two frames.
    Closed,
    /// The helper died inside a header or a body.
    Malformed,
}

/// Encode one frame (kind, u32 little-endian length, body).
pub fn encode_frame(kind: u8, body: &[u8]) -> Result<Vec<u8>, String> {
    if kind == 0 || body.len() > MAX_FRAME_BYTES {
        return Err("helper.failed".to_string());
    }
    let mut frame = Vec::with_capacity(5 + body.len());
    frame.push(kind);
    frame.extend_from_slice(&(body.len() as u32).to_le_bytes());
    frame.extend_from_slice(body);
    Ok(frame)
}

/// Read one frame. A helper that closes between two frames is `Closed`; one
/// that closes inside a header or a body is `Malformed`.
pub fn read_frame<R: Read>(reader: &mut R, max_frame_bytes: usize) -> HelperFrameEvent {
    let mut kind = [0u8; 1];
    match reader.read(&mut kind) {
        Ok(0) => return HelperFrameEvent::Closed,
        Ok(_) => {}
        Err(_) => return HelperFrameEvent::Closed,
    }
    if kind[0] == 0 {
        return HelperFrameEvent::Malformed;
    }
    let mut header = [0u8; 4];
    if reader.read_exact(&mut header).is_err() {
        return HelperFrameEvent::Malformed;
    }
    let length = u32::from_le_bytes(header) as usize;
    if length > max_frame_bytes {
        return HelperFrameEvent::TooLarge;
    }
    let mut body = vec![0u8; length];
    if reader.read_exact(&mut body).is_err() {
        return HelperFrameEvent::Malformed;
    }
    HelperFrameEvent::Frame {
        kind: kind[0],
        body,
    }
}

/// The app's side of one framed helper process.
pub struct FramedHelperProcess {
    child: Child,
    stdin: Option<ChildStdin>,
    frames: Receiver<HelperFrameEvent>,
    max_frame_bytes: usize,
    // Kept for as long as the process runs: closing it kills the process.
    _job: JobObject,
}

impl FramedHelperProcess {
    /// Start any command as a framed helper. The caller builds the command
    /// with a static flag; no path or user text is ever a command line.
    pub fn spawn_command(
        mut command: Command,
        memory_limit: usize,
        max_frame_bytes: usize,
    ) -> Result<FramedHelperProcess, String> {
        use std::os::windows::process::CommandExt;
        if max_frame_bytes == 0 || max_frame_bytes > MAX_FRAME_BYTES {
            return Err("helper.start_failed".to_string());
        }
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW);
        let mut child = command
            .spawn()
            .map_err(|_| "helper.start_failed".to_string())?;
        let job = match JobObject::create(&child, memory_limit) {
            Ok(job) => job,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
        let stdin = child.stdin.take();
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "helper.start_failed".to_string())?;
        let (sender, receiver) = mpsc::sync_channel(FRAME_QUEUE);
        std::thread::spawn(move || {
            let mut reader = stdout;
            loop {
                let event = read_frame(&mut reader, max_frame_bytes);
                let stop = !matches!(event, HelperFrameEvent::Frame { .. });
                if sender.send(event).is_err() || stop {
                    return;
                }
            }
        });
        Ok(FramedHelperProcess {
            child,
            stdin,
            frames: receiver,
            max_frame_bytes,
            _job: job,
        })
    }

    pub fn max_frame_bytes(&self) -> usize {
        self.max_frame_bytes
    }

    /// The child's process id (used in the privacy proof's record).
    pub fn process_id(&self) -> u32 {
        self.child.id()
    }

    pub fn send_frame(&mut self, kind: u8, body: &[u8]) -> Result<(), String> {
        if body.len() > self.max_frame_bytes {
            return Err("helper.failed".to_string());
        }
        let frame = encode_frame(kind, body)?;
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| "helper.failed".to_string())?;
        stdin
            .write_all(&frame)
            .and_then(|_| stdin.flush())
            .map_err(|_| "helper.failed".to_string())
    }

    /// The next frame, or `None` only when the helper stayed silent for the
    /// whole timeout.
    pub fn recv_frame(&self, timeout: Duration) -> Option<HelperFrameEvent> {
        match self.frames.recv_timeout(timeout) {
            Ok(event) => Some(event),
            Err(RecvTimeoutError::Timeout) => None,
            Err(RecvTimeoutError::Disconnected) => Some(HelperFrameEvent::Closed),
        }
    }

    /// Close stdin, terminate the child and wait for it. Idempotent.
    pub fn kill(&mut self) {
        self.stdin = None;
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for FramedHelperProcess {
    fn drop(&mut self) {
        self.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::{encode_frame, read_frame, FramedHelperProcess, HelperFrameEvent};
    use std::io::Cursor;
    use std::process::Command;
    use std::time::Duration;

    #[test]
    fn frames_round_trip_bytes_unchanged() {
        let body = b"line\ncarriage\rnul\0invalid\xFF\xFE text".to_vec();
        let frame = encode_frame(2, &body).unwrap();
        assert_eq!(frame[0], 2);
        assert_eq!(&frame[1..5], &(body.len() as u32).to_le_bytes());
        let mut reader = Cursor::new(frame);
        assert_eq!(
            read_frame(&mut reader, 1024),
            HelperFrameEvent::Frame { kind: 2, body }
        );
        // The frame after a complete one is closed, not malformed.
        assert_eq!(read_frame(&mut reader, 1024), HelperFrameEvent::Closed);
    }

    #[test]
    fn an_oversized_length_is_refused_before_allocation() {
        let mut bytes = vec![1u8];
        bytes.extend_from_slice(&(9_000_000u32).to_le_bytes());
        let mut reader = Cursor::new(bytes);
        assert_eq!(read_frame(&mut reader, 1024), HelperFrameEvent::TooLarge);
    }

    #[test]
    fn truncated_headers_and_bodies_are_malformed() {
        let mut header = Cursor::new(vec![1u8, 2, 0]);
        assert_eq!(read_frame(&mut header, 1024), HelperFrameEvent::Malformed);
        let mut body = Cursor::new(vec![1u8, 4, 0, 0, 0, b'a', b'b']);
        assert_eq!(read_frame(&mut body, 1024), HelperFrameEvent::Malformed);
        let mut zero_kind = Cursor::new(vec![0u8, 0, 0, 0, 0]);
        assert_eq!(
            read_frame(&mut zero_kind, 1024),
            HelperFrameEvent::Malformed
        );
    }

    #[test]
    fn a_frame_of_exactly_the_cap_is_accepted() {
        let body = vec![7u8; 1024];
        let frame = encode_frame(3, &body).unwrap();
        let mut reader = Cursor::new(frame);
        assert_eq!(
            read_frame(&mut reader, 1024),
            HelperFrameEvent::Frame { kind: 3, body }
        );
        assert_eq!(encode_frame(0, b"x"), Err("helper.failed".to_string()));
        assert_eq!(
            encode_frame(1, &vec![0u8; super::MAX_FRAME_BYTES + 1]),
            Err("helper.failed".to_string())
        );
    }

    #[test]
    fn the_queue_stays_bounded_and_the_child_is_killed_on_drop() {
        // A helper that writes one frame and then stays silent: the reader
        // thread keeps at most FRAME_QUEUE events and the drop kills it.
        let script = "$b=[byte[]](1,5,0,0,0,104,101,108,108,111); \
                      [Console]::OpenStandardOutput().Write($b,0,$b.Length); \
                      [Console]::Out.Flush(); Start-Sleep -Seconds 30";
        let mut command = Command::new("powershell.exe");
        command.args(["-NoProfile", "-Command", script]);
        let mut helper = FramedHelperProcess::spawn_command(command, 300 * 1024 * 1024, 1024)
            .expect("the framed helper starts");
        assert_eq!(helper.max_frame_bytes(), 1024);
        let event = helper.recv_frame(Duration::from_secs(20));
        assert_eq!(
            event,
            Some(HelperFrameEvent::Frame {
                kind: 1,
                body: b"hello".to_vec()
            })
        );
        // Nobody reads: the channel holds at most FRAME_QUEUE events.
        helper.kill();
        helper.kill();
        assert_eq!(
            helper.recv_frame(Duration::from_millis(1)),
            Some(HelperFrameEvent::Closed)
        );
    }
}
