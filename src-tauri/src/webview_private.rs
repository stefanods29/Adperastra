#![allow(dead_code)] // Public producer API; consumed from Step 07e onward.
//! The required private-profile proof (Step 07d, "Required native
//! private-profile proof").
//!
//! `WebviewWindowBuilder::incognito(true)` alone proves nothing: Wry 0.57.1
//! falls back to an ordinary controller when the environment does not expose
//! `ICoreWebView2Environment10`, and a data-folder name is not a privacy
//! guarantee. So every helper asks the live WebView2 profile itself, on the
//! WebView/UI thread, and only a `true` answer lets sensitive grants, tokens
//! or bytes reach the child.
//!
//! The proof is native-only: a window label, the process id and an instant.
//! It is never serialized and never authorizes a second window.

use std::sync::mpsc::{sync_channel, RecvTimeoutError};
use std::time::{Duration, Instant};

use tauri::{WebviewWindow, Wry};

/// How long the profile answer may take (2 s).
pub const PREFLIGHT_TIMEOUT: Duration = Duration::from_secs(2);

/// The proof that one exact, live window is in private mode.
#[derive(Debug)]
pub struct PrivateWebviewProof {
    window_label: String,
    process_id: u32,
    verified_at: Instant,
}

impl PrivateWebviewProof {
    pub fn window_label(&self) -> &str {
        &self.window_label
    }

    pub fn process_id(&self) -> u32 {
        self.process_id
    }

    /// How long ago the profile answered; a child replaces the proof, not
    /// the window, so the answer keeps its age.
    pub fn age(&self) -> Duration {
        self.verified_at.elapsed()
    }

    /// A proof authorizes exactly the window it was made for.
    pub fn is_for(&self, window_label: &str) -> bool {
        self.window_label == window_label
    }
}

/// Turn a profile answer into a proof: `false` or an error is always
/// `helper.sensitive_unsupported`.
pub fn proof_from_answer(
    window_label: &str,
    process_id: u32,
    answer: Result<bool, String>,
) -> Result<PrivateWebviewProof, String> {
    match answer {
        Ok(true) => Ok(PrivateWebviewProof {
            window_label: window_label.to_string(),
            process_id,
            verified_at: Instant::now(),
        }),
        _ => Err("helper.sensitive_unsupported".to_string()),
    }
}

/// Run a profile query under the timeout. The query runs wherever the caller
/// puts it (in production: the UI thread, through `with_webview`), and a late
/// answer finds a dropped receiver and changes no state.
pub fn preflight_with<F>(
    window_label: &str,
    process_id: u32,
    query: F,
    timeout: Duration,
) -> Result<PrivateWebviewProof, String>
where
    F: FnOnce() -> Result<bool, String> + Send + 'static,
{
    let (sender, receiver) = sync_channel::<Result<bool, String>>(1);
    std::thread::spawn(move || {
        let answer = query();
        let _ = sender.try_send(answer);
    });
    match receiver.recv_timeout(timeout) {
        Ok(answer) => proof_from_answer(window_label, process_id, answer),
        Err(RecvTimeoutError::Timeout) | Err(RecvTimeoutError::Disconnected) => {
            Err("helper.sensitive_unsupported".to_string())
        }
    }
}

/// Ask the live WebView2 of this window whether its profile is private.
///
/// Call this from a dedicated helper thread after Tauri's event loop is
/// running, never on the UI thread itself: all COM work happens inside a
/// `with_webview` closure, which Tauri runs on the WebView/UI thread.
#[cfg(windows)]
pub fn require_private_webview(window: &WebviewWindow<Wry>) -> Result<PrivateWebviewProof, String> {
    let label = window.label().to_string();
    let process_id = std::process::id();
    let (sender, receiver) = sync_channel::<Result<bool, String>>(1);
    let handle = window.clone();
    let scheduled = handle.with_webview(move |platform| {
        let answer = private_mode_of(platform);
        // The receiver may be gone (timeout): the answer is then dropped on
        // this thread and no host state changes.
        let _ = sender.try_send(answer);
    });
    if scheduled.is_err() {
        return Err("helper.sensitive_unsupported".to_string());
    }
    match receiver.recv_timeout(PREFLIGHT_TIMEOUT) {
        Ok(answer) => proof_from_answer(&label, process_id, answer),
        Err(_) => Err("helper.sensitive_unsupported".to_string()),
    }
}

