//! One-operation elevated disk broker (Step 09j T3).
//!
//! When Windows refuses a read-only attach without administrator rights,
//! the app asks for the user's explicit confirmation and then starts this
//! executable elevated with `--disk-broker`. The parent creates a
//! current-user/SYSTEM-only named pipe, verifies the returned process by
//! id, creation time and SID, and sends exactly one mount request. The
//! broker accepts only that request and then eject/status for the same
//! mount; every reply echoes the request UUID and the parent refuses an
//! uncorrelated or inconsistent reply before using its fields. The broker
//! never calls Tauri commands and never forwards user strings.

use std::sync::mpsc;
use std::time::{Duration, Instant};

use fs_service::{CancellationToken, SourceStamp};

use crate::disk_broker_security::{
    read_frame, valid_pipe_name, write_frame, BrokerHost, BrokerMountInfo, BrokerReply,
    BrokerRequest, PeerIdentity,
};
use crate::disk_image_types::DiskImageKind;
use crate::disk_mounts::MountHandle;

/// The helper flag; handled before any app setup in `main`.
pub const HELPER_FLAG: &str = "--disk-broker";
/// How long the broker may take to connect and answer.
pub const BROKER_TIMEOUT: Duration = Duration::from_secs(10);

pub struct BrokerAttachment {
    pub handle: Box<dyn MountHandle>,
    pub physical_path: String,
    pub volume_roots: Vec<String>,
}

#[cfg(not(windows))]
pub fn mount_elevated(
    _path: &std::path::Path,
    _kind: DiskImageKind,
    _stamp: &SourceStamp,
    _token: &CancellationToken,
    _progress: &mut dyn FnMut(u64),
) -> Result<BrokerAttachment, String> {
    Err("disk.unavailable".to_string())
}

#[cfg(not(windows))]
pub fn run_disk_broker(
    _pipe_name: &str,
    _parent_pid: u32,
    _parent_ticks: &str,
) -> Result<(), String> {
    Err("disk.unavailable".to_string())
}

