//! Editable image-project jobs (Step 18b T5/T6, `image-project-1`).
//!
//! The guarded `.adimage` reader is bounded and never extracts to disk, so
//! opening one only validates it with the pure `image_edit::project` codec and
//! returns descriptors (no tile or extension bytes cross IPC). The native
//! capture encoder and PSD import have no project-owned source/writer API
//! yet; their commands refuse with a stable `image_project.*` code instead of
//! fabricating a snapshot, a plan or a partial import.
//!
//! The payload channel is a separate, bounded step: `image_project_payload_start`
//! revalidates the same archive, keeps the decoded tiles, masks, originals and
//! optional metadata/extension bytes in zeroizing memory and returns the
//! validated manifest plus an opaque session handle. `image_project_payload_page`
//! serves at most one 1 MiB raw page and `image_project_payload_release` drops
//! the session. A sensitive 08a snapshot stays memory-only: the lease is held
//! for the session lifetime, no byte touches a path or a cache file, and the
//! snapshot descriptor returned to the UI omits its source stamp.

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use convert::ConversionInput;
use image_edit::project::{
    decode_project, inspect_project, ImageProjectInfo, ImageProjectManifest, ProjectExtension,
    ProjectMetadataEntry, ProjectPayloads, ProjectTileKind, MAX_ARCHIVE_BYTES, MAX_EXTENSION_BYTES,
    MAX_PROJECT_PAYLOAD_BYTES,
};
use serde::Serialize;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::export_snapshot_types::ExportSnapshot;
use crate::export_snapshots::{ExportSnapshots, SnapshotLease};
use crate::jobs::{self, Jobs};

/// Mirrors `PROJECT_MIME` in `src/image-edit/projectTypes.ts`.
const PROJECT_MIME: &str = "application/vnd.adperastra.image-project+zip";
/// One bounded read chunk for a file or an 08a snapshot backing.
const READ_CHUNK: usize = 1024 * 1024;
/// Largest raw page the payload channel returns in one IPC reply.
const MAX_PAYLOAD_PAGE_BYTES: u64 = 1024 * 1024;
/// At most this many opened payload sessions may be live at once.
const MAX_PAYLOAD_SESSIONS: usize = 4;
/// Aggregate decoded bytes across all live payload sessions.
const MAX_PAYLOAD_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;
/// A session nobody reads or releases is dropped after this long.
const PAYLOAD_SESSION_IDLE: Duration = Duration::from_secs(300);

/// The additive native open result: `ImageProjectInfo` at the top level plus
/// descriptors only. Payload bytes stay behind the guarded reader.
#[derive(Debug, Serialize)]
struct ImageProjectOpenResult {
    #[serde(flatten)]
    info: ImageProjectInfo,
    extensions: Vec<ProjectExtension>,
    metadata_entries: Vec<ProjectMetadataEntry>,
}

fn bad<T>() -> Result<T, String> {
    Err("image_project.bad_request".to_string())
}

fn corrupt<T>() -> Result<T, String> {
    Err("image_project.corrupt".to_string())
}

fn too_large<T>() -> Result<T, String> {
    Err("image_project.too_large".to_string())
}

fn changed<T>() -> Result<T, String> {
    Err("image_project.changed".to_string())
}

fn failed<T>() -> Result<T, String> {
    Err("image_project.failed".to_string())
}

fn snapshot_error(error: String) -> String {
    match error.as_str() {
        "snapshot.changed" => "image_project.changed".to_string(),
        "snapshot.too_large" => "image_project.too_large".to_string(),
        "snapshot.bad_request" => "image_project.bad_request".to_string(),
        _ => "image_project.failed".to_string(),
    }
}

