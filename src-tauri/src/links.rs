//! Opening web and mail links from viewers in the user's default browser
//! or mail app (Step 04b). Only http, https and mailto links are allowed.

use tauri::WebviewWindow;

use crate::ensure_main;

/// Longest link the app will open.
pub const MAX_URL_CHARS: usize = 2048;

/// Accept only http(s) and mailto links without spaces or control
/// characters. Returns the link unchanged.
pub fn validate_external_url(url: &str) -> Result<&str, String> {
    let lower = url.to_ascii_lowercase();
    let allowed_scheme = lower.starts_with("https://")
        || lower.starts_with("http://")
        || lower.starts_with("mailto:");
    if !allowed_scheme
        || url.chars().count() > MAX_URL_CHARS
        || url.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        return Err("links.invalid".to_string());
    }
    Ok(url)
}

#[cfg(windows)]
pub(crate) fn shell_open(url: &str) -> Result<(), String> {
    use crate::explorer::{wide_null, ComGuard};
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW};
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let _com = ComGuard::new();
    let verb = wide_null("open");
    let file = wide_null(url);
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOASYNC,
        lpVerb: PCWSTR(verb.as_ptr()),
        lpFile: PCWSTR(file.as_ptr()),
        nShow: SW_SHOWNORMAL.0,
        ..Default::default()
    };
    // SAFETY: `verb` and `file` outlive the call; COM is initialized on
    // this thread by `_com`.
    unsafe { ShellExecuteExW(&mut info) }.map_err(|_| "links.failed".to_string())
}

#[cfg(not(windows))]
fn shell_open(_url: &str) -> Result<(), String> {
    Err("links.failed".to_string())
}

/// Open a link the user clicked (after the UI asked them to confirm).
#[tauri::command]
pub async fn open_external_url(window: WebviewWindow, url: String) -> Result<(), String> {
    ensure_main(window.label())?;
    validate_external_url(&url)?;
    tauri::async_runtime::spawn_blocking(move || shell_open(&url))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_only_web_and_mail_links() {
        assert!(validate_external_url("https://example.com/a?b=c").is_ok());
        assert!(validate_external_url("HTTP://example.com").is_ok());
        assert!(validate_external_url("mailto:someone@example.com").is_ok());
        for bad in [
            "file:///C:/Windows/system32/calc.exe",
            "javascript:alert(1)",
            "C:\\Windows\\notepad.exe",
            "ms-settings:privacy",
            "https://example.com/a b",
            "https://example.com/\u{0007}",
        ] {
            assert_eq!(
                validate_external_url(bad),
                Err("links.invalid".to_string()),
                "{bad}"
            );
        }
        let long = format!("https://example.com/{}", "a".repeat(MAX_URL_CHARS));
        assert!(validate_external_url(&long).is_err());
    }
}
