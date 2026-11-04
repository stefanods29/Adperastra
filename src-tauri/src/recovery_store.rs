//! The encrypted, bounded recovery store (Step 09h recovery-1).
//!
//! A save protects metadata and encoded bytes for the current user, then
//! publishes one owned record file before its opaque catalog row. A listing
//! decrypts metadata only; content is decrypted only by an explicit open.
//! Nothing here deletes a user's original file or a foreign record.
#![allow(dead_code)]


use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{AppHandle, Manager, State, WebviewWindow};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::export_snapshot_types::{ExportSnapshot, StoragePolicy};
use crate::jobs::{spawn_job, JobContext, Jobs};
use crate::recovery_dpapi::{protect_current_user, unprotect_current_user};
use crate::recovery_envelope::{
    build_content_plaintext_with_hash, build_envelope, check_envelope_size, is_sha256_hex,
    parse_content_plaintext_bound, parse_envelope, parse_envelope_header, sha256_hex,
    AuthenticatedMetadata,
};
use crate::recovery_types::{
    disk_source, record_file_name, source_path, validate_metadata, RecoveryCandidate,
    RecoveryCatalog, RecoveryCatalogRecord, RecoveryListPage, RecoveryMetadata,
    RecoveryRecordState, RecoverySaveResult, RecoveryStatus, CATALOG_VERSION,
    CLEAN_RETENTION_SECONDS, CONTENT_PREFIX_LEN, DPAPI_OVERHEAD, ENVELOPE_HEADER_LEN,
    ENVELOPE_MAGIC, MAX_DISCARD_IDS, MAX_LIST_PAGE, MAX_METADATA_BYTES, MAX_RECORD_BYTES,
    MAX_RECORDS, MAX_SAFE_INTEGER, MAX_TOTAL_BYTES, RECOVERY_VERSION,
};
use crate::{ensure_main, AppState};

/// The directory below the app data folder.
pub const RECOVERY_DIR: &str = "recovery";
/// The catalog file; legacy plaintext `<hash>.json` drafts are never read.
pub const CATALOG_NAME: &str = "catalog.json";
/// The catalog is opaque rows only and must stay small; a bigger or foreign
/// file is refused instead of being read into memory.
pub const MAX_CATALOG_BYTES: u64 = 4 * 1024 * 1024;
/// Folder scans in the recovery directory stay bounded.
const MAX_DIRECTORY_SCAN: usize = 1_000;

/// One catalog writer at a time across save, discard and cleanup. The guard
/// is taken at every production entry point; tests use separate folders.
static RECOVERY_STORE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn lock_store() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    RECOVERY_STORE_LOCK
        .lock()
        .map_err(|_| "recovery.io".to_string())
}

/// Cross-process guard for the catalog. A second app instance cannot write a
/// record or the catalog while this handle is open.
pub fn take_store_lock(root: &Path) -> Result<std::fs::File, String> {
    std::fs::create_dir_all(root).map_err(|_| "recovery.io".to_string())?;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(false);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(0);
    }
    options.open(root.join("store.lock")).map_err(|error| {
        // ERROR_SHARING_VIOLATION / ERROR_LOCK_VIOLATION mean another app
        // instance owns the store; every other failure is an I/O problem.
        match error.raw_os_error() {
            Some(32) | Some(33) => "recovery.busy".to_string(),
            _ => "recovery.io".to_string(),
        }
    })
}

/// One protector for the two blobs. Production is current-user DPAPI; the
/// trait exists so store tests never pretend DPAPI succeeded.
pub trait RecordProtector: Send + Sync {
    fn protect(&self, plain: &[u8]) -> Result<Vec<u8>, String>;
    fn unprotect(&self, cipher: &[u8]) -> Result<Zeroizing<Vec<u8>>, String>;
}

pub struct DpapiProtector;

impl RecordProtector for DpapiProtector {
    fn protect(&self, plain: &[u8]) -> Result<Vec<u8>, String> {
        protect_current_user(plain)
    }

    fn unprotect(&self, cipher: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
        unprotect_current_user(cipher)
    }
}

pub struct RecoveryStore {
    root: PathBuf,
    protector: Arc<dyn RecordProtector>,
    max_total: u64,
    /// Test-only injection point that proves the catalog is written after
    /// the record and that a failed publication leaves no orphan.
    #[cfg(test)]
    fail_next_catalog_save: std::sync::atomic::AtomicBool,
}