/// Reads one project file through the same pinned identity rules as the
/// conversion sources: absolute path, no `..`, the expected stamp when the
/// caller supplied one, and a final identity check after the last byte.
fn read_file_archive(
    path: &str,
    expected: Option<&fs_service::SourceStamp>,
    cancel: &fs_service::CancellationToken,
) -> Result<Zeroizing<Vec<u8>>, String> {
    crate::validate_absolute_path(path).map_err(|_| "image_project.bad_request".to_string())?;
    let path = Path::new(path);
    let stamp = fs_service::capture_source_stamp(path).map_err(|_| "image_project.changed".to_string())?;
    if expected.is_some_and(|expected| expected != &stamp) {
        return changed();
    }
    if stamp.size_bytes == 0 {
        return corrupt();
    }
    if stamp.size_bytes > MAX_ARCHIVE_BYTES {
        return too_large();
    }
    let identity = fs_service::owned_io::SourceIdentity::capture(path)
        .map_err(|_| "image_project.changed".to_string())?;
    let mut source = fs_service::owned_io::PinnedSource::open(path, &identity)
        .map_err(|_| "image_project.changed".to_string())?;
    let mut bytes = Zeroizing::new(Vec::with_capacity(stamp.size_bytes as usize));
    let mut buffer = Zeroizing::new(vec![0u8; READ_CHUNK]);
    while (bytes.len() as u64) < stamp.size_bytes {
        if cancel.load(Ordering::Relaxed) {
            return failed();
        }
        let take = ((stamp.size_bytes - bytes.len() as u64) as usize).min(READ_CHUNK);
        source
            .file_mut()
            .read_exact(&mut buffer.as_mut_slice()[..take])
            .map_err(|_| "image_project.changed".to_string())?;
        bytes.extend_from_slice(buffer.as_slice());
    }
    source
        .verify_after_read()
        .map_err(|_| "image_project.changed".to_string())?;
    Ok(bytes)
}

/// Reads a finalized 08a snapshot only when it is a project archive. The
/// snapshot identity and length are checked before any byte is copied; the
/// returned lease keeps the backing alive for as long as the caller needs it.
fn read_snapshot_archive(
    app: &AppHandle,
    snapshot_id: &str,
    document_id: &str,
    revision: u64,
    cancel: &fs_service::CancellationToken,
) -> Result<(Zeroizing<Vec<u8>>, SnapshotLease), String> {
    let snapshots = app.state::<Arc<ExportSnapshots>>();
    let lease = snapshots
        .resolve(snapshot_id, document_id, revision)
        .map_err(snapshot_error)?;
    if lease.snapshot.mime != PROJECT_MIME {
        return bad();
    }
    let length = lease.backing.length();
    if length != lease.snapshot.byte_len {
        return changed();
    }
    if length == 0 {
        return corrupt();
    }
    if length > MAX_ARCHIVE_BYTES {
        return too_large();
    }
    let mut bytes = Zeroizing::new(Vec::with_capacity(length as usize));
    let mut offset = 0u64;
    while offset < length {
        if cancel.load(Ordering::Relaxed) {
            return failed();
        }
        let take = (length - offset).min(READ_CHUNK as u64) as usize;
        let chunk = Zeroizing::new(
            lease
                .backing
                .read_range(offset, take)
                .map_err(|_| "image_project.changed".to_string())?,
        );
        if chunk.len() != take {
            return changed();
        }
        bytes.extend_from_slice(chunk.as_slice());
        offset += take as u64;
    }
    Ok((bytes, lease))
}

/// One validated archive source. A snapshot keeps its 08a lease so the
/// descriptor the payload channel returns stays a real, resolvable capture.
type ProjectInputSource = (Zeroizing<Vec<u8>>, Option<Arc<SnapshotLease>>);

fn read_project_input(
    app: &AppHandle,
    input: &ConversionInput,
    cancel: &fs_service::CancellationToken,
) -> Result<ProjectInputSource, String> {
    match input {
        ConversionInput::File { path, expected } => {
            Ok((read_file_archive(path, expected.as_ref(), cancel)?, None))
        }
        ConversionInput::Snapshot {
            snapshot_id,
            document_id,
            revision,
        } => {
            let (bytes, lease) =
                read_snapshot_archive(app, snapshot_id, document_id, *revision, cancel)?;
            Ok((bytes, Some(Arc::new(lease))))
        }
    }
}

/// A stable payload identity. `name` is a tile UUID, a metadata category or
/// an extension name; it is never a filesystem path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum ProjectPayloadKind {
    Rgba,
    Alpha,
    Metadata,
    Extension,
}

/// One bounded payload descriptor, in channel order.
#[derive(Debug, Clone, Serialize)]
struct ProjectPayloadEntry {
    kind: ProjectPayloadKind,
    name: String,
    byte_len: u64,
}

