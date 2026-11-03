use super::*;
#[test]
fn random_staging_name_keeps_the_entire_uuid() {
    assert!(is_owned_staging_path(Path::new(
        "~adp-thumbnail-00000000-0000-4000-8000-000000000001.partial"
    )));
    assert!(!is_owned_staging_path(Path::new(
        "~adp-thumbnail-000000000001.partial"
    )));
}
#[cfg(windows)]
#[test]
fn swapped_staging_is_never_truncated() {
    let dir = tempfile::tempdir().unwrap();
    let original = dir.path().join("owned.partial");
    std::fs::write(&original, b"").unwrap();
    let identity = file_identity(&File::open(&original).unwrap()).unwrap();
    let foreign = dir.path().join("foreign.partial");
    std::fs::write(&foreign, b"foreign content").unwrap();
    assert!(open_staging_for_write(&foreign, &identity).is_err());
    assert_eq!(std::fs::read(&foreign).unwrap(), b"foreign content");
}

#[cfg(windows)]
#[test]
fn guard_drop_without_child_removes_only_its_created_file() {
    let directory = tempfile::tempdir().unwrap();
    let foreign = directory.path().join("foreign.partial");
    std::fs::write(&foreign, b"user data").unwrap();
    let guard = GuardedStaging::create(directory.path()).unwrap();
    let owned = guard.path.clone();
    assert!(owned.exists());
    drop(guard);
    assert!(!owned.exists());
    assert_eq!(std::fs::read(foreign).unwrap(), b"user data");
}

#[cfg(windows)]
#[test]
fn reserved_output_counts_its_cap_until_writer_finishes_and_then_cleans() {
    use std::io::Write;
    let directory = tempfile::tempdir().unwrap();
    let guard = GuardedStaging::create_reserved(
        directory.path(),
        crate::thumbnail_encode::MAX_OUTPUT_BYTES,
    )
    .unwrap();
    let path = guard.path.clone();
    assert_eq!(
        std::fs::symlink_metadata(&path).unwrap().len(),
        crate::thumbnail_encode::MAX_OUTPUT_BYTES
    );
    let mut writer = open_staging_for_write(&path, &guard.identity).unwrap();
    writer.write_all(b"bounded result").unwrap();
    assert_eq!(
        writer.metadata().unwrap().len(),
        crate::thumbnail_encode::MAX_OUTPUT_BYTES
    );
    writer.set_len(14).unwrap();
    writer.sync_all().unwrap();
    drop(writer);
    let reader = open_staged_read(&path).unwrap();
    drop(guard);
    assert_eq!(reader.metadata().unwrap().len(), 14);
    drop(reader);
    assert!(!path.exists());
}

#[cfg(windows)]
#[test]
fn child_write_then_guard_drop_keeps_read_lease_and_physical_measurement() {
    use std::io::{Read, Write};
    let directory = tempfile::tempdir().unwrap();
    let guard = GuardedStaging::create(directory.path()).unwrap();
    let path = guard.path.clone();
    assert!(
        std::fs::remove_file(&path).is_err(),
        "guard denies foreign deletion"
    );
    let mut child = open_staging_for_write(&path, &guard.identity).unwrap();
    child.write_all(b"bounded result").unwrap();
    child.sync_all().unwrap();
    drop(child);
    let mut read = open_staged_read(&path).unwrap();
    assert_eq!(file_identity(&read).unwrap(), guard.identity);
    assert!(
        std::fs::OpenOptions::new().write(true).open(&path).is_err(),
        "reader denies writes"
    );
    drop(guard);
    // Cache physical accounting uses symlink_metadata while this lease lives.
    assert_eq!(std::fs::symlink_metadata(&path).unwrap().len(), 14);
    let bytes = std::fs::read_dir(directory.path())
        .unwrap()
        .map(|entry| {
            std::fs::symlink_metadata(entry.unwrap().path())
                .unwrap()
                .len()
        })
        .sum::<u64>();
    assert_eq!(bytes, 14);
    let mut data = Vec::new();
    read.read_to_end(&mut data).unwrap();
    assert_eq!(data, b"bounded result");
    drop(read);
    assert!(!path.exists());
}

/// Invoked by its parent test in a separate owned process; ordinary runs do no work.
#[cfg(windows)]
#[test]
fn staging_crash_fixture() {
    use std::io::Write;
    let Some(directory) = std::env::var_os("ADPERASTRA_STAGING_CRASH_DIRECTORY") else {
        return;
    };
    let directory = std::path::PathBuf::from(directory);
    let guard = GuardedStaging::create(&directory).unwrap();
    let mode = std::env::var("ADPERASTRA_STAGING_CRASH_MODE").unwrap();
    if mode != "before_write" {
        let mut writer = open_staging_for_write(&guard.path, &guard.identity).unwrap();
        writer.write_all(b"crash result").unwrap();
        writer.sync_all().unwrap();
        drop(writer);
    }
    let owned = guard.path.clone();
    let retained = if mode == "after_read" {
        Some(open_staged_read(&owned).unwrap())
    } else {
        None
    };
    let guard = if mode == "after_read" {
        drop(guard);
        None
    } else {
        Some(guard)
    };
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(directory.join("ready.txt"))
        .unwrap()
        .write_all(owned.to_str().unwrap().as_bytes())
        .unwrap();
    loop {
        std::hint::black_box((&guard, &retained));
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}

#[cfg(windows)]
#[test]
fn process_crash_cleans_before_write_after_write_and_after_guard_handoff() {
    use std::os::windows::process::CommandExt;
    for mode in ["before_write", "after_write", "after_read"] {
        let directory = tempfile::tempdir().unwrap();
        let fixture = format!(
            "{}::staging_crash_fixture",
            module_path!().split_once("::").unwrap().1
        );
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", &fixture, "--nocapture"])
            .env("ADPERASTRA_STAGING_CRASH_DIRECTORY", directory.path())
            .env("ADPERASTRA_STAGING_CRASH_MODE", mode)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .creation_flags(crate::helper::CREATE_NO_WINDOW)
            .spawn()
            .unwrap();
        let ready = directory.path().join("ready.txt");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        let path = loop {
            if let Ok(name) = std::fs::read_to_string(&ready) {
                if !name.is_empty() {
                    break std::path::PathBuf::from(name);
                }
            }
            if std::time::Instant::now() >= deadline || child.try_wait().unwrap().is_some() {
                let _ = child.kill();
                let _ = child.wait();
                panic!("owned staging fixture did not initialize: {mode}");
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        };
        assert!(
            std::fs::symlink_metadata(&path).is_ok(),
            "fixture has live staging before crash"
        );
        child.kill().unwrap();
        child.wait().unwrap();
        assert!(
            !path.exists(),
            "kernel cleans last handle after crash: {mode}"
        );
    }
}