#[cfg(windows)]
mod windows_impl {
    use super::*;
    use std::ffi::c_void;
    use std::fs::{File, OpenOptions};
    use std::os::windows::io::{AsRawHandle, FromRawHandle, RawHandle};
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{
        CloseHandle, HANDLE, HLOCAL, LocalFree, ERROR_PIPE_CONNECTED, ERROR_PIPE_LISTENING,
        WAIT_OBJECT_0,
    };
    use windows::Win32::Security::{
        Authorization::{
            ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
        },
        GetTokenInformation, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER,
        TokenUser,
    };
    use windows::Win32::Storage::FileSystem::PIPE_ACCESS_DUPLEX;
    use windows::Win32::System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, GetNamedPipeClientProcessId,
        GetNamedPipeServerProcessId, SetNamedPipeHandleState, PIPE_NOWAIT, PIPE_READMODE_BYTE,
        PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE,
    };
    use windows::Win32::System::Threading::{
        GetCurrentProcess, GetCurrentProcessId, GetProcessId, GetProcessTimes, OpenProcess,
        OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION, TerminateProcess,
        WaitForSingleObject,
    };
    use windows::Win32::UI::Shell::{
        ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW,
    };
    use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;

    struct OwnedHandle(HANDLE);

    // SAFETY: a kernel handle is usable from any thread and this wrapper
    // owns exactly one handle, closed once.
    unsafe impl Send for OwnedHandle {}

    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            // SAFETY: this wrapper owns the handle and closes it once.
            let _ = unsafe { CloseHandle(self.0) };
        }
    }

    impl OwnedHandle {
        fn get(&self) -> HANDLE {
            self.0
        }

        fn kill(&self) {
            // SAFETY: the process handle is live and owned here.
            let _ = unsafe { TerminateProcess(self.0, 1) };
        }

        fn exited(&self) -> bool {
            // SAFETY: the process handle is live and owned here.
            unsafe { WaitForSingleObject(self.0, 0) == WAIT_OBJECT_0 }
        }

        fn wait(&self, timeout: Duration) {
            let millis = timeout.as_millis().min(60_000) as u32;
            // SAFETY: the process handle is live and owned here.
            let _ = unsafe { WaitForSingleObject(self.0, millis) };
        }
    }

    fn current_identity() -> Result<PeerIdentity, String> {
        process_identity(unsafe { GetCurrentProcess() }).map(|mut identity| {
            identity.pid = unsafe { GetCurrentProcessId() };
            identity
        })
    }

    fn process_identity(handle: HANDLE) -> Result<PeerIdentity, String> {
        let pid = unsafe { GetProcessId(handle) };
        if pid == 0 {
            return Err("disk.denied".to_string());
        }
        let mut created = windows::Win32::Foundation::FILETIME::default();
        let mut exited = windows::Win32::Foundation::FILETIME::default();
        let mut kernel = windows::Win32::Foundation::FILETIME::default();
        let mut user = windows::Win32::Foundation::FILETIME::default();
        // SAFETY: all four FILETIME outputs are writable locals.
        unsafe { GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user) }
            .map_err(|_| "disk.denied".to_string())?;
        let ticks = ((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64;
        Ok(PeerIdentity {
            pid,
            start_ticks: ticks.to_string(),
            sid: process_sid(handle)?,
        })
    }

    fn process_sid(handle: HANDLE) -> Result<String, String> {
        let mut token = HANDLE::default();
        // SAFETY: the process handle is live; the token is closed below.
        unsafe { OpenProcessToken(handle, TOKEN_QUERY, &mut token) }
            .map_err(|_| "disk.denied".to_string())?;
        let token = OwnedHandle(token);
        let mut length = 0u32;
        // SAFETY: a zero-length query reports the required size.
        let _ = unsafe {
            GetTokenInformation(token.get(), TokenUser, None, 0, &mut length)
        };
        if length == 0 || length > 64 * 1024 {
            return Err("disk.denied".to_string());
        }
        // TOKEN_USER contains pointers, so the buffer is allocated with
        // pointer alignment rather than as a byte vector.
        let mut buffer = vec![0u64; (length as usize).div_ceil(8)];
        // SAFETY: the buffer matches the reported length and is writable.
        unsafe {
            GetTokenInformation(
                token.get(),
                TokenUser,
                Some(buffer.as_mut_ptr() as *mut c_void),
                length,
                &mut length,
            )
        }
        .map_err(|_| "disk.denied".to_string())?;
        // SAFETY: the buffer holds a TOKEN_USER with a valid SID pointer.
        let sid = unsafe { (*(buffer.as_ptr() as *const TOKEN_USER)).User.Sid };
        let mut text = PWSTR::null();
        // SAFETY: `sid` came from the token structure and is valid.
        unsafe { ConvertSidToStringSidW(sid, &mut text) }
            .map_err(|_| "disk.denied".to_string())?;
        // SAFETY: the API returned a NUL-terminated string owned by us.
        let value = unsafe { String::from_utf16_lossy(text.as_wide()) };
        // SAFETY: the string came from ConvertSidToStringSidW and is freed once.
        unsafe {
            let _ = LocalFree(Some(HLOCAL(text.0 as *mut c_void)));
        }
        if value.is_empty() {
            return Err("disk.denied".to_string());
        }
        Ok(value)
    }

    struct PipeServer {
        handle: OwnedHandle,
    }

    fn create_pipe(name: &str, sid: &str) -> Result<PipeServer, String> {
        let sddl = format!("D:P(A;;GA;;;SY)(A;;GA;;;{sid})");
        let sddl_wide = crate::explorer::wide_null(&sddl);
        let mut descriptor = PSECURITY_DESCRIPTOR::default();
        // SAFETY: the SDDL is NUL-terminated; the descriptor is freed below.
        unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                PCWSTR(sddl_wide.as_ptr()),
                1,
                &mut descriptor,
                None,
            )
        }
        .map_err(|_| "disk.denied".to_string())?;
        let attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor.0,
            bInheritHandle: false.into(),
        };
        let full = format!(r"\\.\pipe\{name}");
        let wide = crate::explorer::wide_null(&full);
        // SAFETY: the name and attributes outlive the call; a failed call
        // returns INVALID_HANDLE_VALUE.
        let handle = unsafe {
            CreateNamedPipeW(
                PCWSTR(wide.as_ptr()),
                PIPE_ACCESS_DUPLEX,
                PIPE_TYPE_BYTE
                    | PIPE_READMODE_BYTE
                    | PIPE_NOWAIT
                    | PIPE_REJECT_REMOTE_CLIENTS,
                1,
                64 * 1024,
                64 * 1024,
                10_000,
                Some(&attributes as *const SECURITY_ATTRIBUTES),
            )
        };
        // SAFETY: the descriptor is ours and is freed once.
        unsafe {
            let _ = LocalFree(Some(HLOCAL(descriptor.0)));
        }
        if handle.is_invalid() {
            return Err("disk.denied".to_string());
        }
        Ok(PipeServer {
            handle: OwnedHandle(handle),
        })
    }

    fn accept(
        pipe: PipeServer,
        timeout: Duration,
        token: &CancellationToken,
        progress: &mut dyn FnMut(u64),
    ) -> Result<File, String> {
        let started = Instant::now();
        let deadline = started + timeout;
        loop {
            if token.load(std::sync::atomic::Ordering::Relaxed) {
                return Err("disk.cancelled".to_string());
            }
            // SAFETY: the pipe handle is live and owned by `pipe`.
            let connected = unsafe { ConnectNamedPipe(pipe.handle.get(), None) };
            if connected.is_ok() {
                break;
            }
            // SAFETY: reads the calling thread's last error.
            let code = unsafe { windows::Win32::Foundation::GetLastError() };
            if code == ERROR_PIPE_CONNECTED {
                break;
            }
            if code != ERROR_PIPE_LISTENING {
                return Err("disk.denied".to_string());
            }
            if Instant::now() >= deadline {
                return Err("disk.timeout".to_string());
            }
            progress(started.elapsed().as_secs().min(timeout.as_secs()));
            std::thread::sleep(Duration::from_millis(50));
        }
        // The server was created non-blocking so the connect wait could
        // be bounded and cancelled; reads and writes must block now.
        let mode = PIPE_READMODE_BYTE;
        // SAFETY: the handle is connected and `mode` outlives the call.
        unsafe { SetNamedPipeHandleState(pipe.handle.get(), Some(&mode), None, None) }
            .map_err(|_| "disk.denied".to_string())?;
        // SAFETY: the handle is connected; the File takes ownership and
        // `pipe` must not close it again.
        let file = unsafe { File::from_raw_handle(pipe.handle.get().0 as RawHandle) };
        std::mem::forget(pipe);
        Ok(file)
    }

    fn launch(exe: &std::path::Path, parameters: &str) -> Result<OwnedHandle, String> {
        let verb = crate::explorer::wide_null("runas");
        let file = crate::explorer::wide_null(&exe.to_string_lossy());
        let params = crate::explorer::wide_null(parameters);
        let mut info = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC,
            lpVerb: PCWSTR(verb.as_ptr()),
            lpFile: PCWSTR(file.as_ptr()),
            lpParameters: PCWSTR(params.as_ptr()),
            nShow: SW_HIDE.0,
            ..Default::default()
        };
        // SAFETY: every pointer refers to a buffer that outlives the call.
        match unsafe { ShellExecuteExW(&mut info) } {
            Ok(()) => {}
            Err(error) => {
                let code = error.code().0 as u32 & 0xFFFF;
                if crate::disk_broker_security::launch_cancelled(code) {
                    return Err("disk.cancelled".to_string());
                }
                return Err("disk.denied".to_string());
            }
        }
        if info.hProcess.is_invalid() {
            return Err("disk.denied".to_string());
        }
        Ok(OwnedHandle(info.hProcess))
    }

    struct BrokerConnection {
        reader: Option<File>,
        writer: File,
        process: OwnedHandle,
    }

    impl BrokerConnection {
        fn exchange(
            &mut self,
            request: &BrokerRequest,
            timeout: Duration,
        ) -> Result<BrokerReply, String> {
            let bytes = serde_json::to_vec(request).map_err(|_| "disk.denied".to_string())?;
            write_frame(&mut self.writer, &bytes)?;
            let mut reader = self.reader.take().ok_or_else(|| "disk.denied".to_string())?;
            let (sender, receiver) = mpsc::channel();
            std::thread::spawn(move || {
                let result = read_frame(&mut reader);
                let _ = sender.send((reader, result));
            });
            match receiver.recv_timeout(timeout) {
                Ok((reader, Ok(Some(frame)))) => {
                    self.reader = Some(reader);
                    serde_json::from_slice(&frame).map_err(|_| "disk.denied".to_string())
                }
                Ok((_, _)) => Err("disk.denied".to_string()),
                Err(_) => Err("disk.timeout".to_string()),
            }
        }
    }

    struct BrokerMountHandle {
        connection: Option<BrokerConnection>,
        broker_mount_id: String,
    }

    impl MountHandle for BrokerMountHandle {
        fn detach(&mut self) -> Result<(), String> {
            let Some(mut connection) = self.connection.take() else {
                return Ok(());
            };
            let answer = connection.exchange(
                &BrokerRequest::Eject {
                    mount_id: self.broker_mount_id.clone(),
                },
                BROKER_TIMEOUT,
            );
            match answer {
                Ok(reply)
                    if crate::disk_broker_security::verify_reply(
                        &reply,
                        &self.broker_mount_id,
                        false,
                    )
                    .is_ok() =>
                {
                    if reply.ok {
                        connection.process.wait(Duration::from_secs(2));
                        Ok(())
                    } else if connection.process.exited() {
                        Ok(())
                    } else {
                        self.connection = Some(connection);
                        Err("disk.in_use".to_string())
                    }
                }
                Ok(_) | Err(_) => {
                    if connection.process.exited() {
                        return Ok(());
                    }
                    // An uncorrelated answer or a broken exchange is not
                    // trusted; killing the broker closes its VHD handle,
                    // which detaches the read-only mount and no writable
                    // state exists.
                    connection.process.kill();
                    connection.process.wait(Duration::from_secs(2));
                    Ok(())
                }
            }
        }
    }

    impl Drop for BrokerMountHandle {
        fn drop(&mut self) {
            if let Some(connection) = self.connection.take() {
                // Closing the pipe makes the broker detach and exit.
                drop(connection);
            }
        }
    }

    fn connect_pipe(name: &str, timeout: Duration) -> Result<File, String> {
        let path = format!(r"\\.\pipe\{name}");
        let deadline = Instant::now() + timeout;
        loop {
            match OpenOptions::new().read(true).write(true).open(&path) {
                Ok(file) => return Ok(file),
                Err(_) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(_) => return Err("disk.timeout".to_string()),
            }
        }
    }

    pub fn mount_elevated(
        path: &std::path::Path,
        _kind: DiskImageKind,
        stamp: &SourceStamp,
        token: &CancellationToken,
        progress: &mut dyn FnMut(u64),
    ) -> Result<BrokerAttachment, String> {
        let expected = current_identity()?;
        let name = format!("adp-disk-{}", uuid::Uuid::new_v4());
        if !valid_pipe_name(&name) {
            return Err("disk.denied".to_string());
        }
        let server = create_pipe(&name, &expected.sid)?;
        let exe = std::env::current_exe().map_err(|_| "disk.unavailable".to_string())?;
        let parameters = format!(
            "{HELPER_FLAG} {name} {} {}",
            expected.pid, expected.start_ticks
        );
        let process = launch(&exe, &parameters)?;
        // The identity of the process this app just started, read from
        // the handle ShellExecuteExW returned. Its SID must be the app's
        // own user; a different account can never use the current-user
        // pipe and is refused before any request exists.
        let child = match process_identity(process.get()) {
            Ok(child) => child,
            Err(_) => {
                process.kill();
                return Err("disk.denied".to_string());
            }
        };
        let expected_child = PeerIdentity {
            pid: child.pid,
            start_ticks: child.start_ticks.clone(),
            sid: expected.sid.clone(),
        };
        if child.pid == expected.pid
            || crate::disk_broker_security::verify_peer(&expected_child, &child).is_err()
        {
            process.kill();
            return Err("disk.denied".to_string());
        }
        let reader = match accept(server, BROKER_TIMEOUT, token, progress) {
            Ok(file) => file,
            Err(code) => {
                process.kill();
                return Err(code);
            }
        };
        // The pipe ACL allows the current user; this check binds the
        // connected peer to the exact process the app launched, so no
        // other same-user process can answer the mount request.
        let mut client_pid = 0u32;
        // SAFETY: the pipe is connected and the output is writable.
        let peer = unsafe {
            GetNamedPipeClientProcessId(HANDLE(reader.as_raw_handle()), &mut client_pid)
        };
        if peer.is_err() || client_pid != child.pid || process.exited() {
            process.kill();
            return Err("disk.denied".to_string());
        }
        if token.load(std::sync::atomic::Ordering::Relaxed) {
            process.kill();
            return Err("disk.cancelled".to_string());
        }
        let writer = reader.try_clone().map_err(|_| "disk.unavailable".to_string())?;
        let mut connection = BrokerConnection {
            reader: Some(reader),
            writer,
            process,
        };
        let mount_id = uuid::Uuid::new_v4().to_string();
        let request = BrokerRequest::Mount {
            mount_id: mount_id.clone(),
            request: crate::disk_image_types::MountRequest {
                path: path.to_string_lossy().into_owned(),
                expected: Some(stamp.clone()),
                readonly: true,
                allow_elevation: true,
            },
        };
        let reply = match connection.exchange(&request, BROKER_TIMEOUT) {
            Ok(reply) => reply,
            Err(code) => {
                connection.process.kill();
                return Err(code);
            }
        };
        // The reply must echo the request UUID and carry exactly one
        // consistent, read-only mount answer; anything else is refused
        // before its path or roots are used.
        if let Err(code) = crate::disk_broker_security::verify_reply(&reply, &mount_id, true) {
            connection.process.kill();
            return Err(code);
        }
        let Some(info) = reply.mount else {
            connection.process.kill();
            return Err(reply.error.unwrap_or_else(|| "disk.denied".to_string()));
        };
        Ok(BrokerAttachment {
            handle: Box::new(BrokerMountHandle {
                connection: Some(connection),
                broker_mount_id: mount_id,
            }),
            physical_path: info.physical_path,
            volume_roots: info.volume_roots,
        })
    }

    struct WindowsBrokerHost {
        handle: Option<Box<dyn MountHandle>>,
    }

    impl BrokerHost for WindowsBrokerHost {
        fn open_readonly(
            &mut self,
            _mount_id: &str,
            request: &crate::disk_image_types::MountRequest,
        ) -> Result<BrokerMountInfo, String> {
            if self.handle.is_some() {
                return Err("disk.denied".to_string());
            }
            let kind = crate::disk_images::classify_image(std::path::Path::new(&request.path))?;
            let stamp = fs_service::capture_source_stamp(std::path::Path::new(&request.path))
                .map_err(|_| "disk.changed".to_string())?;
            if let Some(expected) = &request.expected {
                if !crate::disk_image_types::expected_matches(expected, &stamp) {
                    return Err("disk.changed".to_string());
                }
            }
            let (handle, physical_path) = crate::disk_images::broker_open_readonly(
                std::path::Path::new(&request.path),
                kind,
            )?;
            let mut handle = handle;
            // A source that changes while Windows attaches it is never
            // reported as mounted; the freshly attached handle is detached.
            let after =
                match fs_service::capture_source_stamp(std::path::Path::new(&request.path)) {
                    Ok(after) => after,
                    Err(_) => {
                        let _ = crate::disk_mounts::MountHandle::detach(&mut handle);
                        return Err("disk.changed".to_string());
                    }
                };
            if !crate::disk_image_types::same_stamp(&stamp, &after) {
                let _ = crate::disk_mounts::MountHandle::detach(&mut handle);
                return Err("disk.changed".to_string());
            }
            let roots = match crate::disk_volumes::resolve_roots_for_device(
                &physical_path,
                &fs_service::new_cancellation_token(),
                &mut |_| {},
            ) {
                Ok(roots) if !roots.is_empty() => roots,
                _ => {
                    let _ = crate::disk_mounts::MountHandle::detach(&mut handle);
                    return Err("disk.unavailable".to_string());
                }
            };
            let info = BrokerMountInfo {
                physical_path,
                volume_roots: roots,
                readonly: true,
            };
            self.handle = Some(Box::new(handle));
            Ok(info)
        }

        fn detach(&mut self) -> Result<(), String> {
            if let Some(mut handle) = self.handle.take() {
                if let Err(code) = handle.detach() {
                    self.handle = Some(handle);
                    return Err(code);
                }
            }
            Ok(())
        }
    }

    pub fn run_disk_broker(
        pipe_name: &str,
        parent_pid: u32,
        parent_ticks: &str,
    ) -> Result<(), String> {
        if !valid_pipe_name(pipe_name) || parent_pid == 0 || parent_ticks.is_empty() {
            return Err("disk.denied".to_string());
        }
        let file = connect_pipe(pipe_name, BROKER_TIMEOUT)?;
        let mut server_pid = 0u32;
        // SAFETY: the pipe is connected and the output is writable.
        unsafe {
            GetNamedPipeServerProcessId(HANDLE(file.as_raw_handle()), &mut server_pid)
        }
        .map_err(|_| "disk.denied".to_string())?;
        // SAFETY: the id is a live process; the handle is closed below.
        let process = unsafe {
            OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, server_pid)
        }
        .map_err(|_| "disk.denied".to_string())?;
        let process = OwnedHandle(process);
        let actual = process_identity(process.get())?;
        let expected = PeerIdentity {
            pid: parent_pid,
            start_ticks: parent_ticks.to_string(),
            sid: current_identity()?.sid,
        };
        crate::disk_broker_security::verify_peer(&expected, &actual)?;
        let mut reader = file.try_clone().map_err(|_| "disk.unavailable".to_string())?;
        let mut writer = file;
        let mut host = WindowsBrokerHost { handle: None };
        crate::disk_broker_security::run_session(&mut host, &mut reader, &mut writer)
    }

}

#[cfg(windows)]
pub use windows_impl::{mount_elevated, run_disk_broker};