/// What `image_project_payload_start` returns: the validated manifest, the
/// channel layout and an opaque session handle. Bytes are served page by page.
#[derive(Debug, Serialize)]
struct ImageProjectPayloadStartResult {
    #[serde(flatten)]
    info: ImageProjectInfo,
    manifest: ImageProjectManifest,
    entries: Vec<ProjectPayloadEntry>,
    handle: String,
    total_bytes: u64,
    page_bytes: u32,
    /// The 08a capture of the input document, with its source stamp removed.
    #[serde(skip_serializing_if = "Option::is_none")]
    source_snapshot: Option<ExportSnapshot>,
}

struct PayloadBlob {
    kind: ProjectPayloadKind,
    name: String,
    bytes: Zeroizing<Vec<u8>>,
}

struct PayloadSession {
    blobs: Vec<PayloadBlob>,
    total_bytes: u64,
    expires_at: Instant,
    /// Keeps a sensitive snapshot's backing alive without a disk path.
    #[allow(dead_code)]
    _lease: Option<Arc<SnapshotLease>>,
}

#[derive(Default)]
struct PayloadSessionsInner {
    sessions: HashMap<Uuid, PayloadSession>,
    reserved: u64,
}

/// The bounded, memory-only project payload store (managed state).
#[derive(Default)]
pub struct ProjectPayloadSessions {
    inner: Mutex<PayloadSessionsInner>,
}

impl ProjectPayloadSessions {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, PayloadSessionsInner>, String> {
        self.inner
            .lock()
            .map_err(|_| "image_project.failed".to_string())
    }

    fn remove_expired(inner: &mut PayloadSessionsInner) {
        let now = Instant::now();
        inner.sessions.retain(|_, session| now < session.expires_at);
        inner.reserved = inner
            .sessions
            .values()
            .map(|session| session.total_bytes)
            .sum();
    }

    fn insert(&self, session: PayloadSession) -> Result<Uuid, String> {
        if session.total_bytes == 0 || session.total_bytes > MAX_PROJECT_PAYLOAD_BYTES {
            return too_large();
        }
        let declared = session
            .blobs
            .iter()
            .map(|blob| blob.bytes.len() as u64)
            .sum::<u64>();
        if declared != session.total_bytes {
            return corrupt();
        }
        let mut inner = self.lock()?;
        Self::remove_expired(&mut inner);
        if inner.sessions.len() >= MAX_PAYLOAD_SESSIONS {
            return too_large();
        }
        let next = inner
            .reserved
            .checked_add(session.total_bytes)
            .ok_or_else(|| "image_project.too_large".to_string())?;
        if next > MAX_PAYLOAD_TOTAL_BYTES {
            return too_large();
        }
        let id = Uuid::new_v4();
        inner.sessions.insert(id, session);
        inner.reserved = next;
        Ok(id)
    }

    fn page(&self, handle: &str, offset: u64, max_bytes: u32) -> Result<Vec<u8>, String> {
        let id = Uuid::parse_str(handle).map_err(|_| "image_project.bad_request".to_string())?;
        if max_bytes == 0 {
            return bad();
        }
        if u64::from(max_bytes) > MAX_PAYLOAD_PAGE_BYTES {
            return too_large();
        }
        let mut inner = self.lock()?;
        Self::remove_expired(&mut inner);
        let session = inner
            .sessions
            .get_mut(&id)
            .ok_or_else(|| "image_project.changed".to_string())?;
        if offset >= session.total_bytes {
            return bad();
        }
        let take = usize::try_from((session.total_bytes - offset).min(u64::from(max_bytes)))
            .map_err(|_| "image_project.failed".to_string())?;
        let mut remaining = offset;
        let mut index = 0usize;
        while index < session.blobs.len() {
            let len = session.blobs[index].bytes.len() as u64;
            if remaining < len {
                break;
            }
            remaining -= len;
            index += 1;
        }
        let mut within =
            usize::try_from(remaining).map_err(|_| "image_project.failed".to_string())?;
        let mut page = Vec::with_capacity(take);
        while page.len() < take && index < session.blobs.len() {
            let blob = &session.blobs[index];
            let bytes = blob.bytes.as_slice();
            let available = bytes.len() - within;
            let count = available.min(take - page.len());
            page.extend_from_slice(&bytes[within..within + count]);
            index += 1;
            within = 0;
        }
        if page.len() != take {
            return changed();
        }
        session.expires_at = Instant::now() + PAYLOAD_SESSION_IDLE;
        Ok(page)
    }

