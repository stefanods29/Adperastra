use cache_store::{CacheKey, CacheKind, CacheStore, SourceStamp};

#[test]
fn scene_larger_than_thumbnail_budget_survives_publish_lookup_and_open() {
    let directory = tempfile::tempdir().unwrap();
    let store = CacheStore::open(&directory.path().join("cache"), 32 * 1024 * 1024).unwrap();
    let path = directory.path().join("scene.bin");
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(path)
        .unwrap();
    file.set_len(5 * 1024 * 1024).unwrap();
    let mut key = CacheKey {
        source: SourceStamp {
            path_key: r"c:\scene.glb".into(),
            volume_id: "00000001".into(),
            file_id: "0000000000000001".into(),
            modified_ticks: "1".into(),
            size_bytes: 1,
        },
        kind: CacheKind::ModelScene,
        handler_id: "model".into(),
        handler_version: 1,
        options_key: "scene=1".into(),
    };
    let record = store
        .publish(&key, &file, "application/x-adperastra-scene", None, None)
        .unwrap();
    assert_eq!(store.lookup(&key).unwrap().unwrap().blob_id, record.blob_id);
    assert_eq!(
        store.open_blob(&record).unwrap().metadata().unwrap().len(),
        5 * 1024 * 1024
    );
    key.kind = CacheKind::Thumbnail;
    assert!(store.publish(&key, &file, "image/png", None, None).is_err());
    assert!(store.usage().unwrap().disk_bytes <= store.limit_bytes());
}
