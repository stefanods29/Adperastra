//! Native document sources (Step 09a T2).
//!
//! `document_open` grants one document through the existing `FileGrants`
//! and registers the same identity with the Step 08a snapshot authority,
//! so an editor capture uses that authority instead of reauthorizing the
//! file as a new document. Providers for virtual (locked) and draft
//! sources are registered natively by their own steps; an absent provider
//! fails with `documents.provider_missing`, never with fake success.
#![allow(dead_code)]


use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};
use uuid::Uuid;

use crate::document_types::{DocumentError, DocumentInfo, DocumentRef, OpenDocumentResult};
use crate::file_grant_backing::GrantedBacking;
use crate::files::FileGrants;
use crate::{ensure_main, validate_absolute_path};

/// Largest encoded snapshot a document may capture (256 MiB).
pub const MAX_DOCUMENT_SNAPSHOT_BYTES: u64 = 256 * 1024 * 1024;
/// Most documents open at once.
pub const MAX_OPEN_DOCUMENTS: usize = 200;

/// The Step 08a snapshot authority, behind a port so this module's logic
/// is unit-tested with an injected fake. The coordinator constructs the
/// store with the real `SnapshotAuthorityRegistry`.
pub trait SnapshotAuthorityPort: Send + Sync {
    fn register_native(
        &self,
        document_id: Uuid,
        name: &str,
        mime: &str,
        source: Option<fs_service::SourceStamp>,
        sensitive: bool,
    ) -> Result<(), DocumentError>;
    /// Register one encoder output MIME (native callers only).
    fn permit_capture_mime(&self, document_id: Uuid, mime: &str) -> Result<(), DocumentError>;
    /// Refuse a capture whose MIME was never permitted for this document.
    fn check_capture_mime(&self, document_id: Uuid, mime: &str) -> Result<(), DocumentError>;
    fn revoke(&self, document_id: Uuid);
}

/// The Step 08a snapshot upload service, behind a port. The coordinator
/// wires the real `ExportSnapshots` begin operation; there is no second
/// upload protocol.
pub trait SnapshotUploadPort: Send + Sync {
    fn begin(
        &self,
        document_id: Uuid,
        captured_revision: u64,
        content_id: Uuid,
        mime: &str,
        byte_len: u64,
    ) -> Result<SnapshotBeginResult, DocumentError>;
}

/// One finished Step 08a snapshot, resolved for a commit.
pub trait SnapshotPort: Send + Sync {
    fn resolve(
        &self,
        snapshot_id: &str,
        document_id: &str,
        revision: u64,
        content_id: &str,
    ) -> Result<Arc<GrantedBacking>, DocumentError>;
}

fn snapshot_error(error: String) -> DocumentError {
    match error.as_str() {
        "snapshot.too_large" => DocumentError::TooLarge,
        "snapshot.changed" => DocumentError::Changed,
        _ => DocumentError::Invalid,
    }
}

/// Production adapters over the real 08a registry. The coordinator can pass
/// one `Arc<ExportSnapshots>` for all three document-store ports; no test fake
/// or parallel snapshot registry is needed in `main.rs`.
impl SnapshotAuthorityPort for crate::export_snapshots::ExportSnapshots {
    fn register_native(
        &self,
        document_id: Uuid,
        name: &str,
        mime: &str,
        source: Option<fs_service::SourceStamp>,
        sensitive: bool,
    ) -> Result<(), DocumentError> {
        self.authorities()
            .register_native(document_id, name, mime, source, sensitive)
            .map_err(snapshot_error)?;
        let derived = if mime.starts_with("image/") {
            Some("image/png")
        } else if mime.starts_with("text/") || matches!(mime, "application/json" | "application/xml") {
            Some("text/plain")
        } else {
            None
        };
        if let Some(derived) = derived.filter(|candidate| *candidate != mime) {
            if let Err(error) = self.authorities().permit_capture_mime(document_id, derived) {
                let _ = self.authorities().revoke(document_id);
                return Err(snapshot_error(error));
            }
        }
        Ok(())
    }