    fn release(&self, handle: &str) -> Result<(), String> {
        let id = Uuid::parse_str(handle).map_err(|_| "image_project.bad_request".to_string())?;
        let mut inner = self.lock()?;
        inner.sessions.remove(&id);
        Self::remove_expired(&mut inner);
        Ok(())
    }
}

/// The manifest's source stamp contains a normalized path; the UI only needs
/// the capture identity, so it never crosses the boundary.
fn redacted_snapshot(snapshot: &ExportSnapshot) -> ExportSnapshot {
    let mut copy = snapshot.clone();
    copy.source = None;
    copy
}

/// Rebuilds the channel layout from the validated manifest, never from raw ZIP
/// order. Every tile (including originals), metadata blob and optional
/// extension must be present exactly once.
fn payload_blobs(
    manifest: &ImageProjectManifest,
    payloads: ProjectPayloads,
) -> Result<Vec<PayloadBlob>, String> {
    let tile_count = payloads.tiles.len();
    let metadata_count = payloads.metadata.len();
    let extension_count = payloads.extensions.len();
    if tile_count != manifest.tiles.len()
        || metadata_count != manifest.metadata_entries.len()
        || extension_count != manifest.extensions.len()
    {
        return corrupt();
    }
    let mut tiles: HashMap<Uuid, Zeroizing<Vec<u8>>> = payloads
        .tiles
        .into_iter()
        .map(|(id, bytes)| (id, Zeroizing::new(bytes)))
        .collect();
    let mut metadata: HashMap<String, Zeroizing<Vec<u8>>> = payloads
        .metadata
        .into_iter()
        .map(|(name, bytes)| (name, Zeroizing::new(bytes)))
        .collect();
    let mut extensions: HashMap<String, Zeroizing<Vec<u8>>> = payloads
        .extensions
        .into_iter()
        .map(|(name, bytes)| (name, Zeroizing::new(bytes)))
        .collect();
    let mut blobs = Vec::with_capacity(tile_count + metadata_count + extension_count);
    for tile in &manifest.tiles {
        let bytes = tiles
            .remove(&tile.id)
            .ok_or_else(|| "image_project.corrupt".to_string())?;
        if bytes.len() as u64 != tile.raw_bytes {
            return corrupt();
        }
        let kind = match tile.kind {
            ProjectTileKind::Rgba => ProjectPayloadKind::Rgba,
            ProjectTileKind::Alpha => ProjectPayloadKind::Alpha,
        };
        blobs.push(PayloadBlob {
            kind,
            name: tile.id.to_string(),
            bytes,
        });
    }
    for entry in &manifest.metadata_entries {
        let bytes = metadata
            .remove(&entry.category)
            .ok_or_else(|| "image_project.corrupt".to_string())?;
        if bytes.len() as u64 != entry.byte_len {
            return corrupt();
        }
        blobs.push(PayloadBlob {
            kind: ProjectPayloadKind::Metadata,
            name: entry.category.clone(),
            bytes,
        });
    }
    for extension in &manifest.extensions {
        let bytes = extensions
            .remove(&extension.name)
            .ok_or_else(|| "image_project.corrupt".to_string())?;
        if bytes.len() as u64 > MAX_EXTENSION_BYTES {
            return too_large();
        }
        blobs.push(PayloadBlob {
            kind: ProjectPayloadKind::Extension,
            name: extension.name.clone(),
            bytes,
        });
    }
    if !tiles.is_empty() || !metadata.is_empty() || !extensions.is_empty() {
        return corrupt();
    }
    Ok(blobs)
}

