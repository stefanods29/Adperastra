use setup_core::{
    expand_env, fetch_installer, free_disk_space, generate_keypair, install_component,
    is_first_run, keys_for, load_profile, parse_manifest, profile_path, save_profile,
    sign_manifest, signature_status, t, verify_component, AppInfo, Component, ComponentKind,
    Installer, Manifest, Profile, SetupError, SignatureStatus, Source, Status,
};
use sha2::{Digest, Sha256};
use std::fs;

fn sha256_hex(data: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(data);
    format!("{:x}", h.finalize())
}
fn file_comp(path: &str, size: Option<u64>, sha: Option<String>, src: Option<Source>) -> Component {
    Component {
        id: "comp1".into(),
        name_key: "comp.webview2".into(),
        version: "1.0".into(),
        kind: ComponentKind::File { path: path.into() },
        required: true,
        size,
        sha256: sha,
        source: src,
        installer: None,
    }
}
#[test]
fn parse_manifest_with_file_and_pack() {
    let text = r#"{
      "schema": 1,
      "app": {"name": "Adperastra", "version": "0.1.0"},
      "components": [{
        "id": "font-inter", "name_key": "comp.fonts", "version": "1.0",
        "kind": {"type": "file", "path": "fonts/Inter.ttf"},
        "required": true, "size": 3, "sha256": null,
        "source": {"type": "local", "path": "files/Inter.ttf"}
      }],
      "optional_packs": [{
        "id": "office", "name_key": "pack.office.name", "desc_key": "pack.office",
        "download_size": 100, "install_size": 200
      }]
    }"#;
    let m = parse_manifest(text).unwrap();
    assert_eq!(m.schema, 1);
    assert_eq!(m.app.name, "Adperastra");
    assert_eq!(m.components.len(), 1);
    assert_eq!(m.optional_packs.len(), 1);
    assert_eq!(m.optional_packs[0].id, "office");
    assert_eq!(m.optional_packs[0].note_key, None);
}

#[test]
fn verify_ok_missing_and_wrong_size() {
    let dir = tempfile::tempdir().unwrap();
    let data = b"hello";
    fs::write(dir.path().join("a.bin"), data).unwrap();
    let ok = file_comp("a.bin", Some(5), Some(sha256_hex(data)), None);
    assert_eq!(verify_component(&ok, dir.path(), true).status, Status::Ok);
    let missing = file_comp("nope.bin", None, None, None);
    assert_eq!(
        verify_component(&missing, dir.path(), false).status,
        Status::Missing
    );
    let bad_size = file_comp("a.bin", Some(99), None, None);
    assert!(matches!(
        verify_component(&bad_size, dir.path(), false).status,
        Status::Broken(_)
    ));
}
#[test]
fn verify_wrong_hash_only_full_mode() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("a.bin"), b"hello").unwrap();
    let c = file_comp("a.bin", Some(5), Some("0".repeat(64)), None);
    assert_eq!(verify_component(&c, dir.path(), false).status, Status::Ok);
    assert!(matches!(
        verify_component(&c, dir.path(), true).status,
        Status::Broken(_)
    ));
}

