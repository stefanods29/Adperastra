//! Confinement of one engine child (Step 12b D2).
//!
//! The helper transport of 06d is *not* a sandbox: it limits memory and kills
//! a hung child, but the child still runs as the user with full file and
//! network access. An engine child therefore starts inside a Windows
//! AppContainer with **no capabilities** (so no network and no access to the
//! user's files), and only the private job directories and the verified pack
//! directory are granted to its SID.
//!
//! If any step of this sequence fails, the engine is not started at all: the
//! capability is reported as `sandbox_failed` rather than retried without
//! confinement (D2, no unrestricted fallback).
#![allow(dead_code)]

use std::ffi::c_void;
use std::fs::File;
use std::os::windows::io::FromRawHandle;
use std::path::Path;
use std::sync::mpsc::Receiver;
use std::time::Duration;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE, NO_ERROR, WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows::Win32::Foundation::{SetHandleInformation, HANDLE_FLAGS, HANDLE_FLAG_INHERIT};
use windows::Win32::Security::Authorization::{
    GetNamedSecurityInfoW, SetEntriesInAclW, SetNamedSecurityInfoW, EXPLICIT_ACCESS_W,
    GRANT_ACCESS, SE_FILE_OBJECT, TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
};
use windows::Win32::Security::Isolation::{
    CreateAppContainerProfile, DeriveAppContainerSidFromAppContainerName,
};
use windows::Win32::Security::{
    FreeSid, ACL, DACL_SECURITY_INFORMATION, PSID, SECURITY_ATTRIBUTES, SECURITY_CAPABILITIES,
    SUB_CONTAINERS_AND_OBJECTS_INHERIT,
};
use windows::Win32::Storage::FileSystem::{
    FILE_ALL_ACCESS, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ,
};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectCpuRateControlInformation,
    JobObjectExtendedLimitInformation, SetInformationJobObject, TerminateJobObject,
    JOBOBJECT_CPU_RATE_CONTROL_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_CPU_RATE_CONTROL_ENABLE, JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP,
    JOB_OBJECT_LIMIT_ACTIVE_PROCESS, JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION,
    JOB_OBJECT_LIMIT_JOB_MEMORY, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOB_OBJECT_LIMIT_PROCESS_MEMORY,
};
use windows::Win32::System::Pipes::CreatePipe;
use windows::Win32::System::Threading::{
    CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess,
    InitializeProcThreadAttributeList, ResumeThread, UpdateProcThreadAttribute,
    WaitForSingleObject, CREATE_NO_WINDOW, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT,
    EXTENDED_STARTUPINFO_PRESENT, LPPROC_THREAD_ATTRIBUTE_LIST, PROCESS_INFORMATION,
    PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, STARTF_USESTDHANDLES, STARTUPINFOEXW,
    STARTUPINFOW,
};

use crate::engine_io::{spawn_line_reader, StreamItem};
use crate::engine_types::EngineError;

/// The AppContainer profile every engine runs in. It grants no capabilities,
/// so the container has no network access and no access to user folders.
pub const ENGINE_CONTAINER_NAME: &str = "adperastra.engine";

/// How many processes one engine job may start (an Office run starts one
/// `soffice.com` which may spawn a helper of its own).
pub const MAX_JOB_PROCESSES: u32 = 8;

/// HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS): the profile is already present.
const ERROR_ALREADY_EXISTS_HRESULT: i32 = 0x8007_00B7u32 as i32;

/// A SID owned by this value, freed with `FreeSid`.
struct SidGuard(PSID);

// SAFETY: a SID is an allocated immutable buffer; it is only read here and
// freed once, on whatever thread drops the guard.
unsafe impl Send for SidGuard {}
unsafe impl Sync for SidGuard {}

impl Drop for SidGuard {
    fn drop(&mut self) {
        if !self.0 .0.is_null() {
            // SAFETY: the SID came from CreateAppContainerProfile or
            // DeriveAppContainerSidFromAppContainerName and is freed once.
            unsafe {
                let _ = FreeSid(self.0);
            }
        }
    }
}

/// The verified AppContainer profile an engine child runs inside.
pub struct EngineSandbox {
    sid: SidGuard,
}

