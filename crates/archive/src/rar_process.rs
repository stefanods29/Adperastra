//! Talking to the installed 7-Zip (Step 06e T7). Arguments are passed one by
//! one, never through a shell; stdin carries a password only; stdout and
//! stderr are drained concurrently under caps and the child is killed when it
//! hangs. The process is still a normal child, not a file-system sandbox.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use crate::error::ArchiveError;

/// No console window ever appears.
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// How long one child may run.
pub const RAR_TIMEOUT: Duration = Duration::from_secs(60);
/// The most stderr text retained for code mapping; the rest is discarded.
pub const MAX_RAR_DIAGNOSTIC_BYTES: usize = 65_536;

/// What one captured run produced.
#[derive(Debug, Clone)]
pub struct Captured {
    pub success: bool,
    pub timed_out: bool,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

/// What one streamed run produced.
#[derive(Debug, Clone, Copy, Default)]
pub struct Streamed {
    pub success: bool,
    pub timed_out: bool,
    pub written: u64,
}

/// A runner the RAR adapter talks to. Tests supply a fake that records the
/// exact arguments and stdin.
pub trait SevenZipRunner {
    fn probe(&self) -> Result<String, ArchiveError>;
    fn capture(
        &self,
        args: &[String],
        stdin: Option<&[u8]>,
        max_stdout: usize,
    ) -> Result<Captured, ArchiveError>;
    fn stream(
        &self,
        args: &[String],
        stdin: Option<&[u8]>,
        max_bytes: u64,
        sink: &mut dyn FnMut(&[u8]) -> Result<(), ArchiveError>,
    ) -> Result<Streamed, ArchiveError>;
}

/// The real, separately installed 7-Zip.
pub struct InstalledSevenZip {
    pub exe: PathBuf,
}

impl InstalledSevenZip {
    pub fn discover() -> Result<Self, ArchiveError> {
        Ok(Self {
            exe: crate::rar_probe::discover()?,
        })
    }

    pub fn at(exe: &Path) -> Self {
        Self {
            exe: exe.to_path_buf(),
        }
    }

    fn spawn(&self, args: &[String]) -> Result<Child, ArchiveError> {
        let mut command = Command::new(&self.exe);
        command
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        command.spawn().map_err(|_| ArchiveError::SevenZipMissing)
    }
}

/// Write the password (one line) or close stdin immediately.
fn feed_stdin(child: &mut Child, secret: Option<&[u8]>) {
    let Some(mut input) = child.stdin.take() else {
        return;
    };
    if let Some(secret) = secret {
        let _ = input.write_all(secret);
        let _ = input.write_all(b"\n");
        let _ = input.flush();
    }
    // Dropping closes the pipe, which tells 7-Zip no password will follow.
    drop(input);
}

fn wait_with_timeout(child: &mut Child, started: Instant) -> bool {
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return false,
            Ok(None) => {}
            Err(_) => return false,
        }
        if started.elapsed() >= RAR_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return true;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

impl SevenZipRunner for InstalledSevenZip {
    fn probe(&self) -> Result<String, ArchiveError> {
        let captured = self.capture(&[], None, 65_536)?;
        if captured.timed_out || !captured.success {
            return Err(ArchiveError::SevenZipUnsupported);
        }
        let mut text = String::from_utf8_lossy(&captured.stdout).into_owned();
        if text.trim().is_empty() {
            text = String::from_utf8_lossy(&captured.stderr).into_owned();
        }
        crate::rar_probe::parse_version(&text).ok_or(ArchiveError::SevenZipUnsupported)
    }