#[test]
fn anypath_and_expand_env() {
    let dir = tempfile::tempdir().unwrap();
    std::env::set_var("SETUP_CORE_TEST_DIR", dir.path().to_str().unwrap());
    assert_eq!(
        expand_env("%SETUP_CORE_TEST_DIR%"),
        dir.path().to_str().unwrap()
    );
    assert_eq!(expand_env("%SETUP_CORE_NOPE_VAR%"), "%SETUP_CORE_NOPE_VAR%");
    let existing = Component {
        id: "rt".into(),
        name_key: "comp.webview2".into(),
        version: "1".into(),
        kind: ComponentKind::AnyPath {
            paths: vec!["%SETUP_CORE_TEST_DIR%".into()],
        },
        required: true,
        size: None,
        sha256: None,
        source: None,
        installer: None,
    };
    assert_eq!(
        verify_component(&existing, dir.path(), false).status,
        Status::Ok
    );
    let missing = Component {
        kind: ComponentKind::AnyPath {
            paths: vec!["%SETUP_CORE_TEST_DIR%/nope-xyz".into()],
        },
        ..existing
    };
    assert_eq!(
        verify_component(&missing, dir.path(), false).status,
        Status::Missing
    );
}
#[test]
fn install_local_repairs_missing_file() {
    let src_dir = tempfile::tempdir().unwrap();
    let dst_dir = tempfile::tempdir().unwrap();
    fs::create_dir_all(src_dir.path().join("files")).unwrap();
    let data = b"payload-data";
    fs::write(src_dir.path().join("files/x.bin"), data).unwrap();
    let c = file_comp(
        "sub/x.bin",
        Some(data.len() as u64),
        Some(sha256_hex(data)),
        Some(Source::Local {
            path: "files/x.bin".into(),
        }),
    );
    let mut last = 0.0f32;
    install_component(&c, dst_dir.path(), src_dir.path(), &mut |p| last = p).unwrap();
    assert_eq!(fs::read(dst_dir.path().join("sub/x.bin")).unwrap(), data);
    assert!(last > 0.0 && last <= 1.0);
}

#[test]
fn install_hash_mismatch_fails_and_leaves_no_dest() {
    let src_dir = tempfile::tempdir().unwrap();
    let dst_dir = tempfile::tempdir().unwrap();
    fs::write(src_dir.path().join("x.bin"), b"bad").unwrap();
    let c = file_comp(
        "x.bin",
        None,
        Some("0".repeat(64)),
        Some(Source::Local {
            path: "x.bin".into(),
        }),
    );
    let mut noop = |_p: f32| {};
    assert!(install_component(&c, dst_dir.path(), src_dir.path(), &mut noop).is_err());
    assert!(!dst_dir.path().join("x.bin").exists());
    assert!(!dst_dir.path().join("x.bin.part").exists());
}

#[test]
fn profile_roundtrip_and_first_run() {
    let dir = tempfile::tempdir().unwrap();
    assert!(is_first_run(dir.path()));
    assert!(load_profile(dir.path()).is_none());
    let mut p = Profile::default();
    p.language = "es".into();
    p.first_run_completed = true;
    p.packs_selected = vec!["office".into()];
    save_profile(dir.path(), &p).unwrap();
    assert_eq!(profile_path(dir.path()), dir.path().join("profile.json"));
    let loaded = load_profile(dir.path()).unwrap();
    assert_eq!(loaded.language, "es");
    assert_eq!(loaded.packs_selected, vec!["office".to_string()]);
    assert!(!is_first_run(dir.path()));
}
#[test]
fn i18n_identical_keys_and_spanish() {
    assert_eq!(keys_for("en"), keys_for("es"));
    assert_ne!(t("es", "button.continue"), t("en", "button.continue"));
    assert_eq!(t("fr", "button.continue"), t("en", "button.continue"));
    assert_eq!(t("en", "no.such.key"), "no.such.key");
    assert!(keys_for("en").contains(&"window.welcome".to_string()));
}

#[test]
fn free_space_positive() {
    let dir = tempfile::tempdir().unwrap();
    assert!(free_disk_space(dir.path()) > 0);
}

#[test]
fn manifest_with_utf8_bom_parses() {
    let json =
        "{\"schema\":1,\"app\":{\"name\":\"Adperastra\",\"version\":\"0\"},\"components\":[]}";
    let text = format!("\u{FEFF}{json}");
    let m = setup_core::parse_manifest(&text).expect("manifest with UTF-8 BOM should parse");
    assert_eq!(m.app.name, "Adperastra");
}

