//! The durable state of one owned pack download. Paths are always derived
//! from a validated UUID under `<packs>/downloads`; no UI path is trusted.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{map_io, PackError, PackResult};
use crate::types::{is_safe_integer, PackId};

pub const DOWNLOAD_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DownloadPhase {
    Downloading,
    Paused,
    Verifying,
    Failed,
}

/// One pack download, persisted beside its owned partial file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DownloadRecord {
    pub schema_version: u32,
    pub download_id: String,
    pub pack_id: PackId,
    pub version: String,
    pub url: String,
    pub expected_bytes: u64,
    pub sha256: String,
    /// Only a strong ETag is ever stored.
    pub etag: Option<String>,
    pub bytes_received: u64,
    pub state: DownloadPhase,
    pub created_unix: u64,
    pub updated_unix: u64,
}

impl DownloadRecord {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        download_id: String,
        pack_id: PackId,
        version: String,
        url: String,
        expected_bytes: u64,
        sha256: String,
        etag: Option<String>,
        now_unix: u64,
    ) -> PackResult<Self> {
        if !is_safe_integer(expected_bytes) || expected_bytes == 0 {
            return Err(PackError::BadRequest);
        }
        Ok(Self {
            schema_version: DOWNLOAD_SCHEMA_VERSION,
            download_id,
            pack_id,
            version,
            url,
            expected_bytes,
            sha256,
            etag: strong_etag(etag.as_deref()),
            bytes_received: 0,
            state: DownloadPhase::Downloading,
            created_unix: now_unix,
            updated_unix: now_unix,
        })
    }

    /// True when a resume may append to this record at all.
    pub fn resumable(&self) -> bool {
        self.state == DownloadPhase::Paused
            && self.bytes_received > 0
            && self.bytes_received < self.expected_bytes
            && self.etag.is_some()
    }
}

/// What a HEAD/metadata response said about the remote artifact.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteMeta {
    pub etag: Option<String>,
    pub total_bytes: Option<u64>,
}

impl RemoteMeta {
    pub fn new(etag: Option<String>, total_bytes: Option<u64>) -> Self {
        Self {
            etag: strong_etag(etag.as_deref()),
            total_bytes,
        }
    }
}

/// The only accepted outcomes of comparing a paused record with the remote.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResumeDecision {
    /// The caller may send a Range request starting at this offset.
    Append { offset: u64 },
    /// A fresh owned partial is needed; the old one stays until a fresh
    /// attempt is accepted, and it is never appended to.
    Restart,
}

/// Resume only with an identical URL/version/size/strong ETag. Anything else
/// restarts instead of mixing bytes.
pub fn resume_decision(record: &DownloadRecord, remote: &RemoteMeta) -> ResumeDecision {
    if !record.resumable() {
        return ResumeDecision::Restart;
    }
    let remote_etag = match strong_etag(remote.etag.as_deref()) {
        Some(etag) => etag,
        None => return ResumeDecision::Restart,
    };
    if record.etag.as_deref() != Some(remote_etag.as_str()) {
        return ResumeDecision::Restart;
    }
    if let Some(total) = remote.total_bytes {
        if total != record.expected_bytes {
            return ResumeDecision::Restart;
        }
    }
    ResumeDecision::Append {
        offset: record.bytes_received,
    }
}

fn strong_etag(value: Option<&str>) -> Option<String> {
    let text = value?.trim();
    if text.is_empty() || text.starts_with("W/") || text.contains(',') {
        return None;
    }
    Some(text.to_string())
}

/// The three owned files of one download.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadPaths {
    pub part: PathBuf,
    pub record: PathBuf,
    pub owner: PathBuf,
}

impl DownloadPaths {
    /// `downloads_directory` is `<packs>/downloads`, never a UI path.
    pub fn under(downloads_directory: &Path, download_id: &str) -> PackResult<Self> {
        validate_download_id(download_id)?;
        Ok(Self {
            part: downloads_directory.join(format!("{download_id}.part")),
            record: downloads_directory.join(format!("{download_id}.json")),
            owner: downloads_directory.join(format!("{download_id}.owner")),
        })
    }
}

