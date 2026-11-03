//! Active cache leases (Step 07a, T3).
//!
//! A lease keeps the verified blob open with read sharing only, so neither
//! another process nor this app's eviction can write, rename or delete it
//! while the UI displays it. Release revokes the `adpfile` token first, then
//! drops the pin.

use std::collections::HashMap;
use std::fs::File;
use std::sync::Mutex;

/// The most leases one app session may hold (plan T3).
pub const MAX_ACTIVE_LEASES: usize = 512;

pub struct Lease {
    pub lease_id: String,
    pub token: String,
    /// The opened blob; dropping it ends the read lease.
    pub pin: File,
}

/// Every live lease, keyed by lease ID.
#[derive(Default)]
pub struct LeaseTable {
    entries: Mutex<HashMap<String, Lease>>,
}

impl LeaseTable {
    pub fn active_count(&self) -> usize {
        self.entries
            .lock()
            .map(|entries| entries.len())
            .unwrap_or(0)
    }

    pub fn insert(&self, lease: Lease) -> Result<(), String> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "cache lock poisoned".to_string())?;
        if entries.len() >= MAX_ACTIVE_LEASES {
            return Err("cache.too_many_leases".to_string());
        }
        entries.insert(lease.lease_id.clone(), lease);
        Ok(())
    }

    /// Remove one lease. The caller revokes its token before this drops the
    /// pin; an unknown ID is not an error.
    pub fn take(&self, lease_id: &str) -> Option<Lease> {
        let mut entries = self.entries.lock().ok()?;
        entries.remove(lease_id)
    }
}

#[cfg(test)]
mod tests {
    use super::{Lease, LeaseTable, MAX_ACTIVE_LEASES};
    use std::fs::File;

    fn lease(index: usize) -> Lease {
        let dir = std::env::temp_dir().join(format!(
            "adperastra-cache-lease-{}-{index}",
            std::process::id()
        ));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("blob.png");
        std::fs::write(&path, b"x").unwrap();
        Lease {
            lease_id: format!("00000000-0000-4000-8000-{index:012}"),
            token: "a".repeat(32),
            pin: File::open(path).unwrap(),
        }
    }

    #[test]
    fn the_table_caps_active_leases() {
        let table = LeaseTable::default();
        for index in 0..MAX_ACTIVE_LEASES {
            table.insert(lease(index)).unwrap();
        }
        assert_eq!(table.active_count(), MAX_ACTIVE_LEASES);
        assert_eq!(
            table.insert(lease(MAX_ACTIVE_LEASES)),
            Err("cache.too_many_leases".to_string())
        );
    }
}
