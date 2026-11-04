use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};

use pack_store::install::{
    install_and_activate, ActiveVersion, ActiveVersions, ACTIVE_SCHEMA_VERSION,
};
use pack_store::leases::{PackLeases, RemoveOutcome};
use pack_store::types::{PackDescriptor, PackFile, PackId};
use pack_store::validation::sha256_hex;
use pack_store::PackError;

const README: &[u8] = b"Adperastra pack fixture";

fn descriptor(id: PackId, version: &str, enables: &[&str], bridge: bool) -> PackDescriptor {
    let mut entrypoints = BTreeMap::new();
    entrypoints.insert("run".to_string(), "README.txt".to_string());
    if bridge {
        entrypoints.insert("office_read_bridge".to_string(), "README.txt".to_string());
    }
    PackDescriptor {
        id,
        version: version.to_string(),
        name_key: format!("packs.{}.name", id.as_str()),
        description_key: format!("packs.{}.description", id.as_str()),
        download_url: format!("https://packs.example.com/{}-{version}.zip", id.as_str()),
        download_bytes: 512,
        install_bytes: README.len() as u64,
        sha256: sha256_hex(b"archive fixture"),
        licenses: vec!["MIT".to_string()],
        source_urls: vec!["https://example.com/source".to_string()],
        files: vec![PackFile {
            path: "README.txt".to_string(),
            size: README.len() as u64,
            sha256: sha256_hex(README),
            executable: false,
        }],
        dependencies: Vec::new(),
        enables: enables.iter().map(|value| value.to_string()).collect(),
        entrypoints,
        catalog_revision: 1,
    }
}

fn seed_version(root: &Path, descriptor: &PackDescriptor) -> ActiveVersion {
    let directory = format!("versions/{}/{}", descriptor.id.as_str(), descriptor.version);
    let version_root = root.join(directory.replace('/', std::path::MAIN_SEPARATOR_STR));
    std::fs::create_dir_all(&version_root).unwrap();
    std::fs::write(version_root.join("README.txt"), README).unwrap();
    let pointer = ActiveVersion {
        schema_version: ACTIVE_SCHEMA_VERSION,
        pack_id: descriptor.id,
        version: descriptor.version.clone(),
        directory,
        descriptor_sha256: descriptor.digest(),
        previous_version: None,
        activated_unix: 1,
    };
    ActiveVersions::new(root).write(&pointer).unwrap();
    pointer
}

fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
    let file = std::fs::File::create(path).unwrap();
    let mut writer = zip::ZipWriter::new(file);
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    for (name, bytes) in entries {
        writer.start_file(*name, options).unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap();
}

#[test]
fn lease_inventory_refuses_unlisted_resources_after_acquisition() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().join("packs");
    let model = descriptor(PackId::Office, "1.0.0", &["office_read_v1"], true);
    let pointer = seed_version(&root, &model);
    let leases = PackLeases::new(&root);
    let lease = leases
        .acquire(&pointer, &model, "office_read_bridge")
        .unwrap();
    lease.verify_inventory().unwrap();
    std::fs::write(
        lease.root().join("unlisted.dll"),
        b"not in signed inventory",
    )
    .unwrap();
    assert_eq!(lease.verify_inventory(), Err(PackError::Changed));
    // Checking the executable alone would still succeed: the resource check
    // must happen before the child gets access to its directory.
    assert!(lease.entrypoint("office_read_bridge").is_ok());
}

#[test]
fn traversal_refused() {
    let temporary = tempfile::tempdir().unwrap();
    let packs = temporary.path().join("packs");
    let archive = temporary.path().join("pack.zip");
    write_zip(
        &archive,
        &[("README.txt", README), ("../outside.txt", b"escaped")],
    );
    let staging = packs.join("staging").join("test");
    let error = pack_store::install::extract_archive(
        &archive,
        &descriptor(PackId::Media, "1.0.0", &[], false),
        &staging,
    )
    .unwrap_err();
    assert_eq!(error, PackError::BadRequest);
    assert!(!temporary.path().join("outside.txt").exists());
}

