//! Native Office binary lease registry (Step 20a E18/E24).
//!
//! A render/export lease belongs to exactly one live session and document.
//! `resolve_office_lease` is native-only: the browser cannot call it, and a
//! FileGrants token alone is not proof of Office session ownership. Session
//! close or explicit release forbids new lookups while an already-cloned
//! backing Arc may finish its current read.
#![allow(dead_code)]


use std::collections::HashMap;
use std::sync::{Arc, OnceLock, RwLock};

use uuid::Uuid;

use crate::export_snapshot_types::now_unix;
use crate::file_grant_backing::GrantedBacking;
use crate::office_edit_types::OfficeEditError;
use crate::office_edit_values::{OfficeBinaryLease, OfficeStoragePolicy};

pub const MAX_OFFICE_LEASES: usize = 1_024;

struct LeaseRecord {
    session_id: Uuid,
    document_id: Uuid,
    #[allow(dead_code)]
    token: String,
    storage_policy: OfficeStoragePolicy,
    backing: Arc<GrantedBacking>,
    expires_unix: u64,
    revoked: bool,
}

static LEASES: OnceLock<RwLock<HashMap<Uuid, LeaseRecord>>> = OnceLock::new();

fn leases() -> &'static RwLock<HashMap<Uuid, LeaseRecord>> {
    LEASES.get_or_init(|| RwLock::new(HashMap::new()))
}

/// Register one lease produced by a live session. The backing is retained
/// until release/session close; no bytes are copied.
pub fn register_office_lease(
    session_id: Uuid,
    document_id: Uuid,
    lease: &OfficeBinaryLease,
    backing: Arc<GrantedBacking>,
    expires_unix: u64,
) -> Result<(), OfficeEditError> {
    if session_id.is_nil() || document_id.is_nil() || !lease.is_valid() {
        return Err(OfficeEditError::Invalid);
    }
    if backing.length() != lease.byte_len || !backing.is_consistent() {
        return Err(OfficeEditError::Changed);
    }
    let backing_sensitive = backing.is_sensitive();
    let declared_sensitive = lease.storage_policy == OfficeStoragePolicy::Sensitive;
    if declared_sensitive && matches!(&*backing, GrantedBacking::Disk { .. }) {
        return Err(OfficeEditError::SensitiveUnsupported);
    }
    if backing_sensitive != declared_sensitive {
        return Err(OfficeEditError::Changed);
    }
    let mut guard = leases().write().map_err(|_| OfficeEditError::Failed)?;
    if guard.len() >= MAX_OFFICE_LEASES || guard.contains_key(&lease.lease_id) {
        return Err(OfficeEditError::TooLarge);
    }
    guard.insert(
        lease.lease_id,
        LeaseRecord {
            session_id,
            document_id,
            token: lease.token.clone(),
            storage_policy: lease.storage_policy,
            backing,
            expires_unix,
            revoked: false,
        },
    );
    Ok(())
}

/// Idempotent explicit release. A reader that already cloned the backing keeps
/// its own Arc; later lookups by this lease id fail.
pub fn release_office_lease(lease_id: Uuid) -> Result<(), OfficeEditError> {
    if lease_id.is_nil() {
        return Err(OfficeEditError::Invalid);
    }
    let mut guard = leases().write().map_err(|_| OfficeEditError::Failed)?;
    if let Some(record) = guard.get_mut(&lease_id) {
        record.revoked = true;
        // Keep a bounded tombstone so a later lookup can distinguish a
        // revoked lease (Changed) from an unknown id (Invalid), without
        // retaining the backing bytes.
        record.backing = Arc::new(GrantedBacking::Memory {
            bytes: Arc::new(zeroize::Zeroizing::new(Vec::new())),
            length: 0,
            sensitive: false,
        });
    }
    Ok(())
}

/// Release one lease only when it belongs to the supplied live session.
pub fn release_office_lease_in_session(
    session_id: Uuid,
    lease_id: Uuid,
) -> Result<(), OfficeEditError> {
    let mut guard = leases().write().map_err(|_| OfficeEditError::Failed)?;
    match guard.get(&lease_id) {
        Some(record) if record.session_id == session_id => {
            guard.remove(&lease_id);
            Ok(())
        }
        _ => Err(OfficeEditError::Invalid),
    }
}

