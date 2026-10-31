//! Copies waiting to be stored (`pending/`). Only a flushed complete copy
//! receives its JSON completion record (R-SAFE-5, Step 06b D2).

use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::coordination::PendingLock;
use crate::{StoreError, MAX_PENDING_BYTES, MAX_SNAPSHOT_BYTES};

/// Process-wide counter so two snapshots in the same nanosecond differ.
static SNAPSHOT_COUNTER: AtomicU64 = AtomicU64::new(0);

/// What the importer reads next to a pending copy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PendingSidecar {
    pub path: String,
    pub reason: String,
    pub created_unix: u64,
    pub file_modified_unix: u64,
    /// Required completion record; legacy sidecars cannot prove a full copy.
    pub size: u64,
}

pub(crate) struct PendingCopy {
    pub raw: PathBuf,
    pub sidecar: PathBuf,
}

/// The pending directory of a store folder.
pub fn pending_dir(dir: &Path) -> PathBuf {
    dir.join("pending")
}

/// With the session locked, old staging files cannot belong to a live writer.
/// Legacy raw/JSON pairs remain available for recovery rather than being
/// accepted without evidence that their copy finished.
pub(crate) fn cleanup_incomplete(pending: &Path, now_unix: u64) -> Result<(), StoreError> {
    for entry in std::fs::read_dir(pending)? {
        let path = entry?.path();
        let orphan = match path.extension().and_then(|extension| extension.to_str()) {
            Some("partial" | "tmp") => true,
            Some("raw") => !path.with_extension("json").try_exists()?,
            _ => false,
        };
        if orphan {
            let metadata = std::fs::symlink_metadata(&path)?;
            if metadata.is_file() && now_unix.saturating_sub(modified_unix(&metadata)) >= 60 {
                std::fs::remove_file(path)?;
            }
        }
    }
    Ok(())
}

/// Copy a file's current content into `pending/` without hashing or
/// compressing it. `false` when there is nothing to keep.
pub fn snapshot_to_pending(
    dir: &Path,
    path: &Path,
    reason: &str,
    now_unix: u64,
) -> Result<bool, StoreError> {
    let _lock = PendingLock::acquire(dir)?;
    Ok(snapshot_locked(dir, path, reason, now_unix)?.is_some())
}

/// The caller owns the store session, so publication cannot race cleanup.
pub(crate) fn snapshot_locked(
    dir: &Path,
    path: &Path,
    reason: &str,
    now_unix: u64,
) -> Result<Option<PendingCopy>, StoreError> {
    snapshot_with_limit(dir, path, reason, now_unix, MAX_PENDING_BYTES)
}

fn snapshot_with_limit(
    dir: &Path,
    path: &Path,
    reason: &str,
    now_unix: u64,
    max_pending: u64,
) -> Result<Option<PendingCopy>, StoreError> {
    // A size-only skip does not need to open a writer's oversized file. This
    // observation never authorizes a copy: the actual opened source is checked
    // again below, under its write/rename guard.
    if std::fs::metadata(path)
        .is_ok_and(|metadata| metadata.is_file() && metadata.len() > MAX_SNAPSHOT_BYTES)
    {
        return Err(StoreError::TooLarge);
    }
    let mut source = match open_snapshot_source(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let meta = source.metadata()?;
    if !meta.is_file() {
        return Ok(None);
    }
    if meta.len() > MAX_SNAPSHOT_BYTES {
        return Err(StoreError::TooLarge);
    }
    let pending = pending_dir(dir);
    std::fs::create_dir_all(&pending)?;
    let name = pending_name();
    let raw = pending.join(format!("{name}.raw"));
    let partial = pending.join(format!("{name}.raw.partial"));
    let sidecar = pending.join(format!("{name}.json"));
    let sidecar_value = PendingSidecar {
        path: path.to_string_lossy().to_string(),
        reason: reason.to_string(),
        created_unix: now_unix,
        file_modified_unix: modified_unix(&meta),
        size: meta.len(),
    };
    let json =
        serde_json::to_vec(&sidecar_value).map_err(|error| StoreError::Io(error.to_string()))?;
    let used = crate::disk::disk_usage(&pending)?;
    let needed = meta.len().saturating_add(json.len() as u64);
    if needed > max_pending || used > max_pending - needed {
        // Ordinary saves skip TooLarge source files; a full pending queue must
        // instead stop the write, preserving the original file on disk.
        return Err(StoreError::Io(
            "pending snapshot budget exhausted".to_string(),
        ));
    }
    let mut dest = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&partial)?;
    let copied = (|| -> Result<(), StoreError> {
        let size = std::io::copy(&mut (&mut source).take(MAX_SNAPSHOT_BYTES + 1), &mut dest)?;
        let after = source.metadata()?;
        if size != meta.len()
            || after.len() != meta.len()
            || after.modified()? != meta.modified()?
        {
            return Err(StoreError::Io(
                "snapshot source changed while copying".to_string(),
            ));
        }
        dest.flush()?;
        dest.sync_all()?;
        Ok(())
    })();
    drop(dest);
    if let Err(error) = copied {
        let _ = std::fs::remove_file(&partial);
        return Err(error);
    }
    if let Err(error) = fs_service::move_without_replacing(&partial, &raw) {
        let _ = std::fs::remove_file(&partial);
        return Err(StoreError::Io(error.to_string()));
    }
    if let Err(error) = write_atomic(&sidecar, &json) {
        let _ = std::fs::remove_file(&raw);
        return Err(error);
    }
    Ok(Some(PendingCopy { raw, sidecar }))
}

