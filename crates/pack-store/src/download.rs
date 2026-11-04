//! Owned, resumable pack downloads. A partial is created exclusively under
//! `<packs>/downloads/<UUID>`, resumed only with an identical strong ETag and
//! a validated Range response, and hashed completely before installation.
use crate::download_state::{
    resume_decision, DownloadPaths, DownloadPhase, DownloadRecord, DownloadStateStore, RemoteMeta,
    ResumeDecision,
};
use crate::error::{map_io, PackError, PackResult};
use crate::types::{is_safe_integer, PackId};
use crate::validation::{is_sha256_hex, is_valid_semver};
use fs_service::CancellationToken;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

const CHUNK_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadSpec {
    pub pack_id: PackId,
    pub version: String,
    pub url: String,
    pub expected_bytes: u64,
    pub sha256: String,
}

impl DownloadSpec {
    pub fn validate(&self) -> PackResult<()> {
        if !is_valid_semver(&self.version)
            || !is_safe_integer(self.expected_bytes)
            || self.expected_bytes == 0
            || !is_sha256_hex(&self.sha256)
        {
            return Err(PackError::BadRequest);
        }
        Ok(())
    }
}

pub struct DownloadBody {
    pub reader: Box<dyn Read + Send>,
    pub status: u16,
    pub content_range_start: Option<u64>,
    pub etag: Option<String>,
    pub total_bytes: Option<u64>,
}

/// The network surface used by the download loop. Tests inject a fake; the
/// production implementation is [`HttpDownloadClient`].
pub trait DownloadClient {
    fn meta(&self, url: &str) -> PackResult<RemoteMeta>;
    fn get(&self, url: &str, range: Option<(u64, String)>) -> PackResult<DownloadBody>;
}

#[derive(Clone)]
pub struct DownloadControl {
    pub token: CancellationToken,
    pub pause: Arc<AtomicBool>,
}

impl DownloadControl {
    pub fn new(token: CancellationToken) -> Self {
        Self {
            token,
            pause: Arc::new(AtomicBool::new(false)),
        }
    }

    fn checkpoint(&self) -> PackResult<()> {
        if self.token.load(Ordering::Relaxed) {
            return Err(PackError::Cancelled);
        }
        if self.pause.load(Ordering::Relaxed) {
            return Err(PackError::Busy);
        }
        Ok(())
    }
}

pub struct CompletedDownload {
    pub record: DownloadRecord,
    pub part_path: PathBuf,
}

pub enum DownloadOutcome {
    Paused(DownloadRecord),
    Completed(CompletedDownload),
}

pub struct OwnedDownload {
    paths: DownloadPaths,
    record: DownloadRecord,
    file: Option<File>,
    part_identity: Option<fs_service::owned_io::SourceIdentity>,
}

