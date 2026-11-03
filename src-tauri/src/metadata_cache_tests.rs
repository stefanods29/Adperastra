use super::*;
use crate::{
    files::FileGrants,
    metadata_jobs::cache_key,
    metadata_types::{MetadataField, MetadataFieldId, MetadataValue},
};
fn fixture() -> (tempfile::TempDir, Arc<CacheService>, CacheKey, MetadataInfo) {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source.jpg");
    std::fs::write(&source, b"source").unwrap();
    let stamp = fs_service::capture_source_stamp(&source).unwrap();
    let key = cache_key(&stamp);
    let mut info = MetadataInfo::new(stamp);
    info.push(MetadataField {
        id: MetadataFieldId::Width,
        value: MetadataValue::Integer { value: 12 },
    });
    let cache = Arc::new(CacheService::new(
        dir.path().join("data"),
        Arc::new(FileGrants::default()),
    ));
    // Initialize the same lazy cache the first lookup uses.
    cache.with_store(|_| Ok(())).unwrap();
    (dir, cache, key, info)
}
#[test]
fn a_valid_native_cache_hit_returns_without_a_browser_grant() {
    let (_dir, cache, key, info) = fixture();
    publish(&cache, &key, &info).unwrap();
    let read = cached(&cache, &key).unwrap();
    assert_eq!(read.fields, info.fields);
    assert_eq!(cache.active_leases(), 0);
}
#[test]
fn evicted_metadata_is_a_miss() {
    let (_dir, cache, key, info) = fixture();
    publish(&cache, &key, &info).unwrap();
    cache.clear(Some(cache_store::CacheKind::Metadata)).unwrap();
    assert!(cached(&cache, &key).is_none());
}
#[test]
fn cache_missing_ids_survive_normalization() {
    let (_dir, cache, key, mut info) = fixture();
    info.partial = true;
    info.missing = vec![MetadataFieldId::Height];
    publish(&cache, &key, &info).unwrap();
    let read = cached(&cache, &key).unwrap();
    assert!(read.partial);
    assert_eq!(read.missing, vec![MetadataFieldId::Height]);
}
#[test]
fn malformed_native_cache_never_reaches_the_ui() {
    let (_dir, cache, key, _) = fixture();
    let file = tempfile::tempfile().unwrap();
    (&file).write_all(b"{invalid}").unwrap();
    cache
        .publish(&key, &file, "application/json", None, None)
        .unwrap();
    assert!(cached(&cache, &key).is_none());
}
#[test]
fn a_stale_indexed_blob_cannot_be_reopened_after_clear() {
    let (_dir, cache, key, info) = fixture();
    publish(&cache, &key, &info).unwrap();
    cache
        .with_store(|store| {
            let record = store.lookup(&key).unwrap().unwrap();
            store.clear(Some(cache_store::CacheKind::Metadata)).unwrap();
            assert!(store.open_blob(&record).is_err());
            Ok(())
        })
        .unwrap();
}
#[cfg(windows)]
#[test]
fn a_verified_open_cache_blob_denies_mutation() {
    let (_dir, cache, key, info) = fixture();
    publish(&cache, &key, &info).unwrap();
    cache
        .with_store(|store| {
            let record = store.lookup(&key).unwrap().unwrap();
            let pin = store.open_blob(&record).unwrap();
            let path = store.root().join(&record.relative_name);
            assert!(std::fs::OpenOptions::new().write(true).open(path).is_err());
            drop(pin);
            Ok(())
        })
        .unwrap();
}