/// A canonical lowercase UUID v4-style id is the only accepted file stem.
pub fn validate_download_id(value: &str) -> PackResult<()> {
    let uuid = uuid::Uuid::parse_str(value).map_err(|_| PackError::BadRequest)?;
    if uuid.hyphenated().to_string() != value.to_ascii_lowercase() || value.len() != 36 {
        return Err(PackError::BadRequest);
    }
    Ok(())
}

/// Reads and writes records under `<packs>/downloads`.
#[derive(Debug, Clone)]
pub struct DownloadStateStore {
    directory: PathBuf,
}

impl DownloadStateStore {
    pub fn new(packs_root: &Path) -> Self {
        Self {
            directory: packs_root.join("downloads"),
        }
    }

    pub fn directory(&self) -> &Path {
        &self.directory
    }

    pub fn ensure(&self) -> PackResult<()> {
        std::fs::create_dir_all(&self.directory).map_err(|error| map_io(&error))
    }

    pub fn paths(&self, download_id: &str) -> PackResult<DownloadPaths> {
        DownloadPaths::under(&self.directory, download_id)
    }

    pub fn write(&self, record: &DownloadRecord) -> PackResult<()> {
        validate_download_id(&record.download_id)?;
        self.ensure()?;
        let bytes = serde_json::to_vec(record).map_err(|_| PackError::Failed)?;
        let paths = self.paths(&record.download_id)?;
        write_atomic(&paths.record, &bytes)
    }

    pub fn read(&self, download_id: &str) -> PackResult<DownloadRecord> {
        let paths = self.paths(download_id)?;
        let bytes = std::fs::read(&paths.record).map_err(|error| map_io(&error))?;
        if bytes.len() > 16 * 1024 {
            return Err(PackError::BadRequest);
        }
        let record: DownloadRecord =
            serde_json::from_slice(&bytes).map_err(|_| PackError::BadRequest)?;
        if record.schema_version != DOWNLOAD_SCHEMA_VERSION
            || record.download_id != download_id
            || !is_safe_integer(record.expected_bytes)
            || record.bytes_received > record.expected_bytes
            || record.created_unix > record.updated_unix
        {
            return Err(PackError::BadRequest);
        }
        Ok(record)
    }

    /// Current records, newest attempt first. A damaged record is skipped,
    /// never guessed at.
    pub fn list(&self) -> PackResult<Vec<DownloadRecord>> {
        let entries = match std::fs::read_dir(&self.directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(map_io(&error)),
        };
        let mut records = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
                continue;
            };
            if let Ok(record) = self.read(stem) {
                records.push(record);
            }
        }
        records.sort_by(|left, right| {
            right
                .updated_unix
                .cmp(&left.updated_unix)
                .then_with(|| right.download_id.cmp(&left.download_id))
        });
        Ok(records)
    }

    pub fn remove_owned(&self, download_id: &str) -> PackResult<()> {
        let paths = self.paths(download_id)?;
        for path in [&paths.record, &paths.owner] {
            match std::fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(map_io(&error)),
            }
        }
        Ok(())
    }

    /// Drop only this download's record. Used when the owner marker no
    /// longer belongs to us, so a substituted owner/partial is left alone.
    pub fn remove_record(&self, download_id: &str) -> PackResult<()> {
        match std::fs::remove_file(self.paths(download_id)?.record) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(map_io(&error)),
        }
    }
}

pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> PackResult<()> {
    use std::io::Write;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(PackError::BadRequest)?;
    let temp = path.with_file_name(format!(".{name}-{}.partial", uuid::Uuid::new_v4()));
    let result = (|| -> PackResult<()> {
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)
            .map_err(|error| map_io(&error))?;
        file.write_all(bytes).map_err(|error| map_io(&error))?;
        file.sync_all().map_err(|error| map_io(&error))?;
        drop(file);
        std::fs::rename(&temp, path).map_err(|error| map_io(&error))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}