impl OwnedDownload {
    pub fn create(
        store: &DownloadStateStore,
        spec: &DownloadSpec,
        etag: Option<String>,
        now_unix: u64,
    ) -> PackResult<Self> {
        spec.validate()?;
        store.ensure()?;
        let download_id = uuid::Uuid::new_v4().to_string();
        let paths = store.paths(&download_id)?;
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .open(&paths.part)
            .map_err(|error| map_io(&error))?;
        let owner = OwnerMarker {
            schema_version: 1,
            download_id: download_id.clone(),
        };
        let owner_bytes = serde_json::to_vec(&owner).map_err(|_| PackError::Failed)?;
        let owner_result = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&paths.owner)
            .and_then(|mut owner_file| {
                owner_file.write_all(&owner_bytes)?;
                owner_file.sync_all()
            });
        if let Err(error) = owner_result {
            let _ = std::fs::remove_file(&paths.part);
            return Err(map_io(&error));
        }
        let record = DownloadRecord::new(
            download_id,
            spec.pack_id,
            spec.version.clone(),
            spec.url.clone(),
            spec.expected_bytes,
            spec.sha256.clone(),
            etag,
            now_unix,
        )?;
        if let Err(error) = store.write(&record) {
            let _ = std::fs::remove_file(&paths.part);
            let _ = std::fs::remove_file(&paths.owner);
            return Err(error);
        }
        let identity = fs_service::owned_io::SourceIdentity::capture(&paths.part).ok();
        // The writer starts empty; resuming opens the same file in append mode.
        file.seek(SeekFrom::Start(0))
            .map_err(|error| map_io(&error))?;
        Ok(Self {
            paths,
            record,
            file: Some(file),
            part_identity: identity,
        })
    }

    /// Reopen a paused owned partial after verifying its owner marker and
    /// identity. A replaced path is refused, never appended to.
    pub fn open_paused(store: &DownloadStateStore, record: DownloadRecord) -> PackResult<Self> {
        if record.state != DownloadPhase::Paused {
            return Err(PackError::Changed);
        }
        let paths = store.paths(&record.download_id)?;
        let marker = read_owner(&paths.owner)?;
        if marker.download_id != record.download_id {
            return Err(PackError::Changed);
        }
        let identity = fs_service::owned_io::SourceIdentity::capture(&paths.part)
            .map_err(|_| PackError::Changed)?;
        let length = std::fs::metadata(&paths.part)
            .map_err(|_| PackError::Changed)?
            .len();
        if length != record.bytes_received {
            return Err(PackError::Changed);
        }
        let file = std::fs::OpenOptions::new()
            .read(true)
            .append(true)
            .open(&paths.part)
            .map_err(|error| map_io(&error))?;
        Ok(Self {
            paths,
            record,
            file: Some(file),
            part_identity: Some(identity),
        })
    }

    pub fn record(&self) -> &DownloadRecord {
        &self.record
    }

    pub fn part_path(&self) -> &Path {
        &self.paths.part
    }

    pub fn pause(&mut self, store: &DownloadStateStore, now_unix: u64) -> PackResult<()> {
        if let Some(file) = &mut self.file {
            file.flush().map_err(|error| map_io(&error))?;
            file.sync_all().map_err(|error| map_io(&error))?;
            let length = file.metadata().map_err(|error| map_io(&error))?.len();
            self.record.bytes_received = length;
        }
        self.file.take();
        self.record.state = DownloadPhase::Paused;
        self.record.updated_unix = now_unix;
        store.write(&self.record)
    }

    /// Delete only files this download provably created. A foreign file that
    /// replaced our path is left untouched.
    pub fn cancel(mut self, store: &DownloadStateStore) -> PackResult<bool> {
        self.file.take();
        let owner_matches = read_owner(&self.paths.owner)
            .map(|marker| marker.download_id == self.record.download_id)
            .unwrap_or(false);
        let owned = owner_matches && self.owns_part();
        if owned {
            let _ = std::fs::remove_file(&self.paths.part);
        }
        if owner_matches {
            store.remove_owned(&self.record.download_id)?;
        } else {
            store.remove_record(&self.record.download_id)?;
        }
        Ok(owned)
    }

    fn owns_part(&self) -> bool {
        let marker_ok = read_owner(&self.paths.owner)
            .map(|marker| marker.download_id == self.record.download_id)
            .unwrap_or(false);
        if !marker_ok {
            return false;
        }
        let Some(expected) = self.part_identity else {
            return false;
        };
        fs_service::owned_io::SourceIdentity::capture(&self.paths.part)
            .map(|current| current.volume == expected.volume && current.index == expected.index)
            .unwrap_or(false)
    }

    /// Flush, require the exact length and full SHA-256, and hand the archive
    /// to the installer. On any mismatch only this owned partial is removed.
    pub fn finish(mut self, store: &DownloadStateStore) -> PackResult<CompletedDownload> {
        let Some(mut file) = self.file.take() else {
            return Err(PackError::Busy);
        };
        file.flush().map_err(|error| map_io(&error))?;
        file.sync_all().map_err(|error| map_io(&error))?;
        let length = file.metadata().map_err(|error| map_io(&error))?.len();
        if length != self.record.expected_bytes {
            let owned = self.owns_part();
            if owned {
                let _ = std::fs::remove_file(&self.paths.part);
            }
            self.record.state = DownloadPhase::Failed;
            let _ = store.write(&self.record);
            return Err(PackError::Changed);
        }
        let actual = hash_reader(&mut file)?;
        if actual != self.record.sha256 {
            let owned = self.owns_part();
            if owned {
                let _ = std::fs::remove_file(&self.paths.part);
            }
            self.record.state = DownloadPhase::Failed;
            let _ = store.write(&self.record);
            return Err(PackError::BadHash);
        }
        self.record.state = DownloadPhase::Verifying;
        store.write(&self.record)?;
        Ok(CompletedDownload {
            record: self.record,
            part_path: self.paths.part,
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct OwnerMarker {
    schema_version: u32,
    download_id: String,
}

fn read_owner(path: &Path) -> PackResult<OwnerMarker> {
    let bytes = std::fs::read(path).map_err(|_| PackError::Changed)?;
    if bytes.len() > 1024 {
        return Err(PackError::Changed);
    }
    let marker: OwnerMarker = serde_json::from_slice(&bytes).map_err(|_| PackError::Changed)?;
    if marker.schema_version != 1 {
        return Err(PackError::Changed);
    }
    Ok(marker)
}

/// Remove one paused or failed download after proving its owner marker and
/// retained length. Used by the App storage provider; an active writer is
/// left alone and a substituted file is never deleted. Returns the bytes
/// removed from the partial, record and marker.
pub fn clear_owned_download(
    store: &DownloadStateStore,
    record: &DownloadRecord,
) -> PackResult<u64> {
    if matches!(
        record.state,
        DownloadPhase::Downloading | DownloadPhase::Verifying
    ) {
        return Err(PackError::Busy);
    }
    let paths = store.paths(&record.download_id)?;
    if read_owner(&paths.owner)?.download_id != record.download_id {
        return Err(PackError::Changed);
    }
    let mut freed = 0u64;
    match std::fs::metadata(&paths.part) {
        Ok(metadata) => {
            if !metadata.is_file() || metadata.len() != record.bytes_received {
                return Err(PackError::Changed);
            }
            std::fs::remove_file(&paths.part).map_err(|error| map_io(&error))?;
            freed = freed.saturating_add(metadata.len());
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(map_io(&error)),
    }
    for path in [&paths.record, &paths.owner] {
        if let Ok(metadata) = std::fs::metadata(path) {
            freed = freed.saturating_add(metadata.len());
        }
    }
    store.remove_owned(&record.download_id)?;
    Ok(freed)
}

fn hash_reader(file: &mut File) -> PackResult<String> {
    file.seek(SeekFrom::Start(0))
        .map_err(|error| map_io(&error))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; CHUNK_BYTES];
    loop {
        let read = file.read(&mut buffer).map_err(|error| map_io(&error))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let digest = hasher.finalize();
    let mut text = String::with_capacity(64);
    for byte in digest {
        use std::fmt::Write;
        let _ = write!(text, "{byte:02x}");
    }
    Ok(text)
}

/// Download or resume; a mismatch never appends to the old partial.
pub fn run_download(
    client: &dyn DownloadClient,
    store: &DownloadStateStore,
    spec: &DownloadSpec,
    resume: Option<DownloadRecord>,
    control: &DownloadControl,
    now_unix: u64,
    mut progress: impl FnMut(u64, u64),
) -> PackResult<DownloadOutcome> {
    spec.validate()?;
    let meta = client.meta(&spec.url)?;
    let resumable = resume.filter(|record| {
        record.pack_id == spec.pack_id
            && record.version == spec.version
            && record.url == spec.url
            && record.expected_bytes == spec.expected_bytes
            && record.sha256 == spec.sha256
    });
    if let Some(record) = resumable {
        if let ResumeDecision::Append { offset } = resume_decision(&record, &meta) {
            if let Some(etag) = record.etag.clone() {
                let body = client.get(&spec.url, Some((offset, etag.clone())))?;
                let accepted = body.status == 206
                    && body.content_range_start == Some(offset)
                    && body.etag.as_deref() == Some(etag.as_str())
                    && match body.total_bytes {
                        Some(total) => total == record.expected_bytes,
                        None => true,
                    };
                if accepted {
                    if let Ok(mut owned) = OwnedDownload::open_paused(store, record) {
                        return match stream_body(&mut owned, body.reader, control, &mut progress) {
                            Ok(()) => finish_outcome(owned, control, store, now_unix),
                            Err(PackError::Busy) => pause_outcome(owned, store, now_unix),
                            Err(error) => {
                                let _ = owned.cancel(store);
                                Err(error)
                            }
                        };
                    }
                }
                // A mismatched Range response or a replaced owned partial is
                // never appended to. The old partial stays until a fresh
                // attempt is accepted.
            }
        }
    }
    let mut owned = OwnedDownload::create(store, spec, meta.etag.clone(), now_unix)?;
    let body = match open_fresh(client, &spec.url) {
        Ok(body) => body,
        Err(error) => {
            let _ = owned.cancel(store);
            return Err(error);
        }
    };
    match stream_body(&mut owned, body, control, &mut progress) {
        Ok(()) => finish_outcome(owned, control, store, now_unix),
        Err(PackError::Busy) => pause_outcome(owned, store, now_unix),
        Err(error) => {
            let _ = owned.cancel(store);
            Err(error)
        }
    }
}

fn pause_outcome(
    mut owned: OwnedDownload,
    store: &DownloadStateStore,
    now_unix: u64,
) -> PackResult<DownloadOutcome> {
    owned.pause(store, now_unix)?;
    let record = owned.record().clone();
    Ok(DownloadOutcome::Paused(record))
}

fn finish_outcome(
    owned: OwnedDownload,
    control: &DownloadControl,
    store: &DownloadStateStore,
    now_unix: u64,
) -> PackResult<DownloadOutcome> {
    match control.checkpoint() {
        Ok(()) => owned.finish(store).map(DownloadOutcome::Completed),
        Err(PackError::Busy) => pause_outcome(owned, store, now_unix),
        Err(error) => {
            let _ = owned.cancel(store);
            Err(error)
        }
    }
}

fn open_fresh(client: &dyn DownloadClient, url: &str) -> PackResult<Box<dyn Read + Send>> {
    let body = client.get(url, None)?;
    if body.status != 200 && !(body.status == 206 && body.content_range_start == Some(0)) {
        return Err(PackError::Unavailable);
    }
    Ok(body.reader)
}

fn stream_body(
    owned: &mut OwnedDownload,
    mut reader: Box<dyn Read + Send>,
    control: &DownloadControl,
    progress: &mut impl FnMut(u64, u64),
) -> PackResult<()> {
    let expected = owned.record.expected_bytes;
    let file = owned.file.as_mut().ok_or(PackError::Busy)?;
    let mut received = owned.record.bytes_received;
    let mut buffer = vec![0u8; CHUNK_BYTES];
    loop {
        control.checkpoint()?;
        let read = reader.read(&mut buffer).map_err(|error| map_io(&error))?;
        if read == 0 {
            break;
        }
        received = received.saturating_add(read as u64);
        if received > expected {
            return Err(PackError::Changed);
        }
        file.write_all(&buffer[..read])
            .map_err(|error| map_io(&error))?;
        // Persist the offset as it grows, so Pause can resume exactly here.
        owned.record.bytes_received = received;
        progress(received, expected);
    }
    if received != expected {
        return Err(PackError::Changed);
    }
    Ok(())
}

pub use crate::download_http::HttpDownloadClient;