/// E2: validate one project archive in a cancellable shared job. The result
/// is `ImageProjectInfo` plus extension/metadata descriptors; no payload
/// bytes, paths, grants or snapshot ids are returned.
#[tauri::command]
pub async fn image_project_open_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    request_id: String,
    input: serde_json::Value,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    let input: ConversionInput =
        serde_json::from_value(input).map_err(|_| "image_project.bad_request".to_string())?;
    let token = jobs.begin(&request_id, 0)?;
    jobs::spawn_job(app, request_id, token, move |context| {
        let (bytes, _lease) = read_project_input(context.app(), &input, context.token())?;
        if context.token().load(Ordering::Relaxed) {
            return failed();
        }
        let opened = inspect_project(bytes.as_slice()).map_err(|error| error.code().to_string())?;
        let result = ImageProjectOpenResult {
            info: opened.info,
            extensions: opened.manifest.extensions,
            metadata_entries: opened.manifest.metadata_entries,
        };
        serde_json::to_value(result).map_err(|_| "image_project.failed".to_string())
    });
    Ok(())
}

/// E2/E3: validates the same guarded archive again and delivers the canonical
/// manifest plus every decoded payload through the bounded page channel. The
/// job itself returns descriptors and an opaque handle, never a path or a ZIP.
#[tauri::command]
pub async fn image_project_payload_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    request_id: String,
    input: serde_json::Value,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    let input: ConversionInput =
        serde_json::from_value(input).map_err(|_| "image_project.bad_request".to_string())?;
    let token = jobs.begin(&request_id, 0)?;
    jobs::spawn_job(app, request_id, token, move |context| {
        let (archive, lease) = read_project_input(context.app(), &input, context.token())?;
        if context.token().load(Ordering::Relaxed) {
            return failed();
        }
        let opened = decode_project(archive.as_slice()).map_err(|error| error.code().to_string())?;
        drop(archive);
        let manifest = opened.manifest;
        let info = opened.info;
        // Wrap every decoded byte before any early return so a refused open
        // still zeroizes the payloads.
        let blobs = payload_blobs(&manifest, opened.payloads)?;
        if !info.editable {
            return Err(
                if info
                    .unsupported_features
                    .iter()
                    .any(|code| code == "required_extension")
                {
                    "image_project.unknown_required".to_string()
                } else {
                    "image_project.unsupported_schema".to_string()
                },
            );
        }
        if context.token().load(Ordering::Relaxed) {
            return failed();
        }
        let total_bytes = blobs
            .iter()
            .map(|blob| blob.bytes.len() as u64)
            .sum::<u64>();
        if total_bytes == 0 || total_bytes > MAX_PROJECT_PAYLOAD_BYTES {
            return too_large();
        }
        let entries = blobs
            .iter()
            .map(|blob| ProjectPayloadEntry {
                kind: blob.kind,
                name: blob.name.clone(),
                byte_len: blob.bytes.len() as u64,
            })
            .collect();
        let source_snapshot = lease
            .as_ref()
            .map(|lease| redacted_snapshot(&lease.snapshot));
        let sessions = context.app().state::<ProjectPayloadSessions>();
        let handle = sessions.insert(PayloadSession {
            blobs,
            total_bytes,
            expires_at: Instant::now() + PAYLOAD_SESSION_IDLE,
            _lease: lease,
        })?;
        if context.token().load(Ordering::Relaxed) {
            sessions.release(&handle.to_string())?;
            return failed();
        }
        let result = ImageProjectPayloadStartResult {
            info,
            manifest,
            entries,
            handle: handle.to_string(),
            total_bytes,
            page_bytes: MAX_PAYLOAD_PAGE_BYTES as u32,
            source_snapshot,
        };
        serde_json::to_value(result).map_err(|_| "image_project.failed".to_string())
    });
    Ok(())
}

