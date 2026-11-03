//! Helper processes (Step 06d): runs Adperastra.exe with a helper flag
//! inside a Windows job object with a memory limit, talks to it in JSON
//! lines, and kills it when it hangs. Step 07a reuses this.
//!
//! The helper reads one request line from its stdin and answers with lines
//! on its stdout. Nothing the helper parses can reach the app's own memory,
//! so a damaged or hostile archive can never crash or freeze Adperastra
//! (plan/rules.md R-SEC-9).

use fs_service::CancellationToken;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::Ordering;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

/// The longest line a helper may send; a longer one is treated as a crash.
pub const MAX_HELPER_LINE: usize = 8_388_608;
/// No console window pops up for the helper.
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// One thing a helper said.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HelperLine {
    Line(String),
    /// A line longer than the cap: the helper is misbehaving.
    TooLong,
    /// The helper closed its output.
    Closed,
}

/// How one conversation with a helper ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DriveEnd {
    /// The reply the caller waited for arrived.
    Finished,
    /// The cancel was asked for and the helper stopped.
    Cancelled,
}

/// How long `drive` waits: between two reads, before a silent helper counts
/// as hung, and how long a cancelled helper has to stop by itself.
#[derive(Debug, Clone, Copy)]
pub struct DriveTimings {
    pub tick: Duration,
    pub idle: Duration,
    pub grace: Duration,
}

impl Default for DriveTimings {
    fn default() -> Self {
        Self {
            tick: Duration::from_millis(100),
            idle: Duration::from_secs(30),
            grace: Duration::from_secs(5),
        }
    }
}

/// Read one line without its line ending, up to `cap` bytes. `TooLong`
/// when the line is longer; `Closed` at the end of the stream.
pub fn read_capped_line<R: BufRead>(reader: &mut R, cap: usize) -> HelperLine {
    let mut line: Vec<u8> = Vec::new();
    loop {
        let available = match reader.fill_buf() {
            Ok(buffer) => buffer,
            Err(_) => return HelperLine::Closed,
        };
        if available.is_empty() {
            return if line.is_empty() {
                HelperLine::Closed
            } else {
                finish(line, cap)
            };
        }
        if let Some(position) = available.iter().position(|byte| *byte == b'\n') {
            line.extend_from_slice(&available[..position]);
            reader.consume(position + 1);
            return finish(line, cap);
        }
        line.extend_from_slice(available);
        let length = available.len();
        reader.consume(length);
        if line.len() > cap {
            return HelperLine::TooLong;
        }
    }
}

fn finish(mut line: Vec<u8>, cap: usize) -> HelperLine {
    if line.len() > cap {
        return HelperLine::TooLong;
    }
    if line.last() == Some(&b'\r') {
        line.pop();
    }
    HelperLine::Line(String::from_utf8_lossy(&line).into_owned())
}

/// The job object a helper runs in: a memory limit, and a death sentence if
/// the app itself goes away.
pub(crate) struct JobObject(windows::Win32::Foundation::HANDLE);

// SAFETY: a kernel handle may be used from any thread; the job object only
// ever holds that handle.
unsafe impl Send for JobObject {}

impl Drop for JobObject {
    fn drop(&mut self) {
        // SAFETY: the handle came from CreateJobObjectW and is closed once.
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

impl JobObject {
    pub(crate) fn create(child: &Child, memory_limit: usize) -> Result<Self, String> {
        use std::os::windows::io::AsRawHandle;
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOB_OBJECT_LIMIT_PROCESS_MEMORY,
        };

        let failed = || "helper.start_failed".to_string();
        // SAFETY: every call below uses handles it created or was given, and
        // the limits struct outlives the call.
        unsafe {
            let handle = CreateJobObjectW(None, PCWSTR::null()).map_err(|_| failed())?;
            let job = JobObject(handle);
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY
                | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
            limits.ProcessMemoryLimit = memory_limit;
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
            .map_err(|_| failed())?;
            AssignProcessToJobObject(handle, HANDLE(child.as_raw_handle()))
                .map_err(|_| failed())?;
            Ok(job)
        }
    }
}

/// The app's side of one helper process.
pub struct HelperProcess {
    child: Child,
    stdin: Option<ChildStdin>,
    lines: Receiver<HelperLine>,
    // Kept for as long as the process runs: closing it kills the process.
    _job: JobObject,
}

impl HelperProcess {
    /// Start this executable again with a helper flag.
    pub fn spawn(flag: &str, memory_limit: usize) -> Result<HelperProcess, String> {
        let exe = std::env::current_exe().map_err(|_| "helper.start_failed".to_string())?;
        let mut command = Command::new(exe);
        command.arg(flag);
        HelperProcess::spawn_command(command, memory_limit)
    }