impl RecoveryStore {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            protector: Arc::new(DpapiProtector),
            max_total: MAX_TOTAL_BYTES,
            #[cfg(test)]
            fail_next_catalog_save: std::sync::atomic::AtomicBool::new(false),
        }
    }

    /// The settings budget (`recovery.max_mib`, 128-4096 MiB). The per-record
    /// cap stays 64 MiB whatever this value is.
    pub fn with_budget(root: PathBuf, max_total: u64) -> Self {
        Self {
            max_total: max_total.clamp(128 * 1_048_576, 4_096 * 1_048_576),
            ..Self::new(root)
        }
    }

    #[cfg(test)]
    pub fn with_protector(root: PathBuf, protector: Arc<dyn RecordProtector>) -> Self {
        Self {
            root,
            protector,
            max_total: MAX_TOTAL_BYTES,
            fail_next_catalog_save: std::sync::atomic::AtomicBool::new(false),
        }
    }

    #[cfg(test)]
    pub fn fail_catalog_save_once(&self) {
        self.fail_next_catalog_save
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn catalog_path(&self) -> PathBuf {
        self.root.join(CATALOG_NAME)
    }

    fn record_path(&self, id: Uuid) -> PathBuf {
        self.root.join(record_file_name(id))
    }

    /// Read one record file only after its header has been bounded and the
    /// declared lengths match the actual file exactly. A newer envelope is
    /// reported as unsupported before any size decision; a foreign, truncated
    /// or oversized file is never slurped into memory.
    fn read_record_file(&self, id: Uuid) -> Result<Vec<u8>, String> {
        let path = self.record_path(id);
        let metadata = std::fs::symlink_metadata(&path).map_err(|_| "recovery.io".to_string())?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("recovery.io".to_string());
        }
        let mut file = std::fs::File::open(&path).map_err(|_| "recovery.io".to_string())?;
        let mut header = [0u8; ENVELOPE_HEADER_LEN];
        file.read_exact(&mut header)
            .map_err(|error| read_error_code(&error))?;
        let lengths = parse_envelope_header(&header)?;
        if metadata.len() > max_record_file_bytes() {
            return Err("recovery.too_large".to_string());
        }
        check_envelope_size(&lengths, metadata.len())?;
        let total = usize::try_from(metadata.len()).map_err(|_| "recovery.too_large".to_string())?;
        let mut bytes = vec![0u8; total];
        bytes[..ENVELOPE_HEADER_LEN].copy_from_slice(&header);
        file.read_exact(&mut bytes[ENVELOPE_HEADER_LEN..])
            .map_err(|error| read_error_code(&error))?;
        Ok(bytes)
    }

    /// Listing reads one exact header and the protected metadata only. The
    /// content blob is never read or hashed here (Step 09h decision 6); an
    /// explicit open verifies both content hashes.
    fn read_metadata_blob(&self, id: Uuid) -> Result<(Uuid, Vec<u8>), String> {
        let path = self.record_path(id);
        let metadata = std::fs::symlink_metadata(&path).map_err(|_| "recovery.io".to_string())?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("recovery.io".to_string());
        }
        let mut file = std::fs::File::open(&path).map_err(|_| "recovery.io".to_string())?;
        let mut header = [0u8; ENVELOPE_HEADER_LEN];
        file.read_exact(&mut header)
            .map_err(|error| read_error_code(&error))?;
        let lengths = parse_envelope_header(&header)?;
        if metadata.len() > max_record_file_bytes() {
            return Err("recovery.too_large".to_string());
        }
        check_envelope_size(&lengths, metadata.len())?;
        let mut cipher = vec![0u8; lengths.metadata_len as usize];
        file.read_exact(&mut cipher)
            .map_err(|error| read_error_code(&error))?;
        Ok((lengths.record_id, cipher))
    }

    fn load_catalog(&self) -> Result<RecoveryCatalog, String> {
        let path = self.catalog_path();
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(RecoveryCatalog::default())
            }
            Err(_) => return Err("recovery.io".to_string()),
        };
        if metadata.file_type().is_symlink()
            || !metadata.is_file()
            || metadata.len() > MAX_CATALOG_BYTES
        {
            return Err("recovery.corrupt".to_string());
        }
        let bytes = std::fs::read(&path).map_err(|_| "recovery.io".to_string())?;
        let catalog: RecoveryCatalog =
            serde_json::from_slice(&bytes).map_err(|_| "recovery.corrupt".to_string())?;
        if catalog.schema_version > CATALOG_VERSION {
            return Err("recovery.unsupported".to_string());
        }
        if catalog.schema_version != CATALOG_VERSION || !catalog_is_bounded(&catalog) {
            return Err("recovery.corrupt".to_string());
        }
        Ok(catalog)
    }

    fn save_catalog(&self, catalog: &RecoveryCatalog) -> Result<(), String> {
        #[cfg(test)]
        {
            if self
                .fail_next_catalog_save
                .swap(false, std::sync::atomic::Ordering::SeqCst)
            {
                return Err("recovery.io".to_string());
            }
        }
        if !catalog_is_bounded(catalog) {
            return Err("recovery.io".to_string());
        }
        std::fs::create_dir_all(&self.root).map_err(|_| "recovery.io".to_string())?;
        let json = serde_json::to_vec_pretty(catalog).map_err(|_| "recovery.io".to_string())?;
        fs_service::atomic_write(&self.catalog_path(), &json).map_err(|_| "recovery.io".to_string())
    }

    /// Count and bytes of every regular `<uuid>.adprec` file whose own
    /// header proves this store wrote it, including an unlisted record left
    /// by a crash between record publication and the catalog write. They
    /// count against both the record limit and the byte budget but are never
    /// deleted here. A foreign file with our magic and another id is not
    /// counted and is never a deletion target.
    fn owned_record_stats(&self) -> (usize, u64) {
        let Ok(entries) = std::fs::read_dir(&self.root) else {
            return (0, 0);
        };
        let mut count = 0usize;
        let mut total = 0u64;
        for entry in entries.flatten().take(MAX_DIRECTORY_SCAN) {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(stem) = name.strip_suffix(".adprec") else {
                continue;
            };
            let Ok(stem_id) = Uuid::parse_str(stem) else {
                continue;
            };
            let Ok(metadata) = std::fs::symlink_metadata(entry.path()) else {
                continue;
            };
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                continue;
            }
            let Ok(mut file) = std::fs::File::open(entry.path()) else {
                continue;
            };
            let mut header = [0u8; ENVELOPE_HEADER_LEN];
            let mut read = 0usize;
            while read < header.len() {
                match file.read(&mut header[read..]) {
                    Ok(0) => break,
                    Ok(found) => read += found,
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(_) => break,
                }
            }
            if read < 7 || &header[..7] != ENVELOPE_MAGIC {
                continue;
            }
            let owned = if read < ENVELOPE_HEADER_LEN {
                // A partial record this store wrote but never finished.
                true
            } else {
                Uuid::from_slice(&header[11..27])
                    .map(|found| found == stem_id)
                    .unwrap_or(false)
            };
            if owned {
                count += 1;
                total = total.saturating_add(metadata.len());
            }
        }
        (count, total)
    }

    /// Save one immutable revision. The record file is flushed and published
    /// before the catalog row exists; the catalog is never written first. An
    /// expired clean record makes room; a dirty record is never displaced.
    pub fn save(
        &self,
        metadata: &RecoveryMetadata,
        encoded: &[u8],
        now: u64,
    ) -> Result<RecoverySaveResult, String> {
        validate_metadata(metadata)?;
        if encoded.len() as u64 != metadata.byte_len {
            return Err("recovery.changed".to_string());
        }
        if metadata.byte_len > MAX_RECORD_BYTES {
            return Err("recovery.too_large".to_string());
        }
        if metadata
            .byte_len
            .saturating_add(CONTENT_PREFIX_LEN as u64)
            > crate::recovery_dpapi::MAX_DPAPI_BYTES as u64
        {
            return Err("recovery.too_large".to_string());
        }
        let mut catalog = self.load_catalog()?;
        self.expire_clean(&mut catalog, now)?;
        if catalog.get(metadata.record_id).is_some() {
            // A caller never reuses an identity; a retry must use a fresh
            // record id instead of replacing or aliasing the first record.
            return Err("recovery.changed".to_string());
        }
        if self.record_path(metadata.record_id).exists() {
            // An unlisted record with this id is still the first copy; a
            // retry cannot replace it, but must not pretend to have saved.
            return Err("recovery.changed".to_string());
        }
        let (owned_count, owned_total) = self.owned_record_stats();
        let used = catalog.total_bytes().max(owned_total);
        if catalog.records.len().max(owned_count) >= MAX_RECORDS
            || used.saturating_add(metadata.byte_len) > self.max_total
        {
            return Err("recovery.too_large".to_string());
        }

        let (content_plain, plaintext_sha256) =
            build_content_plaintext_with_hash(metadata, encoded);
        let content_plain = Zeroizing::new(content_plain);
        let content_cipher = self.protector.protect(&content_plain)?;
        let ciphertext_sha256 = sha256_hex(&content_cipher);
        let authenticated =
            AuthenticatedMetadata::from_metadata(metadata, plaintext_sha256, ciphertext_sha256);
        let metadata_plain = Zeroizing::new(
            serde_json::to_vec(&authenticated).map_err(|_| "recovery.invalid".to_string())?,
        );
        if metadata_plain.len() > MAX_METADATA_BYTES {
            return Err("recovery.too_large".to_string());
        }
        let metadata_cipher = self.protector.protect(&metadata_plain)?;
        let envelope = build_envelope(metadata.record_id, &metadata_cipher, &content_cipher);

        std::fs::create_dir_all(&self.root).map_err(|_| "recovery.io".to_string())?;
        let directory = fs_service::owned_io::PinnedDirectory::open(&self.root)
            .map_err(|_| "recovery.io".to_string())?;
        let mut output = fs_service::owned_io::OwnedOutput::create(&directory, "recovery")
            .map_err(|_| "recovery.io".to_string())?;
        {
            use std::io::Write;
            output
                .file_mut()
                .write_all(&envelope)
                .map_err(|_| "recovery.io".to_string())?;
        }
        output
            .flush_sync()
            .map_err(|_| "recovery.io".to_string())?;
        output
            .publish_name(&record_file_name(metadata.record_id))
            .map_err(|_| "recovery.io".to_string())?;
        // Close the exclusive staging handle before any later open (a reader
        // or a retention cleanup) can touch the published file.
        drop(output);

        catalog.records.push(RecoveryCatalogRecord {
            record_id: metadata.record_id,
            document_id: metadata.document_id,
            content_id: metadata.content_id,
            revision: metadata.captured_revision,
            captured_unix: metadata.captured_unix,
            byte_len: metadata.byte_len,
            state: RecoveryRecordState::Available,
            error_code: None,
            clean_unix: None,
        });
        // If the catalog cannot be published, the record stays as an
        // unlisted orphan: it is the only copy of this unsaved revision and
        // is never deleted outside Discard or verified-clean retention. It
        // was already counted against the record limit and byte budget.
        self.save_catalog(&catalog)?;
        Ok(RecoverySaveResult {
            record_id: metadata.record_id,
            captured_revision: metadata.captured_revision,
        })
    }

    /// Delete expired verified-clean records before a new save reserves
    /// space. A removal failure keeps that row for a later cleanup.
    fn expire_clean(&self, catalog: &mut RecoveryCatalog, now: u64) -> Result<(), String> {
        let expired: Vec<Uuid> = catalog
            .records
            .iter()
            .filter(|row| {
                row.state == RecoveryRecordState::Clean
                    && now.saturating_sub(row.retention_unix()) > CLEAN_RETENTION_SECONDS
            })
            .map(|row| row.record_id)
            .collect();
        if expired.is_empty() {
            return Ok(());
        }
        let mut removed = Vec::new();
        for id in expired {
            if self.remove_owned_record(id).is_ok() {
                removed.push(id);
            }
        }
        if removed.is_empty() {
            return Ok(());
        }
        catalog
            .records
            .retain(|row| !removed.contains(&row.record_id));
        self.save_catalog(catalog)
    }

    /// Metadata-only listing. Content is never decrypted here.
    pub fn list(
        &self,
        cursor: Option<Uuid>,
        unclean_exit: bool,
        safe_mode: bool,
    ) -> Result<RecoveryListPage, String> {
        let catalog = self.load_catalog()?;
        let mut rows = catalog.records;
        rows.sort_by(|left, right| {
            right
                .captured_unix
                .cmp(&left.captured_unix)
                .then(left.record_id.cmp(&right.record_id))
        });
        let start = match cursor {
            Some(id) => rows
                .iter()
                .position(|row| row.record_id == id)
                .map(|index| index + 1)
                .ok_or_else(|| "recovery.invalid".to_string())?,
            None => 0,
        };
        let page: Vec<_> = rows.iter().skip(start).take(MAX_LIST_PAGE).collect();
        let items = page
            .iter()
            .map(|row| self.candidate(row))
            .collect::<Vec<_>>();
        let next_cursor = if start + page.len() < rows.len() {
            page.last().map(|row| row.record_id)
        } else {
            None
        };
        Ok(RecoveryListPage {
            items,
            next_cursor,
            complete: next_cursor.is_none(),
            unclean_exit,
            safe_mode,
        })
    }

    fn candidate(&self, row: &RecoveryCatalogRecord) -> RecoveryCandidate {
        let fallback = |status: RecoveryStatus, error_code: &str| RecoveryCandidate {
            record_id: row.record_id,
            name: String::new(),
            source_path: None,
            captured_unix: row.captured_unix,
            revision: row.revision,
            byte_len: row.byte_len,
            status,
            error_code: Some(error_code.to_string()),
        };
        match row.state {
            RecoveryRecordState::Corrupt => {
                return fallback(
                    RecoveryStatus::Corrupt,
                    row.error_code.as_deref().unwrap_or("recovery.corrupt"),
                )
            }
            RecoveryRecordState::Unsupported => {
                return fallback(
                    RecoveryStatus::Unsupported,
                    row.error_code
                        .as_deref()
                        .unwrap_or("recovery.unsupported"),
                )
            }
            RecoveryRecordState::Pending
            | RecoveryRecordState::Available
            | RecoveryRecordState::Clean => {}
        }
        match self.authenticated_for_listing(row) {
            Ok(authenticated) => RecoveryCandidate {
                record_id: row.record_id,
                name: authenticated.name,
                source_path: authenticated.original_path,
                captured_unix: authenticated.captured_unix,
                revision: authenticated.revision,
                byte_len: authenticated.encoded_len,
                status: RecoveryStatus::Available,
                error_code: None,
            },
            Err(error) if error == "recovery.unsupported" => {
                fallback(RecoveryStatus::Unsupported, &error)
            }
            Err(error) => fallback(RecoveryStatus::Corrupt, &error),
        }
    }

    /// Metadata-only verification for a listing: one bounded header and the
    /// protected metadata, never the content blob.
    fn authenticated_for_listing(
        &self,
        row: &RecoveryCatalogRecord,
    ) -> Result<AuthenticatedMetadata, String> {
        let (record_id, metadata_cipher) = self.read_metadata_blob(row.record_id)?;
        if record_id != row.record_id {
            return Err("recovery.corrupt".to_string());
        }
        let metadata_plain = self.protector.unprotect(&metadata_cipher)?;
        let authenticated: AuthenticatedMetadata = serde_json::from_slice(&metadata_plain)
            .map_err(|_| "recovery.corrupt".to_string())?;
        self.verify_metadata_identity(row, &authenticated, None)?;
        Ok(authenticated)
    }

    /// Full verification for an explicit open: the whole envelope plus the
    /// SHA-256 of the ciphertext content.
    fn authenticated_for_row(
        &self,
        row: &RecoveryCatalogRecord,
    ) -> Result<(AuthenticatedMetadata, crate::recovery_envelope::EnvelopeParts), String> {
        let bytes = self.read_record_file(row.record_id)?;
        let parts = parse_envelope(&bytes)?;
        if parts.record_id != row.record_id {
            return Err("recovery.corrupt".to_string());
        }
        let metadata_plain = self.protector.unprotect(&parts.metadata_cipher)?;
        let authenticated: AuthenticatedMetadata = serde_json::from_slice(&metadata_plain)
            .map_err(|_| "recovery.corrupt".to_string())?;
        let ciphertext_sha256 = sha256_hex(&parts.content_cipher);
        self.verify_metadata_identity(row, &authenticated, Some(&ciphertext_sha256))?;
        Ok((authenticated, parts))
    }

    /// Every identity the catalog, the metadata blob and the caller repeat
    /// must agree. `expected_cipher_hash` is present only for a full open.
    fn verify_metadata_identity(
        &self,
        row: &RecoveryCatalogRecord,
        authenticated: &AuthenticatedMetadata,
        expected_cipher_hash: Option<&str>,
    ) -> Result<(), String> {
        if authenticated.version > RECOVERY_VERSION {
            return Err("recovery.unsupported".to_string());
        }
        if authenticated.version != RECOVERY_VERSION
            || authenticated.record_id != row.record_id
            || authenticated.document_id != row.document_id
            || authenticated.revision != row.revision
            || authenticated.content_id != row.content_id
            || authenticated.captured_unix != row.captured_unix
            || authenticated.encoded_len != row.byte_len
            || authenticated.sensitive
            || !is_sha256_hex(&authenticated.plaintext_sha256)
            || !is_sha256_hex(&authenticated.ciphertext_sha256)
        {
            return Err("recovery.corrupt".to_string());
        }
        if expected_cipher_hash
            .is_some_and(|expected| authenticated.ciphertext_sha256 != expected)
        {
            return Err("recovery.corrupt".to_string());
        }
        let metadata = metadata_from_authenticated(authenticated);
        match validate_metadata(&metadata) {
            Ok(()) => {}
            Err(code) if code == "recovery.too_large" => return Err(code),
            Err(_) => return Err("recovery.corrupt".to_string()),
        }
        if !authenticated.matches(&metadata) {
            return Err("recovery.corrupt".to_string());
        }
        Ok(())
    }

    /// Decrypt content only after an explicit open and verify both identities
    /// and both hashes. A damaged record becomes corrupt and is kept; an I/O
    /// failure leaves the current state alone.
    pub fn read(&self, id: Uuid) -> Result<(RecoveryMetadata, Zeroizing<Vec<u8>>), String> {
        let catalog = self.load_catalog()?;
        let row = catalog
            .get(id)
            .ok_or_else(|| "recovery.invalid".to_string())?;
        match row.state {
            RecoveryRecordState::Corrupt => return Err("recovery.corrupt".to_string()),
            RecoveryRecordState::Unsupported => {
                return Err("recovery.unsupported".to_string())
            }
            RecoveryRecordState::Pending
            | RecoveryRecordState::Available
            | RecoveryRecordState::Clean => {}
        }
        let result = self.read_envelope(row);
        if let Err(code) = &result {
            match code.as_str() {
                "recovery.corrupt" | "recovery.too_large" => {
                    self.mark_state(id, RecoveryRecordState::Corrupt, code)
                }
                "recovery.unsupported" => {
                    self.mark_state(id, RecoveryRecordState::Unsupported, code)
                }
                _ => {}
            }
        }
        result
    }

    fn read_envelope(
        &self,
        row: &RecoveryCatalogRecord,
    ) -> Result<(RecoveryMetadata, Zeroizing<Vec<u8>>), String> {
        let (authenticated, parts) = self.authenticated_for_row(row)?;
        let metadata = metadata_from_authenticated(&authenticated);
        let content_plain = self.protector.unprotect(&parts.content_cipher)?;
        let content = parse_content_plaintext_bound(&metadata, &content_plain)?;
        if content.plaintext_sha256 != authenticated.plaintext_sha256 {
            return Err("recovery.corrupt".to_string());
        }
        Ok((metadata, Zeroizing::new(content.encoded.to_vec())))
    }

    fn mark_state(&self, id: Uuid, state: RecoveryRecordState, code: &str) {
        let Ok(mut catalog) = self.load_catalog() else {
            return;
        };
        let Some(row) = catalog.records.iter_mut().find(|row| row.record_id == id) else {
            return;
        };
        if row.state == state && row.error_code.as_deref() == Some(code) {
            return;
        }
        row.state = state;
        row.error_code = Some(code.to_string());
        let _ = self.save_catalog(&catalog);
    }

    /// Remove only the named recovery records. Original files are untouched.
    /// Every id must still be in the catalog: an unknown id is refused before
    /// anything is changed, so a successful answer never hides a failed or
    /// aliased deletion.
    pub fn discard(&self, ids: &[Uuid]) -> Result<(), String> {
        if ids.is_empty() || ids.len() > MAX_DISCARD_IDS {
            return Err("recovery.invalid".to_string());
        }
        let mut unique = Vec::with_capacity(ids.len());
        for id in ids {
            if !unique.contains(id) {
                unique.push(*id);
            }
        }
        let mut catalog = self.load_catalog()?;
        if unique.iter().any(|id| catalog.get(*id).is_none()) {
            return Err("recovery.invalid".to_string());
        }
        // Delete the owned files first. A row is removed only for a file that
        // is gone or foreign, so the catalog never silently stops listing a
        // record that still exists. A failure keeps that row for a retry.
        let mut removed = Vec::new();
        let mut first_error = None;
        for id in unique {
            match self.remove_owned_record(id) {
                Ok(()) => removed.push(id),
                Err(error) => {
                    first_error.get_or_insert(error);
                }
            }
        }
        if !removed.is_empty() {
            catalog
                .records
                .retain(|row| !removed.contains(&row.record_id));
            self.save_catalog(&catalog)?;
        }
        match first_error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    /// Remove one record file, only when its own header proves this app wrote
    /// it. A truncated app-owned file is removed too; a foreign file, link or
    /// folder that took the name is always left untouched.
    fn remove_owned_record(&self, id: Uuid) -> Result<(), String> {
        let path = self.record_path(id);
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(_) => return Err("recovery.io".to_string()),
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Ok(());
        }
        let mut file = match std::fs::File::open(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(_) => return Err("recovery.io".to_string()),
        };
        let mut header = [0u8; ENVELOPE_HEADER_LEN];
        let mut read = 0usize;
        while read < header.len() {
            match file.read(&mut header[read..]) {
                Ok(0) => break,
                Ok(count) => read += count,
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => return Err("recovery.io".to_string()),
            }
        }
        if read < 7 || &header[..7] != ENVELOPE_MAGIC {
            // A foreign file took the name: never delete it.
            return Ok(());
        }
        let owned = if read < ENVELOPE_HEADER_LEN {
            // A partial record this app wrote but never finished.
            true
        } else {
            Uuid::from_slice(&header[11..27])
                .map(|found| found == id)
                .unwrap_or(false)
        };
        if !owned {
            return Ok(());
        }
        drop(file);
        std::fs::remove_file(&path).map_err(|_| "recovery.io".to_string())
    }

    /// Retention: only records verified clean may disappear, and only after
    /// a week with no active use. Dirty pending decisions are always kept.
    pub fn cleanup(&self, now: u64, active: &HashSet<Uuid>) -> Result<(), String> {
        // A killed save can leave an app-owned staging file. Remove only the
        // names this store creates, through the owned-I/O guard, before any
        // new operation starts.
        let _ = fs_service::owned_io::dispose_orphaned_staging(&self.root.join("recovery"));
        let mut catalog = self.load_catalog()?;
        let expired: Vec<Uuid> = catalog
            .records
            .iter()
            .filter(|row| {
                row.state == RecoveryRecordState::Clean
                    && !active.contains(&row.record_id)
                    && now.saturating_sub(row.retention_unix()) > CLEAN_RETENTION_SECONDS
            })
            .map(|row| row.record_id)
            .collect();
        if expired.is_empty() {
            return Ok(());
        }
        // Remove the files this pass can remove, then stop listing exactly
        // those. A failure keeps its row so a later cleanup retries it.
        let mut removed = Vec::new();
        let mut first_error = None;
        for id in expired {
            match self.remove_owned_record(id) {
                Ok(()) => removed.push(id),
                Err(error) => {
                    first_error.get_or_insert(error);
                }
            }
        }
        if !removed.is_empty() {
            catalog
                .records
                .retain(|row| !removed.contains(&row.record_id));
            self.save_catalog(&catalog)?;
        }
        match first_error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    /// A verified save of the same content marks its recovery record clean.
    /// The authenticated capture time is never rewritten; retention starts
    /// from `clean_unix`. A corrupt or unsupported record is never promoted.
    pub fn mark_clean(&self, document_id: Uuid, content_id: Uuid, now: u64) -> Result<(), String> {
        if document_id.is_nil() || content_id.is_nil() || now > MAX_SAFE_INTEGER {
            return Err("recovery.invalid".to_string());
        }
        let mut catalog = self.load_catalog()?;
        let mut changed = false;
        for row in &mut catalog.records {
            if row.document_id == document_id
                && row.content_id == content_id
                && matches!(
                    row.state,
                    RecoveryRecordState::Pending
                        | RecoveryRecordState::Available
                        | RecoveryRecordState::Clean
                )
                && (row.state != RecoveryRecordState::Clean
                    || row.clean_unix != Some(now)
                    || row.error_code.is_some())
            {
                row.state = RecoveryRecordState::Clean;
                row.error_code = None;
                row.clean_unix = Some(now);
                changed = true;
            }
        }
        if changed {
            self.save_catalog(&catalog)?;
        }
        Ok(())
    }

    /// The newest readable record for an original path, used only by the
    /// legacy compatibility facade. Only metadata is read; a record verified
    /// clean is the saved content and is not offered as an old draft.
    pub fn find_by_path(
        &self,
        path: &str,
    ) -> Result<Option<RecoveryCatalogRecord>, String> {
        crate::validate_absolute_path(path).map_err(|_| "recovery.invalid".to_string())?;
        let wanted = fs_service::path_key_of(Path::new(path))
            .map_err(|_| "recovery.invalid".to_string())?;
        let catalog = self.load_catalog()?;
        let mut rows: Vec<RecoveryCatalogRecord> = catalog.records;
        rows.sort_by(|left, right| {
            right
                .captured_unix
                .cmp(&left.captured_unix)
                .then(left.record_id.cmp(&right.record_id))
        });
        for row in rows {
            if matches!(
                row.state,
                RecoveryRecordState::Corrupt | RecoveryRecordState::Unsupported
            ) {
                continue;
            }
            let Ok(authenticated) = self.authenticated_for_listing(&row) else {
                continue;
            };
            let Some(found) = authenticated.original_path else {
                continue;
            };
            let Ok(found_key) = fs_service::path_key_of(Path::new(&found)) else {
                continue;
            };
            if found_key != wanted {
                continue;
            }
            // The newest matching record may already be the saved content;
            // never offer an older revision in its place.
            if row.state == RecoveryRecordState::Clean {
                return Ok(None);
            }
            return Ok(Some(row));
        }
        Ok(None)
    }

    /// Explicit import of old Step 06a plaintext drafts. A valid draft is
    /// encrypted as a new record first; only after that succeeds is the old
    /// app-owned file renamed to `*.migrated`. Corrupt or foreign files stay
    /// exactly where they are.
    pub fn import_legacy_drafts(&self, now: u64) -> Result<LegacyImportReport, String> {
        let mut report = LegacyImportReport::default();
        let Ok(entries) = std::fs::read_dir(&self.root) else {
            return Ok(report);
        };
        for entry in entries.flatten().take(MAX_DIRECTORY_SCAN) {
            let file_name = entry.file_name().to_string_lossy().into_owned();
            if !is_legacy_draft_name(&file_name) {
                continue;
            }
            let path = entry.path();
            let Ok(metadata) = std::fs::symlink_metadata(&path) else {
                report.skipped += 1;
                continue;
            };
            if metadata.file_type().is_symlink()
                || !metadata.is_file()
                || metadata.len() > MAX_LEGACY_DRAFT_FILE_BYTES
            {
                report.skipped += 1;
                continue;
            }
            let Ok(bytes) = std::fs::read(&path) else {
                report.skipped += 1;
                continue;
            };
            let Ok(draft) = serde_json::from_slice::<fs_service::Draft>(&bytes) else {
                report.skipped += 1;
                continue;
            };
            if crate::validate_absolute_path(&draft.path).is_err()
                || draft.text.len() as u64 > fs_service::MAX_DRAFT_BYTES
            {
                report.skipped += 1;
                continue;
            }
            let Some(name) = Path::new(&draft.path)
                .file_name()
                .and_then(|name| name.to_str())
            else {
                report.skipped += 1;
                continue;
            };
            // Only the exact old writer's file for this path is app-owned:
            // the 16 lower-case hex digits are `draft_key(draft.path)`. A
            // renamed, foreign or newer-schema file stays where it is.
            if draft.schema_version != fs_service::DRAFTS_SCHEMA
                || file_name[..16] != fs_service::draft_key(&draft.path)
            {
                report.skipped += 1;
                continue;
            }
            let Ok(source) = disk_source(&draft.path) else {
                report.skipped += 1;
                continue;
            };
            let metadata = RecoveryMetadata {
                version: RECOVERY_VERSION,
                record_id: Uuid::new_v4(),
                document_id: Uuid::new_v4(),
                source,
                source_stamp: None,
                name: name.to_string(),
                mime: "text/plain".to_string(),
                handler_id: "text".to_string(),
                captured_revision: 1,
                content_id: Uuid::new_v4(),
                captured_unix: if draft.saved_unix == 0 { now } else { draft.saved_unix },
                byte_len: draft.text.len() as u64,
                from_internet: false,
                sensitive: false,
            };
            match self.save(&metadata, draft.text.as_bytes(), now) {
                Ok(saved) => {
                    // Keep the bytes as evidence; a new name marks migration.
                    // The move never replaces an existing migrated file.
                    let Some(migrated) = self.migration_target(&file_name) else {
                        let _ = self.discard(&[saved.record_id]);
                        report.skipped += 1;
                        continue;
                    };
                    if fs_service::move_without_replacing(&path, &migrated).is_ok() {
                        report.imported += 1;
                    } else {
                        // Do not leave two copies when the old file could not
                        // be marked; discard only the record we just made.
                        let _ = self.discard(&[saved.record_id]);
                        report.skipped += 1;
                    }
                }
                Err(_) => report.skipped += 1,
            }
        }
        Ok(report)
    }

    /// The first free `.migrated` name for one old draft. A name is chosen
    /// only after checking that nothing, including a link, holds it.
    fn migration_target(&self, file_name: &str) -> Option<PathBuf> {
        for suffix in 0..8 {
            let candidate = if suffix == 0 {
                self.root.join(format!("{file_name}.migrated"))
            } else {
                self.root.join(format!("{file_name}.migrated.{suffix}"))
            };
            if std::fs::symlink_metadata(&candidate).is_err() {
                return Some(candidate);
            }
        }
        None
    }

    /// Count old plaintext drafts by their names only; their content is not
    /// read and no file is changed.
    pub fn legacy_draft_count(&self) -> usize {
        let Ok(entries) = std::fs::read_dir(&self.root) else {
            return 0;
        };
        entries
            .flatten()
            .take(MAX_DIRECTORY_SCAN)
            .filter(|entry| {
                let name = entry.file_name().to_string_lossy().into_owned();
                is_legacy_draft_name(&name)
                    && entry.file_type().is_ok_and(|kind| kind.is_file())
            })
            .count()
    }
}