impl EngineSandbox {
    /// Create (or reuse) the fixed engine container. A failure here means the
    /// engine cannot be confined, so it must not run.
    pub fn prepare() -> Result<Self, String> {
        let name: Vec<u16> = ENGINE_CONTAINER_NAME.encode_utf16().chain([0]).collect();
        let display: Vec<u16> = "Adperastra engine".encode_utf16().chain([0]).collect();
        let description: Vec<u16> = "Confined conversion engine"
            .encode_utf16()
            .chain([0])
            .collect();
        // SAFETY: every string is NUL-terminated and outlives the call. No
        // capability is granted, which is what removes network access.
        let created = unsafe {
            CreateAppContainerProfile(
                PCWSTR(name.as_ptr()),
                PCWSTR(display.as_ptr()),
                PCWSTR(description.as_ptr()),
                None,
            )
        };
        let sid = match created {
            Ok(sid) => sid,
            Err(error) if error.code().0 == ERROR_ALREADY_EXISTS_HRESULT => {
                // SAFETY: the name is NUL-terminated and outlives the call.
                unsafe { DeriveAppContainerSidFromAppContainerName(PCWSTR(name.as_ptr())) }
                    .map_err(|_| EngineError::SandboxFailed.message())?
            }
            Err(_) => return Err(EngineError::SandboxFailed.message()),
        };
        if sid.0.is_null() {
            return Err(EngineError::SandboxFailed.message());
        }
        Ok(Self { sid: SidGuard(sid) })
    }

    /// Allow the container to read and execute inside `path` (the verified
    /// pack directory). Inherited by its children.
    pub fn grant_read(&self, path: &Path) -> Result<(), String> {
        self.grant(path, (FILE_GENERIC_READ | FILE_GENERIC_EXECUTE).0)
    }

    /// Allow the container full access to one of *our* private job folders.
    pub fn grant_private(&self, path: &Path) -> Result<(), String> {
        self.grant(path, FILE_ALL_ACCESS.0)
    }

    fn grant(&self, path: &Path, access: u32) -> Result<(), String> {
        let name: Vec<u16> = path
            .as_os_str()
            .to_string_lossy()
            .encode_utf16()
            .chain([0])
            .collect();
        let mut old_dacl: *mut ACL = std::ptr::null_mut();
        let mut descriptor = windows::Win32::Security::PSECURITY_DESCRIPTOR::default();
        // SAFETY: the path is NUL-terminated; the two out-parameters are
        // writable and are released below.
        let read = unsafe {
            GetNamedSecurityInfoW(
                PCWSTR(name.as_ptr()),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                None,
                None,
                Some(&mut old_dacl),
                None,
                &mut descriptor,
            )
        };
        if read != NO_ERROR || descriptor.0.is_null() {
            return Err(EngineError::SandboxFailed.message());
        }
        let entry = EXPLICIT_ACCESS_W {
            grfAccessPermissions: access,
            grfAccessMode: GRANT_ACCESS,
            grfInheritance: SUB_CONTAINERS_AND_OBJECTS_INHERIT,
            Trustee: TRUSTEE_W {
                pMultipleTrustee: std::ptr::null_mut(),
                MultipleTrusteeOperation: Default::default(),
                TrusteeForm: TRUSTEE_IS_SID,
                TrusteeType: TRUSTEE_IS_UNKNOWN,
                ptstrName: windows::core::PWSTR(self.sid.0 .0.cast::<u16>()),
            },
        };
        let mut new_dacl: *mut ACL = std::ptr::null_mut();
        // SAFETY: the entry points at our live SID and the old DACL belongs to
        // the descriptor above; the new DACL is freed below.
        let merged = unsafe { SetEntriesInAclW(Some(&[entry]), Some(old_dacl), &mut new_dacl) };
        if merged != NO_ERROR {
            // SAFETY: the descriptor came from GetNamedSecurityInfoW.
            unsafe {
                windows::Win32::Foundation::LocalFree(Some(windows::Win32::Foundation::HLOCAL(
                    descriptor.0,
                )))
            };
            return Err(EngineError::SandboxFailed.message());
        }
        // SAFETY: the name and DACL are valid; only the DACL changes.
        let written = unsafe {
            SetNamedSecurityInfoW(
                PCWSTR(name.as_ptr()),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                None,
                None,
                Some(new_dacl),
                None,
            )
        };
        // SAFETY: both buffers were allocated by the calls above.
        unsafe {
            windows::Win32::Foundation::LocalFree(Some(windows::Win32::Foundation::HLOCAL(
                new_dacl.cast(),
            )));
            windows::Win32::Foundation::LocalFree(Some(windows::Win32::Foundation::HLOCAL(
                descriptor.0,
            )));
        }
        if written != NO_ERROR {
            return Err(EngineError::SandboxFailed.message());
        }
        Ok(())
    }

