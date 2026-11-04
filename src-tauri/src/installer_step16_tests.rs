//! Step 16 T5 tests: installer upgrade, uninstall ownership and offline pack
//! verification. Included by `installer_integration.rs`.

use std::path::Path;

use super::{
    plan_uninstall, plan_upgrade, verify_offline_catalog, AvailableArtifact, ExitAnswer,
    OfflineArtifactState, OfflineCatalog, OfflinePackEntry, UninstallChoice,
};

/// SHA-256 of the three bytes "abc".
const ABC_SHA256: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

fn pack(signed: bool) -> OfflinePackEntry {
    OfflinePackEntry {
        id: "media-engine".to_string(),
        version: "1.0.0".to_string(),
        file_name: "media-engine-1.0.0.pack".to_string(),
        sha256: ABC_SHA256.to_string(),
        byte_len: 3,
        signed,
    }
}

fn catalog(signed: bool) -> OfflineCatalog {
    OfflineCatalog {
        schema_version: 1,
        packs: vec![pack(signed)],
    }
}

fn available(sha256: &str, byte_len: u64) -> Vec<AvailableArtifact> {
    vec![AvailableArtifact {
        file_name: "media-engine-1.0.0.pack".to_string(),
        sha256: sha256.to_string(),
        byte_len,
    }]
}

#[test]
fn offlinehash_verified() {
    let choices = verify_offline_catalog(&catalog(true), &available(ABC_SHA256, 3))
        .expect("the catalog verifies");
    assert_eq!(choices.len(), 1);
    assert!(choices[0].enabled);
    assert_eq!(choices[0].state, OfflineArtifactState::Verified);

    let changed = verify_offline_catalog(&catalog(true), &available(&"0".repeat(64), 3))
        .expect("the catalog is still readable");
    assert!(!changed[0].enabled);
    assert_eq!(changed[0].state, OfflineArtifactState::HashMismatch);
    assert_eq!(
        changed[0].error_code.as_deref(),
        Some("installer.offline_hash_mismatch")
    );

    let missing = verify_offline_catalog(&catalog(true), &[]).expect("missing artifact");
    assert!(!missing[0].enabled);
    assert_eq!(missing[0].state, OfflineArtifactState::Missing);
    assert_eq!(
        missing[0].error_code.as_deref(),
        Some("installer.offline_missing")
    );

    // An unsigned artifact disables the choice; there is no unsigned
    // download fallback and no automatic substitution.
    let unsigned = verify_offline_catalog(&catalog(false), &available(ABC_SHA256, 3))
        .expect("unsigned catalog");
    assert!(!unsigned[0].enabled);
    assert_eq!(unsigned[0].state, OfflineArtifactState::Unsigned);
}

#[test]
fn upgrade_dirty_exitcancel() {
    let cancelled = plan_upgrade(true, true, Some(ExitAnswer::CancelInstall));
    assert!(!cancelled.proceed);
    assert!(!cancelled.force_terminate);
    assert!(!cancelled.request_graceful_exit);

    let keep_open = plan_upgrade(true, true, Some(ExitAnswer::KeepOpen));
    assert!(!keep_open.proceed);
    assert!(!keep_open.force_terminate);
    assert_eq!(
        keep_open.error_code.as_deref(),
        Some("installer.dirty_still_open")
    );

    let waiting = plan_upgrade(true, true, None);
    assert!(!waiting.proceed);
    assert!(waiting.wait_for_exit);
    assert!(!waiting.force_terminate);

    let clean_exit = plan_upgrade(true, true, Some(ExitAnswer::ExitNow));
    assert!(clean_exit.proceed);
    assert!(!clean_exit.force_terminate);
}

#[test]
fn uninstall_keeps_datadefault() {
    let root = Path::new(r"C:\Users\Ana\AppData\Local\Adperastra");
    let plan = plan_uninstall(UninstallChoice::KeepData, root, root, false);
    assert!(!plan.remove_data, "Keep data is the default");
    assert!(!plan.recycle_data);
    assert_eq!(plan.data_root, None);
    assert!(plan.restore_owned_registry);
    assert_eq!(plan.error_code, None);
}

#[test]
fn foreignroot_neverremoved() {
    let recorded = Path::new(r"C:\Users\Ana\AppData\Local\Adperastra");
    let foreign = Path::new(r"D:\Elsewhere\Adperastra");
    let plan = plan_uninstall(UninstallChoice::RemoveData, recorded, foreign, false);
    assert!(!plan.remove_data);
    assert!(!plan.recycle_data);
    assert_eq!(plan.data_root, None);
    assert_eq!(plan.error_code.as_deref(), Some("installer.foreign_root"));
    assert!(plan.restore_owned_registry, "registry restore is independent");

    // A junction or another unsafe root is refused even for the recorded
    // path.
    let reparse = plan_uninstall(UninstallChoice::RemoveData, recorded, recorded, true);
    assert!(!reparse.remove_data);
    assert_eq!(reparse.error_code.as_deref(), Some("installer.unsafe_root"));

    // A network or verbatim root is never owned for removal.
    let unc = plan_uninstall(
        UninstallChoice::RemoveData,
        recorded,
        Path::new(r"\\server\share\Adperastra"),
        false,
    );
    assert!(!unc.remove_data);
    assert_eq!(unc.error_code.as_deref(), Some("installer.foreign_root"));

    // The exact owned root recycles its data; it is never permanently
    // deleted.
    let owned = plan_uninstall(UninstallChoice::RemoveData, recorded, recorded, false);
    assert!(owned.remove_data);
    assert!(owned.recycle_data);
    assert_eq!(owned.data_root.as_deref(), Some(recorded));
    assert_eq!(owned.error_code, None);
}

#[test]
fn catalog_limits_and_duplicates_are_refused() {
    let mut duplicate = catalog(true);
    duplicate.packs.push(pack(true));
    assert_eq!(
        verify_offline_catalog(&duplicate, &[]).expect_err("duplicate id"),
        "installer.invalid"
    );

    let mut too_many = OfflineCatalog {
        schema_version: 1,
        packs: Vec::new(),
    };
    for index in 0..=super::MAX_OFFLINE_PACKS {
        let mut entry = pack(true);
        entry.id = format!("pack-{index}");
        entry.file_name = format!("pack-{index}.pack");
        too_many.packs.push(entry);
    }
    assert!(verify_offline_catalog(&too_many, &[]).is_err());
}
