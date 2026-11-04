//! Native locked provider (Step 09k T5): entry pages, bounded memory range
//! grants and the explicit unencrypted-copy route. No virtual entry ever
//! receives a filesystem path or a `FileTypeInfo`; grants go through the
//! existing 07d `GrantedBacking` and 32-hex token rules.
#![allow(dead_code)]


use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State, WebviewWindow};
use uuid::Uuid;
use zeroize::Zeroizing;

use locked_store::chunks::protocol_ranges;
use locked_store::types::{LockedEntry, LockedEntryPage, LockedGrantReply};
use locked_store::{LockedError, LockedResult};

use crate::files::FileGrants;
use crate::file_grant_backing::GrantedBacking;
use crate::locked_sessions::{GrantLease, LockedSessions, MAX_GRANT_LEASES_PER_SESSION};

#[tauri::command]
pub fn locked_list(
    window: WebviewWindow,
    sessions: State<'_, Arc<LockedSessions>>,
    session_id: String,
    parent_id: Option<String>,
    cursor: Option<String>,
) -> Result<LockedEntryPage, String> {
    crate::ensure_main(window.label())?;
    let session = parse_uuid(&session_id)?;
    let parent = parent_id.map(|value| parse_uuid(&value)).transpose()?;
    let cursor = cursor.map(|value| parse_uuid(&value)).transpose()?;
    sessions
        .list(session, parent, cursor)
        .map_err(String::from)
}

#[tauri::command]
pub fn locked_entry_info(
    window: WebviewWindow,
    sessions: State<'_, Arc<LockedSessions>>,
    snapshots: State<'_, Arc<crate::export_snapshots::ExportSnapshots>>,
    session_id: String,
    entry_id: String,
) -> Result<LockedEntry, String> {
    crate::ensure_main(window.label())?;
    let session = parse_uuid(&session_id)?;
    let entry = parse_uuid(&entry_id)?;
    sessions
        .ensure_source_unchanged(session)
        .map_err(String::from)?;
    let runtime = sessions.get(session).map_err(String::from)?;
    let runtime = runtime.lock().map_err(|_| LockedError::Locked.code().to_string())?;
    if runtime.session.state != locked_store::types::LockedSessionState::Unlocked {
        return Err(LockedError::Locked.code().to_string());
    }
    let mut entry = runtime.entry(entry).map_err(String::from)?;
    drop(runtime);
    entry.chunks.clear();
    if entry.is_file() && !entry.mime.is_empty() {
        snapshots
            .authorities()
            .register_native(entry.id, &entry.name, &entry.mime, None, true)
            .map_err(|_| LockedError::Invalid.code().to_string())?;
    }
    Ok(entry)
}

/// Grant a bounded memory range. `offset`/`length` are optional for small
/// entries (one whole entry up to 256 MiB); larger entries and every
/// `readLockedEntry` slice pass an explicit range no larger than 8 MiB.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn locked_entry_grant(
    window: WebviewWindow,
    sessions: State<'_, Arc<LockedSessions>>,
    grants: State<'_, Arc<FileGrants>>,
    snapshots: State<'_, Arc<crate::export_snapshots::ExportSnapshots>>,
    session_id: String,
    entry_id: String,
    offset: Option<u64>,
    length: Option<u64>,
) -> Result<LockedGrantReply, String> {
    crate::ensure_main(window.label())?;
    let session = parse_uuid(&session_id)?;
    let entry = parse_uuid(&entry_id)?;
    let sessions = sessions.inner().clone();
    let grants = grants.inner().clone();
    let snapshots = snapshots.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        grant_entry(&sessions, &grants, &snapshots, session, entry, offset, length)
            .map_err(String::from)
    })
    .await
    .map_err(|error| error.to_string())?
}