    /// Start this executable again with a helper flag over the framed binary
    /// transport (Step 07d E7). The line transport above is unchanged.
    #[allow(dead_code)] // Consumed by the later WebView helper kinds.
    pub fn spawn_framed(
        flag: &str,
        memory_limit: usize,
        max_frame_bytes: usize,
    ) -> Result<crate::helper_frames::FramedHelperProcess, String> {
        let exe = std::env::current_exe().map_err(|_| "helper.start_failed".to_string())?;
        let mut command = Command::new(exe);
        command.arg(flag);
        crate::helper_frames::FramedHelperProcess::spawn_command(
            command,
            memory_limit,
            max_frame_bytes,
        )
    }

    /// Start any command as a helper (the tests use PowerShell).
    pub fn spawn_command(
        mut command: Command,
        memory_limit: usize,
    ) -> Result<HelperProcess, String> {
        use std::os::windows::process::CommandExt;
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW);
        let mut child = command
            .spawn()
            .map_err(|_| "helper.start_failed".to_string())?;
        // Nothing has been written to the helper yet, so it cannot have
        // started working before it is inside the job.
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
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                match read_capped_line(&mut reader, MAX_HELPER_LINE) {
                    HelperLine::Line(line) => {
                        if sender.send(HelperLine::Line(line)).is_err() {
                            return;
                        }
                    }
                    other => {
                        let _ = sender.send(other);
                        return;
                    }
                }
            }
        });
        Ok(HelperProcess {
            child,
            stdin,
            lines: receiver,
            _job: job,
        })
    }

    pub fn send_line(&mut self, text: &str) -> Result<(), String> {
        let failed = || "helper.failed".to_string();
        let stdin = self.stdin.as_mut().ok_or_else(failed)?;
        stdin.write_all(text.as_bytes()).map_err(|_| failed())?;
        stdin.write_all(b"\n").map_err(|_| failed())?;
        stdin.flush().map_err(|_| failed())
    }

    /// The next thing the helper said, or `None` when it stayed silent.
    pub fn recv(&self, timeout: Duration) -> Option<HelperLine> {
        match self.lines.recv_timeout(timeout) {
            Ok(line) => Some(line),
            Err(RecvTimeoutError::Timeout) => None,
            Err(RecvTimeoutError::Disconnected) => Some(HelperLine::Closed),
        }
    }

    pub fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for HelperProcess {
    fn drop(&mut self) {
        self.kill();
    }
}

/// What `drive` needs from a helper: talk to it and kill it.
pub trait HelperIo {
    fn recv(&mut self, timeout: Duration) -> Option<HelperLine>;
    fn send_line(&mut self, text: &str) -> Result<(), String>;
    fn kill(&mut self);
}

impl HelperIo for HelperProcess {
    fn recv(&mut self, timeout: Duration) -> Option<HelperLine> {
        HelperProcess::recv(self, timeout)
    }

    fn send_line(&mut self, text: &str) -> Result<(), String> {
        HelperProcess::send_line(self, text)
    }

    fn kill(&mut self) {
        HelperProcess::kill(self);
    }
}

