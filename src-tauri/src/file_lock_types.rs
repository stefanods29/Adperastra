//! Native file-lock wire types (Step 09g, revision `file-locks-1`).
//!
//! The mirror of `src/services/fileLocks.ts`. A lock report is bounded
//! before any Restart Manager session starts: invalid process IDs, start
//! times, path counts and path lengths are refused here, never by opening
//! a helper or an RM session. Rust never returns display text; the UI
//! translates the stable codes under `errors.locks`.

use serde::{Deserialize, Serialize};

/// Most files or folders one inspection may name (Decision 1).
pub const MAX_LOCK_PATHS: usize = 256;
/// Most processes one report may contain (Decision 1).
pub const MAX_LOCK_PROCESSES: usize = 1024;
/// Longest process name or application name, in UTF-16 units.
pub const MAX_PROCESS_NAME_UTF16: usize = 256;
/// Longest decimal Windows FILETIME (`100 ns` ticks) accepted on the wire.
pub const MAX_START_TICKS_DIGITS: usize = 20;
/// A helper request line must stay inside `helper::MAX_HELPER_LINE`.
pub const MAX_HELPER_REQUEST_BYTES: usize = 7 * 1024 * 1024;

pub const ERR_LOCK_FAILED: &str = "locks.failed";
pub const ERR_LOCK_TIMEOUT: &str = "locks.timeout";
pub const ERR_LOCK_DENIED: &str = "locks.denied";
pub const ERR_LOCK_CHANGED: &str = "locks.changed";
pub const ERR_LOCK_CANCELLED: &str = "locks.cancelled";

/// Why a program cannot be asked to close from this app.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LockReason {
    System,
    Critical,
    OtherUser,
    Elevated,
    Unknown,
    #[serde(rename = "self")]
    OwnProcess,
}

/// One program Restart Manager reported for the inspected paths.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LockProcess {
    /// Process ID; never the only identity (the start time is compared).
    pub pid: u32,
    /// Process creation time as decimal Windows `100 ns` ticks.
    pub start_ticks: String,
    /// Executable file name, at most 256 UTF-16 units.
    pub name: String,
    /// Restart Manager application name, at most 256 UTF-16 units.
    pub application: String,
    /// True only when `reason` is `None` and a fresh check still allows it.
    pub can_close: bool,
    /// Why closing is refused here; absent when `can_close` is true.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<LockReason>,
    /// Windows terminal-services session id reported by Restart Manager.
    pub session_id: u32,
}

impl LockProcess {
    /// Validate one report row without touching any process.
    pub fn validate(&self) -> Result<(), String> {
        if self.pid == 0 {
            return Err(ERR_LOCK_FAILED.to_string());
        }
        if !valid_start_ticks(&self.start_ticks) {
            return Err(ERR_LOCK_FAILED.to_string());
        }
        if self.name.encode_utf16().count() > MAX_PROCESS_NAME_UTF16
            || self.application.encode_utf16().count() > MAX_PROCESS_NAME_UTF16
        {
            return Err(ERR_LOCK_FAILED.to_string());
        }
        if self.can_close == self.reason.is_some() {
            // A closable row has no reason; a refused row always has one.
            return Err(ERR_LOCK_FAILED.to_string());
        }
        Ok(())
    }
}

/// The result of one bounded inspection (mirrors `FileLockReport`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileLockReport {
    /// The validated input paths, at most 256.
    pub paths: Vec<String>,
    /// At most 1024 processes; `complete` says whether the list was cut.
    pub processes: Vec<LockProcess>,
    /// False when Restart Manager had more rows than the cap.
    pub complete: bool,
    /// True when at least one input path is a folder (not recursive).
    pub folder_nonrecursive: bool,
    /// A stable code when the report is incomplete or failed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

impl FileLockReport {
    pub fn validate(&self) -> Result<(), String> {
        validate_inspect_paths(&self.paths)?;
        if self.processes.len() > MAX_LOCK_PROCESSES {
            return Err(ERR_LOCK_FAILED.to_string());
        }
        for process in &self.processes {
            process.validate()?;
        }
        Ok(())
    }
}

/// One confirmed normal-close request (E2). `confirmed` is an explicit
/// acknowledgement of the unsaved-work warning; it is never defaulted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloseLockProcessRequest {
    pub pid: u32,
    pub start_ticks: String,
    pub confirmed: bool,
}

impl CloseLockProcessRequest {
    /// Validate before a close helper or RM session is started.
    pub fn validate(&self) -> Result<(), String> {
        if self.pid <= 4 {
            return Err(ERR_LOCK_DENIED.to_string());
        }
        if !valid_start_ticks(&self.start_ticks) {
            return Err(ERR_LOCK_FAILED.to_string());
        }
        if !self.confirmed {
            return Err(ERR_LOCK_DENIED.to_string());
        }
        Ok(())
    }
}

