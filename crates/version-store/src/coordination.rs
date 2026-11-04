//! One exclusive store session, including pending publication and file cleanup.

use std::fs::{File, OpenOptions};
use std::path::Path;

use crate::StoreError;

/// An OS lock also coordinates another running app using the same data folder.
/// The lock file is never removed: unlinking it would let two sessions coexist.
pub(crate) struct StoreLock {
    _file: File,
}

impl StoreLock {
    pub(crate) fn acquire(dir: &Path) -> Result<Self, StoreError> {
        Ok(Self {
            _file: acquire(dir, "store.lock")?,
        })
    }
}

/// Publication has its own lock so a small save never waits for compression.
pub(crate) struct PendingLock {
    _file: File,
}

impl PendingLock {
    pub(crate) fn acquire(dir: &Path) -> Result<Self, StoreError> {
        Ok(Self {
            _file: acquire(dir, "pending.lock")?,
        })
    }
}

fn acquire(dir: &Path, name: &str) -> Result<File, StoreError> {
    std::fs::create_dir_all(dir)?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(dir.join(name))?;
    file.lock()?;
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn explicit_deletion_blocks_publication_only_while_its_pending_lock_is_held() {
        let dir = tempfile::tempdir().unwrap();
        let user = tempfile::tempdir().unwrap();
        let path = user.path().join("a.txt");
        std::fs::write(&path, "one").unwrap();
        let _store = StoreLock::acquire(dir.path()).unwrap();
        let pending = PendingLock::acquire(dir.path()).unwrap();
        let store_path = dir.path().to_path_buf();
        let (tx, rx) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            crate::snapshot_to_pending(&store_path, &path, "save", 100).unwrap();
            tx.send(()).unwrap();
        });
        assert!(rx.recv_timeout(Duration::from_millis(100)).is_err());
        drop(pending);
        rx.recv_timeout(Duration::from_secs(5)).unwrap();
        worker.join().unwrap();
    }
}
