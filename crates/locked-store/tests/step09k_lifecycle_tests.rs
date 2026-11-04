//! Step 09k T6: idle/workstation locking, verified pending generations and
//! non-rebinding Save encrypted copy.

use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime};

use age::secrecy::{ExposeSecret, SecretString};
use fs_service::new_cancellation_token;
use locked_store::chunks::protocol_ranges;
use locked_store::create::{create_locked_copy, CreateDeps};
use locked_store::generations::{write_generation, ChangeSet, Generation};
use locked_store::lifecycle::{
    auto_lock_decision, idle_deadline, idle_due, keep_recovery_allows_close, lock_decision,
    save_copy_keeps_original, LockDecision,
};
use locked_store::open::unlock_with_password;
use locked_store::types::LockedCreateRequest;
use locked_store::verify::{hash_source, verify_generation};
use locked_store::Limits;
use zeroize::Zeroizing;

fn password() -> SecretString {
    SecretString::from("a twelve char password".to_string())
}

fn source_folder(root: &Path) -> std::path::PathBuf {
    let source = root.join("source");
    fs::create_dir_all(&source).unwrap();
    fs::write(source.join("a.txt"), b"alpha").unwrap();
    source
}

fn make_container(root: &Path) -> (std::path::PathBuf, std::path::PathBuf) {
    let source = source_folder(root);
    let dest = root.join("v.adplock");
    let recovery = root.join("v.adprecovery");
    let request = LockedCreateRequest {
        source_dir: source.to_string_lossy().into_owned(),
        dest_path: dest.to_string_lossy().into_owned(),
        password: password(),
        recovery_dest_path: recovery.to_string_lossy().into_owned(),
        keep_original: true,
        confirm_original_unprotected: true,
    };
    let zone = |_: &Path| false;
    let token = new_cancellation_token();
    let mut deps = CreateDeps::quiet(&zone, &token);
    create_locked_copy(&request, &mut deps).unwrap();
    (dest, recovery)
}

#[test]
fn idle_timer_is_five_minutes_and_never_is_zero() {
    let start = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000);
    assert_eq!(
        idle_deadline(start, 5),
        Some(start + Duration::from_secs(300))
    );
    assert!(!idle_due(start, 5, start + Duration::from_secs(299)));
    assert!(idle_due(start, 5, start + Duration::from_secs(300)));
    assert_eq!(idle_deadline(start, 0), None);
    assert!(!idle_due(start, 0, start + Duration::from_secs(10_000)));
}

#[test]
fn workstation_lock_uses_the_same_fail_safe_decision() {
    assert_eq!(auto_lock_decision(true, false), LockDecision::LockPending);
    assert_eq!(lock_decision(true, false, true), LockDecision::Locked);
    assert_eq!(lock_decision(true, true, false), LockDecision::Locked);
    assert_eq!(lock_decision(false, false, false), LockDecision::Locked);
}

#[test]
fn pending_persist_failure_does_not_report_locked() {
    assert_eq!(lock_decision(true, false, false), LockDecision::LockPending);
}

#[test]
fn pending_generation_is_decryptable_after_a_simulated_crash() {
    let root = tempfile::tempdir().unwrap();
    let (container, _recovery) = make_container(root.path());
    let mut opened = unlock_with_password(&container, &password(), Limits::default()).unwrap();
    let entry = opened
        .index
        .entries
        .iter()
        .find(|entry| entry.name == "a.txt")
        .unwrap()
        .clone();
    let change = ChangeSet {
        entry_id: entry.id,
        bytes: Zeroizing::new(b"beta".to_vec()),
        modified_unix: 2,
    };
    let password_slot = opened.file.password_slot().to_vec();
    let recovery_slot = opened.file.recovery_slot().to_vec();
    let dest = root.path().join("pending.adplock");
    let pin = fs_service::owned_io::PinnedDirectory::open(root.path()).unwrap();
    let mut output = fs_service::owned_io::OwnedOutput::create(&pin, "pending").unwrap();
    let (index, _header) = write_generation(
        output.file_mut(),
        Generation {
            source: &mut opened.file,
            index: &opened.index,
            identity: &opened.identity,
            password_slot: &password_slot,
            recovery_slot: &recovery_slot,
            changes: &[change],
            revision: 2,
            limits: Limits::default(),
        },
    )
    .unwrap();
    output.flush_sync().unwrap();
    output.close().publish_to(&dest).unwrap();
    verify_generation(&dest, &index, &opened.identity, Limits::default()).unwrap();
    let mut reopened = unlock_with_password(&dest, &password(), Limits::default()).unwrap();
    let entry = reopened
        .index
        .entries
        .iter()
        .find(|item| item.name == "a.txt")
        .unwrap();
    let bytes = reopened
        .file
        .read_entry_range(
            &reopened.identity,
            entry,
            &reopened.index.chunk_records,
            0,
            4,
        )
        .unwrap();
    assert_eq!(&*bytes, b"beta");
}