    /// The capabilities block handed to CreateProcessW: the container SID with
    /// an empty capability list.
    fn security_capabilities(&self) -> SECURITY_CAPABILITIES {
        SECURITY_CAPABILITIES {
            AppContainerSid: self.sid.0,
            Capabilities: std::ptr::null_mut(),
            CapabilityCount: 0,
            Reserved: 0,
        }
    }
}

/// A kernel handle closed exactly once.
struct OwnedHandle(HANDLE);

// SAFETY: kernel handles may be used from any thread.
unsafe impl Send for OwnedHandle {}

impl OwnedHandle {
    /// Give up ownership without closing: the caller now owns the handle.
    fn into_raw(self) -> HANDLE {
        let handle = self.0;
        std::mem::forget(self);
        handle
    }
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        if !self.0.is_invalid() && !self.0 .0.is_null() {
            // SAFETY: this value owns the handle and closes it once.
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }
}

/// How the parent reads the child's stdout: text lines (ffmpeg progress and
/// JSON) or the raw bytes of a framed binary protocol.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StdoutMode {
    Lines,
    Raw,
}

/// One engine child inside the container and its job object.
pub struct ConfinedProcess {
    process: OwnedHandle,
    job: OwnedHandle,
    pid: u32,
    stdin: Option<File>,
    /// stdout as bounded lines when the caller asked for lines.
    stdout_lines: Option<Receiver<StreamItem>>,
    /// stdout as a raw stream when the caller speaks a binary protocol.
    stdout_raw: Option<File>,
    /// stderr as bounded lines, reduced to codes by the caller.
    stderr: Receiver<StreamItem>,
    exited: bool,
    _desktop: Option<crate::engine_desktop::EngineDesktop>,
}

impl ConfinedProcess {
    pub fn deadline(
        &self,
        timeout: Duration,
    ) -> Result<crate::engine_deadline::EngineDeadline, String> {
        crate::engine_deadline::arm(self.job.0, timeout)
    }
    /// The process ID, for diagnostics only.
    pub fn pid(&self) -> u32 {
        self.pid
    }

    /// The bounded stderr line stream.
    pub fn stderr(&self) -> &Receiver<StreamItem> {
        &self.stderr
    }

    /// Take the bounded line stream (only in `StdoutMode::Lines`).
    pub fn take_stdout_lines(&mut self) -> Option<Receiver<StreamItem>> {
        self.stdout_lines.take()
    }

    /// Take the raw stdout stream (only in `StdoutMode::Raw`).
    pub fn take_stdout_reader(&mut self) -> Option<File> {
        self.stdout_raw.take()
    }

    /// Write bytes to the child's stdin.
    pub fn write_stdin(&mut self, bytes: &[u8]) -> Result<(), String> {
        use std::io::Write;
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| EngineError::Failed.message())?;
        stdin
            .write_all(bytes)
            .and_then(|()| stdin.flush())
            .map_err(|_| EngineError::Failed.message())
    }

    /// Close stdin first, so a cooperative child can stop by itself.
    pub fn close_stdin(&mut self) {
        self.stdin.take();
    }

    /// Wait up to `timeout`; `Some(exit_code)` once the child ended.
    pub fn wait(&mut self, timeout: Duration) -> Option<i32> {
        // SAFETY: the handle is open for as long as this value lives.
        let waited = unsafe {
            WaitForSingleObject(
                self.process.0,
                timeout.as_millis().min(u32::MAX as u128) as u32,
            )
        };
        if waited == WAIT_TIMEOUT {
            return None;
        }
        if waited != WAIT_OBJECT_0 {
            return None;
        }
        let mut code: u32 = 0;
        // SAFETY: the process handle is open and `code` is writable.
        unsafe { GetExitCodeProcess(self.process.0, &mut code) }.ok()?;
        self.exited = true;
        Some(code as i32)
    }

    /// Kill the whole job: descendants included (D4, cancellation).
    pub fn terminate(&mut self) {
        // SAFETY: the job handle is ours and still open.
        unsafe {
            let _ = TerminateJobObject(self.job.0, 1);
        }
        self.exited = true;
    }
}

