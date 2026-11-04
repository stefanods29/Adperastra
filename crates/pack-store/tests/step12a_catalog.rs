use std::collections::BTreeMap;
use std::io::Cursor;
use std::sync::atomic::{AtomicUsize, Ordering};

use pack_store::catalog::{parse_catalog_verified, verify_and_parse, CatalogStore, CatalogTrust};
use pack_store::types::{PackCatalog, PackDependency, PackDescriptor, PackFile, PackId};
use pack_store::validation::{sha256_hex, validate_capability, validate_catalog, CatalogPolicy};

const ORIGIN: &str = "https://packs.example.com";
const README: &[u8] = b"Adperastra pack fixture";

fn test_key() -> (String, minisign::SecretKey) {
    let pair = minisign::KeyPair::generate_unencrypted_keypair().unwrap();
    (pair.pk.to_base64(), pair.sk)
}

fn sign_bytes(bytes: &[u8], secret: &minisign::SecretKey) -> String {
    let public = minisign::PublicKey::from_secret_key(secret).unwrap();
    minisign::sign(Some(&public), secret, Cursor::new(bytes), None, None)
        .unwrap()
        .to_string()
        .trim_end()
        .to_string()
}

fn readme_file(path: &str) -> PackFile {
    PackFile {
        path: path.to_string(),
        size: README.len() as u64,
        sha256: sha256_hex(README),
        executable: false,
    }
}

fn descriptor(id: PackId, version: &str) -> PackDescriptor {
    let mut entrypoints = BTreeMap::new();
    entrypoints.insert("run".to_string(), "README.txt".to_string());
    PackDescriptor {
        id,
        version: version.to_string(),
        name_key: format!("packs.{}.name", id.as_str()),
        description_key: format!("packs.{}.description", id.as_str()),
        download_url: format!("{ORIGIN}/{}-{version}.zip", id.as_str()),
        download_bytes: 512,
        install_bytes: README.len() as u64,
        sha256: sha256_hex(b"archive fixture"),
        licenses: vec!["MIT".to_string()],
        source_urls: vec!["https://example.com/source".to_string()],
        files: vec![readme_file("README.txt")],
        dependencies: Vec::new(),
        enables: vec!["ordinary".to_string()],
        entrypoints,
        catalog_revision: 1,
    }
}

fn catalog(revision: u32, packs: Vec<PackDescriptor>) -> PackCatalog {
    PackCatalog {
        schema_version: 1,
        revision,
        allowed_origins: vec![ORIGIN.to_string()],
        packs,
    }
}

fn policy() -> CatalogPolicy {
    CatalogPolicy {
        allow_test_fixture: true,
        allow_test_loopback: false,
    }
}

#[test]
fn catalog_signature_precedes_parse() {
    let (public, secret) = test_key();
    let trust = CatalogTrust::new(public);
    let bytes = serde_json::to_vec(&catalog(1, vec![descriptor(PackId::Media, "1.0.0")])).unwrap();
    let signature = sign_bytes(&bytes, &secret);

    let parsed = parse_catalog_verified(&bytes, &signature, &trust, policy()).unwrap();
    assert_eq!(parsed.revision, 1);

    // One changed signed byte: the parser callback must never run.
    let mut tampered = bytes.clone();
    let position = tampered
        .windows(11)
        .position(|window| window == b"\"revision\":")
        .unwrap()
        + 11;
    tampered[position] = b'2';
    let calls = AtomicUsize::new(0);
    let result = verify_and_parse(&tampered, &signature, &trust, |_| {
        calls.fetch_add(1, Ordering::SeqCst);
        Err(pack_store::PackError::Failed)
    });
    assert_eq!(result.unwrap_err(), pack_store::PackError::BadSignature);
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[test]
fn catalog_cycle_refused() {
    let mut media = descriptor(PackId::Media, "1.0.0");
    media.dependencies = vec![PackDependency {
        id: PackId::Office,
        version: "1.0.0".to_string(),
    }];
    let mut office = descriptor(PackId::Office, "1.0.0");
    office.dependencies = vec![PackDependency {
        id: PackId::Media,
        version: "1.0.0".to_string(),
    }];
    let catalog = catalog(1, vec![media, office]);
    assert_eq!(
        validate_catalog(&catalog, policy()).unwrap_err(),
        pack_store::PackError::DependencyCycle
    );
}

#[test]
fn unknown_schema_retained() {
    let temporary = tempfile::tempdir().unwrap();
    let store = CatalogStore::new(temporary.path());
    let (public, secret) = test_key();
    let trust = CatalogTrust::new(public);

    let original =
        serde_json::to_vec(&catalog(1, vec![descriptor(PackId::Media, "1.0.0")])).unwrap();
    store
        .store(&original, &sign_bytes(&original, &secret), &trust, policy())
        .unwrap();

    let mut newer = catalog(2, vec![descriptor(PackId::Media, "2.0.0")]);
    newer.schema_version = 2;
    let newer_bytes = serde_json::to_vec(&newer).unwrap();
    let error = store
        .store(
            &newer_bytes,
            &sign_bytes(&newer_bytes, &secret),
            &trust,
            policy(),
        )
        .unwrap_err();
    assert_eq!(error, pack_store::PackError::UnsupportedSchema);
    assert_eq!(std::fs::read(store.catalog_path()).unwrap(), original);

    // A newer catalog already on disk is never downgraded by an older app.
    std::fs::write(store.catalog_path(), &newer_bytes).unwrap();
    let error = store
        .store(&original, &sign_bytes(&original, &secret), &trust, policy())
        .unwrap_err();
    assert_eq!(error, pack_store::PackError::UnsupportedSchema);
    assert_eq!(std::fs::read(store.catalog_path()).unwrap(), newer_bytes);
}

#[test]
fn reserved_bridge_without_signed_entrypoint_unavailable() {
    let mut office = descriptor(PackId::Office, "1.0.0");
    office.entrypoints.clear();
    office.enables = vec!["office_read_v1".to_string()];
    assert_eq!(
        validate_capability(&office, "office_read_bridge").unwrap_err(),
        pack_store::PackError::CapabilityMissing
    );

    office
        .entrypoints
        .insert("office_read_bridge".to_string(), "README.txt".to_string());
    office.enables.clear();
    assert_eq!(
        validate_capability(&office, "office_read_bridge").unwrap_err(),
        pack_store::PackError::CapabilityMissing
    );

    office.enables.push("office_read_v1".to_string());
    assert!(validate_capability(&office, "office_read_bridge").is_ok());
}

#[test]
fn first_run_selection_is_non_ai() {
    let selected = vec![
        "media".to_string(),
        "office".to_string(),
        "ocr".to_string(),
        "ai_runtime".to_string(),
        "ai_assistant".to_string(),
        "test_fixture".to_string(),
        "unknown".to_string(),
    ];
    assert_eq!(
        pack_store::types::selected_production_packs(&selected),
        vec![PackId::Media, PackId::Office, PackId::Ocr]
    );
}
