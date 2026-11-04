//! Process identity and eligibility for a normal close (Step 09g, D2).
//!
//! A PID alone is never an identity: Windows reuses process IDs, so every
//! inspection and every close compares the process creation FILETIME
//! (`start_ticks`, Windows `100 ns` ticks) captured with the PID. Closing
//! is allowed only for the same user, a non-critical and non-system
//! process that is not elevated and is not this app. Nothing here calls
//! `TerminateProcess` or any force flag.

use crate::file_lock_types::{LockReason, ERR_LOCK_CHANGED};

/// The exact identity of one running process.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessIdentity {
    pub pid: u32,
    /// Creation time as decimal Windows `100 ns` ticks.
    pub start_ticks: String,
}

/// Everything the close-eligibility rule needs to know. Kept pure so the
/// denied cases can be tested without starting a real process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EligibilityFacts {
    pub pid: u32,
    pub current_pid: u32,
    pub identity_known: bool,
    pub start_ticks_match: bool,
    pub same_user: bool,
    pub critical: bool,
    pub system: bool,
    pub elevated: bool,
}

/// The first refusal reason, in the fixed safety order, or `Ok(())`.
pub fn evaluate(facts: &EligibilityFacts) -> Result<(), LockReason> {
    if !facts.identity_known || !facts.start_ticks_match {
        return Err(LockReason::Unknown);
    }
    if facts.pid == facts.current_pid {
        return Err(LockReason::OwnProcess);
    }
    if facts.pid <= 4 || facts.system {
        return Err(LockReason::System);
    }
    if facts.critical {
        return Err(LockReason::Critical);
    }
    if !facts.same_user {
        return Err(LockReason::OtherUser);
    }
    if facts.elevated {
        return Err(LockReason::Elevated);
    }
    Ok(())
}

/// Compare the start time captured at click time with a fresh capture.
pub fn identity_matches(expected_ticks: &str, actual: &ProcessIdentity) -> Result<(), String> {
    let expected = expected_ticks
        .parse::<u64>()
        .map_err(|_| ERR_LOCK_CHANGED.to_string())?;
    let actual = actual
        .start_ticks
        .parse::<u64>()
        .map_err(|_| ERR_LOCK_CHANGED.to_string())?;
    if expected == actual {
        Ok(())
    } else {
        Err(ERR_LOCK_CHANGED.to_string())
    }
}

#[cfg(windows)]
mod windows_impl {
    use super::{evaluate, identity_matches, EligibilityFacts, ProcessIdentity};
    use crate::file_lock_types::{
        LockReason, ERR_LOCK_CHANGED, ERR_LOCK_DENIED, ERR_LOCK_FAILED,
    };
    use std::ffi::c_void;
    use windows::Win32::Foundation::{
        CloseHandle, FILETIME, HANDLE, ERROR_INVALID_PARAMETER,
    };
    use windows::Win32::Security::{
        GetLengthSid, GetTokenInformation, TokenElevation, TokenUser, TOKEN_ELEVATION,
        TOKEN_QUERY, TOKEN_USER,
    };
    use windows::Win32::System::Threading::{
        GetProcessTimes, IsProcessCritical, OpenProcess, OpenProcessToken,
        QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
        PROCESS_QUERY_INFORMATION,
    };

    struct Handle(HANDLE);

    impl Drop for Handle {
        fn drop(&mut self) {
            // SAFETY: this guard owns the handle and closes it exactly once.
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    fn win32_code(error: &windows::core::Error) -> u32 {
        (error.code().0 as u32) & 0xffff
    }

    /// The creation FILETIME of a running process; `Ok(None)` when the
    /// process no longer exists (the close result is then `already_closed`).
    pub fn capture_optional(pid: u32) -> Result<Option<ProcessIdentity>, String> {
        if pid == 0 {
            return Err(ERR_LOCK_DENIED.to_string());
        }
        // SAFETY: plain Win32 query; the handle is owned by the guard.
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) };
        let handle = match handle {
            Ok(handle) => Handle(handle),
            Err(error) if win32_code(&error) == ERROR_INVALID_PARAMETER.0 => return Ok(None),
            Err(_) => return Err(ERR_LOCK_DENIED.to_string()),
        };
        let mut creation = FILETIME::default();
        let mut exit = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        // SAFETY: all four pointers are valid, writable FILETIME values and
        // the handle was opened for process queries.
        unsafe {
            GetProcessTimes(handle.0, &mut creation, &mut exit, &mut kernel, &mut user)
                .map_err(|_| ERR_LOCK_FAILED.to_string())?;
        }
        let ticks = (u64::from(creation.dwHighDateTime) << 32)
            | u64::from(creation.dwLowDateTime);
        if ticks == 0 {
            return Err(ERR_LOCK_FAILED.to_string());
        }
        Ok(Some(ProcessIdentity {
            pid,
            start_ticks: ticks.to_string(),
        }))
    }

