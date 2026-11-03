use cache_store::{CacheError, CacheKey, CacheKind, CacheStore, SourceStamp};
fn key() -> CacheKey {
    CacheKey {
        source: SourceStamp {
            path_key: r"c:\a.png".into(),
            volume_id: "00000001".into(),
            file_id: "0000000000000001".into(),
            modified_ticks: "1".into(),
            size_bytes: 4,
        },
        kind: CacheKind::Thumbnail,
        handler_id: "test".into(),
        handler_version: 1,
        options_key: String::new(),
    }
}
fn prepared(root: &std::path::Path) -> std::fs::File {
    let p = root.join("prepared");
    std::fs::write(&p, b"data").unwrap();
    std::fs::File::open(p).unwrap()
}
#[test]
fn mime_header_controls_are_refused() {
    let dir = tempfile::tempdir().unwrap();
    let store = CacheStore::open(&dir.path().join("cache"), 4 * 1024 * 1024).unwrap();
    assert_eq!(
        store.publish(
            &key(),
            &prepared(dir.path()),
            "image/png\r\nX-Header: injected",
            None,
            None
        ),
        Err(CacheError::BadRequest)
    );
}
#[test]
fn an_untracked_uuid_file_is_kept_even_after_clear() {
    let dir = tempfile::tempdir().unwrap();
    let store = CacheStore::open(&dir.path().join("cache"), 4 * 1024 * 1024).unwrap();
    let foreign = store
        .root()
        .join("blobs/00112233-4455-4677-8899-aabbccddeeff.png");
    std::fs::write(&foreign, b"foreign").unwrap();
    store.clear(None).unwrap();
    store.trim().unwrap();
    assert_eq!(std::fs::read(foreign).unwrap(), b"foreign");
}
#[test]
fn a_replaced_owned_path_is_not_read_or_deleted() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("cache");
    let store = CacheStore::open(&root, 4 * 1024 * 1024).unwrap();
    let record = store
        .publish(&key(), &prepared(dir.path()), "image/png", None, None)
        .unwrap();
    let p = root.join(&record.relative_name);
    std::fs::rename(&p, root.join("original-owned.png")).unwrap();
    std::fs::write(&p, b"evil").unwrap();
    assert_eq!(store.lookup(&key()).unwrap(), None);
    assert!(store.open_blob(&record).is_err());
    store.clear(None).unwrap();
    assert_eq!(std::fs::read(p).unwrap(), b"evil");
}
#[test]
fn a_newer_schema_is_refused_without_database_changes() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("cache");
    std::fs::create_dir_all(&root).unwrap();
    let db = root.join("index.sqlite3");
    let conn = rusqlite::Connection::open(&db).unwrap();
    conn.execute_batch("CREATE TABLE meta(schema_version INTEGER);INSERT INTO meta VALUES(99);")
        .unwrap();
    drop(conn);
    let before = std::fs::read(&db).unwrap();
    assert!(matches!(
        CacheStore::open(&root, 4 * 1024 * 1024),
        Err(CacheError::Unavailable)
    ));
    assert_eq!(std::fs::read(db).unwrap(), before);
}
#[test]
fn lowering_the_budget_never_admits_more_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let store = CacheStore::open(&dir.path().join("cache"), 4 * 1024 * 1024).unwrap();
    store.set_limit(100);
    assert_eq!(
        store.publish(&key(), &prepared(dir.path()), "image/png", None, None),
        Err(CacheError::Busy)
    );
    assert_eq!(store.usage().unwrap().entry_count, 0);
}

#[test]
fn corrupt_record_numbers_disable_reads_without_deleting_the_blob() {
    for column in ["byte_len", "width", "height", "used_unix", "pending_delete"] {
        let dir = tempfile::tempdir().unwrap();
        let store = CacheStore::open(&dir.path().join("cache"), 4 * 1024 * 1024).unwrap();
        let record = store
            .publish(&key(), &prepared(dir.path()), "image/png", Some(1), Some(1))
            .unwrap();
        let database = rusqlite::Connection::open(store.root().join("index.sqlite3")).unwrap();
        database
            .execute(&format!("UPDATE entries SET {column}=-1"), [])
            .unwrap();
        assert_eq!(store.usage(), Err(CacheError::Unavailable), "{column}");
        assert_eq!(store.clear(None), Err(CacheError::Unavailable), "{column}");
        assert_eq!(
            std::fs::read(store.root().join(record.relative_name)).unwrap(),
            b"data",
            "corruption never authorizes a cleanup: {column}"
        );
    }
}

#[test]
fn an_oversized_index_is_refused_before_bulk_cleanup() {
    let dir = tempfile::tempdir().unwrap();
    let store = CacheStore::open(&dir.path().join("cache"), 32 * 1024 * 1024).unwrap();
    let record = store
        .publish(&key(), &prepared(dir.path()), "image/png", None, None)
        .unwrap();
    let database = rusqlite::Connection::open(store.root().join("index.sqlite3")).unwrap();
    database
        .execute_batch(
            "WITH RECURSIVE extra(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM extra WHERE n<50000)
         INSERT INTO entries SELECT printf('%064x',n),key_text,kind,blob_id,relative_name,mime,
           byte_len,width,height,used_unix,pending_delete FROM extra CROSS JOIN
           (SELECT * FROM entries LIMIT 1);",
        )
        .unwrap();
    assert_eq!(store.usage(), Err(CacheError::Unavailable));
    assert_eq!(store.clear(None), Err(CacheError::Unavailable));
    assert_eq!(
        std::fs::read(store.root().join(record.relative_name)).unwrap(),
        b"data"
    );
}
