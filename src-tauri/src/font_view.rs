//! Font preview (Step 06f D10, D11): the helper process reports a font's
//! names and characters, and Install runs Windows' own `install` verb after
//! the user's explicit click. The app never writes into a fonts folder.

use tauri::{AppHandle, State, WebviewWindow};

use crate::font_helper::{self, FontInfo, HelperMessage, HELPER_FLAG, HELPER_MEMORY_LIMIT};
use crate::helper::{self, DriveEnd, DriveTimings, HelperProcess};
use crate::jobs::{spawn_job, JobContext, Jobs};
use crate::{ensure_main, valid_request_id, validate_absolute_path};

fn helper_code(code: &str) -> String {
    match code {
        "helper.timeout" => "font.timeout".to_string(),
        _ => "font.helper_failed".to_string(),
    }
}

fn run_font_helper(ctx: &JobContext, path: &str) -> Result<FontInfo, String> {
    let mut process = HelperProcess::spawn(HELPER_FLAG, HELPER_MEMORY_LIMIT)
        .map_err(|_| "font.helper_failed".to_string())?;
    let request = serde_json::to_string(&font_helper::HelperRequest {
        path: path.to_string(),
    })
    .map_err(|_| "font.helper_failed".to_string())?;
    process
        .send_line(&request)
        .map_err(|_| "font.helper_failed".to_string())?;
    let mut info: Option<FontInfo> = None;
    let mut failure: Option<String> = None;
    let end = helper::drive(
        &mut process,
        ctx.token(),
        DriveTimings::default(),
        &mut |text| {
            let message: HelperMessage =
                serde_json::from_str(text).map_err(|_| "font.helper_failed".to_string())?;
            match message {
                HelperMessage::Info { info: found } => {
                    info = Some(*found);
                    Ok(true)
                }
                HelperMessage::Failed { code } => {
                    failure = Some(code);
                    Ok(true)
                }
            }
        },
    );
    match end {
        Ok(DriveEnd::Finished) => match (failure, info) {
            (Some(code), _) => Err(code),
            (None, Some(info)) => Ok(info),
            (None, None) => Err("font.helper_failed".to_string()),
        },
        Ok(DriveEnd::Cancelled) => Err("font.cancelled".to_string()),
        Err(code) => Err(helper_code(&code)),
    }
}

/// Read a font's details in the helper process, in the background.
#[tauri::command]
pub fn font_info_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    app: AppHandle,
    request_id: String,
    path: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id).map_err(|_| "font.bad_request".to_string())?;
    validate_absolute_path(&path).map_err(|_| "font.bad_request".to_string())?;
    let token = jobs
        .begin(&request_id, 0)
        .map_err(|_| "font.bad_request".to_string())?;
    spawn_job(app, request_id, token, move |ctx| {
        let info = run_font_helper(ctx, &path)?;
        serde_json::to_value(info).map_err(|_| "font.helper_failed".to_string())
    });
    Ok(())
}

/// Ask Windows to install the font. False means the user cancelled Windows'
/// own prompt.
#[tauri::command]
pub async fn font_install(window: WebviewWindow, path: String) -> Result<bool, String> {
    ensure_main(window.label())?;
    font_helper::validate_install_path(&path)?;
    tauri::async_runtime::spawn_blocking(move || install_font(&path))
        .await
        .map_err(|_| "font.install_failed".to_string())?
}

#[cfg(windows)]
fn install_font(path: &str) -> Result<bool, String> {
    use crate::explorer::wide_null;
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW};
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let _com = crate::explorer::ComGuard::new();
    let file = wide_null(path);
    let verb = wide_null("install");
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        // NOASYNC: this worker thread ends right after the call.
        fMask: SEE_MASK_NOASYNC,
        lpVerb: PCWSTR(verb.as_ptr()),
        lpFile: PCWSTR(file.as_ptr()),
        nShow: SW_SHOWNORMAL.0,
        ..Default::default()
    };
    // SAFETY: every pointer in `info` refers to a buffer that outlives the
    // call, and COM is initialized on this thread just above.
    match unsafe { ShellExecuteExW(&mut info) } {
        Ok(()) => Ok(true),
        Err(error) if crate::shell::is_cancelled(&error) => Ok(false),
        Err(_) => Err("font.install_failed".to_string()),
    }
}

#[cfg(not(windows))]
fn install_font(_path: &str) -> Result<bool, String> {
    Err("font.install_failed".to_string())
}