    fn permit_capture_mime(&self, document_id: Uuid, mime: &str) -> Result<(), DocumentError> {
        self.authorities()
            .permit_capture_mime(document_id, mime)
            .map_err(snapshot_error)
    }

    fn check_capture_mime(&self, document_id: Uuid, mime: &str) -> Result<(), DocumentError> {
        let permitted = self
            .authorities()
            .capture_mimes(document_id)
            .map_err(snapshot_error)?;
        if permitted.iter().any(|candidate| candidate == mime) {
            Ok(())
        } else {
            Err(DocumentError::ReadOnly)
        }
    }

    fn revoke(&self, document_id: Uuid) {
        let _ = self.authorities().revoke(document_id);
    }
}

impl SnapshotPort for crate::export_snapshots::ExportSnapshots {
    fn resolve(
        &self,
        snapshot_id: &str,
        document_id: &str,
        revision: u64,
        content_id: &str,
    ) -> Result<Arc<GrantedBacking>, DocumentError> {
        self.resolve_exact(snapshot_id, document_id, revision, content_id)
            .map(|lease| lease.backing.clone())
            .map_err(snapshot_error)
    }
}

impl SnapshotUploadPort for crate::export_snapshots::ExportSnapshots {
    fn begin(
        &self,
        document_id: Uuid,
        captured_revision: u64,
        content_id: Uuid,
        mime: &str,
        byte_len: u64,
    ) -> Result<SnapshotBeginResult, DocumentError> {
        crate::export_snapshots::ExportSnapshots::begin(
            self,
            crate::export_snapshot_types::SnapshotBeginRequest {
                document_id,
                revision: captured_revision,
                content_id,
                mime: mime.to_string(),
                byte_len,
                source: None,
            },
        )
        .map(|reply| SnapshotBeginResult {
            snapshot_id: reply.snapshot_id,
            upload_token: reply.upload_token,
        })
        .map_err(snapshot_error)
    }
}

/// A detected, pinned disk file ready to be granted and registered.
pub struct PreparedDisk {
    pub info: crate::files::FileTypeInfo,
    pub backing: Arc<GrantedBacking>,
    pub stamp: Option<fs_service::SourceStamp>,
}

#[derive(Debug, Clone)]
pub struct NativeDocumentEntry {
    pub info: DocumentInfo,
    pub token: String,
    pub source_generation: u64,
    pub can_save_existing: bool,
}

/// Managed document store. Constructed by the coordinator with the real
/// authority and snapshot registries.
pub struct DocumentStore {
    entries: Mutex<HashMap<Uuid, NativeDocumentEntry>>,
    authority: Arc<dyn SnapshotAuthorityPort>,
    snapshots: Arc<dyn SnapshotPort>,
    uploads: Arc<dyn SnapshotUploadPort>,
}

impl DocumentStore {
    pub fn new(
        authority: Arc<dyn SnapshotAuthorityPort>,
        snapshots: Arc<dyn SnapshotPort>,
        uploads: Arc<dyn SnapshotUploadPort>,
    ) -> Self {
        DocumentStore {
            entries: Mutex::new(HashMap::new()),
            authority,
            snapshots,
            uploads,
        }
    }

    pub fn entry(&self, document_id: Uuid) -> Result<NativeDocumentEntry, DocumentError> {
        let entries = self.entries.lock().map_err(|_| DocumentError::Io)?;
        entries.get(&document_id).cloned().ok_or(DocumentError::ProviderMissing)
    }

    /// Detect and pin one disk file (blocking work, no shared state).
    /// `register_prepared` finishes the open on the caller's thread.
    pub fn prepare_disk(path: &Path) -> Result<PreparedDisk, DocumentError> {
        let info = crate::files::detect(path).map_err(|_| DocumentError::Io)?;
        let identity = fs_service::owned_io::SourceIdentity::capture(path)
            .map_err(|_| DocumentError::Changed)?;
        let pinned = fs_service::owned_io::PinnedSource::open(path, &identity)
            .map_err(|_| DocumentError::Changed)?;
        let stamp = fs_service::capture_source_stamp(path).ok();
        let backing = Arc::new(GrantedBacking::Disk {
            source: Arc::new(pinned),
            length: info.size,
        });
        Ok(PreparedDisk {
            info,
            backing,
            stamp,
        })
    }

