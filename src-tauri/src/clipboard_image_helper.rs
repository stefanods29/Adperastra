//! Isolated clipboard image parser. The parent never gives it a file path.

use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

pub const HELPER_FLAG: &str = "--clipboard-image-helper";
const MAX_OUTPUT: u64 = 321 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(15);

/// Read exactly one binary length-prefixed response, rejecting trailing bytes.
fn read_response(mut input: impl Read, limit: u64) -> std::io::Result<Vec<u8>> {
    let mut header = [0u8; 8];
    input.read_exact(&mut header)?;
    let size = u64::from_le_bytes(header);
    if size == 0 || size > limit {
        return Err(std::io::ErrorKind::InvalidData.into());
    }
    let mut bytes = vec![0; size as usize];
    input.read_exact(&mut bytes)?;
    let mut extra = [0];
    if input.read(&mut extra)? != 0 {
        return Err(std::io::ErrorKind::InvalidData.into());
    }
    Ok(bytes)
}

#[cfg(windows)]
struct Job(windows::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl Job {
    fn attach(child: &std::process::Child) -> windows::core::Result<Self> {
        use std::os::windows::io::AsRawHandle;
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_PROCESS_MEMORY,
        };
        // SAFETY: null attributes and name request a new unnamed job; the
        // returned owned handle is closed by Job::drop.
        let job = Self(unsafe { CreateJobObjectW(None, windows::core::PCWSTR::null()) }?);
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT(
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE.0 | JOB_OBJECT_LIMIT_PROCESS_MEMORY.0,
        );
        limits.ProcessMemoryLimit = 1536 * 1024 * 1024;
        // SAFETY: limits is initialized and remains valid for this call;
        // child and job handles are live and owned by their Rust wrappers.
        unsafe {
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&limits) as u32,
            )?;
            AssignProcessToJobObject(job.0, HANDLE(child.as_raw_handle()))?;
        }
        Ok(job)
    }
}

#[cfg(windows)]
impl Drop for Job {
    fn drop(&mut self) {
        // SAFETY: this wrapper owns exactly this job handle and closes it once.
        let _ = unsafe { windows::Win32::Foundation::CloseHandle(self.0) };
    }
}

/// Spawn only this executable. The child waits for one byte before parsing,
/// so it cannot run before the parent's memory-limited job is attached.
#[cfg(windows)]
pub fn encode(format: &str) -> Result<Vec<u8>, String> {
    use std::os::windows::process::CommandExt;
    if !matches!(format, "png" | "jpg") {
        return Err("image.failed".into());
    }
    let exe = std::env::current_exe().map_err(|_| "image.failed".to_string())?;
    let mut child = Command::new(exe)
        .arg(HELPER_FLAG)
        .arg(format)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .spawn()
        .map_err(|_| "image.failed".to_string())?;
    collect(&mut child, TIMEOUT)
}

#[cfg(windows)]
fn collect(child: &mut std::process::Child, timeout: Duration) -> Result<Vec<u8>, String> {
    let job = match Job::attach(child) {
        Ok(job) => job,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("image.failed".into());
        }
    };
    let Some(mut stdin) = child.stdin.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("image.failed".into());
    };
    if stdin.write_all(&[1]).is_err() {
        let _ = child.kill();
        let _ = child.wait();
        return Err("image.failed".into());
    }
    drop(stdin);
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("image.failed".into());
    };
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let _ = tx.send(read_response(stdout, MAX_OUTPUT));
    });
    let started = Instant::now();
    let response = rx.recv_timeout(timeout).ok().and_then(Result::ok);
    let success = if response.is_some() {
        loop {
            match child.try_wait() {
                Ok(Some(status)) => break status.success(),
                Err(_) => break false,
                Ok(None) if started.elapsed() >= timeout => break false,
                Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            }
        }
    } else {
        false
    };
    if !success {
        let _ = child.kill();
    }
    let _ = child.wait();
    drop(job);
    if success {
        response.ok_or_else(|| "image.failed".into())
    } else {
        Err("image.failed".into())
    }
}

/// Helper's entry point, executed before Tauri. It blocks until contained.
#[cfg(windows)]
pub fn run(format: Option<&str>) -> i32 {
    let Some(format @ ("png" | "jpg")) = format else {
        return 2;
    };
    let mut ready = [0u8; 1];
    if std::io::stdin().read_exact(&mut ready).is_err() || ready != [1] {
        return 2;
    }
    if crate::clipboard::encode_image(format, &mut std::io::stdout()).is_ok() {
        0
    } else {
        1
    }
}

#[cfg(test)]
mod tests {
    use super::read_response;

    #[test]
    fn binary_response_rejects_truncation_oversize_zero_and_trailing_bytes() {
        assert_eq!(
            read_response(&[3, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3][..], 3).unwrap(),
            [1, 2, 3]
        );
        assert!(read_response(&[3, 0, 0, 0, 0, 0, 0, 0, 1, 2][..], 3).is_err());
        assert!(read_response(&[4, 0, 0, 0, 0, 0, 0, 0][..], 3).is_err());
        assert!(read_response(&[0; 8][..], 3).is_err());
        assert!(read_response(&[1, 0, 0, 0, 0, 0, 0, 0, 1, 2][..], 3).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn helper_timeout_kills_and_reaps_the_process() {
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};
        use std::time::{Duration, Instant};
        let mut child = Command::new("powershell.exe")
            .args(["-NoProfile", "-Command", "Start-Sleep -Seconds 30"])
            .creation_flags(0x0800_0000)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let started = Instant::now();
        assert!(super::collect(&mut child, Duration::from_millis(500)).is_err());
        assert!(started.elapsed() < Duration::from_secs(5));
        assert!(child.try_wait().unwrap().is_some());
    }

    #[cfg(windows)]
    #[test]
    fn crashed_helper_is_reaped_and_never_returns_output() {
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};
        use std::time::Duration;
        let mut child = Command::new("powershell.exe")
            .args(["-NoProfile", "-Command", "exit 4"])
            .creation_flags(0x0800_0000)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        assert!(super::collect(&mut child, Duration::from_secs(10)).is_err());
        assert!(child.try_wait().unwrap().is_some());
    }

    #[cfg(windows)]
    #[test]
    fn successful_helper_returns_the_complete_binary_frame() {
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};
        use std::time::Duration;
        let mut child = Command::new("powershell.exe")
            .args(["-NoProfile", "-Command", "$null = [Console]::OpenStandardInput().ReadByte(); $stream = [Console]::OpenStandardOutput(); $data = [byte[]](3,0,0,0,0,0,0,0,1,2,3); $stream.Write($data,0,$data.Length); $stream.Flush()"])
            .creation_flags(0x0800_0000)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
            .spawn().unwrap();
        assert_eq!(
            super::collect(&mut child, Duration::from_secs(10)).unwrap(),
            [1, 2, 3]
        );
        assert!(child.try_wait().unwrap().is_some());
    }
}
