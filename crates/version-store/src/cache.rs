//! Bounded read-only open copies and accounting for all version-store files.

use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::coordination::{PendingLock, StoreLock};
use crate::disk::{disk_usage, reparse};
use crate::{StoreError, VersionStore, MAX_OPEN_BYTES};

impl VersionStore {
    /// Reclaim oldest owned copies before extracting, in one exclusive session.
    pub fn extract_open(&self, id: i64, file_name: &str) -> Result<PathBuf, StoreError> {
        let _lock = StoreLock::acquire(&self.dir)?;
        self.extract_open_locked(id, file_name, MAX_OPEN_BYTES)
    }

    fn extract_open_locked(
        &self,
        id: i64,
        file_name: &str,
        max_bytes: u64,
    ) -> Result<PathBuf, StoreError> {
        let mut components = Path::new(file_name).components();
        if !matches!(components.next(), Some(Component::Normal(_)))
            || components.next().is_some()
            || file_name.contains(['/', '\\', ':'])
        {
            return Err(StoreError::Io("invalid cache filename".to_string()));
        }
        let (_, size) = self.record_for(id)?;
        let open = self.dir.join("open");
        std::fs::create_dir_all(&open)?;
        let dest = open.join(format!("{id}-{file_name}"));
        let cached = match std::fs::symlink_metadata(&dest) {
            Ok(metadata) if metadata.is_file() && !reparse(&metadata) => {
                if metadata.len() == size {
                    true
                } else {
                    remove_owned_copy(&dest)?;
                    false
                }
            }
            Ok(_) => {
                return Err(StoreError::Io(
                    "cache destination is not a regular owned copy".to_string(),
                ))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(error) => return Err(error.into()),
        };
        reclaim(&open, if cached { 0 } else { size }, max_bytes, &dest)?;
        if !cached {
            self.extract_locked(id, &dest)?;
        }
        let mut permissions = std::fs::metadata(&dest)?.permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&dest, permissions)?;
        Ok(dest)
    }

    /// Logical bytes on disk, including SQLite/WAL, pending copies and open copies.
    /// Immutable compressed-blob accounting remains `stored_bytes`.
    pub fn disk_bytes(&self) -> Result<u64, StoreError> {
        let _lock = StoreLock::acquire(&self.dir)?;
        let _pending_lock = PendingLock::acquire(&self.dir)?;
        disk_usage(&self.dir)
    }
}

fn reclaim(open: &Path, needed: u64, max_bytes: u64, retained: &Path) -> Result<(), StoreError> {
    if needed > max_bytes {
        return Err(StoreError::TooLarge);
    }
    let mut total = disk_usage(open)?;
    let mut candidates = Vec::new();
    for entry in std::fs::read_dir(open)? {
        let path = entry?.path();
        let metadata = std::fs::symlink_metadata(&path)?;
        if path != retained && metadata.is_file() && !reparse(&metadata) && owned_cache_name(&path)
        {
            candidates.push((
                metadata.modified().unwrap_or(UNIX_EPOCH),
                path,
                metadata.len(),
            ));
        }
    }
    candidates.sort();
    for (_, path, size) in candidates {
        if total <= max_bytes - needed {
            break;
        }
        if remove_owned_copy(&path).is_ok() {
            total = total.saturating_sub(size);
        }
    }
    if total > max_bytes - needed {
        return Err(StoreError::Io(
            "open cache has no reclaimable space".to_string(),
        ));
    }
    Ok(())
}

fn owned_cache_name(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    if let Some((id, suffix)) = name.split_once('-') {
        if id.parse::<i64>().is_ok_and(|id| id > 0) && !suffix.is_empty() {
            return true;
        }
    }
    name.strip_prefix("~version-")
        .and_then(|name| name.strip_suffix(".partial"))
        .is_some_and(|name| name.split('-').all(|part| part.parse::<u128>().is_ok()))
}

fn remove_owned_copy(path: &Path) -> Result<(), StoreError> {
    let metadata = std::fs::symlink_metadata(path)?;
    if !metadata.is_file() || reparse(&metadata) || !owned_cache_name(path) {
        return Err(StoreError::Io(
            "refusing to remove a foreign cache entry".to_string(),
        ));
    }
    #[cfg(windows)]
    if metadata.permissions().readonly() {
        fs_service::clear_owned_readonly(path)?;
    }
    std::fs::remove_file(path)?;
    Ok(())
}

#[cfg(test)]
#[path = "cache_tests.rs"]
mod tests;