#[test]
fn signing_valid_tampered_missing() {
    let (public_key, secret_key) = generate_keypair().unwrap();
    assert!(!public_key.is_empty());
    assert!(!secret_key.is_empty());
    let mut m = Manifest {
        schema: 1,
        app: AppInfo {
            name: "Adperastra".into(),
            version: "0.1.0".into(),
        },
        signature: None,
        components: vec![],
        optional_packs: vec![],
    };
    assert_eq!(signature_status(&m, &public_key), SignatureStatus::Missing);
    sign_manifest(&mut m, &secret_key).unwrap();
    assert_eq!(signature_status(&m, &public_key), SignatureStatus::Valid);
    let mut tampered = m.clone();
    tampered.app.version = "9.9.9".into();
    assert_eq!(
        signature_status(&tampered, &public_key),
        SignatureStatus::Invalid
    );
    let fresh = Manifest {
        schema: 1,
        app: AppInfo {
            name: "Adperastra".into(),
            version: "0.1.0".into(),
        },
        signature: None,
        components: vec![],
        optional_packs: vec![],
    };
    assert_eq!(
        signature_status(&fresh, &public_key),
        SignatureStatus::Missing
    );
    assert_eq!(signature_status(&m, ""), SignatureStatus::Missing);
}

#[test]
fn fetch_installer_local_ok_and_bad_hash() {
    let src_dir = tempfile::tempdir().unwrap();
    let dst_dir = tempfile::tempdir().unwrap();
    let data = b"fake-installer-bytes";
    fs::write(src_dir.path().join("setup.exe"), data).unwrap();
    let inst = Installer {
        source: Source::Local {
            path: "setup.exe".into(),
        },
        fallback_source: None,
        sha256: sha256_hex(data),
        size: data.len() as u64,
        args: vec![],
    };
    let mut noop = |_p: f32| {};
    let path = fetch_installer(&inst, src_dir.path(), dst_dir.path(), &mut noop).unwrap();
    assert_eq!(path, dst_dir.path().join("installer.exe"));
    assert_eq!(fs::read(&path).unwrap(), data);

    let bad_dir = tempfile::tempdir().unwrap();
    let bad = Installer {
        sha256: "0".repeat(64),
        ..inst
    };
    let mut noop2 = |_p: f32| {};
    assert!(fetch_installer(&bad, src_dir.path(), bad_dir.path(), &mut noop2).is_err());
    assert!(!bad_dir.path().join("installer.exe").exists());
}

#[test]
fn fetch_installer_uses_fallback() {
    let src_dir = tempfile::tempdir().unwrap();
    let dst_dir = tempfile::tempdir().unwrap();
    let data = b"fallback-installer-bytes";
    fs::write(src_dir.path().join("fallback.exe"), data).unwrap();
    let inst = Installer {
        source: Source::Local {
            path: "does-not-exist.exe".into(),
        },
        fallback_source: Some(Source::Local {
            path: "fallback.exe".into(),
        }),
        sha256: sha256_hex(data),
        size: data.len() as u64,
        args: vec![],
    };
    let mut noop = |_p: f32| {};
    let path = fetch_installer(&inst, src_dir.path(), dst_dir.path(), &mut noop).unwrap();
    assert_eq!(path, dst_dir.path().join("installer.exe"));
    assert_eq!(fs::read(&path).unwrap(), data);

    // Fallback with wrong sha256: the fallback's HashMismatch error
    // surfaces and no installer.exe is left behind.
    let bad_dst = tempfile::tempdir().unwrap();
    let bad = Installer {
        sha256: "0".repeat(64),
        ..inst
    };
    let mut noop2 = |_p: f32| {};
    let err = fetch_installer(&bad, src_dir.path(), bad_dst.path(), &mut noop2).unwrap_err();
    assert!(
        matches!(err, SetupError::HashMismatch(_)),
        "expected HashMismatch, got {err:?}"
    );
    assert!(
        err.to_string().contains("hash mismatch"),
        "unexpected Display: {err}"
    );
    assert!(!bad_dst.path().join("installer.exe").exists());
}