#[test]
fn save_copy_does_not_rebind_or_clean_the_original() {
    let root = tempfile::tempdir().unwrap();
    let (container, _recovery) = make_container(root.path());
    let before = hash_source(&container).unwrap();
    let mut opened = unlock_with_password(&container, &password(), Limits::default()).unwrap();
    let entry = opened
        .index
        .entries
        .iter()
        .find(|item| item.name == "a.txt")
        .unwrap()
        .clone();
    let change = ChangeSet {
        entry_id: entry.id,
        bytes: Zeroizing::new(b"changed".to_vec()),
        modified_unix: 2,
    };
    let password_slot = opened.file.password_slot().to_vec();
    let recovery_slot = opened.file.recovery_slot().to_vec();
    let copy = root.path().join("copy.adplock");
    let pin = fs_service::owned_io::PinnedDirectory::open(root.path()).unwrap();
    let mut output = fs_service::owned_io::OwnedOutput::create(&pin, "copy").unwrap();
    let (index, _header) = write_generation(
        output.file_mut(),
        Generation {
            source: &mut opened.file,
            index: &opened.index,
            identity: &opened.identity,
            password_slot: &password_slot,
            recovery_slot: &recovery_slot,
            changes: &[change],
            revision: 2,
            limits: Limits::default(),
        },
    )
    .unwrap();
    output.flush_sync().unwrap();
    output.close().publish_to(&copy).unwrap();
    verify_generation(&copy, &index, &opened.identity, Limits::default()).unwrap();
    assert_eq!(hash_source(&container).unwrap(), before);
    assert!(save_copy_keeps_original(true, true));
    let mut reopened = unlock_with_password(&container, &password(), Limits::default()).unwrap();
    let original_entry = reopened
        .index
        .entries
        .iter()
        .find(|item| item.name == "a.txt")
        .unwrap();
    let bytes = reopened
        .file
        .read_entry_range(
            &reopened.identity,
            original_entry,
            &reopened.index.chunk_records,
            0,
            5,
        )
        .unwrap();
    assert_eq!(&*bytes, b"alpha");
}

#[test]
fn newer_edits_and_missing_receipts_prevent_keep_recovery_close() {
    assert!(keep_recovery_allows_close(
        &["a".to_string(), "b".to_string()],
        &["b".to_string(), "a".to_string()]
    ));
    assert!(!keep_recovery_allows_close(
        &["a".to_string(), "new".to_string()],
        &["a".to_string()]
    ));
}

#[test]
fn eight_mib_read_splits_into_at_most_two_protocol_requests() {
    let ranges = protocol_ranges(0, 8 * 1024 * 1024).unwrap();
    assert_eq!(ranges.len(), 2);
    assert_eq!(ranges[0], (0, 4 * 1024 * 1024));
    assert_eq!(ranges[1], (4 * 1024 * 1024, 4 * 1024 * 1024));
    assert!(ranges.iter().all(|(_, length)| *length <= 4 * 1024 * 1024));
    assert!(protocol_ranges(0, 8 * 1024 * 1024 + 1).is_err());
}

#[test]
fn recovery_secret_is_independent_from_the_password() {
    let root = tempfile::tempdir().unwrap();
    let (_container, recovery) = make_container(root.path());
    let text = fs::read_to_string(&recovery).unwrap();
    assert!(text.contains("recovery_secret"));
    let file = locked_store::recovery_key::parse_recovery_text(&text).unwrap();
    assert_ne!(
        file.recovery_secret.expose_secret(),
        password().expose_secret()
    );
    assert!(file.recovery_secret.expose_secret().len() > 10);
}