/// Talk to a helper until `on_line` is done with it, it is cancelled, or it
/// hangs. `on_line` returning `Ok(true)` ends the conversation normally.
pub fn drive(
    io: &mut dyn HelperIo,
    token: &CancellationToken,
    timings: DriveTimings,
    on_line: &mut dyn FnMut(&str) -> Result<bool, String>,
) -> Result<DriveEnd, String> {
    let mut last_line = Instant::now();
    let mut cancel_sent: Option<Instant> = None;
    loop {
        match io.recv(timings.tick) {
            Some(HelperLine::Line(line)) => {
                last_line = Instant::now();
                match on_line(&line) {
                    Ok(true) => return Ok(DriveEnd::Finished),
                    Ok(false) => {}
                    Err(error) => {
                        io.kill();
                        return Err(error);
                    }
                }
            }
            Some(HelperLine::TooLong) => {
                io.kill();
                return Err("helper.failed".to_string());
            }
            Some(HelperLine::Closed) => {
                return if cancel_sent.is_some() {
                    Ok(DriveEnd::Cancelled)
                } else {
                    Err("helper.failed".to_string())
                };
            }
            None => {}
        }
        if cancel_sent.is_none() && token.load(Ordering::Relaxed) {
            // The helper stops at the next entry it starts.
            let _ = io.send_line("cancel");
            cancel_sent = Some(Instant::now());
        }
        if cancel_sent.is_some_and(|sent| sent.elapsed() >= timings.grace) {
            io.kill();
            return Ok(DriveEnd::Cancelled);
        }
        if last_line.elapsed() >= timings.idle {
            io.kill();
            return Err("helper.timeout".to_string());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        drive, read_capped_line, DriveEnd, DriveTimings, HelperIo, HelperLine, HelperProcess,
        MAX_HELPER_LINE,
    };
    use fs_service::new_cancellation_token;
    use std::io::Cursor;
    use std::process::{Command, Stdio};
    use std::sync::atomic::Ordering;
    use std::time::Duration;

    fn lines(text: &str, cap: usize) -> Vec<HelperLine> {
        let mut reader = Cursor::new(text.as_bytes().to_vec());
        let mut out = Vec::new();
        loop {
            let line = read_capped_line(&mut reader, cap);
            let done = matches!(line, HelperLine::Closed | HelperLine::TooLong);
            out.push(line);
            if done {
                return out;
            }
        }
    }

    #[test]
    fn capped_lines() {
        assert_eq!(
            lines("a\nbb\r\nccc", 10),
            [
                HelperLine::Line("a".to_string()),
                HelperLine::Line("bb".to_string()),
                HelperLine::Line("ccc".to_string()),
                HelperLine::Closed,
            ]
        );
        assert_eq!(
            lines(&format!("{}\n", "x".repeat(20)), 10),
            [HelperLine::TooLong]
        );
        assert_eq!(lines(&"y".repeat(20), 10), [HelperLine::TooLong]);
        // A line of exactly the cap is still fine.
        assert_eq!(
            read_capped_line(&mut Cursor::new(format!("{}\n", "z".repeat(10))), 10),
            HelperLine::Line("z".repeat(10))
        );
        let _ = MAX_HELPER_LINE;
    }

    /// A helper that answers from a queue and remembers what it was told.
    struct FakeIo {
        answers: std::collections::VecDeque<HelperLine>,
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
            // Behave like a silent helper for one tick.
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
            idle: Duration::from_millis(50),
            grace: Duration::from_millis(20),
        }
    }

    fn line(text: &str) -> HelperLine {
        HelperLine::Line(text.to_string())
    }

    #[test]
    fn drives_a_helper_until_its_last_line() {
        let token = new_cancellation_token();
        let mut io = FakeIo::new(vec![line("x"), line("done")]);
        let mut seen: Vec<String> = Vec::new();
        let end = drive(&mut io, &token, timings(), &mut |text| {
            seen.push(text.to_string());
            Ok(text == "done")
        })
        .unwrap();
        assert_eq!(end, DriveEnd::Finished);
        assert_eq!(seen, ["x", "done"]);
        assert!(!io.killed);
    }

    #[test]
    fn a_helper_that_closes_is_a_failure() {
        let token = new_cancellation_token();
        let mut io = FakeIo::new(vec![HelperLine::Closed]);
        assert_eq!(
            drive(&mut io, &token, timings(), &mut |_| Ok(false)),
            Err("helper.failed".to_string())
        );
    }

    #[test]
    fn a_silent_helper_times_out_and_is_killed() {
        let token = new_cancellation_token();
        let mut io = FakeIo::new(Vec::new());
        assert_eq!(
            drive(&mut io, &token, timings(), &mut |_| Ok(false)),
            Err("helper.timeout".to_string())
        );
        assert!(io.killed);
    }

    #[test]
    fn a_cancel_is_sent_once_and_then_the_helper_is_killed() {
        let token = new_cancellation_token();
        token.store(true, Ordering::Relaxed);
        let mut io = FakeIo::new(Vec::new());
        assert_eq!(
            drive(&mut io, &token, timings(), &mut |_| Ok(false)),
            Ok(DriveEnd::Cancelled)
        );
        assert_eq!(io.sent, ["cancel"]);
        assert!(io.killed);
    }

    #[test]
    fn a_too_long_line_is_a_failure() {
        let token = new_cancellation_token();
        let mut io = FakeIo::new(vec![HelperLine::TooLong]);
        assert_eq!(
            drive(&mut io, &token, timings(), &mut |_| Ok(false)),
            Err("helper.failed".to_string())
        );
        assert!(io.killed);
    }

    fn powershell(script: &str) -> Command {
        let mut command = Command::new("powershell.exe");
        command
            .args(["-NoProfile", "-Command", script])
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        command
    }

    #[test]
    fn a_helper_line_round_trip() {
        let helper =
            HelperProcess::spawn_command(powershell("Write-Output 'hello'"), 300 * 1024 * 1024)
                .expect("the helper starts");
        assert_eq!(
            helper.recv(Duration::from_secs(20)),
            Some(HelperLine::Line("hello".to_string()))
        );
        assert_eq!(
            helper.recv(Duration::from_secs(20)),
            Some(HelperLine::Closed)
        );
    }

    #[test]
    fn the_memory_limit_applies() {
        // 600 MB inside a 300 MB job: the allocation must fail.
        let script = "$out = 'refused'; \
             try { $big = New-Object 'byte[]' 600000000; if ($big.Length -gt 0) { $out = 'allocated' } } \
             catch { $out = 'refused' }; Write-Output $out";
        let helper = HelperProcess::spawn_command(powershell(script), 300 * 1024 * 1024)
            .expect("the helper starts");
        assert_eq!(
            helper.recv(Duration::from_secs(30)),
            Some(HelperLine::Line("refused".to_string()))
        );
    }
}
