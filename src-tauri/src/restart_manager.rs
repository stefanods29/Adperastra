//! Bounded Windows Restart Manager use (Step 09g, D1-D3).
//!
//! Inspection and normal close both run in the isolated
//! `--file-locks-helper` process. Every RM session is ended by a guard on
//! ordinary completion and on every error path. A close uses a *new*
//! session registering only the exact `RM_UNIQUE_PROCESS` chosen by the
//! user, calls `RmShutdown` with flags `0` (never `RmForceShutdown`) and
//! never falls back to terminating a process.

use crate::process_identity::ProcessIdentity;

/// Ends a Restart Manager session. Kept separate so the RAII rule can be
/// tested with a fake that records every end, including error paths.
pub trait SessionEnd {
    fn end(&mut self, handle: u32);
}

/// Run `work` with an RM session handle and always end the session after
/// it returns (or panics). This is the only way this module ends a
/// session, so no early return or error can leak one.
pub fn with_session_end<S: SessionEnd, T>(
    api: &mut S,
    handle: u32,
    work: impl FnOnce(u32) -> Result<T, String>,
) -> Result<T, String> {
    struct Guard<'a, S: SessionEnd> {
        api: &'a mut S,
        handle: u32,
    }
    impl<S: SessionEnd> Drop for Guard<'_, S> {
        fn drop(&mut self) {
            self.api.end(self.handle);
        }
    }
    let guard = Guard { api, handle };
    work(guard.handle)
}

/// The exact process list of one normal close. It is built from the
/// fresh identity, never from a path or a report row.
#[derive(Debug, Clone, PartialEq)]
pub struct ClosePlan {
    pub processes: Vec<windows::Win32::System::RestartManager::RM_UNIQUE_PROCESS>,
    /// Always `0`: forcing is not part of this step.
    pub flags: u32,
}

/// Build the close session from the verified identity. The session has
/// exactly one process and no force flag (D3).
pub fn build_close_plan(identity: &ProcessIdentity) -> ClosePlan {
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::RestartManager::RM_UNIQUE_PROCESS;
    let ticks = identity.start_ticks.parse::<u64>().unwrap_or(0);
    ClosePlan {
        processes: vec![RM_UNIQUE_PROCESS {
            dwProcessId: identity.pid,
            ProcessStartTime: FILETIME {
                dwLowDateTime: ticks as u32,
                dwHighDateTime: (ticks >> 32) as u32,
            },
        }],
        flags: 0,
    }
}

#[cfg(windows)]
mod windows_impl {
    use super::{build_close_plan, with_session_end, SessionEnd};
    use crate::file_lock_types::{
        CloseLockProcessResult, CloseLockStatus, FileLockReport, LockProcess, LockReason,
        ERR_LOCK_CHANGED, ERR_LOCK_DENIED, ERR_LOCK_FAILED, MAX_LOCK_PROCESSES,
    };
    use crate::process_identity::{identity_matches, inspect_eligibility};
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{ERROR_MORE_DATA, ERROR_SUCCESS};
    use windows::Win32::System::RestartManager::{
        RmCritical, RmEndSession, RmExplorer, RmGetList, RmRegisterResources, RmService,
        RmShutdown, RmStartSession, RmUnknownApp, RM_APP_TYPE, RM_PROCESS_INFO,
        CCH_RM_SESSION_KEY,
    };

    struct RealSessionEnd;

    impl SessionEnd for RealSessionEnd {
        fn end(&mut self, handle: u32) {
            // SAFETY: the handle came from RmStartSession and is ended once.
            unsafe {
                let _ = RmEndSession(handle);
            }
        }
    }