    fn capture(
        &self,
        args: &[String],
        stdin: Option<&[u8]>,
        max_stdout: usize,
    ) -> Result<Captured, ArchiveError> {
        let mut child = self.spawn(args)?;
        feed_stdin(&mut child, stdin);
        let stdout = child
            .stdout
            .take()
            .ok_or(ArchiveError::SevenZipUnsupported)?;
        let stderr = child
            .stderr
            .take()
            .ok_or(ArchiveError::SevenZipUnsupported)?;
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let mut reader = stdout;
            let mut collected = Vec::new();
            let mut buffer = vec![0u8; 65_536];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(read) => {
                        if collected.len() + read > max_stdout {
                            let _ = sender.send(Err(()));
                            return;
                        }
                        collected.extend_from_slice(&buffer[..read]);
                    }
                    Err(_) => {
                        let _ = sender.send(Err(()));
                        return;
                    }
                }
            }
            let _ = sender.send(Ok(collected));
        });
        let stderr_thread = std::thread::spawn(move || {
            let mut reader = stderr;
            let mut kept = Vec::new();
            let mut buffer = vec![0u8; 8_192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(read) => {
                        if kept.len() < MAX_RAR_DIAGNOSTIC_BYTES {
                            let room = MAX_RAR_DIAGNOSTIC_BYTES - kept.len();
                            kept.extend_from_slice(&buffer[..read.min(room)]);
                        }
                    }
                    Err(_) => break,
                }
            }
            kept
        });
        let started = Instant::now();
        let timed_out = wait_with_timeout(&mut child, started);
        let status = child.wait().ok();
        let collected = receiver.recv_timeout(Duration::from_secs(5));
        let stderr = stderr_thread.join().unwrap_or_default();
        if timed_out {
            return Ok(Captured {
                success: false,
                timed_out: true,
                stdout: Vec::new(),
                stderr,
            });
        }
        let stdout = match collected {
            Ok(Ok(bytes)) => bytes,
            _ => {
                return Err(ArchiveError::AmbiguousRar);
            }
        };
        Ok(Captured {
            success: status.is_some_and(|status| status.success()),
            timed_out: false,
            stdout,
            stderr,
        })
    }

    fn stream(
        &self,
        args: &[String],
        stdin: Option<&[u8]>,
        max_bytes: u64,
        sink: &mut dyn FnMut(&[u8]) -> Result<(), ArchiveError>,
    ) -> Result<Streamed, ArchiveError> {
        let mut child = self.spawn(args)?;
        feed_stdin(&mut child, stdin);
        let stdout = child
            .stdout
            .take()
            .ok_or(ArchiveError::SevenZipUnsupported)?;
        let stderr = child
            .stderr
            .take()
            .ok_or(ArchiveError::SevenZipUnsupported)?;
        let (sender, receiver) = mpsc::channel::<Option<Vec<u8>>>();
        std::thread::spawn(move || {
            let mut reader = stdout;
            let mut buffer = vec![0u8; 65_536];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        let _ = sender.send(None);
                        return;
                    }
                    Ok(read) => {
                        if sender.send(Some(buffer[..read].to_vec())).is_err() {
                            return;
                        }
                    }
                    Err(_) => {
                        let _ = sender.send(None);
                        return;
                    }
                }
            }
        });
        let stderr_thread = std::thread::spawn(move || {
            let mut reader = stderr;
            let mut kept = Vec::new();
            let mut buffer = vec![0u8; 8_192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(read) => {
                        if kept.len() < MAX_RAR_DIAGNOSTIC_BYTES {
                            let room = MAX_RAR_DIAGNOSTIC_BYTES - kept.len();
                            kept.extend_from_slice(&buffer[..read.min(room)]);
                        }
                    }
                    Err(_) => break,
                }
            }
            kept
        });
        let started = Instant::now();
        let mut written = 0u64;
        let mut timed_out = false;
        loop {
            if started.elapsed() >= RAR_TIMEOUT {
                let _ = child.kill();
                timed_out = true;
                break;
            }
            match receiver.recv_timeout(Duration::from_millis(50)) {
                Ok(Some(chunk)) => {
                    written = written.saturating_add(chunk.len() as u64);
                    if written > max_bytes {
                        let _ = child.kill();
                        let _ = child.wait();
                        let _ = stderr_thread.join();
                        return Err(ArchiveError::OutputChanged);
                    }
                    sink(&chunk)?;
                }
                Ok(None) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        if !timed_out {
            wait_with_timeout(&mut child, started);
        }
        let status = child.wait().ok();
        let _stderr = stderr_thread.join().unwrap_or_default();
        Ok(Streamed {
            success: !timed_out && status.is_some_and(|status| status.success()),
            timed_out,
            written,
        })
    }
}
