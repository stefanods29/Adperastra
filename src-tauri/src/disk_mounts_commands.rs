//! Disk-mount commands (Step 09j T2).
//!
//! Start commands validate every argument before a job exists; the actual
//! attach, volume wait and detach run on the shared job table so Cancel
//! and progress use the same UI as every other long action.

use std::sync::Arc;

use tauri::{AppHandle, State, WebviewWindow};
use uuid::Uuid;

use crate::disk_image_types::{
    EjectResult, MountRequest, MountResult, MountedImage, VOLUME_WAIT_SECONDS,
};
use crate::disk_mounts::DiskMounts;
use crate::jobs::{spawn_job, Jobs};

#[tauri::command]
pub fn disk_mount_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    mounts: State<'_, Arc<DiskMounts>>,
    request_id: String,
    request: MountRequest,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    request.validate()?;
    let token = jobs.begin(&request_id, VOLUME_WAIT_SECONDS as usize)?;
    let mounts = Arc::clone(&*mounts);
    spawn_job(app, request_id, token, move |ctx| {
        let result: MountResult = mounts.mount(&request, ctx.token(), &mut |progress| {
            ctx.set_progress(&progress);
        })?;
        serde_json::to_value(result).map_err(|_| "disk.unavailable".to_string())
    });
    Ok(())
}

#[tauri::command]
pub fn disk_eject_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    mounts: State<'_, Arc<DiskMounts>>,
    request_id: String,
    mount_id: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    Uuid::parse_str(&mount_id).map_err(|_| "disk.denied".to_string())?;
    let token = jobs.begin(&request_id, 1)?;
    let mounts = Arc::clone(&*mounts);
    spawn_job(app, request_id, token, move |_ctx| {
        let result: EjectResult = mounts.eject(&mount_id)?;
        serde_json::to_value(result).map_err(|_| "disk.unavailable".to_string())
    });
    Ok(())
}

#[tauri::command]
pub fn disk_mounts(
    window: WebviewWindow,
    mounts: State<'_, Arc<DiskMounts>>,
) -> Result<Vec<MountedImage>, String> {
    crate::ensure_main(window.label())?;
    mounts.list()
}
