//! Reviewed recovered copies and recovery-required rename journals
//! (Step 09h T3). Opening a recovery record is an explicit authorization to
//! write one new app-owned plaintext copy; the original file is never
//! replaced and the encrypted record is retained until the user discards it.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, State, WebviewWindow};
use tauri::Manager;
use uuid::Uuid;

use crate::jobs::{spawn_job, JobContext, Jobs};
use crate::recovery_store::{RecoveryStore, RECOVERY_DIR};
use crate::recovery_types::RecoveryOpenResult;
use crate::{ensure_main, AppState};

/// New plaintext copies live below this folder in the app data directory.
pub const OPEN_DIR: &str = "recovery-open";
/// Proves that a recovered-copy folder was created by this app.
pub const OPEN_MARKER: &str = "owner.json";
pub const OPEN_MARKER_TEXT: &str = "{\"kind\":\"adperastra-recovery-open\",\"version\":1}";
/// Where unfinished rename plans are recorded (Step 09e).
pub const RENAME_JOURNAL_DIR: &str = "rename-journals";

/// The fixed mark applied to a recovered copy of an internet file.
pub const INTERNET_ZONE_TEXT: &str = "[ZoneTransfer]\r\nZoneId=3\r\n";

/// Write one recovered revision below `<data>/recovery-open/<new UUID>/`.
/// `name` is a single validated component; publication never replaces.
pub fn write_recovered_copy(
    data_dir: &Path,
    metadata: &crate::recovery_types::RecoveryMetadata,
    encoded: &[u8],
) -> Result<RecoveryOpenResult, String> {
    // The same validation the store applied before saving, repeated before
    // any new plaintext is written from a record read back from disk.
    crate::recovery_types::validate_metadata(metadata)?;
    if metadata.byte_len > crate::recovery_types::MAX_RECORD_BYTES {
        return Err("recovery.too_large".to_string());
    }
    if encoded.len() as u64 != metadata.byte_len {
        return Err("recovery.changed".to_string());
    }
    fs_service::validate_new_name(&metadata.name).map_err(|_| "recovery.invalid".to_string())?;
    if metadata.name.contains('/') || metadata.name.contains('\\') {
        return Err("recovery.invalid".to_string());
    }
    let root = data_dir.join(OPEN_DIR);
    std::fs::create_dir_all(&root).map_err(|_| "recovery.io".to_string())?;
    let mut folder = None;
    for _ in 0..4 {
        let candidate = root.join(Uuid::new_v4().to_string());
        match std::fs::create_dir(&candidate) {
            Ok(()) => {
                folder = Some(candidate);
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("recovery.io".to_string()),
        }
    }
    let folder = folder.ok_or_else(|| "recovery.io".to_string())?;
    let marker = folder.join(OPEN_MARKER);
    let mut marker_file = match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&marker)
    {
        Ok(file) => file,
        Err(_) => {
            // The folder we just created is empty; a foreign marker that
            // appeared meanwhile makes the removal fail and is left alone.
            let _ = std::fs::remove_dir(&folder);
            return Err("recovery.io".to_string());
        }
    };
    let marker_written = {
        use std::io::Write;
        let written = marker_file.write_all(OPEN_MARKER_TEXT.as_bytes());
        written.and_then(|_| marker_file.sync_all())
    };
    drop(marker_file);
    if marker_written.is_err() {
        let _ = std::fs::remove_file(&marker);
        let _ = std::fs::remove_dir(&folder);
        return Err("recovery.io".to_string());
    }
    let result = publish_copy(&folder, metadata, encoded);
    if result.is_err() {
        // Remove the marker and the folder only when no other entry remains.
        // A copy this call published (for example when the internet mark
        // failed) stays with its marker so startup cleanup can find it.
        dispose_fresh_open_folder(&folder);
    }
    result
}