impl Drop for ConfinedProcess {
    fn drop(&mut self) {
        if !self.exited {
            self.terminate();
        }
    }
}

/// Everything one launch needs; no shell text and no inherited environment.
pub struct EngineLaunch<'a> {
    pub program: &'a Path,
    /// The single argument string built by `media_arguments` (the documented
    /// CreateProcess quoting algorithm), or by the Office argument builder.
    pub arguments: String,
    pub working_directory: &'a Path,
    /// Only these variables reach the child.
    pub environment: Vec<(String, String)>,
    pub memory_bytes: u64,
    pub cpu_percent: u32,
    pub stdout_mode: StdoutMode,
}

/// Start one confined engine child. Any failure is `engines.sandbox_failed`:
/// the caller never retries outside the container.
pub fn spawn_confined(
    sandbox: &EngineSandbox,
    launch: &EngineLaunch<'_>,
) -> Result<ConfinedProcess, String> {
    let failed = || EngineError::SandboxFailed.message();
    let (stdin_read, stdin_write) = pipe_pair().map_err(|_| failed())?;
    let (stdout_read, stdout_write) = pipe_pair().map_err(|_| failed())?;
    let (stderr_read, stderr_write) = pipe_pair().map_err(|_| failed())?;
    // The child inherits only the three far ends.
    for handle in [stdin_write.0, stdout_read.0, stderr_read.0] {
        // SAFETY: the handle is open and ours.
        unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT.0, HANDLE_FLAGS(0)) }
            .map_err(|_| failed())?;
    }

    let mut capabilities = sandbox.security_capabilities();
    let attribute_list = AttributeList::new(&mut capabilities).map_err(|_| failed())?;

    let mut desktop = if crate::office_kit_arguments::is_kit_worker(launch.program) {
        Some(crate::engine_desktop::EngineDesktop::new(
            capabilities.AppContainerSid,
        )?)
    } else {
        None
    };

    let mut startup = STARTUPINFOEXW::default();
    if let Some(desktop) = &mut desktop {
        startup.StartupInfo.lpDesktop = desktop.path();
    }
    startup.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = stdin_read.0;
    startup.StartupInfo.hStdOutput = stdout_write.0;
    startup.StartupInfo.hStdError = stderr_write.0;
    startup.lpAttributeList = attribute_list.list;

    let application: Vec<u16> = launch
        .program
        .as_os_str()
        .to_string_lossy()
        .encode_utf16()
        .chain([0])
        .collect();
    let mut command_line: Vec<u16> = format!(
        "\"{}\" {}",
        launch.program.to_string_lossy(),
        launch.arguments
    )
    .encode_utf16()
    .chain([0])
    .collect();
    let directory: Vec<u16> = launch
        .working_directory
        .as_os_str()
        .to_string_lossy()
        .encode_utf16()
        .chain([0])
        .collect();
    let environment = appcontainer_environment(&launch.environment)?;

    let mut process_info = PROCESS_INFORMATION::default();
    // SAFETY: all buffers outlive the call; the attribute list holds the
    // capabilities block, which also outlives it.
    let started = unsafe {
        CreateProcessW(
            PCWSTR(application.as_ptr()),
            Some(windows::core::PWSTR(command_line.as_mut_ptr())),
            None,
            None,
            true,
            CREATE_SUSPENDED
                | CREATE_UNICODE_ENVIRONMENT
                | CREATE_NO_WINDOW
                | EXTENDED_STARTUPINFO_PRESENT,
            Some(environment.as_ptr().cast::<c_void>()),
            PCWSTR(directory.as_ptr()),
            (&startup as *const STARTUPINFOEXW).cast::<STARTUPINFOW>(),
            &mut process_info,
        )
    };
    if started.is_err() {
        return Err(failed());
    }
    let process = OwnedHandle(process_info.hProcess);
    let thread = OwnedHandle(process_info.hThread);

    let job = create_job(launch.memory_bytes, launch.cpu_percent).map_err(|_| failed())?;
    // SAFETY: both handles are open and ours.
    if unsafe { AssignProcessToJobObject(job.0, process.0) }.is_err() {
        // SAFETY: the process is suspended and ours; kill it before dropping.
        unsafe {
            let _ = windows::Win32::System::Threading::TerminateProcess(process.0, 1);
        }
        return Err(failed());
    }
    // SAFETY: the thread is suspended and ours; resume it once inside the job.
    let resumed = unsafe { ResumeThread(thread.0) };
    if resumed == u32::MAX {
        // SAFETY: the process is still ours and has done nothing yet.
        unsafe {
            let _ = TerminateJobObject(job.0, 1);
        }
        return Err(failed());
    }
    drop(thread);

    // SAFETY: parent keeps the write end of stdin and the read ends of the
    // outputs; converting them to `File` gives exactly one owner each.
    let stdin = unsafe { File::from_raw_handle(stdin_write.into_raw().0) };
    let stdout = unsafe { File::from_raw_handle(stdout_read.into_raw().0) };
    let stderr = unsafe { File::from_raw_handle(stderr_read.into_raw().0) };
    let (stdout_lines, stdout_raw) = match launch.stdout_mode {
        StdoutMode::Lines => (
            Some(spawn_line_reader(
                stdout,
                crate::engine_session_types::MAX_CONTROL_FRAME_BYTES,
            )),
            None,
        ),
        StdoutMode::Raw => (None, Some(stdout)),
    };

    Ok(ConfinedProcess {
        process,
        job,
        pid: process_info.dwProcessId,
        stdin: Some(stdin),
        stdout_lines,
        stdout_raw,
        stderr: spawn_line_reader(stderr, crate::engine_io::MAX_STDERR_BYTES),
        exited: false,
        _desktop: desktop,
    })
}

