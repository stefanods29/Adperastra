//! Windows primitives for the user-scoped single-instance lock (Step 09c
//! D9). The names carry the current user's SID, the pipe DACL grants that
//! SID and SYSTEM only, and `PIPE_REJECT_REMOTE_CLIENTS` keeps remote
//! callers out. A connected client is checked a second time against the
//! user of its process token, so a spoofed local caller is refused too.
//!
//! Everything here is native and never opens a file; the caller only
//! queues paths for the frontend's `planOpen` pipeline.

#[cfg(windows)]
use std::ffi::c_void;

/// Named pipe for the current user. `\\.\pipe\` is the local pipe
/// namespace; the SID in the name keeps users apart.
pub fn pipe_name(sid: &str) -> String {
    format!(r"\\.\pipe\adperastra.activation.{sid}")
}

/// Session-local mutex that decides which process is the primary one.
pub fn mutex_name(sid: &str) -> String {
    format!(r"Local\adperastra.activation.{sid}")
}

/// SIDs are case-insensitive text; an empty expectation never matches.
pub fn sid_matches(expected: &str, actual: &str) -> bool {
    !expected.is_empty() && expected.eq_ignore_ascii_case(actual)
}

/// `None` means the client is remote or its process could not be queried;
/// both are denied.
pub fn client_allowed(expected: &str, client: Option<&str>) -> bool {
    matches!(client, Some(value) if sid_matches(expected, value))
}

#[cfg(windows)]
mod platform {
    use super::*;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{
        CloseHandle, GetLastError, LocalFree, SetLastError, ERROR_ALREADY_EXISTS, ERROR_SUCCESS,
        HANDLE, HLOCAL, HWND,
    };
    use windows::Win32::Security::{
        AddAccessAllowedAceEx, CopySid, CreateWellKnownSid, GetTokenInformation, InitializeAcl,
        InitializeSecurityDescriptor, IsValidSid, SetSecurityDescriptorDacl, TokenUser,
        WinLocalSystemSid, ACL, ACL_REVISION, ACE_FLAGS, PSECURITY_DESCRIPTOR, PSID,
        SECURITY_ATTRIBUTES, SECURITY_DESCRIPTOR, SECURITY_MAX_SID_SIZE, TOKEN_QUERY,
        TOKEN_USER,
    };
    use windows::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows::Win32::Storage::FileSystem::{FILE_ALL_ACCESS, PIPE_ACCESS_DUPLEX};
    use windows::Win32::System::Pipes::{
        CreateNamedPipeW, NAMED_PIPE_MODE, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS,
        PIPE_TYPE_BYTE, PIPE_WAIT,
    };
    use windows::Win32::System::Threading::{
        CreateMutexW, GetCurrentProcess, OpenProcess, OpenProcessToken, ReleaseMutex,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        FlashWindowEx, FLASHWINFO, FLASHW_ALL, FLASHW_TIMERNOFG,
    };

    use crate::activation::ACTIVATION_TIMEOUT_MS;

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn local_free(pointer: windows::core::PWSTR) {
        if !pointer.is_null() {
            // SAFETY: ConvertSidToStringSidW allocated this string with
            // LocalAlloc; LocalFree is its matching release.
            let _ = unsafe { LocalFree(Some(HLOCAL(pointer.0 as *mut c_void))) };
        }
    }