    fn start_session() -> Result<u32, String> {
        let mut handle = 0u32;
        let mut key = [0u16; CCH_RM_SESSION_KEY as usize + 1];
        // SAFETY: the handle and the key buffer are writable and correctly
        // sized; the session flags are zero.
        let result = unsafe {
            RmStartSession(&mut handle, Some(0), PWSTR(key.as_mut_ptr()))
        };
        if result != ERROR_SUCCESS {
            return Err(ERR_LOCK_FAILED.to_string());
        }
        Ok(handle)
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn wide_text(value: &[u16]) -> String {
        let length = value.iter().position(|unit| *unit == 0).unwrap_or(value.len());
        String::from_utf16_lossy(&value[..length])
    }

    fn start_ticks(info: &RM_PROCESS_INFO) -> String {
        let ticks = (u64::from(info.Process.ProcessStartTime.dwHighDateTime) << 32)
            | u64::from(info.Process.ProcessStartTime.dwLowDateTime);
        ticks.to_string()
    }

    fn rm_system_and_reason(application: RM_APP_TYPE) -> (bool, Option<LockReason>) {
        if application == RmCritical {
            (false, Some(LockReason::Critical))
        } else if application == RmService || application == RmExplorer {
            (true, None)
        } else if application == RmUnknownApp {
            (false, Some(LockReason::Unknown))
        } else {
            (false, None)
        }
    }

    fn process_row(info: &RM_PROCESS_INFO, owner_pid: u32) -> LockProcess {
        let pid = info.Process.dwProcessId;
        let ticks = start_ticks(info);
        let application = wide_text(&info.strAppName);
        let name = crate::process_identity::image_name(pid)
            .ok()
            .and_then(|path| {
                std::path::Path::new(&path)
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
            })
            .unwrap_or_default();
        let (system, rm_reason) = rm_system_and_reason(info.ApplicationType);
        let (mut can_close, mut reason) = inspect_eligibility(pid, &ticks, system, owner_pid);
        if let Some(rm_reason) = rm_reason {
            can_close = false;
            reason = Some(rm_reason);
        }
        LockProcess {
            pid,
            start_ticks: ticks,
            name,
            application: if application.is_empty() {
                String::new()
            } else {
                application
            },
            can_close,
            reason,
            session_id: info.TSSessionId,
        }
    }

    fn inspect_with_session(
        handle: u32,
        paths: &[String],
        owner_pid: u32,
    ) -> Result<FileLockReport, String> {
        let wide_paths: Vec<Vec<u16>> = paths.iter().map(|path| wide(path)).collect();
        let pointers: Vec<PCWSTR> = wide_paths
            .iter()
            .map(|path| PCWSTR(path.as_ptr()))
            .collect();
        // SAFETY: every pointer refers to a NUL-terminated buffer that lives
        // until RmRegisterResources returns.
        let registered = unsafe {
            RmRegisterResources(handle, Some(pointers.as_slice()), None, None)
        };
        if registered != ERROR_SUCCESS {
            return Err(ERR_LOCK_FAILED.to_string());
        }
        let mut needed = 0u32;
        let mut count = 0u32;
        let mut reasons = 0u32;
        // SAFETY: a null list with a zero count asks only for the size.
        let first = unsafe {
            RmGetList(handle, &mut needed, &mut count, None, &mut reasons)
        };
        if first != ERROR_SUCCESS && first != ERROR_MORE_DATA {
            return Err(ERR_LOCK_FAILED.to_string());
        }
        let cap = needed.min(MAX_LOCK_PROCESSES as u32);
        let mut rows = vec![RM_PROCESS_INFO::default(); cap as usize];
        let mut complete = needed == 0;
        if cap > 0 {
            let mut count = cap;
            // SAFETY: the vector has `cap` writable entries and the count
            // matches its length.
            let second = unsafe {
                RmGetList(
                    handle,
                    &mut needed,
                    &mut count,
                    Some(rows.as_mut_ptr()),
                    &mut reasons,
                )
            };
            if second == ERROR_SUCCESS {
                complete = needed <= cap;
            } else if second == ERROR_MORE_DATA && cap == MAX_LOCK_PROCESSES as u32 {
                // More than 1024 rows: report the bounded prefix honestly.
                complete = false;
            } else {
                return Err(ERR_LOCK_FAILED.to_string());
            }
            rows.truncate(count.min(cap) as usize);
        }
        let processes: Vec<LockProcess> = rows
            .iter()
            .map(|info| process_row(info, owner_pid))
            .collect();
        let folder_nonrecursive = paths.iter().any(|path| {
            std::fs::metadata(path)
                .map(|metadata| metadata.is_dir())
                .unwrap_or(false)
        });
        Ok(FileLockReport {
            paths: paths.to_vec(),
            processes,
            complete,
            folder_nonrecursive,
            error_code: if complete {
                None
            } else {
                Some(ERR_LOCK_FAILED.to_string())
            },
        })
    }

    /// Inspect one bounded list of files or folders. Folders are inspected
    /// as items themselves; this is never a recursive lock scan.
    pub fn inspect_paths(paths: &[String], owner_pid: u32) -> Result<FileLockReport, String> {
        let handle = start_session()?;
        let mut end = RealSessionEnd;
        with_session_end(&mut end, handle, |handle| {
            inspect_with_session(handle, paths, owner_pid)
        })
    }

    /// Ask one exact process to close normally. Always a fresh session with
    /// only that process; no force flag exists anywhere in this module.
    pub fn close_process(
        pid: u32,
        expected_ticks: &str,
        owner_pid: u32,
    ) -> Result<CloseLockProcessResult, String> {
        if pid <= 4 {
            return Ok(CloseLockProcessResult {
                status: CloseLockStatus::Refused,
                reason: Some(ERR_LOCK_DENIED.to_string()),
            });
        }
        let actual = match crate::process_identity::capture_optional(pid)? {
            Some(actual) => actual,
            None => {
                return Ok(CloseLockProcessResult {
                    status: CloseLockStatus::AlreadyClosed,
                    reason: None,
                })
            }
        };
        if identity_matches(expected_ticks, &actual).is_err() {
            return Ok(CloseLockProcessResult {
                status: CloseLockStatus::Refused,
                reason: Some(ERR_LOCK_CHANGED.to_string()),
            });
        }
        let actual = match crate::process_identity::verify_for_close(
            pid,
            expected_ticks,
            false,
            owner_pid,
        ) {
            Ok(actual) => actual,
            Err(code) => {
                return Ok(CloseLockProcessResult {
                    status: CloseLockStatus::Refused,
                    reason: Some(code),
                });
            }
        };
        let plan = build_close_plan(&actual);
        let handle = start_session()?;
        let mut end = RealSessionEnd;
        let requested = with_session_end(&mut end, handle, |handle| {
            // SAFETY: the plan holds exactly one process built from the
            // fresh identity; the process array outlives the call.
            let registered = unsafe {
                RmRegisterResources(handle, None, Some(plan.processes.as_slice()), None)
            };
            if registered != ERROR_SUCCESS {
                return Ok(false);
            }
            // SAFETY: flags 0 means a normal shutdown request; forcing is
            // never used. A null status callback means no progress display.
            let shutdown = unsafe { RmShutdown(handle, plan.flags, None) };
            Ok(shutdown == ERROR_SUCCESS)
        })?;
        if requested {
            Ok(CloseLockProcessResult {
                status: CloseLockStatus::Requested,
                reason: None,
            })
        } else {
            Ok(CloseLockProcessResult {
                status: CloseLockStatus::Refused,
                reason: Some(ERR_LOCK_DENIED.to_string()),
            })
        }
    }
}

#[cfg(windows)]
pub use windows_impl::{close_process, inspect_paths};

#[cfg(test)]
mod tests {
    use super::{build_close_plan, with_session_end, SessionEnd};
    use crate::process_identity::ProcessIdentity;

