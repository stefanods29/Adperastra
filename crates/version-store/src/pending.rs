//! Copies waiting to be stored (`pending/`): the sidecar is written first,
//! then the copy (R-SAFE-5, Step 06b D2).

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::{StoreError, MAX_SNAPSHOT_BYTES};

/// Process-wide counter so two snapshots in the same nanosecond differ.
static SNAPSHOT_COUNTER: AtomicU64 = AtomicU64::new(0);

/// What the importer reads next to a pending copy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PendingSidecar {
    pub path: String,
    pub reason: String,
    pub created_unix: u64,
    pub file_modified_unix: u64,
}

/// The pending directory of a store folder.
pub fn pending_dir(dir: &Path) -> PathBuf {
    dir.join("pending")
}

/// Copy a file's current content into `pending/` without hashing or
/// compressing it. `false` when there is nothing to keep.
pub fn snapshot_to_pending(
    dir: &Path,
    path: &Path,
    reason: &str,
    now_unix: u64,
) -> Result<bool, StoreError> {
    let meta = match std::fs::metadata(path) {
        Ok(meta) => meta,
        Err(_) => return Ok(false),
    };
    if !meta.is_file() {
        return Ok(false);
    }
    if meta.len() > MAX_SNAPSHOT_BYTES {
        return Err(StoreError::TooLarge);
    }
    let pending = pending_dir(dir);
    std::fs::create_dir_all(&pending)?;
    let name = pending_name();
    let raw = pending.join(format!("{name}.raw"));
    let sidecar = pending.join(format!("{name}.json"));
    let sidecar_value = PendingSidecar {
        path: path.to_string_lossy().to_string(),
        reason: reason.to_string(),
        created_unix: now_unix,
        file_modified_unix: modified_unix(&meta),
    };
    let json =
        serde_json::to_vec(&sidecar_value).map_err(|error| StoreError::Io(error.to_string()))?;
    write_atomic(&sidecar, &json)?;
    if let Err(error) = std::fs::copy(path, &raw) {
        let _ = std::fs::remove_file(&raw);
        let _ = std::fs::remove_file(&sidecar);
        return Err(StoreError::Io(error.to_string()));
    }
    Ok(true)
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
    let written = (|| {
        let mut file = std::fs::File::create(&partial)?;
        file.write_all(bytes)?;
        file.sync_all()
    })();
    if let Err(error) = written {
        let _ = std::fs::remove_file(&partial);
        return Err(StoreError::Io(error.to_string()));
    }
    if let Err(error) = std::fs::rename(&partial, target) {
        let _ = std::fs::remove_file(&partial);
        return Err(StoreError::Io(error.to_string()));
    }
    Ok(())
}