/// What a normal-close attempt actually did. It never promises that the
/// user's program saved its data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CloseLockStatus {
    Requested,
    AlreadyClosed,
    Refused,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloseLockProcessResult {
    pub status: CloseLockStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl CloseLockProcessResult {
    pub fn validate(&self) -> Result<(), String> {
        match self.status {
            CloseLockStatus::Requested | CloseLockStatus::AlreadyClosed => {
                if self.reason.is_some() {
                    return Err(ERR_LOCK_FAILED.to_string());
                }
            }
            CloseLockStatus::Refused => {
                if self.reason.as_deref().is_none_or(str::is_empty) {
                    return Err(ERR_LOCK_FAILED.to_string());
                }
            }
        }
        Ok(())
    }
}

/// Validate the paths of one inspection before any RM session exists.
pub fn validate_inspect_paths(paths: &[String]) -> Result<(), String> {
    if paths.is_empty() || paths.len() > MAX_LOCK_PATHS {
        return Err(ERR_LOCK_FAILED.to_string());
    }
    let mut bytes = 0usize;
    for path in paths {
        crate::validate_absolute_path(path).map_err(|_| ERR_LOCK_FAILED.to_string())?;
        if path.encode_utf16().count() > 32_768 {
            return Err(ERR_LOCK_FAILED.to_string());
        }
        bytes = bytes.saturating_add(path.len());
    }
    if bytes > MAX_HELPER_REQUEST_BYTES {
        return Err(ERR_LOCK_FAILED.to_string());
    }
    Ok(())
}

/// A decimal Windows FILETIME: 1 to 20 digits, non-zero, inside u64.
pub fn valid_start_ticks(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_START_TICKS_DIGITS
        && value.bytes().all(|byte| byte.is_ascii_digit())
        && value.parse::<u64>().is_ok_and(|ticks| ticks > 0)
}

#[cfg(test)]
mod tests {
    use super::{
        validate_inspect_paths, CloseLockProcessRequest, CloseLockProcessResult, CloseLockStatus,
        FileLockReport, LockProcess, LockReason, MAX_LOCK_PATHS, MAX_LOCK_PROCESSES,
    };

    fn process(pid: u32, close: bool) -> LockProcess {
        LockProcess {
            pid,
            start_ticks: "133000000000000000".to_string(),
            name: "notepad.exe".to_string(),
            application: "Notepad".to_string(),
            can_close: close,
            reason: if close {
                None
            } else {
                Some(LockReason::System)
            },
            session_id: 1,
        }
    }

    fn paths(count: usize) -> Vec<String> {
        (0..count)
            .map(|index| format!("C:\\locks\\file{index}.txt"))
            .collect()
    }

    #[test]
    fn invalid_pid_is_refused() {
        let mut row = process(0, true);
        assert!(row.validate().is_err());
        row.pid = 7;
        assert!(row.validate().is_ok());
        let request = CloseLockProcessRequest {
            pid: 0,
            start_ticks: "133000000000000000".to_string(),
            confirmed: true,
        };
        assert_eq!(request.validate().unwrap_err(), "locks.denied");
    }

    #[test]
    fn invalid_start_ticks_are_refused() {
        for ticks in ["", "12x", " 12", "123456789012345678901", "0"] {
            let request = CloseLockProcessRequest {
                pid: 7,
                start_ticks: ticks.to_string(),
                confirmed: true,
            };
            assert_eq!(request.validate().unwrap_err(), "locks.failed", "{ticks:?}");
        }
        let request = CloseLockProcessRequest {
            pid: 7,
            start_ticks: "133000000000000000".to_string(),
            confirmed: false,
        };
        assert_eq!(request.validate().unwrap_err(), "locks.denied");
    }

    #[test]
    fn path_limits_are_refused_before_any_session() {
        assert!(validate_inspect_paths(&[]).is_err());
        assert!(validate_inspect_paths(&paths(MAX_LOCK_PATHS)).is_ok());
        assert!(validate_inspect_paths(&paths(MAX_LOCK_PATHS + 1)).is_err());
        assert!(validate_inspect_paths(&["relative.txt".to_string()]).is_err());
        assert!(validate_inspect_paths(&["C:\\a\\..\\b.txt".to_string()]).is_err());
        let long = format!("C:\\{}", "a".repeat(32_768));
        assert!(validate_inspect_paths(&[long]).is_err());
    }

    #[test]
    fn report_limits_and_reasons_are_checked() {
        let mut report = FileLockReport {
            paths: paths(1),
            processes: vec![process(9, true)],
            complete: true,
            folder_nonrecursive: false,
            error_code: None,
        };
        assert!(report.validate().is_ok());
        report.processes = vec![process(9, true); MAX_LOCK_PROCESSES + 1];
        assert!(report.validate().is_err());
        report.processes = vec![process(9, false)];
        assert!(report.validate().is_ok());
        report.processes[0].reason = None;
        assert!(report.validate().is_err());
    }

    #[test]
    fn close_results_are_truthful() {
        assert!(CloseLockProcessResult {
            status: CloseLockStatus::Requested,
            reason: None
        }
        .validate()
        .is_ok());
        assert!(CloseLockProcessResult {
            status: CloseLockStatus::Refused,
            reason: Some("locks.denied".to_string())
        }
        .validate()
        .is_ok());
        assert!(CloseLockProcessResult {
            status: CloseLockStatus::Refused,
            reason: None
        }
        .validate()
        .is_err());
    }
}