fn publish_copy(
    folder: &Path,
    metadata: &crate::recovery_types::RecoveryMetadata,
    encoded: &[u8],
) -> Result<RecoveryOpenResult, String> {
    let directory = fs_service::owned_io::PinnedDirectory::open(folder)
        .map_err(|_| "recovery.io".to_string())?;
    let mut output = fs_service::owned_io::OwnedOutput::create(&directory, "recovered")
        .map_err(|_| "recovery.io".to_string())?;
    {
        use std::io::Write;
        output
            .file_mut()
            .write_all(encoded)
            .map_err(|_| "recovery.io".to_string())?;
    }
    output
        .flush_sync()
        .map_err(|_| "recovery.io".to_string())?;
    let path = output
        .publish_name(&metadata.name)
        .map_err(|_| "recovery.io".to_string())?;
    // The staging handle is exclusive; close it before opening the
    // Zone.Identifier stream on the same file.
    drop(output);
    if metadata.from_internet {
        apply_internet_mark(&path)?;
    }
    Ok(RecoveryOpenResult {
        record_id: metadata.record_id,
        copy_path: path.to_string_lossy().into_owned(),
        from_internet: metadata.from_internet,
    })
}

fn apply_internet_mark(path: &Path) -> Result<(), String> {
    use std::io::Write;
    let stream = crate::zone::zone_stream_path(path)
        .ok_or_else(|| "recovery.io".to_string())?;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&stream)
        .map_err(|_| "recovery.io".to_string())?;
    file.write_all(INTERNET_ZONE_TEXT.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|_| "recovery.io".to_string())
}

/// Delete only the marker and the fresh folder when they are the only
/// entries. Anything else (a published copy, a foreign file that raced in)
/// keeps the folder and its ownership marker.
fn dispose_fresh_open_folder(folder: &Path) {
    let remaining = match std::fs::read_dir(folder) {
        Ok(entries) => entries
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().as_ref() != OPEN_MARKER)
            .count(),
        Err(_) => 1,
    };
    if remaining == 0 {
        let _ = std::fs::remove_file(folder.join(OPEN_MARKER));
        let _ = std::fs::remove_dir(folder);
    }
}

/// Recovered plaintext copies share this budget under the data folder.
pub const MAX_OPEN_TOTAL: u64 = 1_073_741_824;