#[test]
fn active_lease_blocks_removal() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().join("packs");
    let model = descriptor(PackId::Media, "1.0.0", &[], false);
    let pointer = seed_version(&root, &model);
    let leases = PackLeases::new(&root);
    let lease = leases.acquire(&pointer, &model, "run").unwrap();
    let outcome = leases.request_remove(&pointer, &|_| {}).unwrap();
    assert_eq!(outcome, RemoveOutcome::Pending);
    let version_root = ActiveVersions::new(&root).version_root(&pointer).unwrap();
    assert!(version_root.join("README.txt").exists());
    assert!(leases.is_pending_remove(PackId::Media));

    drop(lease);
    assert!(!version_root.exists());
    assert!(ActiveVersions::new(&root)
        .read(PackId::Media)
        .unwrap()
        .is_none());
    assert!(!leases.is_pending_remove(PackId::Media));
}

#[test]
fn failed_update_keeps_old_version() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().join("packs");
    let old = descriptor(PackId::Media, "1.0.0", &[], false);
    let old_pointer = seed_version(&root, &old);
    let old_root = ActiveVersions::new(&root)
        .version_root(&old_pointer)
        .unwrap();

    let newer = descriptor(PackId::Media, "2.0.0", &[], false);
    let archive = temporary.path().join("media-2.zip");
    write_zip(&archive, &[("README.txt", README)]);
    let error = install_and_activate(&archive, &newer, &root, 5, &|_, _| {
        Err("probe failed".into())
    })
    .unwrap_err();
    assert_eq!(error, PackError::Failed);

    let active = ActiveVersions::new(&root)
        .read(PackId::Media)
        .unwrap()
        .unwrap();
    assert_eq!(active.version, "1.0.0");
    assert_eq!(std::fs::read(old_root.join("README.txt")).unwrap(), README);
    assert!(!root.join("versions/media/2.0.0").exists());
}

#[test]
fn reserved_bridge_without_signed_entrypoint_unavailable() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().join("packs");
    let bridge = descriptor(PackId::Office, "1.0.0", &["office_read_v1"], true);
    let pointer = seed_version(&root, &bridge);
    let leases = PackLeases::new(&root);
    let mut missing = bridge.clone();
    missing.entrypoints.remove("office_read_bridge");
    assert_eq!(
        leases
            .acquire(&pointer, &missing, "office_read_bridge")
            .err()
            .expect("must fail"),
        PackError::CapabilityMissing
    );
}

#[test]
fn wrong_bridge_protocol_refused() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().join("packs");
    let bridge = descriptor(PackId::Office, "1.0.0", &["office_read_v1"], true);
    let pointer = seed_version(&root, &bridge);
    let leases = PackLeases::new(&root);
    let mut wrong = bridge.clone();
    wrong.enables = vec!["ordinary".to_string()];
    assert_eq!(
        leases
            .acquire(&pointer, &wrong, "office_read_bridge")
            .err()
            .expect("must fail"),
        PackError::CapabilityMissing
    );
}

#[test]
fn active_bridge_retains_exact_pack_version() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().join("packs");
    let first = descriptor(PackId::Office, "1.0.0", &["office_read_v1"], true);
    let first_pointer = seed_version(&root, &first);
    let leases = PackLeases::new(&root);
    let lease = leases
        .acquire(&first_pointer, &first, "office_read_bridge")
        .unwrap();

    // An update activates beside the lease without touching the pinned one.
    let second = descriptor(PackId::Office, "2.0.0", &["office_read_v1"], true);
    seed_version(&root, &second);
    assert_eq!(lease.version(), "1.0.0");
    let entry = lease.entrypoint("office_read_bridge").unwrap();
    let canonical_root = std::fs::canonicalize(&root).unwrap();
    assert!(entry.starts_with(canonical_root.join("versions").join("office").join("1.0.0")));

    let outcome = leases.request_remove(&first_pointer, &|_| {}).unwrap();
    assert_eq!(outcome, RemoveOutcome::Pending);
    assert_eq!(lease.version(), "1.0.0");
    drop(lease);
    assert!(!root.join("versions/office/1.0.0").exists());
    assert!(!root.join("versions/office/2.0.0").exists());
}

#[test]
fn temporary_paths_are_absolute_under_packs() {
    let root = PathBuf::from("C:/data/packs");
    let pointer = ActiveVersion {
        schema_version: ACTIVE_SCHEMA_VERSION,
        pack_id: PackId::Media,
        version: "1.0.0".to_string(),
        directory: "versions/media/1.0.0".to_string(),
        descriptor_sha256: "a".repeat(64),
        previous_version: None,
        activated_unix: 1,
    };
    assert!(ActiveVersions::new(&root)
        .version_root(&pointer)
        .unwrap()
        .starts_with(&root));
}