/// One bounded raw payload page. The response is at most 1 MiB; `offset` is
/// the exact byte cursor the previous page ended at. An expired or released
/// handle is `image_project.changed`; geometry outside the session is refused.
#[tauri::command]
pub async fn image_project_payload_page(
    window: WebviewWindow,
    sessions: State<'_, ProjectPayloadSessions>,
    handle: String,
    offset: u64,
    max_bytes: u32,
) -> Result<tauri::ipc::Response, String> {
    crate::ensure_main(window.label())?;
    let bytes = sessions.page(&handle, offset, max_bytes)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Drops one payload session and its zeroizing buffers. Releasing an already
/// released handle is harmless so a cleanup path can always run.
#[tauri::command]
pub fn image_project_payload_release(
    window: WebviewWindow,
    sessions: State<'_, ProjectPayloadSessions>,
    handle: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    sessions.release(&handle)
}

/// E2: native capture gate. `encodeImageProject` already uploads the exact
/// archive through the 08a snapshot protocol; there is no project-owned
/// source/encoder channel and this signature has no snapshot id, so the
/// command refuses instead of returning a snapshot whose bytes were never
/// validated.
#[tauri::command]
pub fn image_project_capture_start(
    window: WebviewWindow,
    request_id: String,
    document_id: String,
    revision: u64,
    content_id: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    Uuid::parse_str(&document_id).map_err(|_| "image_project.bad_request".to_string())?;
    Uuid::parse_str(&content_id).map_err(|_| "image_project.bad_request".to_string())?;
    if revision < 1 {
        return bad();
    }
    failed()
}

/// E2: PSD scan gate. The 07g PSD helper exposes a composite preview and
/// layer names, but not the blend, bounds, mask and proved-raster fields a
/// `PsdImportPlan` requires. Refusing keeps every PSD feature listed as
/// unavailable instead of inventing a lossless plan.
#[tauri::command]
pub fn image_project_psd_scan_start(
    window: WebviewWindow,
    request_id: String,
    path: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    crate::validate_absolute_path(&path).map_err(|_| "image_project.bad_request".to_string())?;
    failed()
}

/// E2: PSD import gate. No native writer can create an editable project from
/// PSD raster layers, and a flattened copy would need a trusted document
/// publisher. Refuse before touching the source; PSD Save is never offered.
#[tauri::command]
pub fn image_project_psd_import_start(
    window: WebviewWindow,
    request_id: String,
    path: String,
    expected_sha256: String,
    accept_flattened: bool,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    crate::validate_absolute_path(&path).map_err(|_| "image_project.bad_request".to_string())?;
    if expected_sha256.len() != 64
        || !expected_sha256
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
    {
        return bad();
    }
    let _ = accept_flattened;
    failed()
}

#[cfg(test)]
mod payload_tests {
    use super::*;

    fn blob(kind: ProjectPayloadKind, name: &str, bytes: &[u8]) -> PayloadBlob {
        PayloadBlob {
            kind,
            name: name.to_string(),
            bytes: Zeroizing::new(bytes.to_vec()),
        }
    }

    #[test]
    fn pages_span_blobs_and_are_bounded() {
        let sessions = ProjectPayloadSessions::default();
        let handle = sessions
            .insert(PayloadSession {
                blobs: vec![
                    blob(ProjectPayloadKind::Rgba, "a", &[1, 2, 3]),
                    blob(ProjectPayloadKind::Alpha, "b", &[4, 5, 6, 7]),
                ],
                total_bytes: 7,
                expires_at: Instant::now() + PAYLOAD_SESSION_IDLE,
                _lease: None,
            })
            .expect("insert");
        let handle = handle.to_string();
        assert_eq!(
            sessions.page(&handle, 0, 4).expect("page"),
            vec![1u8, 2, 3, 4]
        );
        assert_eq!(sessions.page(&handle, 4, 4).expect("page"), vec![5u8, 6, 7]);
        assert_eq!(
            sessions.page(&handle, 0, 0).err().as_deref(),
            Some("image_project.bad_request")
        );
        assert_eq!(
            sessions
                .page(&handle, 0, (MAX_PAYLOAD_PAGE_BYTES as u32) + 1)
                .err()
                .as_deref(),
            Some("image_project.too_large")
        );
        assert_eq!(
            sessions.page(&handle, 7, 1).err().as_deref(),
            Some("image_project.bad_request")
        );
        sessions.release(&handle).expect("release");
        assert_eq!(
            sessions.page(&handle, 0, 1).err().as_deref(),
            Some("image_project.changed")
        );
    }

    #[test]
    fn over_budget_sessions_fail_closed() {
        let sessions = ProjectPayloadSessions::default();
        let session = PayloadSession {
            blobs: vec![blob(ProjectPayloadKind::Rgba, "a", &[0])],
            total_bytes: MAX_PROJECT_PAYLOAD_BYTES + 1,
            expires_at: Instant::now() + PAYLOAD_SESSION_IDLE,
            _lease: None,
        };
        assert_eq!(
            sessions.insert(session).err().as_deref(),
            Some("image_project.too_large")
        );
    }
}