pub fn grant_entry(
    sessions: &LockedSessions,
    grants: &FileGrants,
    snapshots: &crate::export_snapshots::ExportSnapshots,
    session_id: Uuid,
    entry_id: Uuid,
    offset: Option<u64>,
    length: Option<u64>,
) -> LockedResult<LockedGrantReply> {
    let runtime_handle = sessions.get(session_id)?;
    let runtime = runtime_handle
        .lock()
        .map_err(|_| LockedError::Locked)?;
    if runtime.session.state != locked_store::types::LockedSessionState::Unlocked {
        return Err(LockedError::Locked);
    }
    drop(runtime);
    sessions.ensure_source_unchanged(session_id)?;
    let runtime_handle = sessions.get(session_id)?;
    let runtime = runtime_handle
        .lock()
        .map_err(|_| LockedError::Locked)?;
    let mut entry = runtime.entry(entry_id)?;
    if !entry.is_file() {
        return Err(LockedError::Invalid);
    }
    // A fixed number of live grants per session, each bounded by the
    // protocol range; together with the shared byte budget this bounds
    // decrypted memory a window can pin.
    if runtime.grants.len() >= MAX_GRANT_LEASES_PER_SESSION {
        return Err(LockedError::TooLarge);
    }
    entry.chunks.clear();
    let offset = offset.unwrap_or(0);
    let requested = length.unwrap_or(entry.size);
    if requested > locked_store::limits::MAX_READ_RANGE
        || offset.checked_add(requested).is_none()
        || offset.saturating_add(requested) > entry.size
    {
        return Err(LockedError::TooLarge);
    }
    if length.is_none() && entry.size > locked_store::limits::MAX_OPEN_ENTRY_MEMORY {
        return Err(LockedError::TooLarge);
    }
    drop(runtime);
    sessions.reserve_open_memory(requested)?;
    let bytes = match sessions.read_entry_range(session_id, entry_id, offset, requested) {
        Ok(bytes) => bytes,
        Err(error) => {
            sessions.release_open_memory(requested);
            return Err(error);
        }
    };
    let backing = GrantedBacking::Memory {
        bytes: Arc::new(bytes),
        length: requested,
        sensitive: true,
    };
    let token = match crate::document_grants::grant_backing(grants, Arc::new(backing)) {
        Ok(token) => token,
        Err(_) => {
            sessions.release_open_memory(requested);
            return Err(LockedError::TooLarge);
        }
    };
    let runtime_handle = sessions.get(session_id)?;
    let mut runtime = runtime_handle
        .lock()
        .map_err(|_| LockedError::Locked)?;
    if runtime.session.state != locked_store::types::LockedSessionState::Unlocked {
        drop(runtime);
        crate::document_grants::revoke(grants, &token);
        sessions.release_open_memory(requested);
        return Err(LockedError::Locked);
    }
    if runtime.grants.len() >= MAX_GRANT_LEASES_PER_SESSION {
        drop(runtime);
        crate::document_grants::revoke(grants, &token);
        sessions.release_open_memory(requested);
        return Err(LockedError::TooLarge);
    }
    runtime.grants.insert(
        token.clone(),
        GrantLease {
            bytes: requested,
        },
    );
    drop(runtime);

    if !entry.mime.is_empty() {
        let authority = snapshots.authorities().register_native(
            entry.id,
            &entry.name,
            &entry.mime,
            None,
            true,
        );
        if authority.is_err() {
            crate::document_grants::revoke(grants, &token);
            let runtime_handle = sessions.get(session_id)?;
            if let Ok(mut runtime) = runtime_handle.lock() {
                let _ = runtime.grants.remove(&token);
            }
            sessions.release_open_memory(requested);
            return Err(LockedError::Invalid);
        }
    }

    Ok(LockedGrantReply {
        token,
        length: requested,
        mime: entry.mime.clone(),
        name: entry.name.clone(),
        size: entry.size,
        modified_unix: entry.modified_unix,
        from_internet: entry.from_internet,
        read_only: true,
    })
}

#[tauri::command]
pub fn locked_entry_release(
    window: WebviewWindow,
    sessions: State<'_, Arc<LockedSessions>>,
    grants: State<'_, Arc<FileGrants>>,
    session_id: String,
    token: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    let session = parse_uuid(&session_id)?;
    if token.len() != 32 || !token.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()) {
        return Err(LockedError::Invalid.code().to_string());
    }
    // A token is released only through the session that owns it. A token
    // from another session (or one already revoked by a lock) is not a
    // reason to revoke someone else's grant.
    let runtime = sessions.get(session).map_err(String::from)?;
    let lease = {
        let mut runtime = runtime
            .lock()
            .map_err(|_| LockedError::Locked.code().to_string())?;
        runtime.grants.remove(&token)
    };
    let Some(lease) = lease else {
        return Ok(());
    };
    crate::document_grants::revoke(&grants, &token);
    sessions.release_open_memory(lease.bytes);
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LockedExportRequest {
    pub session_id: String,
    pub entry_ids: Vec<String>,
    pub dest_dir: String,
    pub confirmed_unencrypted: bool,
}

