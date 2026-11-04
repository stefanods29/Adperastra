//! "What is using this?" commands and the isolated file-lock helper
//! (Step 09g, E1/E2).
//!
//! The UI never runs Restart Manager in the app process. Both inspection
//! and normal close start `Adperastra.exe --file-locks-helper` through the
//! shared `helper::HelperProcess`, send one bounded JSON line and wait at
//! most 3 seconds. A timeout or cancel kills only that owned helper.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::file_lock_types::{
    validate_inspect_paths, CloseLockProcessRequest, CloseLockProcessResult, FileLockReport,
    ERR_LOCK_CANCELLED, ERR_LOCK_DENIED, ERR_LOCK_FAILED, ERR_LOCK_TIMEOUT,
    MAX_HELPER_REQUEST_BYTES,
};
use crate::helper::{self, DriveEnd, DriveTimings, HelperProcess};
use crate::jobs::{spawn_job, Jobs};
use crate::{ensure_main, valid_request_id};

pub const HELPER_FLAG: &str = "--file-locks-helper";
/// The helper runs in a memory-limited job, like every other helper.
pub const HELPER_MEMORY_LIMIT: usize = 256 * 1024 * 1024;
/// Decision 1: three seconds of wall time for one lock question.
pub const HELPER_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum LockHelperRequest {
    Inspect {
        /// The app process; the helper never allows closing it (D2).
        owner_pid: u32,
        paths: Vec<String>,
    },
    Close {
        owner_pid: u32,
        pid: u32,
        start_ticks: String,
        confirmed: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LockHelperReply {
    Report { report: FileLockReport },
    Closed { result: CloseLockProcessResult },
    Error { code: String },
}

fn progress(items_done: usize, items_total: usize) -> fs_service::OpProgress {
    fs_service::OpProgress {
        items_done,
        items_total,
        bytes_done: 0,
        bytes_total: 0,
        current: String::new(),
    }
}

/// One bounded helper conversation. `drive` owns the timeout, grace and
/// kill rules; this function only maps the transport codes to `locks.*`.
fn ask_helper(
    request: &LockHelperRequest,
    token: &fs_service::CancellationToken,
) -> Result<LockHelperReply, String> {
    let body = serde_json::to_string(request).map_err(|_| ERR_LOCK_FAILED.to_string())?;
    if body.len() > MAX_HELPER_REQUEST_BYTES {
        return Err(ERR_LOCK_FAILED.to_string());
    }
    let mut helper =
        HelperProcess::spawn(HELPER_FLAG, HELPER_MEMORY_LIMIT).map_err(|_| ERR_LOCK_FAILED.to_string())?;
    helper
        .send_line(&body)
        .map_err(|_| ERR_LOCK_FAILED.to_string())?;
    let timings = DriveTimings {
        tick: Duration::from_millis(50),
        idle: HELPER_TIMEOUT,
        grace: Duration::from_millis(250),
    };
    let mut reply = None;
    let end = helper::drive(&mut helper, token, timings, &mut |line| {
        let parsed: LockHelperReply =
            serde_json::from_str(line).map_err(|_| ERR_LOCK_FAILED.to_string())?;
        reply = Some(parsed);
        Ok(true)
    });
    match end {
        Ok(DriveEnd::Finished) => reply.ok_or_else(|| ERR_LOCK_FAILED.to_string()),
        Ok(DriveEnd::Cancelled) => Err(ERR_LOCK_CANCELLED.to_string()),
        Err(code) if code == "helper.timeout" => Err(ERR_LOCK_TIMEOUT.to_string()),
        Err(_) => Err(ERR_LOCK_FAILED.to_string()),
    }
}

/// E1 native work: inspect the validated paths in the helper.
pub fn inspect(paths: &[String], token: &fs_service::CancellationToken) -> Result<FileLockReport, String> {
    validate_inspect_paths(paths)?;
    match ask_helper(
        &LockHelperRequest::Inspect {
            owner_pid: std::process::id(),
            paths: paths.to_vec(),
        },
        token,
    )? {
        LockHelperReply::Report { report } => {
            report.validate()?;
            Ok(report)
        }
        LockHelperReply::Error { code } => Err(code),
        _ => Err(ERR_LOCK_FAILED.to_string()),
    }
}

/// E2 native work: ask the exact process to close in a fresh helper.
pub fn close(
    request: &CloseLockProcessRequest,
    token: &fs_service::CancellationToken,
) -> Result<CloseLockProcessResult, String> {
    request.validate()?;
    match ask_helper(
        &LockHelperRequest::Close {
            owner_pid: std::process::id(),
            pid: request.pid,
            start_ticks: request.start_ticks.clone(),
            confirmed: true,
        },
        token,
    )? {
        LockHelperReply::Closed { result } => {
            result.validate()?;
            Ok(result)
        }
        LockHelperReply::Error { code } => Err(code),
        _ => Err(ERR_LOCK_FAILED.to_string()),
    }
}

#[tauri::command]
pub fn locks_inspect_start(
    window: WebviewWindow,
    app: AppHandle,
    request_id: String,
    paths: Vec<String>,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    validate_inspect_paths(&paths)?;
    let total = paths.len();
    let token = app.state::<Jobs>().begin(&request_id, total)?;
    spawn_job(app, request_id, token, move |context| {
        let report = inspect(&paths, context.token())?;
        context.set_progress(&progress(total, total));
        serde_json::to_value(report).map_err(|_| ERR_LOCK_FAILED.to_string())
    });
    Ok(())
}

#[tauri::command]
pub fn locks_close_start(
    window: WebviewWindow,
    app: AppHandle,
    request_id: String,
    request: CloseLockProcessRequest,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    request.validate()?;
    let token = app.state::<Jobs>().begin(&request_id, 1)?;
    spawn_job(app, request_id, token, move |context| {
        let result = close(&request, context.token())?;
        context.set_progress(&progress(1, 1));
        serde_json::to_value(result).map_err(|_| ERR_LOCK_FAILED.to_string())
    });
    Ok(())
}

/// Entry point of the `--file-locks-helper` process. One request line,
/// one reply line; no path or password ever appears on a command line.
pub fn run_helper() -> i32 {
    let mut reader = std::io::BufReader::new(std::io::stdin());
    let line = match crate::helper::read_capped_line(&mut reader, crate::helper::MAX_HELPER_LINE) {
        crate::helper::HelperLine::Line(line) => line,
        _ => return write_error(ERR_LOCK_FAILED),
    };
    let request: LockHelperRequest = match serde_json::from_str(&line) {
        Ok(request) => request,
        Err(_) => return write_error(ERR_LOCK_FAILED),
    };
    let reply = match request {
        LockHelperRequest::Inspect { owner_pid, paths } => match validate_inspect_paths(&paths) {
            Ok(()) if owner_pid > 4 => match crate::restart_manager::inspect_paths(&paths, owner_pid)
            {
                Ok(report) => LockHelperReply::Report { report },
                Err(code) => LockHelperReply::Error { code },
            },
            Ok(()) => LockHelperReply::Error {
                code: ERR_LOCK_DENIED.to_string(),
            },
            Err(code) => LockHelperReply::Error { code },
        },
        LockHelperRequest::Close {
            owner_pid,
            pid,
            start_ticks,
            confirmed,
        } => {
            if !confirmed || owner_pid <= 4 {
                LockHelperReply::Error {
                    code: crate::file_lock_types::ERR_LOCK_DENIED.to_string(),
                }
            } else {
                match crate::restart_manager::close_process(pid, &start_ticks, owner_pid) {
                    Ok(result) => LockHelperReply::Closed { result },
                    Err(code) => LockHelperReply::Error { code },
                }
            }
        }
    };
    match serde_json::to_string(&reply) {
        Ok(text) => {
            println!("{text}");
            0
        }
        Err(_) => 2,
    }
}

fn write_error(code: &str) -> i32 {
    let reply = LockHelperReply::Error {
        code: code.to_string(),
    };
    if let Ok(text) = serde_json::to_string(&reply) {
        println!("{text}");
    }
    2
}

#[cfg(test)]
mod tests {
    use super::{close, inspect, LockHelperReply, LockHelperRequest};
    use crate::file_lock_types::{CloseLockProcessRequest, MAX_LOCK_PATHS};

    #[test]
    fn invalid_inspection_request_never_starts_a_helper() {
        let paths = (0..=MAX_LOCK_PATHS)
            .map(|index| format!("C:\\a\\{index}.txt"))
            .collect::<Vec<_>>();
        let token = fs_service::new_cancellation_token();
        assert_eq!(
            inspect(&paths, &token).unwrap_err(),
            "locks.failed"
        );
    }

    #[test]
    fn invalid_close_request_never_starts_a_helper() {
        let token = fs_service::new_cancellation_token();
        for request in [
            CloseLockProcessRequest {
                pid: 0,
                start_ticks: "1".to_string(),
                confirmed: true,
            },
            CloseLockProcessRequest {
                pid: 8,
                start_ticks: "x".to_string(),
                confirmed: true,
            },
            CloseLockProcessRequest {
                pid: 8,
                start_ticks: "1".to_string(),
                confirmed: false,
            },
        ] {
            assert!(close(&request, &token).is_err());
        }
    }

    #[test]
    fn helper_replies_round_trip_the_contract() {
        let request = LockHelperRequest::Close {
            owner_pid: 10,
            pid: 10,
            start_ticks: "133000000000000000".to_string(),
            confirmed: true,
        };
        let text = serde_json::to_string(&request).unwrap();
        assert!(text.contains("\"action\":\"close\""));
        let reply = LockHelperReply::Error {
            code: "locks.denied".to_string(),
        };
        assert!(serde_json::to_string(&reply)
            .unwrap()
            .contains("\"kind\":\"error\""));
    }
}
