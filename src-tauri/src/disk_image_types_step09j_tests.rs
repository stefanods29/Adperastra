//! Contract tests for `disk_image_types` (Step 09j T1/T2).

use super::{
    expected_matches, same_stamp, valid_image_path, valid_volume_root, validate_stamp,
    DiskImageKind, MountRequest, MountState, MountedImage,
};
use fs_service::SourceStamp;

pub(crate) fn stamp(path: &str, ticks: &str) -> SourceStamp {
    SourceStamp {
        path_key: path.to_string(),
        volume_id: "00112233".to_string(),
        file_id: "0011223344556677".to_string(),
        modified_ticks: ticks.to_string(),
        size_bytes: 1024,
    }
}

#[test]
fn invalid_path_is_refused_before_any_api() {
    for path in [
        "",
        "relative\\image.iso",
        r"C:\images\..\secret.iso",
        "C:\\bad\\\u{1}.iso",
    ] {
        let request = MountRequest {
            path: path.to_string(),
            expected: None,
            readonly: true,
            allow_elevation: false,
        };
        assert_eq!(
            request.validate(),
            Err("disk.unsupported".to_string()),
            "{path}"
        );
    }
    // A UNC path is syntactically absolute; only the privileged broker
    // refuses network sources.
    assert!(valid_image_path(r"\\server\share\image.iso"));
    assert!(valid_image_path(
        r"C:\Users\me\My Images\a very long name.vhdx"
    ));
}

#[test]
fn nonreadonly_request_is_refused_before_any_api() {
    let request = MountRequest {
        path: r"C:\images\disk.iso".to_string(),
        expected: None,
        readonly: false,
        allow_elevation: false,
    };
    assert_eq!(request.validate(), Err("disk.unsupported".to_string()));
}

#[test]
fn unsupported_image_formats_are_refused_before_any_api() {
    for path in [r"C:\images\disk.zip", r"C:\images\disk", r"C:\images\.iso"] {
        let request = MountRequest {
            path: path.to_string(),
            expected: None,
            readonly: true,
            allow_elevation: false,
        };
        assert_eq!(
            request.validate(),
            Err("disk.unsupported".to_string()),
            "{path}"
        );
    }
    // `.img` is admitted by name here; the classifier verifies its ISO
    // 9660 signature before any attach.
    for path in [
        r"C:\images\disk.ISO",
        r"C:\images\disk.img",
        r"C:\images\disk.vhd",
        r"C:\images\disk.VHDX",
    ] {
        let request = MountRequest {
            path: path.to_string(),
            expected: None,
            readonly: true,
            allow_elevation: false,
        };
        assert!(request.validate().is_ok(), "{path}");
    }
}

#[test]
fn missing_readonly_field_defaults_to_true() {
    let request: MountRequest =
        serde_json::from_str(r#"{"path":"C:\\images\\disk.iso"}"#).unwrap();
    assert!(request.readonly);
    assert!(!request.allow_elevation);
    assert!(request.validate().is_ok());
}

#[test]
fn a_changed_source_is_not_the_same_identity() {
    let first = stamp(r"C:\images\disk.vhd", "100");
    let mut second = first.clone();
    second.modified_ticks = "101".to_string();
    assert!(!same_stamp(&first, &second));
    assert!(!expected_matches(&first, &second));
    assert!(same_stamp(&first, &first));
}

#[test]
fn stamp_fields_follow_the_07a_wire_rules() {
    let valid = stamp(r"C:\images\disk.vhd", "100");
    assert_eq!(validate_stamp(&valid), Ok(()));

    let mut uppercase = valid.clone();
    uppercase.volume_id = "0011223A".to_string();
    assert_eq!(
        validate_stamp(&uppercase),
        Err("disk.changed".to_string())
    );

    let mut long_ticks = valid.clone();
    long_ticks.modified_ticks = "1".repeat(21);
    assert_eq!(
        validate_stamp(&long_ticks),
        Err("disk.changed".to_string())
    );

    let mut text_ticks = valid.clone();
    text_ticks.modified_ticks = "10x".to_string();
    assert_eq!(
        validate_stamp(&text_ticks),
        Err("disk.changed".to_string())
    );

    let mut huge = valid.clone();
    huge.size_bytes = 9_007_199_254_740_992;
    assert_eq!(validate_stamp(&huge), Err("disk.changed".to_string()));

    let mut relative = valid.clone();
    relative.path_key = r"images\disk.vhd".to_string();
    assert_eq!(
        validate_stamp(&relative),
        Err("disk.changed".to_string())
    );
}

#[test]
fn volume_roots_are_exact_drive_roots() {
    assert!(valid_volume_root(r"F:\"));
    assert!(!valid_volume_root(r"F:"));
    assert!(!valid_volume_root(r"F:\folder"));
    assert!(!valid_volume_root(r"\\server\share"));
}

#[test]
fn every_mount_state_round_trips() {
    for (wire, state) in [
        ("mounting", MountState::Mounting),
        ("mounted", MountState::Mounted),
        ("ejecting", MountState::Ejecting),
        ("in_use", MountState::InUse),
        ("error", MountState::Error),
    ] {
        let decoded: MountState = serde_json::from_str(&format!("\"{wire}\"")).unwrap();
        assert_eq!(decoded, state);
    }
}

#[test]
fn mount_records_are_read_only_and_typed() {
    let mount = MountedImage {
        mount_id: "6f7a4e59-6c1f-4f4f-9b0b-4b8f7f1d2e3a".to_string(),
        source: stamp(r"C:\images\disk.iso", "100"),
        kind: DiskImageKind::Iso,
        volume_roots: vec![r"F:\".to_string()],
        physical_path: r"\\.\PhysicalDrive3".to_string(),
        readonly: true,
        owned: true,
        state: MountState::Mounted,
        brokered: false,
    };
    let json = serde_json::to_value(&mount).unwrap();
    assert_eq!(json["kind"], "iso");
    assert_eq!(json["state"], "mounted");
    assert_eq!(json["readonly"], true);
}