    /// The SID of a process token, copied into an owned buffer plus its
    /// text form before the token closes.
    fn token_user_sid(token: HANDLE) -> Result<(Vec<u32>, String), String> {
        let mut size = 0u32;
        // The first call only asks for the buffer size.
        let _ = unsafe { GetTokenInformation(token, TokenUser, None, 0, &mut size) };
        if size == 0 {
            return Err("activation.denied".to_string());
        }
        let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
        unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                Some(buffer.as_mut_ptr() as *mut c_void),
                size,
                &mut size,
            )
        }
        .map_err(|_| "activation.denied".to_string())?;
        let user = unsafe { &*(buffer.as_ptr() as *const TOKEN_USER) };
        if !unsafe { IsValidSid(user.User.Sid) }.as_bool() {
            return Err("activation.denied".to_string());
        }
        let mut sid_buffer = vec![0u32; (SECURITY_MAX_SID_SIZE as usize).div_ceil(4)];
        let sid = PSID(sid_buffer.as_mut_ptr() as *mut c_void);
        unsafe { CopySid(SECURITY_MAX_SID_SIZE, sid, user.User.Sid) }
            .map_err(|_| "activation.denied".to_string())?;
        let mut text = windows::core::PWSTR::null();
        unsafe { ConvertSidToStringSidW(sid, &mut text) }
            .map_err(|_| "activation.denied".to_string())?;
        let result = unsafe { text.to_string() }.map_err(|_| "activation.denied".to_string());
        local_free(text);
        Ok((sid_buffer, result?))
    }

    /// The signed-in user, copied into an owned buffer plus its text form.
    pub struct UserSid {
        buffer: Vec<u32>,
        text: String,
    }

    impl UserSid {
        pub fn current() -> Result<Self, String> {
            let mut token = HANDLE::default();
            unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) }
                .map_err(|_| "activation.denied".to_string())?;
            let result = token_user_sid(token);
            let _ = unsafe { CloseHandle(token) };
            let (buffer, text) = result?;
            Ok(Self { buffer, text })
        }

        pub fn text(&self) -> &str {
            &self.text
        }

        fn psid(&self) -> PSID {
            PSID(self.buffer.as_ptr() as *mut c_void)
        }
    }

    /// DACL for the pipe and the mutex: the current user and SYSTEM only.
    pub struct PipeSecurity {
        descriptor: SECURITY_DESCRIPTOR,
        // The descriptor points into this buffer; it must outlive the
        // create call that copies the DACL.
        #[allow(dead_code)]
        _acl: Vec<u64>,
    }

    impl PipeSecurity {
        pub fn new(user: &UserSid) -> Result<Self, String> {
            let mut system_buffer = vec![0u32; (SECURITY_MAX_SID_SIZE as usize).div_ceil(4)];
            let mut system_size = SECURITY_MAX_SID_SIZE;
            let system = PSID(system_buffer.as_mut_ptr() as *mut c_void);
            unsafe {
                CreateWellKnownSid(
                    WinLocalSystemSid,
                    None,
                    Some(system),
                    &mut system_size,
                )
            }
            .map_err(|_| "activation.failed".to_string())?;

            let mut acl = vec![0u64; 64];
            let acl_size = (acl.len() * std::mem::size_of::<u64>()) as u32;
            let acl_ptr = acl.as_mut_ptr() as *mut ACL;
            unsafe { InitializeAcl(acl_ptr, acl_size, ACL_REVISION) }
                .map_err(|_| "activation.failed".to_string())?;
            let mask = FILE_ALL_ACCESS.0;
            unsafe {
                AddAccessAllowedAceEx(acl_ptr, ACL_REVISION, ACE_FLAGS(0), mask, user.psid())
            }
            .map_err(|_| "activation.failed".to_string())?;
            unsafe {
                AddAccessAllowedAceEx(acl_ptr, ACL_REVISION, ACE_FLAGS(0), mask, system)
            }
            .map_err(|_| "activation.failed".to_string())?;

            let mut descriptor = SECURITY_DESCRIPTOR::default();
            let descriptor_ptr =
                PSECURITY_DESCRIPTOR(&mut descriptor as *mut _ as *mut c_void);
            unsafe { InitializeSecurityDescriptor(descriptor_ptr, 1) }
                .map_err(|_| "activation.failed".to_string())?;
            unsafe {
                SetSecurityDescriptorDacl(
                    descriptor_ptr,
                    true,
                    Some(acl_ptr as *const ACL),
                    false,
                )
            }
            .map_err(|_| "activation.failed".to_string())?;
            Ok(Self {
                descriptor,
                _acl: acl,
            })
        }

        /// Attributes for one user-scoped named object. The system copies
        /// the descriptor during creation, so this value may be dropped
        /// after the call.
        pub fn attributes(&self) -> SECURITY_ATTRIBUTES {
            SECURITY_ATTRIBUTES {
                nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: &self.descriptor as *const _ as *mut c_void,
                bInheritHandle: false.into(),
            }
        }

        /// Create one server instance.
        pub fn create_pipe(&self, name: &str) -> Result<HANDLE, String> {
            let name = wide(name);
            let attributes = self.attributes();
            let pipe_mode: NAMED_PIPE_MODE = PIPE_TYPE_BYTE
                | PIPE_READMODE_BYTE
                | PIPE_WAIT
                | PIPE_REJECT_REMOTE_CLIENTS;
            let handle = unsafe {
                CreateNamedPipeW(
                    PCWSTR(name.as_ptr()),
                    PIPE_ACCESS_DUPLEX,
                    pipe_mode,
                    1,
                    64 * 1024,
                    64 * 1024,
                    ACTIVATION_TIMEOUT_MS,
                    Some(&attributes as *const SECURITY_ATTRIBUTES),
                )
            };
            if handle.is_invalid() {
                Err("activation.failed".to_string())
            } else {
                Ok(handle)
            }
        }
    }

    /// SID text of the process on the other end, or `None` when the client
    /// is remote or cannot be queried. Both are refused.
    pub fn client_sid(pipe: HANDLE) -> Option<String> {
        let mut process_id = 0u32;
        unsafe { windows::Win32::System::Pipes::GetNamedPipeClientProcessId(pipe, &mut process_id) }
            .ok()?;
        let process =
            unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) }.ok()?;
        let mut token = HANDLE::default();
        let opened =
            unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) }.is_ok();
        let sid = if opened {
            token_user_sid(token).ok().map(|(_, text)| text)
        } else {
            None
        };
        if opened {
            let _ = unsafe { CloseHandle(token) };
        }
        let _ = unsafe { CloseHandle(process) };
        sid
    }

    /// Mutex handle kept for the whole process lifetime. `ReleaseMutex`
    /// is best effort: dropping the handle would release ownership anyway.
    pub struct InstanceGuard {
        handle: HANDLE,
    }

    impl Drop for InstanceGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = ReleaseMutex(self.handle);
                let _ = CloseHandle(self.handle);
            }
        }
    }

    pub enum Instance {
        Primary(InstanceGuard),
        Secondary,
    }

    /// Take the per-user mutex. An existing mutex (even if its owner is
    /// still starting) makes this process the secondary one. The mutex
    /// uses the same user-and-SYSTEM DACL as the pipe.
    pub fn acquire_instance() -> Result<Instance, String> {
        let user = UserSid::current()?;
        let name = mutex_name(user.text());
        let name = wide(&name);
        let security = PipeSecurity::new(&user)?;
        let attributes = security.attributes();
        unsafe { SetLastError(ERROR_SUCCESS) };
        let handle = unsafe {
            CreateMutexW(
                Some(&attributes as *const SECURITY_ATTRIBUTES),
                true,
                PCWSTR(name.as_ptr()),
            )
        }
        .map_err(|_| "activation.failed".to_string())?;
        let existing = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
        if existing {
            let _ = unsafe { ReleaseMutex(handle) };
            let _ = unsafe { CloseHandle(handle) };
            Ok(Instance::Secondary)
        } else {
            Ok(Instance::Primary(InstanceGuard { handle }))
        }
    }

    /// Windows may refuse to raise another process's window; a taskbar
    /// flash is the fallback D11 asks for.
    pub fn flash_taskbar(raw_hwnd: isize) {
        let hwnd = HWND(raw_hwnd as *mut c_void);
        let info = FLASHWINFO {
            cbSize: std::mem::size_of::<FLASHWINFO>() as u32,
            hwnd,
            dwFlags: FLASHW_ALL | FLASHW_TIMERNOFG,
            uCount: 2,
            dwTimeout: 0,
        };
        let _ = unsafe { FlashWindowEx(&info) };
    }
}

#[cfg(windows)]
pub use platform::*;
