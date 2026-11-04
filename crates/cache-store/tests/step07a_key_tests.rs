use cache_store::{key_hash, CacheKey, CacheKind, SourceStamp};

fn stamp(modified_ticks: &str) -> SourceStamp {
    SourceStamp {
        path_key: r"c:\pictures\report.png".to_string(),
        volume_id: "1a2b3c4d".to_string(),
        // 2^53 + 1: a file ID a JavaScript number can no longer hold.
        file_id: "0020000000000001".to_string(),
        modified_ticks: modified_ticks.to_string(),
        size_bytes: 4_096,
    }
}

fn key(modified_ticks: &str) -> CacheKey {
    CacheKey {
        source: stamp(modified_ticks),
        kind: CacheKind::Thumbnail,
        handler_id: "wic".to_string(),
        handler_version: 1,
        options_key: "edge=128".to_string(),
    }
}

#[test]
fn cache_key_changes_with_file_revision() {
    let early = key_hash(&key("10")).unwrap();
    let late = key_hash(&key("11")).unwrap();
    assert_ne!(early, late, "a 100 ns revision must change the hash");
    assert_eq!(early, key_hash(&key("10")).unwrap());
    assert_eq!(early.len(), 64);
}

#[test]
fn ids_do_not_lose_precision() {
    let key = key("10");
    assert_eq!(key.source.file_id, "0020000000000001");
    let json = serde_json::to_string(&key.source).unwrap();
    assert!(json.contains("\"file_id\":\"0020000000000001\""));
    let back: SourceStamp = serde_json::from_str(&json).unwrap();
    assert_eq!(back, key.source);
    assert_eq!(
        key_hash(&key).unwrap(),
        key_hash(&CacheKey {
            source: back,
            ..key
        })
        .unwrap()
    );

    let mut bad = stamp("10");
    bad.file_id = "002000000000000G".to_string();
    assert!(bad.validate().is_err());
    let mut uppercase = stamp("10");
    uppercase.file_id = "002000000000000A".to_string();
    assert!(uppercase.validate().is_err());
    let mut coarse = stamp("10");
    coarse.modified_ticks = String::new();
    assert!(coarse.validate().is_err());
}
