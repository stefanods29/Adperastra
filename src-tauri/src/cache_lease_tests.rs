//! Lease and revision behavior of the cache service (Step 07a, T3).

use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use cache_store::{CacheKey, CacheKind, SourceStamp};

use crate::cache::CacheService;
use crate::files::FileGrants;

fn service(dir: &Path) -> (CacheService, Arc<FileGrants>) {
    let grants = Arc::new(FileGrants::default());
    (
        CacheService::new(dir.to_path_buf(), Arc::clone(&grants)),
        grants,
    )
}

fn key(name: &str) -> CacheKey {
    CacheKey {
        source: SourceStamp {
            path_key: format!(r"c:\pictures\{name}"),
            volume_id: "1a2b3c4d".to_string(),
            file_id: "0020000000000001".to_string(),
            modified_ticks: "133000000000000010".to_string(),
            size_bytes: 60,
        },
        kind: CacheKind::Thumbnail,
        handler_id: "wic".to_string(),
        handler_version: 1,
        options_key: "edge=128".to_string(),
    }
}

fn publish_one(service: &CacheService, dir: &Path) -> (File, cache_store::CacheRecord) {
    let path = dir.join("prepared.png");
    std::fs::write(&path, vec![7u8; 60]).unwrap();
    let file = File::open(&path).unwrap();
    let record = service
        .with_store(|store| {
            store
                .publish(&key("photo.png"), &file, "image/png", Some(8), Some(8))
                .map_err(|_| "cache.unavailable".to_string())
        })
        .unwrap();
    (file, record)
}

fn blob_path(data_dir: &Path, blob_id: &str) -> PathBuf {
    data_dir
        .join("cache")
        .join("blobs")
        .join(format!("{blob_id}.png"))
}

#[test]
fn a_lease_survives_clear_and_usage_accounts_its_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let (service, _grants) = service(dir.path());
    let (_source, record) = publish_one(&service, dir.path());
    let lease = service.lease(&record).unwrap();
    assert_eq!(lease.token.len(), 32);
    assert_eq!(lease.name, "thumbnail.png");
    assert_eq!(lease.byte_len, 60);
    let blob = blob_path(dir.path(), &record.blob_id);
    assert!(blob.exists());

    let cleared = service.clear(None).unwrap();
    assert!(blob.exists(), "a displayed blob is never deleted");
    assert!(cleared.pending_delete_bytes >= 60);

    service.release(&lease.lease_id).unwrap();
    service.release(&lease.lease_id).unwrap();
    assert!(!blob.exists(), "the pin drop lets the owned cleanup finish");
    assert_eq!(service.active_leases(), 0);
}

#[test]
fn an_unknown_lease_id_cannot_revoke_another_grant() {
    let dir = tempfile::tempdir().unwrap();
    let (service, grants) = service(dir.path());
    let (_source, record) = publish_one(&service, dir.path());
    let lease = service.lease(&record).unwrap();
    assert!(grants.path_for(&lease.token).is_some());

    let foreign = uuid::Uuid::new_v4().to_string();
    service.release(&foreign).unwrap();
    assert!(grants.path_for(&lease.token).is_some());
    assert_eq!(service.active_leases(), 1);
    service.release(&lease.lease_id).unwrap();
    assert!(grants.path_for(&lease.token).is_none());
}

#[test]
fn a_subsecond_change_changes_the_source_stamp() {
    use std::time::{Duration, UNIX_EPOCH};
    let dir = tempfile::tempdir().unwrap();
    let (service, _grants) = service(dir.path());
    let path = dir.path().join("changing.txt");
    std::fs::write(&path, b"one").unwrap();
    let file = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
    file.set_modified(UNIX_EPOCH + Duration::from_millis(1_700_000_000_123))
        .unwrap();
    let first = service.source_stamp(&path).unwrap();
    file.set_modified(UNIX_EPOCH + Duration::from_millis(1_700_000_000_124))
        .unwrap();
    let second = service.source_stamp(&path).unwrap();
    assert_ne!(first.modified_ticks, second.modified_ticks);
    assert_eq!(first.path_key, second.path_key);
    assert_eq!(first.size_bytes, second.size_bytes);
}
