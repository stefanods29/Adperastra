//! Named-pipe transport for user-scoped single instance activation
//! (Step 09c D9/D10).
//!
//! The primary owns `\\.\pipe\adperastra.activation.<sid>` with a
//! current-user-and-SYSTEM DACL, rejects remote clients and checks the
//! client process SID again. One frame is a little-endian `u32` length plus
//! UTF-8 JSON, capped at 768 KiB. An ack means "queued", never "opened".
//! A secondary forwards one bounded request, waits at most three seconds
//! and never starts a window.
#![allow(clippy::collapsible_match, clippy::redundant_closure_call, clippy::redundant_clone)]
use crate::activation::{
    now_unix, process_activation, same_uuid, validate_activation, ActivationAck,
    ActivationQueue, ActivationRequest, ACTIVATION_TIMEOUT_MS, ACTIVATION_VERSION, ERR_BUSY,
    ERR_DENIED, ERR_INVALID, ERR_TIMEOUT, MAX_ACTIVATION_BYTES,
};
use std::sync::Arc;
pub const ACTIVATION_OPEN_EVENT: &str = "activation-open";
const MAX_ACK_BYTES: usize = 64 * 1024;
pub enum ForwardOutcome {
    Accepted,
    Refused(String),
    TimedOut,
}
/// Install the ready flag and hand the startup queue to the caller. The
/// frontend calls this once, after its `activation-open` listener exists.
#[tauri::command]
pub fn activation_ready(
    window: tauri::WebviewWindow,
    queue: tauri::State<'_, Arc<ActivationQueue>>,
) -> Result<Vec<ActivationRequest>, String> {
    crate::ensure_main(window.label())?;
    queue.mark_ready_and_drain()
}
/// Start the per-user pipe server on its own thread. Pre-ready requests
/// stay in the bounded queue and are drained by `activation_ready`.
pub fn start_pipe_server(app: tauri::AppHandle, queue: Arc<ActivationQueue>) {
    #[cfg(windows)]
    {
        std::thread::spawn(move || pipe_loop(app, queue));
    }
    #[cfg(not(windows))]
    {
        let _ = (app, queue);
    }
}
/// Send one request and wait at most `ACTIVATION_TIMEOUT_MS` for the ack.
pub fn forward_activation(
    paths: &[String],
    intent: Option<crate::windows_integration_types::ActivationIntent>,
) -> ForwardOutcome {
    let request = ActivationRequest {
        version: ACTIVATION_VERSION,
        request_id: uuid::Uuid::new_v4().to_string(),
        paths: paths.to_vec(),
        sent_unix: now_unix(),
        intent,
    };
    let request_id = request.request_id.clone();
    #[cfg(windows)]
    {
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = sender.send(exchange(&request));
        });
        match receiver.recv_timeout(std::time::Duration::from_millis(
            ACTIVATION_TIMEOUT_MS as u64,
        )) {
            Ok(Ok(ack)) => interpret_ack(&request_id, ack),
            Ok(Err(code)) if code == ERR_TIMEOUT => ForwardOutcome::TimedOut,
            Ok(Err(code)) => ForwardOutcome::Refused(code),
            Err(_) => ForwardOutcome::TimedOut,
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (request, request_id);
        ForwardOutcome::TimedOut
    }
}
/// Entry path of a secondary instance: parse once, forward one request,
/// show a translated error when refused, and exit. An empty launch exits.
pub fn run_secondary(args: &[String]) -> ! {
    if args.is_empty() {
        std::process::exit(0);
    }
    let language = crate::load_settings(&crate::resolve_data_dir()).language;
    match crate::activation::parse_activation_args(args) {
        Ok((intent, paths)) => match forward_activation(&paths, Some(intent)) {
            ForwardOutcome::Accepted => std::process::exit(0),
            ForwardOutcome::Refused(error) => {
                show_activation_error(&error, &language);
                std::process::exit(1);
            }
            ForwardOutcome::TimedOut => {
                show_activation_error(ERR_TIMEOUT, &language);
                std::process::exit(1);
            }
        },
        Err(error) => {
            show_activation_error(&error, &language);
            std::process::exit(2);
        }
    }
}
/// Show the translated activation error in the configured language. The
/// text lives in the locale files; no user-visible string is written here.
pub fn show_activation_error(error: &str, language: &str) {
    #[cfg(windows)]
    {
        use windows::core::PCWSTR;
        use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
        let body = activation_text(language, error.trim_start_matches("activation."))
            .or_else(|| activation_text(language, "denied"))
            .unwrap_or_default();
        let title = activation_text(language, "title").unwrap_or_else(|| body.clone());
        if body.is_empty() && title.is_empty() {
            return;
        }
        let body = wide(&body);
        let title = wide(&title);
        unsafe {
            MessageBoxW(
                None,
                PCWSTR(body.as_ptr()),
                PCWSTR(title.as_ptr()),
                MB_OK | MB_ICONERROR,
            );
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (error, language);
    }
}
#[cfg(windows)]
fn interpret_ack(expected_request_id: &str, ack: ActivationAck) -> ForwardOutcome {
    if !same_uuid(expected_request_id, &ack.request_id) {
        return ForwardOutcome::TimedOut;
    }
    if ack.accepted {
        return ForwardOutcome::Accepted;
    }
    let code = ack.error.unwrap_or_else(|| ERR_DENIED.to_string());
    if code == ERR_INVALID || code == ERR_BUSY || code == ERR_DENIED || code == ERR_TIMEOUT {
        ForwardOutcome::Refused(code)
    } else {
        ForwardOutcome::Refused(ERR_DENIED.to_string())
    }
}
#[cfg(windows)]
fn activation_text(language: &str, key: &str) -> Option<String> {
    let source = if language == "es" {
        include_str!("../../src/i18n/locales/es.json")
    } else {
        include_str!("../../src/i18n/locales/en.json")
    };
    let root: serde_json::Value = serde_json::from_str(source).ok()?;
    root.get("errors")?
        .get("activation")?
        .get(key)?
        .as_str()
        .map(str::to_owned)
}
#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}
#[cfg(windows)]
fn pipe_loop(app: tauri::AppHandle, queue: Arc<ActivationQueue>) {
    use windows::Win32::Foundation::{CloseHandle, GetLastError, ERROR_PIPE_CONNECTED};
    use windows::Win32::System::Pipes::{ConnectNamedPipe, DisconnectNamedPipe};
    use crate::activation_security::{
        client_allowed, client_sid, pipe_name, PipeSecurity, UserSid,
    };
    let Ok(user) = UserSid::current() else {
        return;
    };
    let Ok(security) = PipeSecurity::new(&user) else {
        return;
    };
    let name = pipe_name(user.text());
    loop {
        let Ok(pipe) = security.create_pipe(&name) else {
            return;
        };
        let connected = match unsafe { ConnectNamedPipe(pipe, None) } {
            Ok(()) => true,
            Err(_) => unsafe { GetLastError() == ERROR_PIPE_CONNECTED },
        };
        if connected {
            let peer = client_sid(pipe);
            if client_allowed(user.text(), peer.as_deref()) {
                serve_one(&app, &queue, pipe);
            }
            let _ = unsafe { DisconnectNamedPipe(pipe) };
        } else {
            // A rejected remote client or transient failure: do not spin.
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let _ = unsafe { CloseHandle(pipe) };
    }
}
#[cfg(windows)]
fn serve_one(app: &tauri::AppHandle, queue: &ActivationQueue, pipe: windows::Win32::Foundation::HANDLE) {
    use tauri::Emitter;
    let Some(bytes) = read_frame(pipe, MAX_ACTIVATION_BYTES) else {
        return;
    };
    let request = match validate_activation(&bytes) {
        Ok(request) => request,
        Err(code) => {
            if let Some(request_id) = invalid_request_id(&bytes) {
                write_ack(
                    pipe,
                    &ActivationAck {
                        request_id,
                        accepted: false,
                        error: Some(code),
                    },
                );
            }
            return;
        }
    };
    let request_id = request.request_id.clone();
    let ack = match process_activation(request, queue) {
        Ok(ack) => ack,
        Err(_) => ActivationAck {
            request_id,
            accepted: false,
            error: Some(ERR_DENIED.to_string()),
        },
    };
    let accepted = ack.accepted;
    write_ack(pipe, &ack);
    if !accepted {
        return;
    }
    focus_main_window(app);
    for request in queue.drain_for_event() {
        let _ = app.emit(ACTIVATION_OPEN_EVENT, request);
    }
}
#[cfg(windows)]
fn invalid_request_id(bytes: &[u8]) -> Option<String> {
    let value: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    let id = value.get("request_id")?.as_str()?;
    uuid::Uuid::parse_str(id).ok().map(|id| id.to_string())
}
#[cfg(windows)]
fn focus_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;
    let runner = app.clone();
    let inner = app.clone();
    let _ = runner.run_on_main_thread(move || {
        let Some(window) = inner.get_webview_window("main") else {
            return;
        };
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let focused = window.is_focused().unwrap_or(false);
        if !focused {
            if let Ok(raw) = window.hwnd() {
                crate::activation_security::flash_taskbar(raw.0 as isize);
            }
        }
    });
}
#[cfg(windows)]
fn read_frame(pipe: windows::Win32::Foundation::HANDLE, cap: usize) -> Option<Vec<u8>> {
    let mut prefix = [0u8; 4];
    read_exact(pipe, &mut prefix).ok()?;
    let length = u32::from_le_bytes(prefix) as usize;
    if length == 0 || length > cap {
        return None;
    }
    let mut payload = vec![0u8; length];
    read_exact(pipe, &mut payload).ok()?;
    Some(payload)
}
#[cfg(windows)]
fn write_ack(pipe: windows::Win32::Foundation::HANDLE, ack: &ActivationAck) {
    use windows::Win32::Storage::FileSystem::FlushFileBuffers;
    let Ok(bytes) = serde_json::to_vec(ack) else {
        return;
    };
    if bytes.is_empty() || bytes.len() > MAX_ACK_BYTES {
        return;
    }
    let mut frame = (bytes.len() as u32).to_le_bytes().to_vec();
    frame.extend_from_slice(&bytes);
    if write_all(pipe, &frame).is_ok() {
        let _ = unsafe { FlushFileBuffers(pipe) };
    }
}
#[cfg(windows)]
fn exchange(request: &ActivationRequest) -> Result<ActivationAck, String> {
    use windows::Win32::Foundation::CloseHandle;
    use crate::activation_security::{pipe_name, UserSid};
    let user = UserSid::current().map_err(|_| ERR_DENIED.to_string())?;
    let payload = serde_json::to_vec(request).map_err(|_| ERR_INVALID.to_string())?;
    if payload.is_empty() || payload.len() > MAX_ACTIVATION_BYTES {
        return Err(ERR_INVALID.to_string());
    }
    let pipe = connect(&pipe_name(user.text()))?;
    let result = (|| -> Result<ActivationAck, String> {
        write_all(pipe, &(payload.len() as u32).to_le_bytes())?;
        write_all(pipe, &payload)?;
        unsafe { windows::Win32::Storage::FileSystem::FlushFileBuffers(pipe) }
            .map_err(|_| ERR_TIMEOUT.to_string())?;
        let mut prefix = [0u8; 4];
        read_exact(pipe, &mut prefix)?;
        let length = u32::from_le_bytes(prefix) as usize;
        if length == 0 || length > MAX_ACK_BYTES {
            return Err(ERR_TIMEOUT.to_string());
        }
        let mut bytes = vec![0u8; length];
        read_exact(pipe, &mut bytes)?;
        serde_json::from_slice(&bytes).map_err(|_| ERR_TIMEOUT.to_string())
    })();
    let _ = unsafe { CloseHandle(pipe) };
    result
}
#[cfg(windows)]
fn connect(name: &str) -> Result<windows::Win32::Foundation::HANDLE, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{
        GetLastError, ERROR_FILE_NOT_FOUND, ERROR_PIPE_BUSY, GENERIC_READ, GENERIC_WRITE,
    };
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_NONE, OPEN_EXISTING,
    };
    let deadline =
        std::time::Instant::now() + std::time::Duration::from_millis(ACTIVATION_TIMEOUT_MS as u64);
    let name = wide(name);
    loop {
        let result = unsafe {
            CreateFileW(
                PCWSTR(name.as_ptr()),
                GENERIC_READ.0 | GENERIC_WRITE.0,
                FILE_SHARE_NONE,
                None,
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL,
                None,
            )
        };
        match result {
            Ok(handle) => return Ok(handle),
            Err(_) => {
                let error = unsafe { GetLastError() };
                if error != ERROR_PIPE_BUSY && error != ERROR_FILE_NOT_FOUND {
                    return Err(ERR_DENIED.to_string());
                }
                if std::time::Instant::now() >= deadline {
                    return Err(ERR_TIMEOUT.to_string());
                }
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
        }
    }
}
#[cfg(windows)]
fn write_all(
    pipe: windows::Win32::Foundation::HANDLE,
    buffer: &[u8],
) -> Result<(), String> {
    use windows::Win32::Storage::FileSystem::WriteFile;
    let mut offset = 0usize;
    while offset < buffer.len() {
        let mut written = 0u32;
        unsafe { WriteFile(pipe, Some(&buffer[offset..]), Some(&mut written), None) }
            .map_err(|_| ERR_TIMEOUT.to_string())?;
        if written == 0 {
            return Err(ERR_TIMEOUT.to_string());
        }
        offset += written as usize;
    }
    Ok(())
}
#[cfg(windows)]
fn read_exact(
    pipe: windows::Win32::Foundation::HANDLE,
    buffer: &mut [u8],
) -> Result<(), String> {
    use windows::Win32::Storage::FileSystem::ReadFile;
    let mut offset = 0usize;
    while offset < buffer.len() {
        let mut read = 0u32;
        unsafe { ReadFile(pipe, Some(&mut buffer[offset..]), Some(&mut read), None) }
            .map_err(|_| ERR_TIMEOUT.to_string())?;
        if read == 0 {
            return Err(ERR_TIMEOUT.to_string());
        }
        offset += read as usize;
    }
    Ok(())
}
#[cfg(test)]
#[path = "activation_step09c_tests.rs"]
mod activation_step09c_tests;
