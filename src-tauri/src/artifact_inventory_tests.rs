use super::*;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::fs;

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn record(name: &str, bytes: &[u8]) -> ArtifactRecord {
    ArtifactRecord {
        name: name.to_string(),
        sha256: sha256_hex(bytes),
        byte_len: bytes.len() as u64,
        source_commit: "a".repeat(40),
        version: "0.1.0".to_string(),
        target: TARGET.to_string(),
        unsigned: true,
    }
}

#[test]
fn sha256_of_known_bytes_is_exact() {
    assert_eq!(
        sha256_hex(b"abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}

#[test]
fn fixed_artifact_names_match_the_catalog() {
    let names = expected_artifact_names("0.1.0").unwrap();
    assert_eq!(names.len(), 7);
    for expected in [
        "Adperastra-0.1.0-windows-x64-setup.exe",
        "Adperastra-0.1.0-windows-x64-portable.zip",
        "SHA256SUMS.txt",
        "THIRD_PARTY_LICENSES.txt",
        "SOURCE-NOTICES.txt",
        "release-notes-en.md",
        "release-notes-es.md",
    ] {
        assert!(names.iter().any(|name| name.as_str() == expected), "{expected}");
    }
}

#[test]
fn version_tag_and_manifest_must_match() {
    assert!(validate_release_identity("0.1.0", "v0.1.0", "0.1.0").is_ok());
    assert_eq!(
        validate_release_identity("0.1.0", "v0.1.1", "0.1.0"),
        Err("release.version_mismatch".to_string())
    );
    assert_eq!(
        validate_release_identity("0.1.0", "v0.1.0", "0.1.1"),
        Err("release.version_mismatch".to_string())
    );
}

#[test]
fn every_version_source_must_match_the_tag() {
    let tauri = json!({ "version": "0.1.0" });
    let package = json!({ "version": "0.1.0" });
    assert!(validate_version_sources("0.1.0", &tauri, &package, "0.1.0").is_ok());
    let old_package = json!({ "version": "0.0.0" });
    assert_eq!(
        validate_version_sources("0.1.0", &tauri, &old_package, "0.1.0"),
        Err("release.version_mismatch:package.json".to_string())
    );
}

#[test]
fn debug_port_key_and_model_artifacts_are_refused() {
    let good = ReleaseBuildMetadata {
        version: "0.1.0".to_string(),
        source_commit: "a".repeat(40),
        profile: "release".to_string(),
        debug_port: None,
        signing_key_present: false,
        model_files: 0,
    };
    assert!(validate_build_metadata(&good).is_ok());
    for bad in [
        ReleaseBuildMetadata { profile: "debug".to_string(), ..good.clone() },
        ReleaseBuildMetadata { debug_port: Some(9222), ..good.clone() },
        ReleaseBuildMetadata { signing_key_present: true, ..good.clone() },
        ReleaseBuildMetadata { model_files: 1, ..good.clone() },
    ] {
        assert!(validate_build_metadata(&bad).is_err());
    }
    for name in [
        "Adperastra-debug-windows-x64-setup.exe",
        "dev-signing.key",
        "model.gguf",
        "weights.safetensors",
        "private/test.html",
    ] {
        assert!(
            validate_artifact_record(&record(name, b"x")).is_err(),
            "{name} must be refused"
        );
    }
}

#[test]
fn build_helper_refuses_a_debug_or_key_build() {
    let commit = "a".repeat(40);
    let ok = vec![
        "build".to_string(),
        "0.1.0".to_string(),
        commit.clone(),
        "release".to_string(),
        "none".to_string(),
        "false".to_string(),
        "0".to_string(),
    ];
    assert_eq!(run_helper_with(ok), 0);
    let debug = vec![
        "build".to_string(),
        "0.1.0".to_string(),
        commit.clone(),
        "release".to_string(),
        "9222".to_string(),
        "false".to_string(),
        "0".to_string(),
    ];
    assert_eq!(run_helper_with(debug), 2);
    let key = vec![
        "build".to_string(),
        "0.1.0".to_string(),
        commit,
        "release".to_string(),
        "none".to_string(),
        "true".to_string(),
        "0".to_string(),
    ];
    assert_eq!(run_helper_with(key), 2);
}

#[test]
fn release_set_requires_each_record_name_exactly_once() {
    let names = record_artifact_names("0.1.0").unwrap();
    assert_eq!(names.len(), 6);
    let mut records: Vec<ArtifactRecord> = names
        .iter()
        .map(|name| record(name, name.as_bytes()))
        .collect();
    let commit = "a".repeat(40);
    assert!(validate_release_set(&records, "0.1.0", &commit).is_ok());
    records.pop();
    assert_eq!(
        validate_release_set(&records, "0.1.0", &commit),
        Err("release.artifact_count".to_string())
    );
    records.push(record(&names[1], b"again"));
    assert_eq!(
        validate_release_set(&records, "0.1.0", &commit),
        Err("release.duplicate_artifact".to_string())
    );
}

#[test]
fn checksum_list_round_trips() {
    let first = record("SHA256SUMS.txt", b"a");
    let second = record("THIRD_PARTY_LICENSES.txt", b"b");
    let text = checksums_text(&[first.clone(), second.clone()]);
    assert_eq!(
        text,
        format!(
            "{}  {}\n{}  {}\n",
            first.sha256, first.name, second.sha256, second.name
        )
    );
}

#[test]
fn runtime_allowlist_excludes_unregistered_pages() {
    for allowed in [
        "Adperastra.exe",
        "help/en/installing-and-updating.md",
        "help/es/whats-new-0-1.md",
        "templates/blank/blank.docx",
        "templates/builtin/en/letter.docx",
        "assets/fonts/inter-4.1/Inter-Regular.ttf",
        "portable-mode.marker",
    ] {
        assert!(validate_runtime_asset(allowed).is_ok(), "{allowed}");
    }
    for refused in [
        "help/pseudo/getting-started.md",
        "help/en/not registered.md",
        "test/fixture.html",
        "src/__tests__/page.html",
        "keys/dev-signing.key",
        "models/model.gguf",
        "help/en/../../Windows/System32/evil.md",
        "C:/Windows/System32/evil.exe",
    ] {
        assert!(validate_runtime_asset(refused).is_err(), "{refused}");
    }
}

#[test]
fn verifies_hash_and_size_without_writing() {
    let directory = tempfile::tempdir().unwrap();
    let bytes = b"release bytes";
    let name = expected_artifact_names("0.1.0").unwrap()[0].clone();
    fs::write(directory.path().join(&name), bytes).unwrap();
    let good = record(&name, bytes);
    assert!(verify_artifact_file(directory.path(), &good).is_ok());
    let mut bad = good.clone();
    bad.sha256 = sha256_hex(b"other");
    assert!(verify_artifact_file(directory.path(), &bad).is_err());
    let mut bad_size = good;
    bad_size.byte_len += 1;
    assert!(verify_artifact_file(directory.path(), &bad_size).is_err());
}

#[test]
fn manifest_write_and_verify_use_the_same_rules() {
    let directory = tempfile::tempdir().unwrap();
    for (index, name) in record_artifact_names("0.1.0").unwrap().iter().enumerate() {
        fs::write(directory.path().join(name), format!("artifact {index}")).unwrap();
    }
    let manifest = write_release_manifest(directory.path(), "0.1.0", &"a".repeat(40)).unwrap();
    assert_eq!(manifest.records.len(), 6);
    assert!(directory.path().join(CHECKSUMS_FILE).is_file());
    assert!(verify_release_manifest(directory.path()).is_ok());
    fs::write(directory.path().join("dev-signing.key"), b"x").unwrap();
    assert!(verify_release_manifest(directory.path()).is_err());
}