    #[test]
    fn close_session_contains_only_selected_process() {
        let plan = build_close_plan(&ProcessIdentity {
            pid: 4242,
            start_ticks: "133000000000000000".to_string(),
        });
        assert_eq!(plan.processes.len(), 1);
        assert_eq!(plan.processes[0].dwProcessId, 4242);
        let ticks = (u64::from(plan.processes[0].ProcessStartTime.dwHighDateTime) << 32)
            | u64::from(plan.processes[0].ProcessStartTime.dwLowDateTime);
        assert_eq!(ticks, 133_000_000_000_000_000);
    }

    #[test]
    fn no_force_flags() {
        let plan = build_close_plan(&ProcessIdentity {
            pid: 7,
            start_ticks: "133000000000000001".to_string(),
        });
        assert_eq!(plan.flags, 0);
    }

    #[test]
    fn session_ended_on_all_errors() {
        struct Fake {
            ended: Vec<u32>,
        }
        impl SessionEnd for Fake {
            fn end(&mut self, handle: u32) {
                self.ended.push(handle);
            }
        }
        let mut fake = Fake { ended: Vec::new() };
        assert_eq!(
            with_session_end(&mut fake, 11, |_| Err::<(), String>("locks.failed".to_string())),
            Err("locks.failed".to_string())
        );
        assert_eq!(fake.ended, [11]);
        assert_eq!(with_session_end(&mut fake, 12, |_| Ok(7)).unwrap(), 7);
        assert_eq!(fake.ended, [11, 12]);
    }

    #[test]
    #[ignore = "coordinator fixture: opens a separate PowerShell handle"]
    fn real_fixture_open_handle_identified() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("held-open.txt");
        std::fs::write(&path, b"held").unwrap();
        let mut child = std::process::Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-Command",
                "$f = [System.IO.File]::Open($env:ADP_LOCK_FIXTURE, 'Open', 'ReadWrite', 'None'); Start-Sleep -Seconds 15; $f.Dispose()",
            ])
            .env("ADP_LOCK_FIXTURE", &path)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("the holder starts");
        std::thread::sleep(std::time::Duration::from_secs(2));
        let report = super::inspect_paths(
            &[path.to_string_lossy().into_owned()],
            std::process::id(),
        )
        .unwrap();
        let _ = child.kill();
        let _ = child.wait();
        assert!(
            report.processes.iter().any(|row| row.pid == child.id()),
            "the separate holder process must be reported"
        );
    }
}