    /// Grant a prepared disk file, register its snapshot authority and
    /// remember it. Any failure leaves nothing registered.
    pub fn register_prepared(
        &self,
        grants: &FileGrants,
        prepared: PreparedDisk,
    ) -> Result<OpenDocumentResult, DocumentError> {
        let PreparedDisk {
            info,
            backing,
            stamp,
        } = prepared;
        let document_id = Uuid::new_v4();
        let token = crate::document_grants::grant_backing(grants, backing)
            .map_err(|_| DocumentError::TooManyOpen)?;
        let document_info = DocumentInfo {
            document_id: document_id.to_string(),
            source: DocumentRef::Disk {
                path: info.path.clone(),
            },
            name: info.name.clone(),
            ext: info.ext.clone(),
            mime: info.mime.clone(),
            size: info.size,
            modified_unix: info.modified_unix,
            read_only: info.read_only,
            from_internet: info.from_internet,
            sensitive: false,
            disk_path: Some(info.path.clone()),
        };
        if let Err(error) = self.authority.register_native(
            document_id,
            &document_info.name,
            &document_info.mime,
            stamp.clone(),
            document_info.sensitive,
        ) {
            crate::document_grants::revoke(grants, &token);
            return Err(error);
        }
        // The editable-project encoder captures the exact `.adimage` bytes
        // through 08a. Only this native registration may add that MIME.
        if document_info.ext.eq_ignore_ascii_case("adimage") {
            if let Err(error) = self.authority.permit_capture_mime(
                document_id,
                "application/vnd.adperastra.image-project+zip",
            ) {
                crate::document_grants::revoke(grants, &token);
                self.authority.revoke(document_id);
                return Err(error);
            }
        }
        let mut entries = self.entries.lock().map_err(|_| DocumentError::Io)?;
        if entries.len() >= MAX_OPEN_DOCUMENTS {
            drop(entries);
            crate::document_grants::revoke(grants, &token);
            self.authority.revoke(document_id);
            return Err(DocumentError::TooManyOpen);
        }
        entries.insert(
            document_id,
            NativeDocumentEntry {
                info: document_info.clone(),
                token: token.clone(),
                source_generation: 0,
                // Replacing an existing file in place stays unavailable
                // until Step 09f proves the approved-object contract.
                can_save_existing: false,
            },
        );
        Ok(OpenDocumentResult {
            document_id: document_id.to_string(),
            info: document_info,
            token,
            source_stamp: stamp,
        })
    }

    /// Release one document: revoke its grant and its snapshot authority.
    /// Idempotent.
    pub fn release(&self, grants: &FileGrants, document_id: Uuid) {
        let removed = self
            .entries
            .lock()
            .ok()
            .and_then(|mut entries| entries.remove(&document_id));
        if let Some(entry) = removed {
            crate::document_grants::revoke(grants, &entry.token);
        }
        self.authority.revoke(document_id);
    }

    /// The live document bound to one disk path, if any (paths compare
    /// case-insensitively, ignoring the `\\?\` prefix).
    pub fn document_bound_to_path(&self, path: &Path) -> Option<Uuid> {
        let wanted = path.to_string_lossy().replace('/', "\\").to_lowercase();
        let wanted = wanted.strip_prefix("\\\\?\\").unwrap_or(&wanted).to_string();
        let entries = self.entries.lock().ok()?;
        entries.iter().find_map(|(id, entry)| {
            if let DocumentRef::Disk { path: bound } = &entry.info.source {
                let bound = bound.replace('/', "\\").to_lowercase();
                let bound = bound.strip_prefix("\\\\?\\").unwrap_or(&bound);
                if bound == wanted {
                    return Some(*id);
                }
            }
            None
        })
    }