/// Remove every lease of a closing session. Idempotent.
pub fn close_office_session(session_id: Uuid) {
    if session_id.is_nil() {
        return;
    }
    if let Ok(mut guard) = leases().write() {
        guard.retain(|_, record| record.session_id != session_id);
    }
}

/// Native-only lookup used by a later consumer such as the 22a audience
/// frame. Unknown, foreign, expired or revoked ids return no bytes.
pub fn resolve_office_lease(
    session_id: Uuid,
    lease_id: Uuid,
) -> Result<Arc<GrantedBacking>, OfficeEditError> {
    if session_id.is_nil() || lease_id.is_nil() {
        return Err(OfficeEditError::Invalid);
    }
    let (backing, expired) = {
        let guard = leases().read().map_err(|_| OfficeEditError::Failed)?;
        let record = guard.get(&lease_id).ok_or(OfficeEditError::Invalid)?;
        if record.session_id != session_id {
            return Err(OfficeEditError::Invalid);
        }
        if record.revoked {
            return Err(OfficeEditError::Changed);
        }
        let expired = record.expires_unix != 0 && now_unix() > record.expires_unix;
        if expired {
            return Err(OfficeEditError::Changed);
        }
        if record.storage_policy == OfficeStoragePolicy::Sensitive
            && matches!(&*record.backing, GrantedBacking::Disk { .. })
        {
            return Err(OfficeEditError::SensitiveUnsupported);
        }
        if record.backing.is_sensitive()
            != (record.storage_policy == OfficeStoragePolicy::Sensitive)
            || !record.backing.is_consistent()
        {
            return Err(OfficeEditError::Changed);
        }
        (Arc::clone(&record.backing), expired)
    };
    debug_assert!(!expired);
    Ok(backing)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use zeroize::Zeroizing;

    use super::*;

    fn memory_backing(sensitive: bool) -> Arc<GrantedBacking> {
        Arc::new(GrantedBacking::Memory {
            bytes: Arc::new(Zeroizing::new(vec![1, 2, 3])),
            length: 3,
            sensitive,
        })
    }

    fn lease(sensitive: bool) -> OfficeBinaryLease {
        OfficeBinaryLease {
            lease_id: Uuid::new_v4(),
            token: "token-1".to_string(),
            name: "frame.png".to_string(),
            mime: "image/png".to_string(),
            byte_len: 3,
            width: Some(1),
            height: Some(1),
            storage_policy: if sensitive {
                OfficeStoragePolicy::Sensitive
            } else {
                OfficeStoragePolicy::Ordinary
            },
        }
    }

    #[test]
    fn office_lease_wrong_session_refused() {
        let session = Uuid::new_v4();
        let lease = lease(false);
        register_office_lease(session, Uuid::new_v4(), &lease, memory_backing(false), 0).unwrap();
        assert_eq!(
            resolve_office_lease(Uuid::new_v4(), lease.lease_id).unwrap_err(),
            OfficeEditError::Invalid
        );
        close_office_session(session);
    }

    #[test]
    fn office_lease_revoked_lookup_refused() {
        let session = Uuid::new_v4();
        let lease = lease(false);
        register_office_lease(session, Uuid::new_v4(), &lease, memory_backing(false), 0).unwrap();
        release_office_lease(lease.lease_id).unwrap();
        assert_eq!(
            resolve_office_lease(session, lease.lease_id).unwrap_err(),
            OfficeEditError::Changed
        );
        close_office_session(session);
    }

    #[test]
    fn office_lease_retained_reader_survives_release() {
        let session = Uuid::new_v4();
        let lease = lease(false);
        register_office_lease(session, Uuid::new_v4(), &lease, memory_backing(false), 0).unwrap();
        let reader = resolve_office_lease(session, lease.lease_id).unwrap();
        release_office_lease(lease.lease_id).unwrap();
        assert_eq!(reader.read_range(0, 3).unwrap(), vec![1, 2, 3]);
        close_office_session(session);
    }

    #[test]
    fn office_lease_sensitive_disk_refused() {
        // A sensitive lease can never be served from an ordinary backing.
        // The dedicated disk branch is checked after the same classification
        // test; a real pinned disk source is not created in this unit test.
        let session = Uuid::new_v4();
        let lease = lease(true);
        let ordinary_memory = memory_backing(false);
        assert_eq!(
            register_office_lease(session, Uuid::new_v4(), &lease, ordinary_memory, 0).unwrap_err(),
            OfficeEditError::Changed
        );
        close_office_session(session);
    }
}