/// A parent/child pipe pair; both ends are inheritable until the parent end
/// is marked private.
fn pipe_pair() -> Result<(OwnedHandle, OwnedHandle), ()> {
    let attributes = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: std::ptr::null_mut(),
        bInheritHandle: true.into(),
    };
    let mut read = HANDLE(std::ptr::null_mut());
    let mut write = HANDLE(std::ptr::null_mut());
    // SAFETY: both out-parameters are writable and the attributes outlive the
    // call; the handles are owned by the returned values.
    unsafe { CreatePipe(&mut read, &mut write, Some(&attributes), 0) }.map_err(|_| ())?;
    Ok((OwnedHandle(read), OwnedHandle(write)))
}

/// The process-attribute list holding the AppContainer capabilities.
struct AttributeList {
    list: LPPROC_THREAD_ATTRIBUTE_LIST,
    storage: Vec<u8>,
}

impl AttributeList {
    fn new(capabilities: &mut SECURITY_CAPABILITIES) -> Result<Self, ()> {
        let mut size = 0usize;
        // SAFETY: asking for the required size is the documented first call.
        let _ = unsafe { InitializeProcThreadAttributeList(None, 1, None, &mut size) };
        if size == 0 {
            return Err(());
        }
        let mut storage = vec![0u8; size];
        let list = LPPROC_THREAD_ATTRIBUTE_LIST(storage.as_mut_ptr().cast());
        // SAFETY: the buffer has the size the first call asked for.
        unsafe { InitializeProcThreadAttributeList(Some(list), 1, None, &mut size) }
            .map_err(|_| ())?;
        // SAFETY: the capability block outlives this attribute list at the
        // call site, and the size is the documented one.
        unsafe {
            UpdateProcThreadAttribute(
                list,
                0,
                PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES as usize,
                Some((capabilities as *mut SECURITY_CAPABILITIES).cast::<c_void>()),
                std::mem::size_of::<SECURITY_CAPABILITIES>(),
                None,
                None,
            )
        }
        .map_err(|_| ())?;
        Ok(Self { list, storage })
    }
}

impl Drop for AttributeList {
    fn drop(&mut self) {
        // SAFETY: the list was initialized once and is deleted once.
        unsafe { DeleteProcThreadAttributeList(self.list) };
        self.storage.clear();
    }
}