fn is_reparse_entry(metadata: &std::fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// The marker is tiny and fixed; anything else is not an ownership proof.
fn open_marker_matches(folder: &Path) -> bool {
    let marker = folder.join(OPEN_MARKER);
    let Ok(metadata) = std::fs::symlink_metadata(&marker) else {
        return false;
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 1_024 {
        return false;
    }
    std::fs::read_to_string(marker)
        .is_ok_and(|text| text == OPEN_MARKER_TEXT)
}

fn open_copy_entry(children: &[std::fs::DirEntry]) -> Option<&std::fs::DirEntry> {
    children.iter().find(|child| {
        child.file_name().to_string_lossy().as_ref() != OPEN_MARKER
            && std::fs::symlink_metadata(child.path())
                .is_ok_and(|metadata| metadata.is_file() && !metadata.file_type().is_symlink())
    })
}

/// Remove the oldest app-owned recovered copies until the total is under the
/// 1 GiB cap. Call only at startup, before any copy is granted to a view, so
/// no active grant can be removed. A folder whose name is not a UUID, that is
/// a link or reparse point, or that holds anything else is foreign and is
/// left alone.
pub fn cleanup_open_copies(data_dir: &Path) -> Result<u64, String> {
    cleanup_open_copies_bounded(data_dir, MAX_OPEN_TOTAL)
}

fn cleanup_open_copies_bounded(data_dir: &Path, limit: u64) -> Result<u64, String> {
    let root = data_dir.join(OPEN_DIR);
    let entries = match std::fs::read_dir(&root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(_) => return Err("recovery.io".to_string()),
    };
    let mut folders: Vec<(std::time::SystemTime, PathBuf, u64)> = Vec::new();
    let mut total = 0u64;
    for entry in entries.flatten().take(1_000) {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(metadata) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if Uuid::parse_str(&name).is_err() || !metadata.is_dir() || is_reparse_entry(&metadata) {
            continue;
        }
        if !open_marker_matches(&path) {
            continue;
        }
        let Ok(children) = std::fs::read_dir(&path) else {
            continue;
        };
        let children: Vec<_> = children.flatten().collect();
        if children.len() == 1 {
            // Residue of a failed open: marker only, no copy.
            let _ = std::fs::remove_file(path.join(OPEN_MARKER));
            let _ = std::fs::remove_dir(&path);
            continue;
        }
        if children.len() != 2 {
            continue;
        }
        let Some(copy) = open_copy_entry(&children) else {
            continue;
        };
        let Ok(copy_metadata) = std::fs::symlink_metadata(copy.path()) else {
            continue;
        };
        total = total.saturating_add(copy_metadata.len());
        let modified = copy_metadata
            .modified()
            .unwrap_or(std::time::UNIX_EPOCH);
        folders.push((modified, path, copy_metadata.len()));
    }
    if total <= limit {
        return Ok(total);
    }
    folders.sort_by_key(|entry| entry.0);
    for (_, folder, length) in folders {
        if total <= limit {
            break;
        }
        // Re-check the exact marker and exactly one regular copy.
        if !open_marker_matches(&folder) {
            continue;
        }
        let Ok(children) = std::fs::read_dir(&folder) else {
            continue;
        };
        let children: Vec<_> = children.flatten().collect();
        if children.len() != 2 {
            continue;
        }
        let Some(copy) = open_copy_entry(&children) else {
            continue;
        };
        if std::fs::remove_file(copy.path()).is_ok()
            && std::fs::remove_file(folder.join(OPEN_MARKER)).is_ok()
            && std::fs::remove_dir(&folder).is_ok()
        {
            total = total.saturating_sub(length);
        }
    }
    Ok(total)
}

/// Journals that did not reach `committed`. The caller may report
/// `rename.recovery_required`; this function never deletes, renames or
/// interprets an intermediate name.
pub fn unfinished_rename_journals(data_dir: &Path) -> Vec<PathBuf> {
    let folder = data_dir.join(RENAME_JOURNAL_DIR);
    let Ok(entries) = std::fs::read_dir(folder) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for entry in entries.flatten().take(1_000) {
        let path = entry.path();
        if !path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
        {
            continue;
        }
        // Only the app's `<plan UUID>.json` journal is reported; another
        // name is foreign. A symlink, folder or oversized file is never
        // followed.
        let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) else {
            continue;
        };
        if Uuid::parse_str(stem).is_err() {
            continue;
        }
        let Ok(metadata) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.file_type().is_symlink()
            || !metadata.is_file()
            || metadata.len() > 11 * 1_048_576
        {
            continue;
        }
        let state = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
            .and_then(|value| {
                value
                    .get("state")
                    .or_else(|| value.get("status"))
                    .and_then(|state| state.as_str())
                    .map(str::to_string)
            });
        if state.as_deref() != Some("committed") {
            found.push(path);
        }
    }
    found.sort();
    found
}

#[tauri::command]
pub fn recovery_open_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    app: AppHandle,
    request_id: String,
    record_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    let id = Uuid::parse_str(&record_id).map_err(|_| "recovery.invalid".to_string())?;
    let token = jobs.begin(&request_id, 1)?;
    let data_dir = app.state::<AppState>().data_dir.clone();
    spawn_job(app.clone(), request_id, token, move |_context: &JobContext| {
        let (metadata, encoded) = {
            let _store_guard = crate::recovery_store::lock_store()?;
            let root = data_dir.join(RECOVERY_DIR);
            let _process_guard = crate::recovery_store::take_store_lock(&root)?;
            let store = RecoveryStore::new(root);
            store.read(id)?
        };
        let result = write_recovered_copy(&data_dir, &metadata, &encoded)?;
        serde_json::to_value(result).map_err(|_| "recovery.io".to_string())
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recovery_envelope::sha256_hex;
    use crate::recovery_store::{RecordProtector, RecoveryStore};
    use crate::recovery_types::{RecoveryMetadata, MAX_RECORD_BYTES};
    use std::sync::Arc;
    use zeroize::Zeroizing;

    struct CopyProtector;

    impl RecordProtector for CopyProtector {
        fn protect(&self, plain: &[u8]) -> Result<Vec<u8>, String> {
            let mut bytes = b"COPYPROTECT".to_vec();
            bytes.extend_from_slice(plain);
            Ok(bytes)
        }

        fn unprotect(&self, cipher: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
            if !cipher.starts_with(b"COPYPROTECT") {
                return Err("recovery.corrupt".to_string());
            }
            Ok(Zeroizing::new(cipher[11..].to_vec()))
        }
    }

    fn metadata(name: &str, content: &[u8]) -> RecoveryMetadata {
        RecoveryMetadata {
            version: 1,
            record_id: Uuid::new_v4(),
            document_id: Uuid::new_v4(),
            source: crate::recovery_types::disk_source("C:\\Work\\notes.txt").unwrap(),
            source_stamp: None,
            name: name.to_string(),
            mime: "text/plain".to_string(),
            handler_id: "text".to_string(),
            captured_revision: 2,
            content_id: Uuid::new_v4(),
            captured_unix: 1_700_000_000,
            byte_len: content.len() as u64,
            from_internet: false,
            sensitive: false,
        }
    }

    fn save(folder: &Path, metadata: &RecoveryMetadata, content: &[u8]) -> RecoveryStore {
        let store = RecoveryStore::with_protector(
            folder.join(RECOVERY_DIR),
            Arc::new(CopyProtector),
        );
        store.save(metadata, content, metadata.captured_unix).unwrap();
        store
    }

    #[test]
    fn an_opened_copy_never_changes_the_original() {
        let folder = tempfile::tempdir().unwrap();
        let original = folder.path().join("notes.txt");
        std::fs::write(&original, "original bytes").unwrap();
        let before = sha256_hex(&std::fs::read(&original).unwrap());
        let metadata = metadata("notes.txt", b"edited bytes");
        let store = save(folder.path(), &metadata, b"edited bytes");

        let (read, content) = store.read(metadata.record_id).unwrap();
        let result = write_recovered_copy(folder.path(), &read, &content).unwrap();
        assert!(result.copy_path.contains("recovery-open"));
        assert_eq!(std::fs::read_to_string(&result.copy_path).unwrap(), "edited bytes");
        assert_eq!(sha256_hex(&std::fs::read(&original).unwrap()), before);
        assert!(store.root().join(crate::recovery_types::record_file_name(metadata.record_id)).exists());
    }

    #[test]
    fn an_internet_copy_keeps_the_mark_of_the_web() {
        let folder = tempfile::tempdir().unwrap();
        let mut metadata = metadata("download.txt", b"downloaded");
        metadata.from_internet = true;
        let store = save(folder.path(), &metadata, b"downloaded");
        let (read, content) = store.read(metadata.record_id).unwrap();
        let result = write_recovered_copy(folder.path(), &read, &content).unwrap();
        assert!(result.from_internet);
        assert_eq!(crate::zone::zone_id(Path::new(&result.copy_path)), Some(3));
    }

    #[test]
    fn a_missing_original_does_not_block_a_recovered_copy() {
        let folder = tempfile::tempdir().unwrap();
        let original = folder.path().join("gone.txt");
        std::fs::write(&original, "old").unwrap();
        let metadata = metadata("gone.txt", b"revision");
        let store = save(folder.path(), &metadata, b"revision");
        std::fs::remove_file(&original).unwrap();
        let (read, content) = store.read(metadata.record_id).unwrap();
        let result = write_recovered_copy(folder.path(), &read, &content).unwrap();
        assert_eq!(std::fs::read_to_string(&result.copy_path).unwrap(), "revision");
    }

    #[test]
    fn discard_removes_only_the_record() {
        let folder = tempfile::tempdir().unwrap();
        let original = folder.path().join("keep.txt");
        std::fs::write(&original, "keep me").unwrap();
        let metadata = metadata("keep.txt", b"revision");
        let store = save(folder.path(), &metadata, b"revision");
        store.discard(&[metadata.record_id]).unwrap();
        assert_eq!(std::fs::read_to_string(&original).unwrap(), "keep me");
        assert!(!store.root().join(crate::recovery_types::record_file_name(metadata.record_id)).exists());
    }

    #[test]
    fn an_unfinished_rename_journal_is_reported_and_no_path_is_cleaned() {
        let folder = tempfile::tempdir().unwrap();
        let journal_dir = folder.path().join(RENAME_JOURNAL_DIR);
        std::fs::create_dir_all(&journal_dir).unwrap();
        let unfinished = journal_dir.join(format!("{}.json", Uuid::new_v4()));
        std::fs::write(
            &unfinished,
            r#"{"state":"recovery_required","sources":["C:\\A\\~adp-rename-1"]}"#,
        )
        .unwrap();
        let committed = journal_dir.join(format!("{}.json", Uuid::new_v4()));
        std::fs::write(&committed, r#"{"state":"committed"}"#).unwrap();
        // A foreign name and a symlink-like entry are not reported.
        std::fs::write(journal_dir.join("plan.json"), r#"{"state":"renaming"}"#).unwrap();
        let intermediate = folder.path().join("~adp-rename-1");
        std::fs::write(&intermediate, "user data").unwrap();

        let found = unfinished_rename_journals(folder.path());
        assert_eq!(found, vec![unfinished.clone()]);
        assert_eq!(
            std::fs::read_to_string(&unfinished).unwrap(),
            r#"{"state":"recovery_required","sources":["C:\\A\\~adp-rename-1"]}"#
        );
        assert!(intermediate.exists());
        assert_eq!(std::fs::read_to_string(&intermediate).unwrap(), "user data");
    }

    #[test]
    fn a_name_outside_one_component_is_refused_before_writing() {
        let folder = tempfile::tempdir().unwrap();
        let mut metadata = metadata("ok.txt", b"bytes");
        metadata.name = "..\\escape.txt".to_string();
        assert_eq!(
            write_recovered_copy(folder.path(), &metadata, b"bytes").unwrap_err(),
            "recovery.invalid"
        );
        assert!(!folder.path().join(OPEN_DIR).exists());
    }

    #[test]
    fn a_record_over_the_cap_is_never_copied() {
        let folder = tempfile::tempdir().unwrap();
        let mut metadata = metadata("big.bin", b"");
        metadata.byte_len = MAX_RECORD_BYTES + 1;
        let content = vec![0u8; MAX_RECORD_BYTES as usize + 1];
        assert_eq!(
            write_recovered_copy(folder.path(), &metadata, &content).unwrap_err(),
            "recovery.too_large"
        );
    }

    fn owned_copy(root: &Path, bytes: &[u8], marker: &str) -> PathBuf {
        let folder = root.join(Uuid::new_v4().to_string());
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join(OPEN_MARKER), marker).unwrap();
        std::fs::write(folder.join("copy.txt"), bytes).unwrap();
        folder
    }

    #[test]
    fn cleanup_removes_owned_copies_until_the_cap_is_met() {
        let folder = tempfile::tempdir().unwrap();
        let root = folder.path().join(OPEN_DIR);
        std::fs::create_dir_all(&root).unwrap();
        let first = owned_copy(&root, b"12345678", OPEN_MARKER_TEXT);
        let second = owned_copy(&root, b"abcdefgh", OPEN_MARKER_TEXT);

        let total = cleanup_open_copies_bounded(folder.path(), 10).unwrap();
        assert!(total <= 10);
        let remaining: Vec<PathBuf> = std::fs::read_dir(&root)
            .unwrap()
            .flatten()
            .map(|entry| entry.path())
            .collect();
        assert_eq!(remaining.len(), 1);
        assert!(remaining[0] == first || remaining[0] == second);
        assert!(!(first.exists() && second.exists()));
    }

    #[test]
    fn cleanup_leaves_a_foreign_folder_and_removes_marker_residue() {
        let folder = tempfile::tempdir().unwrap();
        let root = folder.path().join(OPEN_DIR);
        std::fs::create_dir_all(&root).unwrap();
        let foreign = owned_copy(&root, b"12345678", "not our marker");
        let residue = root.join(Uuid::new_v4().to_string());
        std::fs::create_dir_all(&residue).unwrap();
        std::fs::write(residue.join(OPEN_MARKER), OPEN_MARKER_TEXT).unwrap();

        let total = cleanup_open_copies_bounded(folder.path(), 0).unwrap();
        assert_eq!(total, 0);
        assert!(foreign.exists(), "a foreign marker is never deleted");
        assert!(!residue.exists(), "an owned marker-only folder is removed");
    }
}