fn open_snapshot_source(path: &Path) -> std::io::Result<File> {
    // metadata before open preserves the documented folder-skip behavior.
    if std::fs::metadata(path).is_ok_and(|metadata| !metadata.is_file()) {
        return Err(std::io::ErrorKind::NotFound.into());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_SHARE_READ only: a writer or rename cannot change our source
        // between the initial metadata and the completed copy.
        options.share_mode(1);
    }
    options.open(path)
}

/// Seconds since 1970 of a file's modified time, 0 when unknown.
pub fn modified_unix(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn pending_name() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos() as u64)
        .unwrap_or(0);
    let counter = SNAPSHOT_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{nanos}-{counter}")
}

/// Write a file so a crash never leaves it half written: partial, flush,
/// then rename.
fn write_atomic(target: &Path, bytes: &[u8]) -> Result<(), StoreError> {
    let name = target
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".to_string());
    let partial = target.with_file_name(format!("{name}.tmp"));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&partial)?;
    let written = (|| {
        file.write_all(bytes)?;
        file.sync_all()
    })();
    drop(file);
    if let Err(error) = written {
        let _ = std::fs::remove_file(&partial);
        return Err(StoreError::Io(error.to_string()));
    }
    if let Err(error) = fs_service::move_without_replacing(&partial, target) {
        let _ = std::fs::remove_file(&partial);
        return Err(StoreError::Io(error.to_string()));
    }
    Ok(())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn snapshot_source_cannot_be_written_or_replaced_while_it_is_copied() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("source.txt");
        std::fs::write(&path, "original").unwrap();
        let source = open_snapshot_source(&path).unwrap();
        assert!(std::fs::write(&path, "changed").is_err());
        assert!(std::fs::rename(&path, dir.path().join("moved.txt")).is_err());
        assert_eq!(source.metadata().unwrap().len(), 8);
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
    }
}

#[cfg(test)]
mod budget_tests {
    use super::*;

    #[test]
    fn completion_publication_never_replaces_an_existing_record() {
        let dir = tempfile::tempdir().unwrap();
        let record = dir.path().join("existing.json");
        std::fs::write(&record, b"preserved record").unwrap();
        assert!(write_atomic(&record, b"different record").is_err());
        assert_eq!(std::fs::read(record).unwrap(), b"preserved record");
        assert!(!dir.path().join("existing.json.tmp").exists());
    }

    #[test]
    fn pending_budget_failure_is_not_a_skippable_source_size_error() {
        let dir = tempfile::tempdir().unwrap();
        let user = tempfile::tempdir().unwrap();
        let path = user.path().join("a.txt");
        std::fs::write(&path, [b'a'; 500]).unwrap();
        let _lock = PendingLock::acquire(dir.path()).unwrap();
        assert!(snapshot_with_limit(dir.path(), &path, "save", 100, 1024)
            .unwrap()
            .is_some());
        assert!(matches!(
            snapshot_with_limit(dir.path(), &path, "save", 101, 1024),
            Err(StoreError::Io(_))
        ));
        assert_eq!(std::fs::read(&path).unwrap(), [b'a'; 500]);
        assert_eq!(
            std::fs::read_dir(dir.path().join("pending"))
                .unwrap()
                .count(),
            2
        );
        assert_eq!(MAX_PENDING_BYTES, 1_073_741_824);
    }
}