    /// Every live disk document whose source lies under one of the exact
    /// volume roots, with its document identity. Paths compare
    /// case-insensitively, ignore the `\\?\` prefix and trailing
    /// separators, and only a whole path component counts as under a root.
    ///
    /// This is the eject guard of Step 09j: an empty answer must mean
    /// "no open document", never "the registry could not be read". A
    /// poisoned lock is therefore read through its inner guard; the map
    /// is only read here, so at worst one stale entry refuses an eject.
    pub fn open_documents_under(&self, roots: &[String]) -> Vec<(Uuid, String)> {
        let normalize = |path: &str| {
            path.replace('/', "\\")
                .trim_start_matches(r"\\?\")
                .trim_end_matches('\\')
                .to_ascii_lowercase()
        };
        let roots: Vec<String> = roots
            .iter()
            .map(|root| normalize(root.as_str()))
            .collect();
        let entries = match self.entries.lock() {
            Ok(entries) => entries,
            Err(poisoned) => poisoned.into_inner(),
        };
        entries
            .iter()
            .filter_map(|(id, entry)| {
                // The source is authoritative; `disk_path` is only its
                // optional wire mirror and must not decide the guard.
                let path = match &entry.info.source {
                    DocumentRef::Disk { path } => path.as_str(),
                    _ => return None,
                };
                let plain = normalize(path);
                let under = roots.iter().any(|root| {
                    let prefix = format!("{root}\\");
                    plain == *root || plain.starts_with(prefix.as_str())
                });
                under.then(|| (*id, path.to_string()))
            })
            .collect()
    }

    /// Switch one document to a new disk source after its file was
    /// published and verified. The generation must still match; the
    /// generation then increments exactly once. Returns false (changing
    /// nothing) for a stale request, so a published file is reported
    /// truthfully as kept but not switched to.
    pub fn rebind_source(
        &self,
        document_id: Uuid,
        expected_generation: u64,
        new_source: DocumentRef,
    ) -> Result<bool, DocumentError> {
        let mut entries = self.entries.lock().map_err(|_| DocumentError::Io)?;
        let Some(entry) = entries.get_mut(&document_id) else {
            return Ok(false);
        };
        if entry.source_generation != expected_generation {
            return Ok(false);
        }
        if let DocumentRef::Disk { path } = &new_source {
            entry.info.disk_path = Some(path.clone());
            entry.info.name = Path::new(path)
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| entry.info.name.clone());
        } else {
            return Err(DocumentError::Invalid);
        }
        entry.info.source = new_source;
        entry.source_generation += 1;
        Ok(true)
    }

    /// Validate a snapshot begin request against a live authority.
    pub fn validate_snapshot_begin(
        &self,
        document_id: Uuid,
        captured_revision: u64,
        mime: &str,
        byte_len: u64,
    ) -> Result<(), DocumentError> {
        let _ = self.entry(document_id)?;
        if captured_revision == 0 || mime.is_empty() || mime.chars().count() > 128 {
            return Err(DocumentError::Invalid);
        }
        if byte_len > MAX_DOCUMENT_SNAPSHOT_BYTES {
            return Err(DocumentError::TooLarge);
        }
        // Only a natively permitted encoder MIME may capture; a browser
        // request can never add one or lower a sensitive classification.
        self.authority.check_capture_mime(document_id, mime)
    }

