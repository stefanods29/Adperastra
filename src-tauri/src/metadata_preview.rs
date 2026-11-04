//! Background-safe preview detection and pinned source grants.
use crate::{
    files::{is_valid_token, FileGrants, FileTypeInfo},
    metadata_source::PreparedMetadataSource,
};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex},
};
use tauri::{State, WebviewWindow};
#[derive(Default)]
pub struct PreviewGrants(Mutex<HashMap<String, PreparedMetadataSource>>);
#[derive(Serialize)]
pub struct PreviewGrant {
    pub token: String,
    pub info: FileTypeInfo,
}
fn prepare(path: &str) -> Result<PreparedMetadataSource, String> {
    crate::validate_absolute_path(path).map_err(|_| "metadata.bad_request")?;
    let source =
        fs_service::capture_source_stamp(Path::new(path)).map_err(|_| "metadata.failed")?;
    PreparedMetadataSource::open(Path::new(path), &source)
}
fn check_policy(
    background: bool,
    policy: &crate::background::BackgroundPolicy,
) -> Result<(), String> {
    let (idle, ac) = policy.samples();
    if background && !policy.eligible(crate::background::BackgroundTaskKind::Metadata, idle, ac) {
        return Err("background.paused".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn preview_detect(
    window: WebviewWindow,
    path: String,
    background: bool,
    policy: State<'_, Arc<crate::background::BackgroundPolicy>>,
) -> Result<FileTypeInfo, String> {
    crate::ensure_main(window.label())?;
    check_policy(background, &policy)?;
    tauri::async_runtime::spawn_blocking(move || {
        let prepared = prepare(&path)?;
        let info = crate::files::detect(&prepared.source.path)?;
        prepared.verify(&prepared.source.stamp)?;
        Ok(info)
    })
    .await
    .map_err(|_| "metadata.failed".to_string())?
}
#[tauri::command]
pub async fn preview_grant(
    window: WebviewWindow,
    path: String,
    background: bool,
    policy: State<'_, Arc<crate::background::BackgroundPolicy>>,
    grants: State<'_, Arc<FileGrants>>,
    previews: State<'_, Arc<PreviewGrants>>,
) -> Result<PreviewGrant, String> {
    crate::ensure_main(window.label())?;
    check_policy(background, &policy)?;
    let grants = Arc::clone(grants.inner());
    let previews = Arc::clone(previews.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let prepared = prepare(&path)?;
        let info = crate::files::detect(&prepared.source.path)?;
        prepared.verify(&prepared.source.stamp)?;
        let mut entries = previews.0.lock().map_err(|_| "metadata.failed")?;
        if entries.len() >= 128 {
            return Err("files.too_many_open".into());
        }
        let token = grants.grant(prepared.source.path.clone())?;
        entries.insert(token.clone(), prepared);
        Ok(PreviewGrant { token, info })
    })
    .await
    .map_err(|_| "metadata.failed".to_string())?
}
#[tauri::command]
pub async fn preview_revoke(
    window: WebviewWindow,
    token: String,
    grants: State<'_, Arc<FileGrants>>,
    previews: State<'_, Arc<PreviewGrants>>,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    if !is_valid_token(&token) {
        return Err("metadata.bad_request".into());
    }
    let grants = Arc::clone(grants.inner());
    let previews = Arc::clone(previews.inner());
    tauri::async_runtime::spawn_blocking(move || {
        grants.revoke(&token);
        if let Ok(mut entries) = previews.0.lock() {
            entries.remove(&token);
        }
    })
    .await
    .map_err(|_| "metadata.failed".to_string())?;
    Ok(())
}