    /// The executable's full image name, or an empty string when Windows
    /// does not allow reading it (another user's process).
    pub fn image_name(pid: u32) -> Result<String, String> {
        // SAFETY: query-only handle; the buffer is sized for a full path.
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }
            .map_err(|_| ERR_LOCK_DENIED.to_string())?;
        let handle = Handle(handle);
        let mut buffer = vec![0u16; 32_768];
        let mut length = buffer.len() as u32;
        // SAFETY: the buffer and its length are valid for the call.
        unsafe {
            QueryFullProcessImageNameW(
                handle.0,
                PROCESS_NAME_WIN32,
                windows::core::PWSTR(buffer.as_mut_ptr()),
                &mut length,
            )
            .map_err(|_| ERR_LOCK_DENIED.to_string())?;
        }
        Ok(String::from_utf16_lossy(&buffer[..length as usize]))
    }

    fn token_user_bytes(token: HANDLE) -> Result<Vec<u8>, String> {
        let mut needed = 0u32;
        // SAFETY: the first call asks for the required length only.
        let _ = unsafe {
            GetTokenInformation(token, TokenUser, None, 0, &mut needed)
        };
        if needed == 0 {
            return Err(ERR_LOCK_DENIED.to_string());
        }
        // TOKEN_USER needs pointer alignment; u64 words provide it.
        let mut words = vec![0u64; needed.div_ceil(8) as usize];
        // SAFETY: the buffer is at least `needed` bytes and aligned for
        // TOKEN_USER; Windows writes only inside it.
        unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                Some(words.as_mut_ptr() as *mut c_void),
                needed,
                &mut needed,
            )
            .map_err(|_| ERR_LOCK_DENIED.to_string())?;
            let user = &*(words.as_ptr() as *const TOKEN_USER);
            let sid = user.User.Sid;
            if sid.is_invalid() {
                return Err(ERR_LOCK_DENIED.to_string());
            }
            let length = GetLengthSid(sid);
            if length == 0 || length as usize > words.len() * 8 {
                return Err(ERR_LOCK_DENIED.to_string());
            }
            let bytes = std::slice::from_raw_parts(sid.0 as *const u8, length as usize);
            Ok(bytes.to_vec())
        }
    }

    fn current_user() -> Result<Vec<u8>, String> {
        let mut token = HANDLE::default();
        // SAFETY: the current process pseudo-handle is always valid.
        unsafe {
            OpenProcessToken(
                windows::Win32::System::Threading::GetCurrentProcess(),
                TOKEN_QUERY,
                &mut token,
            )
            .map_err(|_| ERR_LOCK_DENIED.to_string())?;
        }
        let token = Handle(token);
        token_user_bytes(token.0)
    }

    /// True only when the target token belongs to the same Windows user.
    pub fn same_user(pid: u32) -> Result<bool, String> {
        let current = current_user()?;
        // SAFETY: query-only process handle and a readable token.
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }
            .map_err(|_| ERR_LOCK_DENIED.to_string())?;
        let process = Handle(process);
        let mut token = HANDLE::default();
        // SAFETY: the handle is valid and `token` is writable.
        unsafe {
            OpenProcessToken(process.0, TOKEN_QUERY, &mut token)
                .map_err(|_| ERR_LOCK_DENIED.to_string())?;
        }
        let token = Handle(token);
        let target = token_user_bytes(token.0)?;
        Ok(current == target)
    }

    /// `IsProcessCritical`; a failed query is treated as critical (deny).
    pub fn is_critical(pid: u32) -> Result<bool, String> {
        // SAFETY: query-only handle; the boolean is writable.
        let process = unsafe { OpenProcess(PROCESS_QUERY_INFORMATION, false, pid) }
            .map_err(|_| ERR_LOCK_DENIED.to_string())?;
        let process = Handle(process);
        let mut critical = windows::core::BOOL(0);
        // SAFETY: valid handle and writable boolean.
        unsafe {
            IsProcessCritical(process.0, &mut critical)
                .map_err(|_| ERR_LOCK_DENIED.to_string())?;
        }
        Ok(critical.as_bool())
    }

    /// True when the process token is elevated.
    pub fn is_elevated(pid: u32) -> Result<bool, String> {
        // SAFETY: query-only process handle and a readable token.
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }
            .map_err(|_| ERR_LOCK_DENIED.to_string())?;
        let process = Handle(process);
        let mut token = HANDLE::default();
        // SAFETY: valid process handle and writable token handle.
        unsafe {
            OpenProcessToken(process.0, TOKEN_QUERY, &mut token)
                .map_err(|_| ERR_LOCK_DENIED.to_string())?;
        }
        let token = Handle(token);
        let mut elevation = TOKEN_ELEVATION::default();
        let mut returned = 0u32;
        // SAFETY: the buffer is exactly TOKEN_ELEVATION and writable.
        unsafe {
            GetTokenInformation(
                token.0,
                TokenElevation,
                Some(&mut elevation as *mut TOKEN_ELEVATION as *mut c_void),
                std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                &mut returned,
            )
            .map_err(|_| ERR_LOCK_DENIED.to_string())?;
        }
        Ok(elevation.TokenIsElevated != 0)
    }

    /// Fresh identity plus every eligibility fact; `Err` is a stable code.
    pub fn verify_for_close(
        pid: u32,
        expected_ticks: &str,
        system: bool,
        owner_pid: u32,
    ) -> Result<ProcessIdentity, String> {
        let actual = capture_optional(pid)?.ok_or_else(|| ERR_LOCK_CHANGED.to_string())?;
        identity_matches(expected_ticks, &actual)?;
        let same = same_user(pid).unwrap_or(false);
        let critical = is_critical(pid).unwrap_or(true);
        let elevated = is_elevated(pid).unwrap_or(true);
        evaluate(&EligibilityFacts {
            pid,
            current_pid: owner_pid,
            identity_known: true,
            start_ticks_match: true,
            same_user: same,
            critical,
            system,
            elevated,
        })
        .map_err(|reason| match reason {
            LockReason::Unknown => ERR_LOCK_CHANGED.to_string(),
            _ => ERR_LOCK_DENIED.to_string(),
        })?;
        Ok(actual)
    }

    /// Inspect-time eligibility: never fails; returns `can_close` and the
    /// reason the UI shows beside the row. `owner_pid` is the app process,
    /// which is never offered for closing (D2).
    pub fn inspect_eligibility(
        pid: u32,
        start_ticks: &str,
        system: bool,
        owner_pid: u32,
    ) -> (bool, Option<LockReason>) {
        let actual = match capture_optional(pid) {
            Ok(Some(actual)) => actual,
            _ => return (false, Some(LockReason::Unknown)),
        };
        let identity_known = true;
        let start_ticks_match = identity_matches(start_ticks, &actual).is_ok();
        let same = same_user(pid).unwrap_or(false);
        // A query we cannot make on another user's process must not be
        // reported as "critical"; the same-user check already denies it.
        let critical = is_critical(pid).unwrap_or(same);
        let elevated = is_elevated(pid).unwrap_or(same);
        let facts = EligibilityFacts {
            pid,
            current_pid: owner_pid,
            identity_known,
            start_ticks_match,
            same_user: same,
            critical,
            system,
            elevated,
        };
        match super::evaluate(&facts) {
            Ok(()) => (true, None),
            Err(reason) => (false, Some(reason)),
        }
    }
}