    /// Write one finished snapshot to a new file (copy), or refuse an
    /// in-place save whose approved-object proof does not exist yet.
    /// Nothing is ever overwritten.
    pub fn commit_copy(
        &self,
        document_id: Uuid,
        snapshot_id: &str,
        captured_revision: u64,
        content_id: &str,
        dest_path: &Path,
    ) -> Result<PathBuf, DocumentError> {
        let entry = self.entry(document_id)?;
        let backing = self.snapshots.resolve(
            snapshot_id,
            &document_id.to_string(),
            captured_revision,
            content_id,
        )?;
        if backing.length() > MAX_DOCUMENT_SNAPSHOT_BYTES {
            return Err(DocumentError::TooLarge);
        }
        // A copy is an independent result: never target a path that is
        // already the live source of an editable document (this document
        // included), so a copy can neither overwrite it nor leave a
        // dangling descriptor behind.
        if self.document_bound_to_path(dest_path).is_some() {
            return Err(DocumentError::EditorConflict);
        }
        let parent = dest_path.parent().ok_or(DocumentError::Invalid)?;
        let name = dest_path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .ok_or(DocumentError::Invalid)?;
        fs_service::validate_new_name(&name).map_err(|_| DocumentError::Invalid)?;
        let directory = fs_service::owned_io::PinnedDirectory::open(parent)
            .map_err(|_| DocumentError::Io)?;
        let mut output = fs_service::owned_io::OwnedOutput::create(&directory, &name)
            .map_err(|_| DocumentError::Io)?;
        let mut offset = 0u64;
        while offset < backing.length() {
            let chunk = backing
                .read_range(offset, 1024 * 1024)
                .map_err(|_| DocumentError::Io)?;
            if chunk.is_empty() {
                break;
            }
            output
                .file_mut()
                .write_all(&chunk)
                .map_err(|_| DocumentError::Io)?;
            offset += chunk.len() as u64;
        }
        if offset != backing.length() {
            return Err(DocumentError::Io);
        }
        output.flush_sync().map_err(|_| DocumentError::Io)?;
        let published = output.publish_name(&name).map_err(|_| DocumentError::Io)?;
        let _ = entry;
        Ok(published)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotBeginRequest {
    pub document_id: String,
    pub captured_revision: u64,
    pub content_id: String,
    pub mime: String,
    pub byte_len: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotBeginResult {
    pub snapshot_id: String,
    pub upload_token: String,
}

/// Open a document source. Only disk sources open here; virtual and draft
/// sources need their native provider (Step 09k / Step 20a).
#[tauri::command]
pub async fn document_open(
    window: WebviewWindow,
    documents: State<'_, Arc<DocumentStore>>,
    grants: State<'_, Arc<FileGrants>>,
    source: DocumentRef,
) -> Result<OpenDocumentResult, String> {
    ensure_main(window.label())?;
    source.validate().map_err(String::from)?;
    let path = match &source {
        DocumentRef::Disk { path } => {
            validate_absolute_path(path).map_err(|_| DocumentError::Invalid.code().to_string())?;
            PathBuf::from(path)
        }
        _ => return Err(DocumentError::ProviderMissing.code().to_string()),
    };
    let prepared = tauri::async_runtime::spawn_blocking(move || DocumentStore::prepare_disk(&path))
        .await
        .map_err(|e| e.to_string())?;
    let prepared = prepared.map_err(String::from)?;
    documents.register_prepared(grants.as_ref(), prepared).map_err(String::from)
}

/// Release a document source (idempotent).
#[tauri::command]
pub fn document_release(
    window: WebviewWindow,
    documents: State<'_, Arc<DocumentStore>>,
    grants: State<'_, Arc<FileGrants>>,
    document_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    let id = Uuid::try_parse(&document_id).map_err(|_| DocumentError::Invalid.code().to_string())?;
    documents.release(grants.as_ref(), id);
    Ok(())
}

/// Begin a snapshot upload for one document revision. The upload itself
/// uses the Step 08a append/finish protocol; this command only validates
/// and delegates to the coordinator-wired snapshot service.
#[tauri::command]
pub fn document_snapshot_begin(
    window: WebviewWindow,
    documents: State<'_, Arc<DocumentStore>>,
    request: SnapshotBeginRequest,
) -> Result<SnapshotBeginResult, String> {
    ensure_main(window.label())?;
    let id = Uuid::try_parse(&request.document_id)
        .map_err(|_| DocumentError::Invalid.code().to_string())?;
    let content_id = Uuid::try_parse(&request.content_id)
        .map_err(|_| DocumentError::Invalid.code().to_string())?;
    documents
        .validate_snapshot_begin(id, request.captured_revision, &request.mime, request.byte_len)
        .map_err(String::from)?;
    documents
        .uploads
        .begin(id, request.captured_revision, content_id, &request.mime, request.byte_len)
        .map_err(String::from)
}


