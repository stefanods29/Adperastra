//! Step 09k T1: pinned metadata, secret redaction and schema refusal.

use age::secrecy::SecretString;
use locked_store::limits::{
    MAX_CHUNK_CIPHER_BYTES, MAX_CHUNK_PLAIN_BYTES, MAX_HEADER_BYTES, MAX_INDEX_PLAIN_BYTES,
    SCRYPT_MAX_WORK_FACTOR, SCRYPT_WORK_FACTOR,
};
use locked_store::types::{
    LockedCreateRequest, LockedCredential, LockedHeader, LockedIndex, LockedSettings,
};
use locked_store::validation::{validate_header, validate_index};
use locked_store::{Limits, LockedError};
use uuid::Uuid;

#[test]
fn metadata_pins_age_and_zeroize() {
    assert_eq!(locked_store::AGE_VERSION, "0.12.1");
    assert_eq!(locked_store::AGE_LICENSE, "MIT OR Apache-2.0");
    assert_eq!(locked_store::ZEROIZE_VERSION, "1.9.1");
    assert_eq!(locked_store::ZEROIZE_LICENSE, "MIT OR Apache-2.0");
    assert_eq!(
        locked_store::FORMAT_DOCUMENT,
        "docs/formats/locked-container-v1.md"
    );
    assert_eq!(locked_store::INTERFACE_REVISION, "locked-container-1");
    assert_eq!(SCRYPT_WORK_FACTOR, 18);
    assert_eq!(SCRYPT_MAX_WORK_FACTOR, 18);
    assert_eq!(MAX_HEADER_BYTES, 64 * 1024);
    assert_eq!(MAX_INDEX_PLAIN_BYTES, 64 * 1024 * 1024);
    assert_eq!(MAX_CHUNK_PLAIN_BYTES, 8 * 1024 * 1024);
    assert_eq!(MAX_CHUNK_CIPHER_BYTES, 9 * 1024 * 1024);
}

#[test]
fn source_credential_debug_is_redacted() {
    let password = "correct horse battery staple";
    let request = LockedCreateRequest {
        source_dir: "C:\\Docs".to_string(),
        dest_path: "C:\\Docs\\vault.adplock".to_string(),
        password: SecretString::from(password.to_string()),
        recovery_dest_path: "D:\\Keys\\vault.adprecovery".to_string(),
        keep_original: true,
        confirm_original_unprotected: true,
    };
    let text = format!("{request:?}");
    assert!(!text.contains(password), "{text}");
    assert!(
        text.contains("REDACTED") || text.contains("SecretBox"),
        "{text}"
    );

    let credential = LockedCredential::Password {
        value: SecretString::from(password.to_string()),
    };
    let text = format!("{credential:?}");
    assert!(!text.contains(password), "{text}");
}

#[test]
fn unsupported_newer_schema_is_refused() {
    let header = LockedHeader {
        schema_version: 2,
        container_id: Uuid::new_v4(),
        content_recipient: "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq".to_string(),
        created_unix: 1,
        chunk_count: 0,
        index_cipher_sha256: "a".repeat(64),
        password_slot_sha256: "b".repeat(64),
        recovery_slot_sha256: "c".repeat(64),
    };
    assert_eq!(validate_header(&header), Err(LockedError::Unsupported));

    let index = LockedIndex {
        schema_version: 2,
        container_id: Uuid::new_v4(),
        revision: 1,
        entries: Vec::new(),
        chunk_records: Vec::new(),
    };
    assert_eq!(
        validate_index(&index, &Limits::default()),
        Err(LockedError::Unsupported)
    );
}

#[test]
fn settings_accept_only_documented_auto_lock_values() {
    for minutes in [0, 1, 5, 15, 30] {
        let settings = LockedSettings {
            auto_lock_minutes: minutes,
            lock_on_workstation: true,
        };
        assert!(settings.validate().is_ok(), "{minutes}");
    }
    for minutes in [2, 4, 6, 31, 60] {
        let settings = LockedSettings {
            auto_lock_minutes: minutes,
            lock_on_workstation: false,
        };
        assert_eq!(settings.validate(), Err(LockedError::Invalid), "{minutes}");
    }
}