#[cfg(windows)]
pub use windows_impl::{
    capture_optional, image_name, inspect_eligibility,
    verify_for_close,
};

#[cfg(test)]
mod tests {
    use super::{evaluate, identity_matches, EligibilityFacts, ProcessIdentity};
    use crate::file_lock_types::LockReason;

    fn facts() -> EligibilityFacts {
        EligibilityFacts {
            pid: 100,
            current_pid: 50,
            identity_known: true,
            start_ticks_match: true,
            same_user: true,
            critical: false,
            system: false,
            elevated: false,
        }
    }

    #[test]
    fn pid_reuse_refused() {
        let actual = ProcessIdentity {
            pid: 100,
            start_ticks: "200".to_string(),
        };
        assert_eq!(
            identity_matches("100", &actual).unwrap_err(),
            "locks.changed"
        );
        assert!(identity_matches("200", &actual).is_ok());
    }

    #[test]
    fn critical_self_other_user_denied() {
        let mut own = facts();
        own.pid = own.current_pid;
        assert_eq!(evaluate(&own).unwrap_err(), LockReason::OwnProcess);
        let mut system = facts();
        system.pid = 4;
        assert_eq!(evaluate(&system).unwrap_err(), LockReason::System);
        let mut critical = facts();
        critical.critical = true;
        assert_eq!(evaluate(&critical).unwrap_err(), LockReason::Critical);
        let mut other = facts();
        other.same_user = false;
        assert_eq!(evaluate(&other).unwrap_err(), LockReason::OtherUser);
        let mut elevated = facts();
        elevated.elevated = true;
        assert_eq!(evaluate(&elevated).unwrap_err(), LockReason::Elevated);
        let mut unknown = facts();
        unknown.identity_known = false;
        assert_eq!(evaluate(&unknown).unwrap_err(), LockReason::Unknown);
        assert!(evaluate(&facts()).is_ok());
    }
}
