//! A composite operation keeps one store lock through the final user-file write.

use std::path::Path;

use crate::coordination::StoreLock;
use crate::{StoreError, VersionStore};

pub struct VersionSession<'a> {
    pub(crate) store: &'a mut VersionStore,
    pub(crate) _lock: StoreLock,
}

impl VersionSession<'_> {
    pub fn read_bytes_for_path(&self, id: i64, path: &str) -> Result<Vec<u8>, StoreError> {
        self.store.read_bytes_for_path_locked(id, path)
    }

    pub fn snapshot_current(
        &mut self,
        path: &Path,
        reason: &str,
        now_unix: u64,
    ) -> Result<Option<i64>, StoreError> {
        self.store.snapshot_current_locked(path, reason, now_unix)
    }

    pub fn delete_all(&mut self) -> Result<(), StoreError> {
        self.store.delete_all_locked()
    }
}