#[tauri::command]
pub async fn locked_export_start(
    window: WebviewWindow,
    app: AppHandle,
    sessions: State<'_, Arc<LockedSessions>>,
    jobs: State<'_, crate::jobs::Jobs>,
    request_id: String,
    request: LockedExportRequest,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    if !request.confirmed_unencrypted {
        return Err(LockedError::UnencryptedCopyRequired.code().to_string());
    }
    if request.entry_ids.is_empty() || request.entry_ids.len() > 256 {
        return Err(LockedError::Invalid.code().to_string());
    }
    crate::validate_absolute_path(&request.dest_dir)
        .map_err(|_| LockedError::Invalid.code().to_string())?;
    let session = parse_uuid(&request.session_id)?;
    let ids = request
        .entry_ids
        .iter()
        .map(|value| parse_uuid(value))
        .collect::<Result<Vec<Uuid>, String>>()?;
    let token = jobs.begin(&request_id, ids.len())?;
    let sessions = sessions.inner().clone();
    let dest = std::path::PathBuf::from(request.dest_dir);
    crate::jobs::spawn_job(app, request_id, token, move |context| {
        let report = export_entries(
            &sessions,
            session,
            &ids,
            &dest,
            context,
        )
        .map_err(String::from)?;
        serde_json::to_value(report).map_err(|_| LockedError::Io.code().to_string())
    });
    Ok(())
}

fn export_entries(
    sessions: &LockedSessions,
    session: Uuid,
    ids: &[Uuid],
    dest: &std::path::Path,
    context: &crate::jobs::JobContext,
) -> LockedResult<convert::ConversionReport> {
    sessions.ensure_source_unchanged(session)?;
    std::fs::create_dir_all(dest).map_err(LockedError::from)?;
    let mut outputs: Vec<convert::ConversionOutput> = Vec::new();
    let mut items: Vec<convert::WorkItemResult> = Vec::new();
    let mut created_paths = Vec::new();
    let mut cancelled = false;
    for (index, id) in ids.iter().enumerate() {
        if context
            .token()
            .load(std::sync::atomic::Ordering::Relaxed)
        {
            cancelled = true;
            break;
        }
        let runtime_handle = sessions.get(session)?;
        let runtime = runtime_handle.lock().map_err(|_| LockedError::Locked)?;
        let entry = runtime.entry(*id)?;
        drop(runtime);
        let outputs_before = outputs.len();
        let outcome = if entry.is_folder() {
            export_folder(sessions, session, &entry, dest, context, index as u32, &mut outputs, &mut created_paths)
        } else {
            export_file(sessions, session, &entry, dest, context, index as u32, &mut outputs, &mut created_paths)
        };
        let (output_count, status, reason) = match outcome {
            Ok(count) => (count, convert::WorkItemStatus::Done, None),
            Err(LockedError::Cancelled) => {
                cancelled = true;
                (0, convert::WorkItemStatus::Cancelled, Some(LockedError::Cancelled.code().to_string()))
            }
            Err(error) => (0, convert::WorkItemStatus::Failed, Some(error.code().to_string())),
        };
        let bytes_written = outputs[outputs_before..]
            .iter()
            .map(|output| output.byte_len)
            .sum();
        items.push(convert::WorkItemResult {
            input_index: index as u32,
            source_path: None,
            output_count,
            status,
            reason,
            metadata_lost: Vec::new(),
            bytes_written,
        });
    }
    let done = outputs.len() as u32;
    let failed = items
        .iter()
        .filter(|item| item.status == convert::WorkItemStatus::Failed)
        .count() as u32;
    Ok(convert::ConversionReport {
        report_id: Uuid::new_v4().to_string(),
        items,
        outputs,
        next_cursor: None,
        created_paths,
        history_id: None,
        input_total: ids.len() as u32,
        done_count: done,
        failed_count: failed,
        skipped_count: 0,
        cancelled_count: if cancelled { 1 } else { 0 },
        outputs_created: done,
        cancelled,
        job_finished: true,
        complete: true,
    })
}