// ---------------------------------------------------------------------------
// Bounded helpers
// ---------------------------------------------------------------------------

/// A pretty-printed old draft is larger than its 32 MiB of text. One that
/// exceeds the record file cap is skipped instead of being read.
const MAX_LEGACY_DRAFT_FILE_BYTES: u64 = MAX_RECORD_BYTES + 65_536;

fn is_legacy_draft_name(name: &str) -> bool {
    name.len() == 21
        && name.ends_with(".json")
        && name[..16]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// The largest record file this build writes: header plus both protected
/// blobs at their caps. The content cap includes the 96-byte prefix.
fn max_record_file_bytes() -> u64 {
    (ENVELOPE_HEADER_LEN as u64)
        .saturating_add(MAX_METADATA_BYTES as u64)
        .saturating_add(DPAPI_OVERHEAD)
        .saturating_add(MAX_RECORD_BYTES)
        .saturating_add(CONTENT_PREFIX_LEN as u64)
        .saturating_add(DPAPI_OVERHEAD)
}

/// A truncated record is corrupt evidence; a real I/O error leaves the row
/// state untouched so a later attempt can still read it.
fn read_error_code(error: &std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::UnexpectedEof {
        "recovery.corrupt".to_string()
    } else {
        "recovery.io".to_string()
    }
}

/// The catalog is opaque, but every row still has to fit the fixed bounds.
/// Duplicate ids, nil identities, unsafe JavaScript numbers and oversize
/// records are refused as one corrupt catalog.
fn catalog_is_bounded(catalog: &RecoveryCatalog) -> bool {
    if catalog.schema_version != CATALOG_VERSION || catalog.records.len() > MAX_RECORDS {
        return false;
    }
    let mut ids = HashSet::with_capacity(catalog.records.len());
    catalog.records.iter().all(|row| {
        !row.record_id.is_nil()
            && !row.document_id.is_nil()
            && !row.content_id.is_nil()
            && row.revision > 0
            && row.revision <= MAX_SAFE_INTEGER
            && row.captured_unix <= MAX_SAFE_INTEGER
            && row.byte_len <= MAX_RECORD_BYTES
            && match row.clean_unix {
                Some(at) => at <= MAX_SAFE_INTEGER,
                None => true,
            }
            && match row.error_code.as_deref() {
                Some(code) => code.len() <= 64 && code.starts_with("recovery."),
                None => true,
            }
            && ids.insert(row.record_id)
    })
}

fn metadata_from_authenticated(authenticated: &AuthenticatedMetadata) -> RecoveryMetadata {
    RecoveryMetadata {
        version: authenticated.version,
        record_id: authenticated.record_id,
        document_id: authenticated.document_id,
        source: authenticated.source.clone(),
        source_stamp: authenticated.source_stamp.clone(),
        name: authenticated.name.clone(),
        mime: authenticated.mime.clone(),
        handler_id: authenticated.handler_id.clone(),
        captured_revision: authenticated.revision,
        content_id: authenticated.content_id,
        captured_unix: authenticated.captured_unix,
        byte_len: authenticated.encoded_len,
        from_internet: authenticated.from_internet,
        sensitive: false,
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Every snapshot field the caller repeats must match the immutable lease:
/// document, revision, content identity, MIME, length, source stamp and an
/// ordinary (never sensitive) policy.
fn check_snapshot_identity(
    snapshot: &ExportSnapshot,
    metadata: &RecoveryMetadata,
) -> Result<(), String> {
    if snapshot.storage_policy != StoragePolicy::Ordinary {
        return Err("recovery.locked".to_string());
    }
    let document_id =
        Uuid::parse_str(&snapshot.document_id).map_err(|_| "recovery.changed".to_string())?;
    if document_id != metadata.document_id
        || snapshot.revision != metadata.captured_revision
        || snapshot.content_id != metadata.content_id
        || snapshot.mime != metadata.mime
        || snapshot.byte_len != metadata.byte_len
        || snapshot.source != metadata.source_stamp
    {
        return Err("recovery.changed".to_string());
    }
    if snapshot.byte_len > MAX_RECORD_BYTES {
        return Err("recovery.too_large".to_string());
    }
    if let Some(stamp) = &snapshot.source {
        // A source stamp belongs to one normalized path, never to a display
        // name or another file.
        let path = source_path(&metadata.source)
            .ok_or_else(|| "recovery.changed".to_string())?;
        let key = fs_service::path_key_of(Path::new(&path))
            .map_err(|_| "recovery.changed".to_string())?;
        if key != stamp.path_key {
            return Err("recovery.changed".to_string());
        }
    }
    Ok(())
}

/// A live native document must still have the same source and internet mark
/// as the metadata. Provider documents have no DocumentStore entry and skip
/// this check; their snapshot identity was already verified above.
fn check_live_document(
    entry: &crate::documents::NativeDocumentEntry,
    metadata: &RecoveryMetadata,
) -> Result<(), String> {
    if entry.info.sensitive {
        return Err("recovery.locked".to_string());
    }
    if entry.info.source != metadata.source
        || entry.info.name != metadata.name
        || entry.info.from_internet != metadata.from_internet
    {
        return Err("recovery.changed".to_string());
    }
    Ok(())
}

/// The snapshot bytes for one record, read from the same immutable lease the
/// editor captured, then compared with the captured SHA-256. Sensitive
/// memory and a sensitive policy are refused before a byte is copied.
fn leased_bytes(
    lease: &crate::export_snapshots::SnapshotLease,
    metadata: &RecoveryMetadata,
) -> Result<Zeroizing<Vec<u8>>, String> {
    if lease.snapshot.storage_policy != StoragePolicy::Ordinary {
        return Err("recovery.locked".to_string());
    }
    if lease.snapshot.byte_len != metadata.byte_len
        || lease.backing.length() != metadata.byte_len
    {
        return Err("recovery.changed".to_string());
    }
    match lease.backing.as_ref() {
        crate::file_grant_backing::GrantedBacking::Memory {
            bytes,
            length,
            sensitive,
        } => {
            if *sensitive {
                return Err("recovery.locked".to_string());
            }
            if bytes.len() as u64 != *length || *length != metadata.byte_len {
                return Err("recovery.changed".to_string());
            }
            Ok(Zeroizing::new(bytes.as_slice().to_vec()))
        }
        crate::file_grant_backing::GrantedBacking::Disk { length, .. } => {
            if *length != metadata.byte_len {
                return Err("recovery.changed".to_string());
            }
            let capacity =
                usize::try_from(*length).map_err(|_| "recovery.too_large".to_string())?;
            // Positioned reads: never move or share the backing's cursor.
            let mut buffer = Zeroizing::new(Vec::with_capacity(capacity));
            let mut offset = 0u64;
            while offset < *length {
                let take = (*length - offset)
                    .min(crate::file_grant_backing::MAX_BACKING_CHUNK as u64)
                    as usize;
                let chunk = Zeroizing::new(
                    lease
                        .backing
                        .read_range(offset, take)
                        .map_err(|_| "recovery.changed".to_string())?,
                );
                if chunk.len() != take {
                    return Err("recovery.changed".to_string());
                }
                buffer.extend_from_slice(chunk.as_slice());
                offset += take as u64;
            }
            Ok(buffer)
        }
    }
}

/// Retention passes run at boot and then once a day: the interval is fixed
/// and the pass only removes clean records older than the seven-day window.
const CLEANUP_INTERVAL: std::time::Duration = std::time::Duration::from_secs(24 * 60 * 60);

/// Boot-time retention plus a bounded daily pass. The first pass runs on the
/// caller's thread, before any window or grant can exist, so no listed record
/// can be in use; later passes take the same locks as a save or a second
/// instance. Failures are silent: a later pass retries, and nothing here may
/// ever block startup or a save.
pub fn start_cleanup(data_dir: PathBuf) {
    let root = data_dir.join(RECOVERY_DIR);
    cleanup_once(&root);
    std::thread::spawn(move || loop {
        std::thread::sleep(CLEANUP_INTERVAL);
        cleanup_once(&root);
    });
}

fn cleanup_once(root: &Path) {
    let Ok(_store_guard) = lock_store() else {
        return;
    };
    let Ok(_process_guard) = take_store_lock(root) else {
        return;
    };
    let _ = RecoveryStore::new(root.to_path_buf()).cleanup(crate::unix_now(), &HashSet::new());
}

/// Read the lease bytes and require the exact captured SHA-256. This is the
/// final identity check before the encrypted record is written.
fn lease_bytes(
    lease: &crate::export_snapshots::SnapshotLease,
    metadata: &RecoveryMetadata,
) -> Result<Zeroizing<Vec<u8>>, String> {
    let bytes = leased_bytes(lease, metadata)?;
    if sha256_hex(bytes.as_slice()) != lease.content_sha256 {
        return Err("recovery.changed".to_string());
    }
    Ok(bytes)
}

#[tauri::command]
pub fn recovery_save_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    app: AppHandle,
    safe: State<'_, crate::safe_mode::SafeMode>,
    request_id: String,
    snapshot_id: String,
    metadata: RecoveryMetadata,
) -> Result<(), String> {
    ensure_main(window.label())?;
    safe.state_writable()?;
    crate::valid_request_id(&request_id)?;
    if Uuid::parse_str(&snapshot_id).is_err() {
        return Err("recovery.invalid".to_string());
    }
    validate_metadata(&metadata)?;
    let root = app.state::<AppState>().data_dir.join(RECOVERY_DIR);
    let max_mib = app
        .state::<AppState>()
        .settings
        .lock()
        .map(|settings| settings.recovery.max_mib)
        .unwrap_or(1024);
    let snapshots = app
        .try_state::<Arc<crate::export_snapshots::ExportSnapshots>>()
        .ok_or_else(|| "recovery.unsupported".to_string())?
        .inner()
        .clone();
    let document_store = app
        .try_state::<Arc<crate::documents::DocumentStore>>()
        .map(|state| state.inner().clone());
    let token = jobs.begin(&request_id, 1)?;
    let document_id = metadata.document_id.to_string();
    spawn_job(app.clone(), request_id, token, move |_context: &JobContext| {
        let _store_guard = lock_store()?;
        let _process_guard = take_store_lock(&root)?;
        let content_id = metadata.content_id.to_string();
        let lease = snapshots
            .resolve_exact(
                &snapshot_id,
                &document_id,
                metadata.captured_revision,
                &content_id,
            )
            .map_err(|_| "recovery.changed".to_string())?;
        check_snapshot_identity(&lease.snapshot, &metadata)?;
        if let Some(store) = document_store.as_ref() {
            match store.entry(metadata.document_id) {
                Ok(entry) => check_live_document(&entry, &metadata)?,
                // A provider or compatibility authority has no native
                // document entry; the snapshot identity is the binding.
                Err(crate::document_types::DocumentError::ProviderMissing) => {}
                Err(_) => return Err("recovery.io".to_string()),
            }
        }
        let bytes = lease_bytes(&lease, &metadata)?;
        let store = RecoveryStore::with_budget(root, u64::from(max_mib) * 1_048_576);
        let now = crate::unix_now();
        let saved = store.save(&metadata, &bytes, now)?;
        serde_json::to_value(saved).map_err(|_| "recovery.io".to_string())
    });
    Ok(())
}

#[tauri::command]
pub async fn recovery_list(
    window: WebviewWindow,
    state: State<'_, AppState>,
    health: State<'_, crate::startup_health::StartupHealth>,
    safe: State<'_, crate::safe_mode::SafeMode>,
    cursor: Option<String>,
) -> Result<RecoveryListPage, String> {
    ensure_main(window.label())?;
    let cursor = match cursor {
        Some(text) => Some(Uuid::parse_str(&text).map_err(|_| "recovery.invalid".to_string())?),
        None => None,
    };
    let root = state.data_dir.join(RECOVERY_DIR);
    let unclean_exit = health.had_unclean_exit();
    let safe_mode = safe.status().active;
    tauri::async_runtime::spawn_blocking(move || {
        let _store_guard = lock_store()?;
        let _process_guard = take_store_lock(&root)?;
        RecoveryStore::new(root).list(cursor, unclean_exit, safe_mode)
    })
    .await
    .map_err(|_| "recovery.io".to_string())?
}

/// Number of old plaintext drafts, detected by file name only.
#[tauri::command]
pub async fn recovery_legacy_count(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    ensure_main(window.label())?;
    let root = state.data_dir.join(RECOVERY_DIR);
    tauri::async_runtime::spawn_blocking(move || {
        let _store_guard = lock_store()?;
        let _process_guard = take_store_lock(&root)?;
        Ok::<usize, String>(RecoveryStore::new(root).legacy_draft_count())
    })
    .await
    .map_err(|_| "recovery.io".to_string())?
}

/// Explicit user choice to encrypt old plaintext drafts. Run as a shared job;
/// a corrupt/foreign old file is counted as skipped and left in place.
#[tauri::command]
pub fn recovery_legacy_import_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    app: AppHandle,
    safe: State<'_, crate::safe_mode::SafeMode>,
    request_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    safe.state_writable()?;
    crate::valid_request_id(&request_id)?;
    let root = app.state::<AppState>().data_dir.join(RECOVERY_DIR);
    let max_mib = app
        .state::<AppState>()
        .settings
        .lock()
        .map(|settings| settings.recovery.max_mib)
        .unwrap_or(1024);
    let token = jobs.begin(&request_id, 1)?;
    spawn_job(app.clone(), request_id, token, move |_context: &JobContext| {
        let _store_guard = lock_store()?;
        let _process_guard = take_store_lock(&root)?;
        let store = RecoveryStore::with_budget(root, u64::from(max_mib) * 1_048_576);
        let report = store.import_legacy_drafts(crate::unix_now())?;
        serde_json::to_value(report).map_err(|_| "recovery.io".to_string())
    });
    Ok(())
}

#[tauri::command]
pub async fn recovery_discard(
    window: WebviewWindow,
    state: State<'_, AppState>,
    safe: State<'_, crate::safe_mode::SafeMode>,
    ids: Vec<String>,
) -> Result<(), String> {
    ensure_main(window.label())?;
    safe.state_writable()?;
    if ids.len() > MAX_DISCARD_IDS {
        return Err("recovery.invalid".to_string());
    }
    let parsed = ids
        .iter()
        .map(|id| Uuid::parse_str(id).map_err(|_| "recovery.invalid".to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    let root = state.data_dir.join(RECOVERY_DIR);
    tauri::async_runtime::spawn_blocking(move || {
        let _store_guard = lock_store()?;
        let _process_guard = take_store_lock(&root)?;
        RecoveryStore::new(root).discard(&parsed)
    })
    .await
    .map_err(|_| "recovery.io".to_string())?
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct LegacyImportReport {
    pub imported: u32,
    pub skipped: u32,
}

/// Compatibility metadata for one old draft path. The bytes travel through
/// an authorized `adpfile` memory grant, never as JSON file bytes.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LegacyDraftRead {
    pub record_id: Uuid,
    pub token: String,
    pub name: String,
    pub saved_unix: u64,
    pub file_modified_unix: u64,
}

#[tauri::command]
pub async fn recovery_legacy_read(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<Option<LegacyDraftRead>, String> {
    ensure_main(window.label())?;
    crate::validate_absolute_path(&path).map_err(|_| "recovery.invalid".to_string())?;
    let root = state.data_dir.join(RECOVERY_DIR);
    let lookup_path = path.clone();
    let found = tauri::async_runtime::spawn_blocking(move || {
        let _store_guard = lock_store()?;
        let _process_guard = take_store_lock(&root)?;
        let store = RecoveryStore::new(root);
        let Some(record) = store.find_by_path(&lookup_path)? else {
            return Ok::<Option<(Uuid, RecoveryMetadata, Zeroizing<Vec<u8>>)>, String>(None);
        };
        // The compatibility facade only ever served text drafts; refuse
        // before decrypting a larger record that happens to share the path.
        if record.byte_len > fs_service::MAX_DRAFT_BYTES {
            return Err("recovery.too_large".to_string());
        }
        let (metadata, content) = store.read(record.record_id)?;
        Ok(Some((record.record_id, metadata, content)))
    })
    .await
    .map_err(|_| "recovery.io".to_string())??;
    let Some((id, metadata, content)) = found else {
        return Ok(None);
    };
    if metadata.byte_len > fs_service::MAX_DRAFT_BYTES {
        return Err("recovery.too_large".to_string());
    }
    let grants = app
        .try_state::<Arc<crate::files::FileGrants>>()
        .ok_or_else(|| "recovery.unsupported".to_string())?;
    let backing = Arc::new(crate::file_grant_backing::GrantedBacking::Memory {
        bytes: Arc::new(content),
        length: metadata.byte_len,
        sensitive: false,
    });
    let token = grants.grant_backing(backing)?;
    Ok(Some(LegacyDraftRead {
        record_id: id,
        token,
        name: metadata.name,
        saved_unix: metadata.captured_unix,
        file_modified_unix: metadata.captured_unix,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recovery_types::{MAX_RECORD_BYTES, MAX_TOTAL_BYTES};
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct FakeProtector {
        calls: AtomicUsize,
        fail: bool,
    }

    impl FakeProtector {
        fn working() -> Arc<Self> {
            Arc::new(Self {
                calls: AtomicUsize::new(0),
                fail: false,
            })
        }

        fn failing() -> Arc<Self> {
            Arc::new(Self {
                calls: AtomicUsize::new(0),
                fail: true,
            })
        }
    }

    impl RecordProtector for FakeProtector {
        fn protect(&self, plain: &[u8]) -> Result<Vec<u8>, String> {
            self.calls.fetch_add(1, Ordering::Relaxed);
            if self.fail {
                return Err("recovery.io".to_string());
            }
            let mut out = b"TESTPROTECT".to_vec();
            out.extend_from_slice(plain);
            Ok(out)
        }

        fn unprotect(&self, cipher: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
            if !cipher.starts_with(b"TESTPROTECT") {
                return Err("recovery.corrupt".to_string());
            }
            Ok(Zeroizing::new(cipher[11..].to_vec()))
        }
    }

    fn metadata(name: &str, content: &[u8]) -> RecoveryMetadata {
        RecoveryMetadata {
            version: 1,
            record_id: Uuid::new_v4(),
            document_id: Uuid::new_v4(),
            source: disk_source("C:\\Work\\notes.txt").unwrap(),
            source_stamp: None,
            name: name.to_string(),
            mime: "text/plain".to_string(),
            handler_id: "text".to_string(),
            captured_revision: 4,
            content_id: Uuid::new_v4(),
            captured_unix: 1_700_000_000,
            byte_len: content.len() as u64,
            from_internet: false,
            sensitive: false,
        }
    }

    fn store(dir: &Path) -> (RecoveryStore, Arc<FakeProtector>) {
        let protector = FakeProtector::working();
        (
            RecoveryStore::with_protector(dir.join(RECOVERY_DIR), protector.clone()),
            protector,
        )
    }

    #[test]
    fn saves_lists_and_opens_one_record() {
        let folder = tempfile::tempdir().unwrap();
        let (store, _) = store(folder.path());
        let metadata = metadata("notes.txt", b"first revision");
        let saved = store.save(&metadata, b"first revision", metadata.captured_unix).unwrap();
        assert_eq!(saved.record_id, metadata.record_id);

        let page = store.list(None, true, false).unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].name, "notes.txt");
        assert_eq!(page.items[0].status, RecoveryStatus::Available);
        assert!(page.complete);
        assert!(page.unclean_exit);

        let (read, content) = store.read(metadata.record_id).unwrap();
        assert_eq!(read.content_id, metadata.content_id);
        assert_eq!(&*content, b"first revision");
    }

    #[test]
    fn a_truncated_or_rehashed_record_is_corrupt_and_kept() {
        let folder = tempfile::tempdir().unwrap();
        let (store, _) = store(folder.path());
        let metadata = metadata("notes.txt", b"first revision");
        store.save(&metadata, b"first revision", metadata.captured_unix).unwrap();
        let path = store.record_path(metadata.record_id);
        let mut bytes = std::fs::read(&path).unwrap();
        bytes.pop();
        std::fs::write(&path, &bytes).unwrap();

        let page = store.list(None, false, false).unwrap();
        assert_eq!(page.items[0].status, RecoveryStatus::Corrupt);
        assert_eq!(page.items[0].error_code.as_deref(), Some("recovery.corrupt"));
        assert!(path.exists());
        assert_eq!(
            store.read(metadata.record_id).unwrap_err(),
            "recovery.corrupt"
        );
    }

    #[test]
    fn more_than_sixty_four_mebibytes_never_reaches_the_protector() {
        let folder = tempfile::tempdir().unwrap();
        let (store, protector) = store(folder.path());
        let content = vec![0u8; MAX_RECORD_BYTES as usize + 1];
        let mut metadata = metadata("huge.bin", &[]);
        metadata.byte_len = content.len() as u64;
        assert_eq!(
            store.save(&metadata, &content, metadata.captured_unix).unwrap_err(),
            "recovery.too_large"
        );
        assert_eq!(protector.calls.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn a_catalog_is_never_published_before_its_data() {
        let folder = tempfile::tempdir().unwrap();
        let (store, _) = store(folder.path());
        std::fs::create_dir_all(store.root()).unwrap();
        // A directory where the catalog file belongs makes loading fail, so
        // no record and no row can be published.
        std::fs::create_dir(store.catalog_path()).unwrap();
        let metadata = metadata("notes.txt", b"data");
        assert!(store.save(&metadata, b"data", metadata.captured_unix).is_err());
        assert!(store.catalog_path().is_dir());
        assert!(store.list(None, false, false).is_err());
    }

    #[test]
    fn a_protection_failure_leaves_no_plaintext_or_catalog_row() {
        let folder = tempfile::tempdir().unwrap();
        let protector = FakeProtector::failing();
        let store = RecoveryStore::with_protector(folder.path().join(RECOVERY_DIR), protector);
        let metadata = metadata("notes.txt", b"secret words");
        assert_eq!(
            store.save(&metadata, b"secret words", metadata.captured_unix).unwrap_err(),
            "recovery.io"
        );
        let mut found = Vec::new();
        if let Ok(entries) = std::fs::read_dir(store.root()) {
            for entry in entries.flatten() {
                found.push(std::fs::read(entry.path()).unwrap_or_default());
            }
        }
        assert!(found.iter().all(|bytes| !bytes.windows(12).any(|part| part == b"secret words")));
        assert!(!store.catalog_path().exists());
    }

    #[test]
    fn discard_removes_the_record_and_keeps_the_original() {
        let folder = tempfile::tempdir().unwrap();
        let (store, _) = store(folder.path());
        let original = folder.path().join("notes.txt");
        std::fs::write(&original, "original bytes").unwrap();
        let metadata = metadata("notes.txt", b"edited bytes");
        store.save(&metadata, b"edited bytes", metadata.captured_unix).unwrap();
        store.discard(&[metadata.record_id]).unwrap();
        assert_eq!(std::fs::read_to_string(&original).unwrap(), "original bytes");
        assert!(!store.record_path(metadata.record_id).exists());
        assert!(store.list(None, false, false).unwrap().items.is_empty());
    }

    #[test]
    fn discard_refuses_an_unknown_id_without_removing_another() {
        let folder = tempfile::tempdir().unwrap();
        let (store, _) = store(folder.path());
        let metadata = metadata("notes.txt", b"edited bytes");
        store.save(&metadata, b"edited bytes", metadata.captured_unix).unwrap();
        assert_eq!(
            store
                .discard(&[metadata.record_id, Uuid::new_v4()])
                .unwrap_err(),
            "recovery.invalid"
        );
        assert!(store.record_path(metadata.record_id).exists());
        assert_eq!(store.list(None, false, false).unwrap().items.len(), 1);
        // A duplicate of the same existing id is one deletion, not an error.
        store
            .discard(&[metadata.record_id, metadata.record_id])
            .unwrap();
        assert!(store.list(None, false, false).unwrap().items.is_empty());
    }

    #[test]
    fn a_corrupt_record_is_never_marked_clean_or_expired() {
        let folder = tempfile::tempdir().unwrap();
        let (store, _) = store(folder.path());
        let metadata = metadata("notes.txt", b"edited bytes");
        store.save(&metadata, b"edited bytes", 1_000).unwrap();
        let path = store.record_path(metadata.record_id);
        let mut bytes = std::fs::read(&path).unwrap();
        bytes[ENVELOPE_HEADER_LEN] ^= 0xFF;
        std::fs::write(&path, &bytes).unwrap();
        assert_eq!(store.read(metadata.record_id).unwrap_err(), "recovery.corrupt");

        store
            .mark_clean(metadata.document_id, metadata.content_id, 2_000)
            .unwrap();
        store
            .cleanup(2_000 + CLEAN_RETENTION_SECONDS + 1, &HashSet::new())
            .unwrap();
        assert!(path.exists());
        assert_eq!(
            store.list(None, false, false).unwrap().items[0].status,
            RecoveryStatus::Corrupt
        );
    }

    #[test]
    fn reusing_a_record_id_is_refused_before_a_second_record_exists() {
        let folder = tempfile::tempdir().unwrap();
        let (store, _) = store(folder.path());
        let metadata = metadata("notes.txt", b"first");
        store.save(&metadata, b"first", metadata.captured_unix).unwrap();
        assert_eq!(
            store.save(&metadata, b"first", metadata.captured_unix).unwrap_err(),
            "recovery.changed"
        );
        assert_eq!(store.list(None, false, false).unwrap().items.len(), 1);
    }

    #[test]
    fn cleanup_keeps_dirty_records_and_removes_old_clean_ones() {
        let folder = tempfile::tempdir().unwrap();
        let (store, _) = store(folder.path());
        let mut metadata = metadata("notes.txt", b"data");
        metadata.captured_unix = 1_000;
        store.save(&metadata, b"data", 1_000).unwrap();
        store.cleanup(1_000 + CLEAN_RETENTION_SECONDS + 1, &HashSet::new()).unwrap();
        assert_eq!(store.list(None, false, false).unwrap().items.len(), 1);

        store
            .mark_clean(metadata.document_id, metadata.content_id, 2_000)
            .unwrap();
        store.cleanup(2_000 + CLEAN_RETENTION_SECONDS + 1, &HashSet::new()).unwrap();
        assert!(store.list(None, false, false).unwrap().items.is_empty());
        assert!(!store.record_path(metadata.record_id).exists());
    }

    #[test]
    fn the_store_never_exceeds_its_shared_budget() {
        let folder = tempfile::tempdir().unwrap();
        let (store, _) = store(folder.path());
        let mut last = None;
        for index in 0..MAX_RECORDS {
            let content = [0u8; 32];
            let mut metadata = metadata(&format!("{index}.txt"), &content);
            metadata.captured_unix += index as u64;
            last = Some(store.save(&metadata, &content, 1_700_000_000).unwrap());
        }
        assert!(last.is_some());
        let content = [0u8; 32];
        let mut extra = metadata("extra.txt", &content);
        extra.byte_len = MAX_TOTAL_BYTES; // over the per-record cap too
        assert_eq!(
            store.save(&extra, &content, 1_700_000_000).unwrap_err(),
            "recovery.too_large"
        );
    }

    #[test]
    fn an_old_plaintext_draft_is_detected_without_reading_it() {
        let folder = tempfile::tempdir().unwrap();
        let (store, _) = store(folder.path());
        std::fs::create_dir_all(store.root()).unwrap();
        let legacy = store.root().join("0123456789abcdef.json");
        std::fs::write(&legacy, "{\"text\":\"plain\"}").unwrap();
        assert_eq!(store.legacy_draft_count(), 1);
        assert_eq!(std::fs::read_to_string(&legacy).unwrap(), "{\"text\":\"plain\"}");
    }

    #[test]
    fn legacy_import_encrypts_and_marks_but_keeps_the_old_bytes() {
        let folder = tempfile::tempdir().unwrap();
        let (store, _) = store(folder.path());
        std::fs::create_dir_all(store.root()).unwrap();
        let draft = fs_service::Draft {
            schema_version: fs_service::DRAFTS_SCHEMA,
            path: "C:\\Work\\legacy.txt".to_string(),
            text: "old unsaved text".to_string(),
            saved_unix: 1_700_000_000,
            file_modified_unix: 1_699_999_000,
        };
        let file = store
            .root()
            .join(format!("{}.json", fs_service::draft_key(&draft.path)));
        let bytes = serde_json::to_vec(&draft).unwrap();
        std::fs::write(&file, &bytes).unwrap();

        let report = store.import_legacy_drafts(1_700_000_100).unwrap();
        assert_eq!(report, LegacyImportReport { imported: 1, skipped: 0 });
        assert_eq!(store.legacy_draft_count(), 0);
        let migrated = store
            .root()
            .join(format!("{}.json.migrated", fs_service::draft_key(&draft.path)));
        assert_eq!(std::fs::read(&migrated).unwrap(), bytes);
        assert!(!file.exists());
        let page = store.list(None, false, false).unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].source_path.as_deref(), Some("C:\\Work\\legacy.txt"));
    }

    #[test]
    fn a_corrupt_legacy_draft_is_skipped_and_untouched() {
        let folder = tempfile::tempdir().unwrap();
        let (store, _) = store(folder.path());
        std::fs::create_dir_all(store.root()).unwrap();
        let file = store.root().join("0123456789abcdef.json");
        std::fs::write(&file, "{not json").unwrap();
        let report = store.import_legacy_drafts(1_700_000_100).unwrap();
        assert_eq!(report, LegacyImportReport { imported: 0, skipped: 1 });
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "{not json");
    }

    #[test]
    fn a_valid_draft_under_another_key_is_foreign_and_stays() {
        let folder = tempfile::tempdir().unwrap();
        let (store, _) = store(folder.path());
        std::fs::create_dir_all(store.root()).unwrap();
        let draft = fs_service::Draft {
            schema_version: fs_service::DRAFTS_SCHEMA,
            path: "C:\\Work\\legacy.txt".to_string(),
            text: "old unsaved text".to_string(),
            saved_unix: 1_700_000_000,
            file_modified_unix: 1_699_999_000,
        };
        assert_ne!(fs_service::draft_key(&draft.path), "0123456789abcdef");
        let file = store.root().join("0123456789abcdef.json");
        std::fs::write(&file, serde_json::to_vec(&draft).unwrap()).unwrap();

        let report = store.import_legacy_drafts(1_700_000_100).unwrap();
        assert_eq!(report, LegacyImportReport { imported: 0, skipped: 1 });
        assert!(file.exists());
        assert!(store.list(None, false, false).unwrap().items.is_empty());
    }

    #[test]
    fn a_newer_catalog_is_refused_without_writing_it_down() {
        let folder = tempfile::tempdir().unwrap();
        let (store, _) = store(folder.path());
        std::fs::create_dir_all(store.root()).unwrap();
        let text = r#"{"schema_version":99,"records":[]}"#;
        std::fs::write(store.catalog_path(), text).unwrap();
        assert_eq!(
            store.list(None, false, false).unwrap_err(),
            "recovery.unsupported"
        );
        assert_eq!(std::fs::read_to_string(store.catalog_path()).unwrap(), text);
    }

    #[test]
    fn a_failed_catalog_write_keeps_the_unlisted_record() {
        let folder = tempfile::tempdir().unwrap();
        let (store, _) = store(folder.path());
        let metadata = metadata("notes.txt", b"data");
        store.fail_catalog_save_once();
        assert_eq!(
            store.save(&metadata, b"data", metadata.captured_unix).unwrap_err(),
            "recovery.io"
        );
        // The encrypted revision is the only copy of the unsaved edit; it is
        // kept as an unlisted, budget-counted orphan, never rolled back.
        assert!(store.record_path(metadata.record_id).exists());
        assert_eq!(store.owned_record_stats().0, 1);
        assert!(!store.catalog_path().exists());
        assert!(store.list(None, false, false).unwrap().items.is_empty());
    }

    #[test]
    fn unlisted_owned_records_count_toward_the_record_limit() {
        let folder = tempfile::tempdir().unwrap();
        let (store, _) = store(folder.path());
        std::fs::create_dir_all(store.root()).unwrap();
        for _ in 0..MAX_RECORDS {
            let id = Uuid::new_v4();
            std::fs::write(
                store.root().join(record_file_name(id)),
                build_envelope(id, b"metadata", b"content"),
            )
            .unwrap();
        }
        let metadata = metadata("notes.txt", b"data");
        assert_eq!(
            store.save(&metadata, b"data", metadata.captured_unix).unwrap_err(),
            "recovery.too_large"
        );
        assert!(!store.record_path(metadata.record_id).exists());
    }

    #[test]
    fn an_unlisted_owned_record_counts_toward_the_budget() {
        let folder = tempfile::tempdir().unwrap();
        let (mut store, _) = store(folder.path());
        std::fs::create_dir_all(store.root()).unwrap();
        let id = Uuid::new_v4();
        let orphan = store.root().join(record_file_name(id));
        std::fs::write(&orphan, build_envelope(id, b"metadata", b"content")).unwrap();
        store.max_total = 50;

        let metadata = metadata("notes.txt", b"0123456789");
        assert_eq!(
            store
                .save(&metadata, b"0123456789", metadata.captured_unix)
                .unwrap_err(),
            "recovery.too_large"
        );
        assert!(!store.record_path(metadata.record_id).exists());
        assert!(orphan.exists(), "an unlisted record is never deleted");
    }

    #[test]
    fn a_clean_record_keeps_its_capture_time_and_expires_from_its_clean_time() {
        let folder = tempfile::tempdir().unwrap();
        let (store, _) = store(folder.path());
        let mut metadata = metadata("notes.txt", b"data");
        metadata.captured_unix = 1_000;
        store.save(&metadata, b"data", 1_000).unwrap();
        store
            .mark_clean(metadata.document_id, metadata.content_id, 2_000)
            .unwrap();

        let page = store.list(None, false, false).unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].captured_unix, 1_000);
        let (read, content) = store.read(metadata.record_id).unwrap();
        assert_eq!(read.captured_unix, 1_000);
        assert_eq!(&*content, b"data");

        // Exactly seven days after the verified save is still retained.
        store
            .cleanup(2_000 + CLEAN_RETENTION_SECONDS, &HashSet::new())
            .unwrap();
        assert!(store.record_path(metadata.record_id).exists());
        store
            .cleanup(2_000 + CLEAN_RETENTION_SECONDS + 1, &HashSet::new())
            .unwrap();
        assert!(!store.record_path(metadata.record_id).exists());
    }

    #[test]
    fn an_expired_clean_record_makes_room_for_a_new_save() {
        let folder = tempfile::tempdir().unwrap();
        let (store, _) = store(folder.path());
        let old = metadata("notes.txt", b"old");
        store.save(&old, b"old", 1_000).unwrap();
        store
            .mark_clean(old.document_id, old.content_id, 1_000)
            .unwrap();

        let new = metadata("notes.txt", b"new");
        let now = 1_000 + CLEAN_RETENTION_SECONDS + 1;
        store.save(&new, b"new", now).unwrap();
        assert!(!store.record_path(old.record_id).exists());
        assert!(store.record_path(new.record_id).exists());
        let page = store.list(None, false, false).unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].record_id, new.record_id);
    }

    #[test]
    fn a_foreign_file_with_the_record_name_is_never_deleted() {
        let folder = tempfile::tempdir().unwrap();
        let (store, _) = store(folder.path());
        let metadata = metadata("notes.txt", b"data");
        store.save(&metadata, b"data", metadata.captured_unix).unwrap();
        let path = store.record_path(metadata.record_id);
        let foreign = b"not an envelope".to_vec();
        std::fs::write(&path, &foreign).unwrap();

        store.discard(&[metadata.record_id]).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), foreign);
        assert!(store.list(None, false, false).unwrap().items.is_empty());
    }

    #[test]
    fn a_foreign_envelope_with_another_id_is_never_deleted() {
        let folder = tempfile::tempdir().unwrap();
        let (store, _) = store(folder.path());
        let metadata = metadata("notes.txt", b"data");
        store.save(&metadata, b"data", metadata.captured_unix).unwrap();
        let path = store.record_path(metadata.record_id);
        let bytes = build_envelope(Uuid::new_v4(), b"metadata", b"content");
        std::fs::write(&path, &bytes).unwrap();

        store.discard(&[metadata.record_id]).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
    }

    #[test]
    fn an_unsupported_record_is_listed_unsupported_and_kept() {
        let folder = tempfile::tempdir().unwrap();
        let (store, _) = store(folder.path());
        let metadata = metadata("notes.txt", b"data");
        store.save(&metadata, b"data", metadata.captured_unix).unwrap();
        let path = store.record_path(metadata.record_id);
        let mut bytes = std::fs::read(&path).unwrap();
        bytes[7..11].copy_from_slice(&2u32.to_le_bytes());
        std::fs::write(&path, &bytes).unwrap();

        let page = store.list(None, false, false).unwrap();
        assert_eq!(page.items[0].status, RecoveryStatus::Unsupported);
        assert_eq!(
            page.items[0].error_code.as_deref(),
            Some("recovery.unsupported")
        );
        assert_eq!(
            store.read(metadata.record_id).unwrap_err(),
            "recovery.unsupported"
        );
        assert!(path.exists());
        assert_eq!(
            store.list(None, false, false).unwrap().items[0].status,
            RecoveryStatus::Unsupported
        );
    }

    fn catalog_row(revision: u64) -> RecoveryCatalogRecord {
        RecoveryCatalogRecord {
            record_id: Uuid::new_v4(),
            document_id: Uuid::new_v4(),
            content_id: Uuid::new_v4(),
            revision,
            captured_unix: 1,
            byte_len: 1,
            state: RecoveryRecordState::Available,
            error_code: None,
            clean_unix: None,
        }
    }

    #[test]
    fn a_catalog_over_the_record_limit_or_with_duplicates_is_refused() {
        let folder = tempfile::tempdir().unwrap();
        let (store, _) = store(folder.path());
        std::fs::create_dir_all(store.root()).unwrap();

        let mut over = RecoveryCatalog {
            schema_version: CATALOG_VERSION,
            records: (1..=(MAX_RECORDS as u64) + 1).map(catalog_row).collect(),
        };
        let text = serde_json::to_vec(&over).unwrap();
        std::fs::write(store.catalog_path(), &text).unwrap();
        assert_eq!(
            store.list(None, false, false).unwrap_err(),
            "recovery.corrupt"
        );
        assert_eq!(std::fs::read(store.catalog_path()).unwrap(), text);

        let duplicate = catalog_row(1);
        over.records = vec![duplicate.clone(), duplicate];
        let text = serde_json::to_vec(&over).unwrap();
        std::fs::write(store.catalog_path(), &text).unwrap();
        assert_eq!(
            store.list(None, false, false).unwrap_err(),
            "recovery.corrupt"
        );
    }

    fn stamp(path_key: &str) -> fs_service::SourceStamp {
        fs_service::SourceStamp {
            path_key: path_key.to_string(),
            volume_id: "00000000".to_string(),
            file_id: "0000000000000000".to_string(),
            modified_ticks: "1".to_string(),
            size_bytes: 1,
        }
    }

    fn snapshot(metadata: &RecoveryMetadata) -> ExportSnapshot {
        ExportSnapshot {
            snapshot_id: Uuid::new_v4().to_string(),
            document_id: metadata.document_id.to_string(),
            revision: metadata.captured_revision,
            content_id: metadata.content_id,
            mime: metadata.mime.clone(),
            byte_len: metadata.byte_len,
            source: metadata.source_stamp.clone(),
            storage_policy: StoragePolicy::Ordinary,
            expires_unix: 0,
        }
    }

    #[test]
    fn exact_snapshot_identity_is_required() {
        let mut metadata = metadata("notes.txt", b"data");
        metadata.source_stamp = Some(stamp("c:\\work\\notes.txt"));
        let good = snapshot(&metadata);
        check_snapshot_identity(&good, &metadata).unwrap();

        let mut wrong = good.clone();
        wrong.document_id = Uuid::new_v4().to_string();
        assert_eq!(
            check_snapshot_identity(&wrong, &metadata).unwrap_err(),
            "recovery.changed"
        );
        let mut wrong = good.clone();
        wrong.revision += 1;
        assert_eq!(
            check_snapshot_identity(&wrong, &metadata).unwrap_err(),
            "recovery.changed"
        );
        let mut wrong = good.clone();
        wrong.content_id = Uuid::new_v4();
        assert_eq!(
            check_snapshot_identity(&wrong, &metadata).unwrap_err(),
            "recovery.changed"
        );
        let mut wrong = good.clone();
        wrong.mime = "text/html".to_string();
        assert_eq!(
            check_snapshot_identity(&wrong, &metadata).unwrap_err(),
            "recovery.changed"
        );
        let mut wrong = good.clone();
        wrong.byte_len += 1;
        assert_eq!(
            check_snapshot_identity(&wrong, &metadata).unwrap_err(),
            "recovery.changed"
        );
        let mut wrong = good.clone();
        wrong.source = Some(stamp("c:\\work\\other.txt"));
        assert_eq!(
            check_snapshot_identity(&wrong, &metadata).unwrap_err(),
            "recovery.changed"
        );
        let mut wrong = good.clone();
        wrong.source = None;
        assert_eq!(
            check_snapshot_identity(&wrong, &metadata).unwrap_err(),
            "recovery.changed"
        );
        let mut wrong = good;
        wrong.storage_policy = StoragePolicy::Sensitive;
        assert_eq!(
            check_snapshot_identity(&wrong, &metadata).unwrap_err(),
            "recovery.locked"
        );
    }

    fn entry(metadata: &RecoveryMetadata) -> crate::documents::NativeDocumentEntry {
        crate::documents::NativeDocumentEntry {
            info: crate::document_types::DocumentInfo {
                document_id: metadata.document_id.to_string(),
                source: metadata.source.clone(),
                name: metadata.name.clone(),
                ext: "txt".to_string(),
                mime: metadata.mime.clone(),
                size: metadata.byte_len,
                modified_unix: 0,
                read_only: false,
                from_internet: metadata.from_internet,
                sensitive: false,
                disk_path: None,
            },
            token: "a".repeat(32),
            source_generation: 0,
            can_save_existing: false,
        }
    }

    #[test]
    fn a_live_document_must_keep_the_same_source_and_internet_mark() {
        let metadata = metadata("notes.txt", b"data");
        let good = entry(&metadata);
        check_live_document(&good, &metadata).unwrap();

        let mut wrong = entry(&metadata);
        wrong.info.source = disk_source("C:\\Work\\other.txt").unwrap();
        assert_eq!(
            check_live_document(&wrong, &metadata).unwrap_err(),
            "recovery.changed"
        );

        let mut wrong = entry(&metadata);
        wrong.info.name = "other.txt".to_string();
        assert_eq!(
            check_live_document(&wrong, &metadata).unwrap_err(),
            "recovery.changed"
        );

        let mut wrong = entry(&metadata);
        wrong.info.from_internet = true;
        assert_eq!(
            check_live_document(&wrong, &metadata).unwrap_err(),
            "recovery.changed"
        );

        let mut wrong = entry(&metadata);
        wrong.info.sensitive = true;
        assert_eq!(
            check_live_document(&wrong, &metadata).unwrap_err(),
            "recovery.locked"
        );
    }

    struct Hold;
    impl crate::export_snapshots::SnapshotRetention for Hold {}

    fn lease(
        metadata: &RecoveryMetadata,
        content: &[u8],
        sha256: String,
        sensitive: bool,
    ) -> crate::export_snapshots::SnapshotLease {
        crate::export_snapshots::SnapshotLease {
            snapshot: snapshot(metadata),
            backing: Arc::new(crate::file_grant_backing::GrantedBacking::Memory {
                bytes: Arc::new(Zeroizing::new(content.to_vec())),
                length: content.len() as u64,
                sensitive,
            }),
            retention: Arc::new(Hold),
            content_sha256: sha256,
        }
    }

    #[test]
    fn lease_bytes_require_the_captured_hash_and_an_ordinary_snapshot() {
        let metadata = metadata("notes.txt", b"data");
        let good = lease(&metadata, b"data", sha256_hex(b"data"), false);
        assert_eq!(&*lease_bytes(&good, &metadata).unwrap(), b"data");

        let wrong_hash = lease(&metadata, b"data", sha256_hex(b"other"), false);
        assert_eq!(
            lease_bytes(&wrong_hash, &metadata).unwrap_err(),
            "recovery.changed"
        );

        let sensitive = lease(&metadata, b"data", sha256_hex(b"data"), true);
        assert_eq!(
            lease_bytes(&sensitive, &metadata).unwrap_err(),
            "recovery.locked"
        );

        let mut sensitive_policy = lease(&metadata, b"data", sha256_hex(b"data"), false);
        sensitive_policy.snapshot.storage_policy = StoragePolicy::Sensitive;
        assert_eq!(
            lease_bytes(&sensitive_policy, &metadata).unwrap_err(),
            "recovery.locked"
        );

        let mut wrong_len = metadata.clone();
        wrong_len.byte_len += 1;
        assert_eq!(
            lease_bytes(&good, &wrong_len).unwrap_err(),
            "recovery.changed"
        );
    }

    #[test]
    fn an_imported_legacy_record_is_found_by_its_exact_path() {
        let folder = tempfile::tempdir().unwrap();
        let (store, _) = store(folder.path());
        std::fs::create_dir_all(store.root()).unwrap();
        let draft = fs_service::Draft {
            schema_version: fs_service::DRAFTS_SCHEMA,
            path: "C:\\Work\\legacy.txt".to_string(),
            text: "old unsaved text".to_string(),
            saved_unix: 1_700_000_000,
            file_modified_unix: 1_699_999_000,
        };
        let file = store
            .root()
            .join(format!("{}.json", fs_service::draft_key(&draft.path)));
        std::fs::write(&file, serde_json::to_vec(&draft).unwrap()).unwrap();
        store.import_legacy_drafts(1_700_000_100).unwrap();

        assert!(store.find_by_path("C:\\Work\\legacy.txt").unwrap().is_some());
        assert!(store.find_by_path("c:\\work\\LEGACY.txt").unwrap().is_some());
        assert!(store.find_by_path("C:\\Work\\other.txt").unwrap().is_none());
        assert_eq!(
            store.find_by_path("C:\\Work\\..\\legacy.txt").unwrap_err(),
            "recovery.invalid"
        );
    }
}