/// A job object with a memory cap, a hard CPU cap, a process limit and
/// kill-on-close. `KILL_ON_JOB_CLOSE` is what ends every descendant if this
/// app disappears.
fn create_job(memory_bytes: u64, cpu_percent: u32) -> Result<OwnedHandle, ()> {
    // SAFETY: no name and no attributes are needed; the returned handle is
    // owned by the value we build from it.
    let handle = unsafe { CreateJobObjectW(None, PCWSTR::null()) }.map_err(|_| ())?;
    let job = OwnedHandle(handle);
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY
        | JOB_OBJECT_LIMIT_JOB_MEMORY
        | JOB_OBJECT_LIMIT_ACTIVE_PROCESS
        | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION
        | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    limits.ProcessMemoryLimit = memory_bytes as usize;
    limits.JobMemoryLimit = memory_bytes as usize;
    limits.BasicLimitInformation.ActiveProcessLimit = MAX_JOB_PROCESSES;
    // SAFETY: the job handle is open and the structure outlives the call.
    unsafe {
        SetInformationJobObject(
            job.0,
            JobObjectExtendedLimitInformation,
            &limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION as *const c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    }
    .map_err(|_| ())?;
    if cpu_percent > 0 {
        let rate = JOBOBJECT_CPU_RATE_CONTROL_INFORMATION {
            ControlFlags: JOB_OBJECT_CPU_RATE_CONTROL_ENABLE | JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP,
            Anonymous:
                windows::Win32::System::JobObjects::JOBOBJECT_CPU_RATE_CONTROL_INFORMATION_0 {
                    // The hard cap is expressed in hundredths of a percent.
                    CpuRate: cpu_percent.saturating_mul(100).min(10_000),
                },
        };
        // SAFETY: the job handle is open and the structure outlives the call.
        unsafe {
            SetInformationJobObject(
                job.0,
                JobObjectCpuRateControlInformation,
                &rate as *const JOBOBJECT_CPU_RATE_CONTROL_INFORMATION as *const c_void,
                std::mem::size_of::<JOBOBJECT_CPU_RATE_CONTROL_INFORMATION>() as u32,
            )
        }
        .map_err(|_| ())?;
    }
    Ok(job)
}

/// Windows needs LOCALAPPDATA to resolve the AppContainer profile. Supply
/// only that parent variable and the explicitly approved child variables.
fn appcontainer_environment(pairs: &[(String, String)]) -> Result<Vec<u16>, String> {
    let local_app_data = std::env::var("LOCALAPPDATA")
        .ok()
        .filter(|value| !value.is_empty() && !value.contains('\0'))
        .ok_or_else(|| EngineError::SandboxFailed.message())?;
    let mut child: Vec<_> = pairs
        .iter()
        .filter(|(key, _)| !key.eq_ignore_ascii_case("LOCALAPPDATA"))
        .cloned()
        .collect();
    child.push(("LOCALAPPDATA".into(), local_app_data));
    Ok(environment_block(&child))
}

/// A minimal environment block built only from the given entries.
fn environment_block(pairs: &[(String, String)]) -> Vec<u16> {
    let mut block: Vec<u16> = Vec::new();
    for (key, value) in pairs {
        if key.is_empty() || key.contains('=') || value.contains('\0') {
            continue;
        }
        block.extend(key.encode_utf16());
        block.push(u16::from(b'='));
        block.extend(value.encode_utf16());
        block.push(0);
    }
    block.push(0);
    block
}

#[cfg(test)]
mod tests {
    use super::environment_block;

    #[test]
    fn environment_block_has_no_inherited_values() {
        let block = environment_block(&[("TEMP".to_string(), "C:\\private".to_string())]);
        let text: String = String::from_utf16_lossy(&block);
        assert!(text.starts_with("TEMP=C:\\private\0"));
        assert!(text.ends_with("\0\0"));
    }

    #[test]
    fn environment_entries_with_separators_are_skipped() {
        let block = environment_block(&[
            ("BAD=KEY".to_string(), "x".to_string()),
            ("OK".to_string(), "y".to_string()),
        ]);
        let text: String = String::from_utf16_lossy(&block);
        assert!(!text.contains("BAD"));
        assert!(text.contains("OK=y"));
    }
}
