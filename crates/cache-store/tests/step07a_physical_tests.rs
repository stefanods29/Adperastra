use cache_store::{CacheKey, CacheKind, CacheStore, SourceStamp};

#[test]
fn the_physical_cap_includes_the_index_and_prepared_foreign_files() {
    let dir = tempfile::tempdir().unwrap();
    let cache = dir.path().join("cache");
    let store = CacheStore::open(&cache, 1024 * 1024).unwrap();
    let source_path = dir.path().join("prepared.bin");
    std::fs::write(&source_path, vec![1u8; 900_000]).unwrap();
    std::fs::write(cache.join("foreign.bin"), vec![2u8; 200_000]).unwrap();
    let key = CacheKey {
        source: SourceStamp {
            path_key: r"c:\image.png".into(),
            volume_id: "00000001".into(),
            file_id: "0000000000000001".into(),
            modified_ticks: "1".into(),
            size_bytes: 1,
        },
        kind: CacheKind::Thumbnail,
        handler_id: "test".into(),
        handler_version: 1,
        options_key: "".into(),
    };
    let source = std::fs::File::open(source_path).unwrap();
    assert!(store
        .publish(&key, &source, "image/png", None, None)
        .is_err());
    assert!(store.usage().unwrap().disk_bytes <= store.limit_bytes());
    assert_eq!(
        std::fs::metadata(cache.join("foreign.bin")).unwrap().len(),
        200_000
    );
}

#[cfg(windows)]
fn reserved_output(
    path: &std::path::Path,
    bytes: u64,
) -> Result<std::fs::File, cache_store::CacheError> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows::Win32::Storage::FileSystem::FILE_FLAG_DELETE_ON_CLOSE;
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .custom_flags(FILE_FLAG_DELETE_ON_CLOSE.0)
        .open(path)?;
    file.set_len(bytes)?;
    Ok(file)
}

#[cfg(windows)]
#[test]
fn independent_stores_serialize_staging_reservations_and_keep_foreign_bytes() {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Barrier,
    };
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("cache");
    let first = CacheStore::open(&root, 2 * 1024 * 1024).unwrap();
    let second = CacheStore::open(&root, 2 * 1024 * 1024).unwrap();
    let foreign = root.join("pending/foreign.bin");
    let original = vec![17; 256 * 1024];
    std::fs::write(&foreign, &original).unwrap();
    let barrier = Arc::new(Barrier::new(2));
    let callbacks = Arc::new(AtomicUsize::new(0));
    let retained: Vec<_> = std::thread::scope(|scope| {
        [first, second]
            .into_iter()
            .enumerate()
            .map(|(index, store)| {
                let barrier = Arc::clone(&barrier);
                let callbacks = Arc::clone(&callbacks);
                let path = root.join(format!("pending/owned-{index}.partial"));
                scope.spawn(move || {
                    barrier.wait();
                    store.with_staging_budget(900_000, || {
                        callbacks.fetch_add(1, Ordering::SeqCst);
                        reserved_output(&path, 900_000)
                    })
                })
            })
            .collect::<Vec<_>>()
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect()
    });
    assert_eq!(retained.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        retained
            .iter()
            .filter(|result| matches!(result, Err(cache_store::CacheError::Busy)))
            .count(),
        1
    );
    assert_eq!(
        callbacks.load(Ordering::SeqCst),
        1,
        "refused work creates no output"
    );
    let observer = CacheStore::open(&root, 2 * 1024 * 1024).unwrap();
    assert!(observer.usage().unwrap().disk_bytes <= observer.limit_bytes());
    observer.clear(None).unwrap();
    assert_eq!(std::fs::read(&foreign).unwrap(), original);
    drop(retained);
    assert_eq!(std::fs::read_dir(root.join("pending")).unwrap().count(), 1);
}

#[cfg(windows)]
#[test]
fn staging_budget_subprocess_fixture() {
    let Some(root) = std::env::var_os("ADPERASTRA_CACHE_BUDGET_FIXTURE") else {
        return;
    };
    let root = std::path::PathBuf::from(root);
    let store = CacheStore::open(&root, 2 * 1024 * 1024).unwrap();
    let called = std::cell::Cell::new(false);
    let result = store.with_staging_budget(900_000, || {
        called.set(true);
        reserved_output(&root.join("pending/child.partial"), 900_000)
    });
    assert!(matches!(result, Err(cache_store::CacheError::Busy)));
    assert!(!called.get());
}

#[cfg(windows)]
#[test]
fn a_second_process_observes_the_live_staging_reservation() {
    use std::os::windows::process::CommandExt;
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("cache");
    let store = CacheStore::open(&root, 2 * 1024 * 1024).unwrap();
    let foreign = root.join("pending/foreign.bin");
    std::fs::write(&foreign, vec![17; 256 * 1024]).unwrap();
    let retained = store
        .with_staging_budget(900_000, || {
            reserved_output(&root.join("pending/parent.partial"), 900_000)
        })
        .unwrap();
    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "staging_budget_subprocess_fixture",
            "--nocapture",
        ])
        .env("ADPERASTRA_CACHE_BUDGET_FIXTURE", &root)
        .stdin(std::process::Stdio::null())
        .creation_flags(0x0800_0000)
        .spawn()
        .unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            assert!(
                status.success(),
                "child must refuse admission before output creation"
            );
            break;
        }
        if std::time::Instant::now() >= deadline {
            child.kill().unwrap();
            child.wait().unwrap();
            panic!("owned budget fixture timed out");
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert!(store.usage().unwrap().disk_bytes <= store.limit_bytes());
    assert_eq!(std::fs::read(&foreign).unwrap(), vec![17; 256 * 1024]);
    assert!(!root.join("pending/child.partial").exists());
    drop(retained);
    assert!(!root.join("pending/parent.partial").exists());
}