#[allow(clippy::too_many_arguments)]
fn export_folder(
    sessions: &LockedSessions,
    session: Uuid,
    folder: &LockedEntry,
    dest: &std::path::Path,
    context: &crate::jobs::JobContext,
    input_index: u32,
    outputs: &mut Vec<convert::ConversionOutput>,
    created_paths: &mut Vec<String>,
) -> LockedResult<u32> {
    let target = unique_directory(dest, &folder.name);
    std::fs::create_dir(&target).map_err(LockedError::from)?;
    created_paths.push(target.to_string_lossy().into_owned());
    let mut count: u32 = 1;
    let mut cursor: Option<Uuid> = None;
    loop {
        let page = sessions.list(session, Some(folder.id), cursor)?;
        let complete = page.complete;
        let next_cursor = page.next_cursor;
        for child in page.entries {
            count += if child.is_folder() {
                export_folder(sessions, session, &child, &target, context, input_index, outputs, created_paths)?
            } else {
                export_file(sessions, session, &child, &target, context, input_index, outputs, created_paths)?
            };
        }
        if complete {
            break;
        }
        cursor = next_cursor;
        if cursor.is_none() {
            return Err(LockedError::Changed);
        }
    }
    Ok(count)
}

#[allow(clippy::too_many_arguments)]
fn export_file(
    sessions: &LockedSessions,
    session: Uuid,
    entry: &LockedEntry,
    dest: &std::path::Path,
    context: &crate::jobs::JobContext,
    input_index: u32,
    outputs: &mut Vec<convert::ConversionOutput>,
    created_paths: &mut Vec<String>,
) -> LockedResult<u32> {
    use std::io::Write;
    if outputs.len() >= 256 {
        return Err(LockedError::TooLarge);
    }
    let parent = dest;
    std::fs::create_dir_all(parent).map_err(LockedError::from)?;
    let pin = fs_service::owned_io::PinnedDirectory::open(parent).map_err(LockedError::from)?;
    let mut output = fs_service::owned_io::OwnedOutput::create(&pin, &entry.name)
        .map_err(LockedError::from)?;
    let mut offset = 0u64;
    while offset < entry.size {
        if context
            .token()
            .load(std::sync::atomic::Ordering::Relaxed)
        {
            return Err(LockedError::Cancelled);
        }
        let length = (entry.size - offset).min(4 * 1024 * 1024);
        let bytes = sessions.read_entry_range(session, entry.id, offset, length)?;
        if bytes.len() as u64 != length {
            return Err(LockedError::Changed);
        }
        output
            .file_mut()
            .write_all(&bytes)
            .map_err(LockedError::from)?;
        offset += length;
    }
    output.flush_sync().map_err(LockedError::from)?;
    let published = output
        .publish_name(&unique_name(parent, &entry.name))
        .map_err(LockedError::from)?;
    created_paths.push(published.to_string_lossy().into_owned());
    outputs.push(convert::ConversionOutput {
        output_id: Uuid::new_v4().to_string(),
        input_indices: vec![input_index],
        output_index: outputs.len() as u32,
        path: published.to_string_lossy().into_owned(),
        byte_len: offset,
    });
    Ok(1)
}

fn unique_directory(parent: &std::path::Path, name: &str) -> std::path::PathBuf {
    let mut candidate = parent.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let stem = name;
    for index in 1..=10_000 {
        candidate = parent.join(format!("{stem} ({index})"));
        if !candidate.exists() {
            return candidate;
        }
    }
    parent.join(format!("{stem} (10000)"))
}

fn unique_name(parent: &std::path::Path, name: &str) -> String {
    if !parent.join(name).exists() {
        return name.to_string();
    }
    let (stem, extension) = name
        .rsplit_once('.')
        .map(|(stem, extension)| (stem, format!(".{extension}")))
        .unwrap_or((name, String::new()));
    for index in 1..=10_000 {
        let candidate = format!("{stem} ({index}){extension}");
        if !parent.join(&candidate).exists() {
            return candidate;
        }
    }
    format!("{stem} (10000){extension}")
}

fn parse_uuid(value: &str) -> Result<Uuid, String> {
    Uuid::try_parse(value).map_err(|_| LockedError::Invalid.code().to_string())
}

pub fn protocol_range_count(length: u64) -> LockedResult<usize> {
    Ok(protocol_ranges(0, length)?.len())
}

/// A zeroizing helper for the provider tests and the lock path.
pub fn sensitive_bytes(bytes: Vec<u8>) -> Zeroizing<Vec<u8>> {
    Zeroizing::new(bytes)
}