/// Ask WebView2 for `IsInPrivateModeEnabled`. Only the boolean leaves this
/// function; no COM pointer crosses a thread or a channel.
#[cfg(windows)]
fn private_mode_of(platform: tauri::webview::PlatformWebview) -> Result<bool, String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_13;
    use windows_core_webview::Interface;

    let failed = || "helper.sensitive_unsupported".to_string();
    let controller = platform.controller();
    // SAFETY: the controller belongs to the live platform webview, every
    // pointer is a local that outlives the call, and each COM reference is
    // released on this same thread before the closure ends.
    unsafe {
        let core = controller.CoreWebView2().map_err(|_| failed())?;
        let extended: ICoreWebView2_13 = core.cast().map_err(|_| failed())?;
        let profile = extended.Profile().map_err(|_| failed())?;
        // windows-core 0.62 exports `BOOL` as `i32` (through windows-strings).
        let mut private = windows_core_webview::BOOL(0);
        profile
            .IsInPrivateModeEnabled(&mut private)
            .map_err(|_| failed())?;
        Ok(private.as_bool())
    }
}

#[cfg(not(windows))]
pub fn require_private_webview(
    _window: &WebviewWindow<Wry>,
) -> Result<PrivateWebviewProof, String> {
    Err("helper.sensitive_unsupported".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn private_true_allows_grants() {
        let proof = preflight_with("webview-helper-pdf", 7, || Ok(true), Duration::from_secs(2))
            .expect("a true answer is a proof");
        assert_eq!(proof.window_label(), "webview-helper-pdf");
        assert_eq!(proof.process_id(), 7);
        assert!(proof.is_for("webview-helper-pdf"));
        assert!(!proof.is_for("webview-helper-book"));
    }

    #[test]
    fn private_false_zero_grants() {
        assert_eq!(
            proof_from_answer("webview-helper-pdf", 7, Ok(false)).err(),
            Some("helper.sensitive_unsupported".to_string())
        );
        // The caller must close the window on this answer; no proof exists,
        // so no token or body can be delivered.
    }

    #[test]
    fn missing_profile_interface_zero_bytes() {
        assert_eq!(
            proof_from_answer(
                "webview-helper-pdf",
                7,
                Err("no ICoreWebView2_13".to_string())
            )
            .err(),
            Some("helper.sensitive_unsupported".to_string())
        );
        assert_eq!(
            preflight_with(
                "webview-helper-pdf",
                7,
                || Err("no profile".to_string()),
                Duration::from_secs(1)
            )
            .err(),
            Some("helper.sensitive_unsupported".to_string())
        );
    }

    #[test]
    fn preflight_timeout_closes_window() {
        let started = Instant::now();
        assert_eq!(
            preflight_with(
                "webview-helper-pdf",
                7,
                || {
                    std::thread::sleep(Duration::from_millis(200));
                    Ok(true)
                },
                Duration::from_millis(20)
            )
            .err(),
            Some("helper.sensitive_unsupported".to_string())
        );
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn stale_callback_cannot_authorize_new_window() {
        // A late "true" for the old window arrives after its receiver is
        // gone. It cannot produce a proof at all, and even a valid proof is
        // bound to its own label.
        let (sender, receiver) = sync_channel::<Result<bool, String>>(1);
        drop(receiver);
        let late = sender.try_send(Ok(true));
        assert!(late.is_err());
        let old = proof_from_answer("webview-helper-old", 7, Ok(true)).unwrap();
        assert!(!old.is_for("webview-helper-new"));
    }
}
