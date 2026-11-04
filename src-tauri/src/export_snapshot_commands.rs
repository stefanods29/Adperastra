// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Authorize a capture of an already granted file. The source stamp comes
/// from the guarded path, never from the UI.
#[tauri::command]
pub async fn export_snapshot_authorize_file(
    window: WebviewWindow,
    grants: State<'_, Arc<crate::files::FileGrants>>,
    snapshots: State<'_, Arc<ExportSnapshots>>,
    token: String,
) -> Result<crate::export_snapshot_types::SnapshotAuthority, String> {
    crate::ensure_main(window.label())?;
    if !crate::files::is_valid_token(&token) {
        return Err("snapshot.bad_request".to_string());
    }
    let path = grants
        .path_for(&token)
        .ok_or_else(|| "snapshot.bad_request".to_string())?;
    let checked = path.clone();
    let (name, mime, stamp) = tauri::async_runtime::spawn_blocking(move || {
        let stamp = fs_service::capture_source_stamp(&checked)
            .map_err(|_| "snapshot.bad_request".to_string())?;
        let name = display_name(&checked);
        let extension = crate::files::extension_of(&name);
        let mime = crate::files::mime_from_ext(&extension)
            .split(';')
            .next()
            .unwrap_or("application/octet-stream")
            .to_string();
        Ok::<_, String>((name, mime, stamp))
    })
    .await
    .map_err(|error| error.to_string())??;
    let authority = snapshots.authorities().register_native(
        Uuid::new_v4(),
        &name,
        &mime,
        Some(stamp),
        false,
    )?;
    // Only static, proven text/image encoders extend capture MIME authority.
    if mime.starts_with("image/") {
        snapshots.authorities().permit_capture_mime(authority.document_id, "image/png")?;
    } else if mime.starts_with("text/") || matches!(mime.as_str(), "application/json" | "application/xml") {
        snapshots.authorities().permit_capture_mime(authority.document_id, "text/plain")?;
    }
    Ok(authority)
}

/// Authorize a brand-new, unsaved document. It has no source and is always
/// ordinary; a sensitive provider uses `register_native` directly.
#[tauri::command]
pub fn export_snapshot_authorize_new(
    window: WebviewWindow,
    snapshots: State<'_, Arc<ExportSnapshots>>,
    name: String,
    mime: String,
) -> Result<crate::export_snapshot_types::SnapshotAuthority, String> {
    crate::ensure_main(window.label())?;
    snapshots
        .authorities()
        .register_native(Uuid::new_v4(), &name, &mime, None, false)
}

#[tauri::command]
pub async fn export_snapshot_begin(
    window: WebviewWindow,
    snapshots: State<'_, Arc<ExportSnapshots>>,
    metadata: SnapshotBeginRequest,
) -> Result<SnapshotBeginReply, String> {
    crate::ensure_main(window.label())?;
    let snapshots = snapshots.inner().clone();
    tauri::async_runtime::spawn_blocking(move || snapshots.begin(metadata))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn export_snapshot_finish(
    window: WebviewWindow,
    snapshots: State<'_, Arc<ExportSnapshots>>,
    snapshot_id: String,
) -> Result<ExportSnapshot, String> {
    crate::ensure_main(window.label())?;
    let snapshots = snapshots.inner().clone();
    tauri::async_runtime::spawn_blocking(move || snapshots.finish(&snapshot_id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn export_snapshot_release(
    window: WebviewWindow,
    snapshots: State<'_, Arc<ExportSnapshots>>,
    snapshot_id: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    let snapshots = snapshots.inner().clone();
    tauri::async_runtime::spawn_blocking(move || snapshots.release(&snapshot_id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn export_snapshot_abort(
    window: WebviewWindow,
    snapshots: State<'_, Arc<ExportSnapshots>>,
    snapshot_id: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    let snapshots = snapshots.inner().clone();
    tauri::async_runtime::spawn_blocking(move || snapshots.abort_upload(&snapshot_id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn export_snapshot_authority_release(
    window: WebviewWindow,
    snapshots: State<'_, Arc<ExportSnapshots>>,
    document_id: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    snapshots.release_snapshot_authority(&document_id)
}

#[cfg(test)]
#[path = "export_snapshot_step08a_tests.rs"]
mod step08a_tests;
