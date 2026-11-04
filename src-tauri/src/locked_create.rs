//! Locked-folder create and unlock commands (Step 09k E1). Creation runs a
//! background job and reports success only after the independent candidate
//! verifier has opened both key slots and every chunk.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use fs_service::OpProgress;
use locked_store::secrecy::ExposeSecret;
use tauri::{AppHandle, State, WebviewWindow};

use locked_store::create::{create_locked_copy, CreateDeps};
use locked_store::format::ContainerFile;
use locked_store::recovery_key::{parse_recovery_bytes, public_recipient};
use locked_store::types::{
    LockedCreateRequest, LockedCredential, LockedRecoveryFile, LockedUnlockRequest,
};
use locked_store::{LockedError, LockedResult, Limits};

use crate::locked_sessions::LockedSessions;

#[tauri::command]
pub async fn locked_create_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, crate::jobs::Jobs>,
    request_id: String,
    request: LockedCreateRequest,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    validate_create_request(&request)?;
    let token = jobs.begin(&request_id, 0)?;
    crate::jobs::spawn_job(app, request_id, token, move |context| {
        let zone = |path: &Path| crate::zone::is_from_internet(path);
        let mut progress = |done: u64, total: u64, current: &str| {
            context.set_progress(&OpProgress {
                items_done: done as usize,
                items_total: total as usize,
                bytes_done: 0,
                bytes_total: 0,
                current: current.to_string(),
            });
        };
        let mut deps = CreateDeps {
            is_from_internet: &zone,
            token: context.token(),
            progress: Some(&mut progress),
        };
        let result = create_locked_copy(&request, &mut deps)
            .map_err(|error| error.code().to_string())?;
        serde_json::to_value(result).map_err(|_| LockedError::Io.code().to_string())
    });
    Ok(())
}

#[tauri::command]
pub async fn locked_unlock_start(
    window: WebviewWindow,
    app: AppHandle,
    sessions: State<'_, Arc<LockedSessions>>,
    jobs: State<'_, crate::jobs::Jobs>,
    request_id: String,
    request: LockedUnlockRequest,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    crate::validate_absolute_path(&request.path)
        .map_err(|_| LockedError::Invalid.code().to_string())?;
    match &request.credential {
        LockedCredential::Password { value } => {
            if value.expose_secret().len() > locked_store::limits::MAX_PASSWORD_BYTES {
                return Err(LockedError::Invalid.code().to_string());
            }
        }
        LockedCredential::Recovery { recovery_path } => {
            crate::validate_absolute_path(recovery_path)
                .map_err(|_| LockedError::Invalid.code().to_string())?;
        }
    }
    let token = jobs.begin(&request_id, 1)?;
    let sessions = sessions.inner().clone();
    crate::jobs::spawn_job(app, request_id, token, move |_context| {
        let path = PathBuf::from(&request.path);
        let session = match request.credential {
            LockedCredential::Password { value } => sessions
                .unlock(&path, Some(&value), None)
                .map_err(|error| error.code().to_string())?,
            LockedCredential::Recovery { recovery_path } => {
                let file = read_recovery_file(Path::new(&recovery_path))
                    .map_err(|error| error.code().to_string())?;
                // Compare the public container identity before any
                // decryption. A recovery file for another container is a
                // wrong credential, never a reason to try its secret.
                let header = ContainerFile::read_header_only(&path, Limits::default())
                    .map_err(|error| error.code().to_string())?;
                if file.container_id != header.container_id {
                    return Err(LockedError::BadPasswordOrCorrupt.code().to_string());
                }
                // Recompute the public recipient from the secret so a
                // mismatched recovery record is refused here, before KDF.
                public_recipient(&file).map_err(|error| error.code().to_string())?;
                sessions
                    .unlock(&path, None, Some(file.recovery_secret.expose_secret()))
                    .map_err(|error| error.code().to_string())?
            }
        };
        serde_json::to_value(session).map_err(|_| LockedError::Io.code().to_string())
    });
    Ok(())
}

/// Windows' open dialog for one recovery-key file.
#[tauri::command]
pub async fn locked_pick_recovery_path(
    window: WebviewWindow,
    title: String,
    filter_name: String,
) -> Result<Option<String>, String> {
    crate::ensure_main(window.label())?;
    if title.is_empty() || title.chars().count() > 200 || filter_name.chars().count() > 200 {
        return Err(LockedError::Invalid.code().to_string());
    }
    let owner = crate::window_handle(&window);
    tauri::async_runtime::spawn_blocking(move || {
        crate::file_dialogs::pick_open_path(owner, &title, &filter_name, "*.adprecovery")
            .map_err(|_| LockedError::Io.code().to_string())
    })
    .await
    .map_err(|_| LockedError::Io.code().to_string())?
}

fn read_recovery_file(path: &Path) -> LockedResult<LockedRecoveryFile> {
    let metadata = std::fs::metadata(path).map_err(LockedError::from)?;
    if metadata.len() > locked_store::limits::MAX_RECOVERY_FILE_BYTES {
        return Err(LockedError::TooLarge);
    }
    let bytes = std::fs::read(path).map_err(LockedError::from)?;
    parse_recovery_bytes(&bytes)
}

fn validate_create_request(request: &LockedCreateRequest) -> Result<(), String> {
    crate::validate_absolute_path(&request.source_dir)
        .map_err(|_| LockedError::Invalid.code().to_string())?;
    crate::validate_absolute_path(&request.dest_path)
        .map_err(|_| LockedError::Invalid.code().to_string())?;
    crate::validate_absolute_path(&request.recovery_dest_path)
        .map_err(|_| LockedError::Invalid.code().to_string())?;
    if !request.keep_original || !request.confirm_original_unprotected {
        return Err(LockedError::Invalid.code().to_string());
    }
    Ok(())
}


