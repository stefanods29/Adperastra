//! Step 09k T2: standard age slots, independent recovery, bounded work
//! factor and no plaintext from a wrong or truncated stream.

use age::secrecy::{ExposeSecret, SecretString};
use locked_store::crypto::{
    check_work_factor, decrypt_content, decrypt_recovery_slot, encrypt_password_slot,
    encrypt_to_recipient, scrypt_work_factor, ContainerIdentity,
};
use locked_store::keyslots::{
    open_password_slot, open_recovery_slot, seal_password_slot, seal_recovery_slot,
};
use locked_store::recovery_key::{
    build_recovery_file, encode_recovery_file, parse_recovery_bytes, recovery_secret,
};
use locked_store::types::LockedHeader;
use locked_store::LockedError;
use uuid::Uuid;

fn password() -> SecretString {
    SecretString::from("twelve chars and spaces".to_string())
}

fn header(container_id: Uuid, identity: &ContainerIdentity) -> LockedHeader {
    LockedHeader {
        schema_version: 1,
        container_id,
        content_recipient: identity.recipient().to_string(),
        created_unix: 1,
        chunk_count: 0,
        index_cipher_sha256: "a".repeat(64),
        password_slot_sha256: "b".repeat(64),
        recovery_slot_sha256: "c".repeat(64),
    }
}

#[test]
fn password_and_independent_recovery_decrypt_same_identity() {
    let container_id = Uuid::new_v4();
    let content = ContainerIdentity::generate();
    let recovery = ContainerIdentity::generate();
    let header = header(container_id, &content);
    let password_slot = seal_password_slot(&content, container_id, &password()).unwrap();
    let recovery_slot = seal_recovery_slot(&content, container_id, recovery.recipient()).unwrap();
    let from_password = open_password_slot(&header, &password_slot, &password()).unwrap();
    let from_recovery =
        open_recovery_slot(&header, &recovery_slot, recovery.secret().expose_secret()).unwrap();
    assert_eq!(from_password.recipient(), content.recipient());
    assert_eq!(from_recovery.recipient(), content.recipient());
    assert_eq!(
        from_password.secret().expose_secret(),
        from_recovery.secret().expose_secret()
    );
}

#[test]
fn mixed_recipient_header_is_never_created() {
    let container_id = Uuid::new_v4();
    let content = ContainerIdentity::generate();
    let password_slot = seal_password_slot(&content, container_id, &password()).unwrap();
    let recovery = ContainerIdentity::generate();
    let recovery_slot = seal_recovery_slot(&content, container_id, recovery.recipient()).unwrap();
    let password_text = String::from_utf8_lossy(&password_slot);
    assert!(password_text.contains("-> scrypt "));
    assert!(!password_text.contains("-> X25519 "));
    let recovery_text = String::from_utf8_lossy(&recovery_slot);
    assert!(recovery_text.contains("-> X25519 "));
    assert!(!recovery_text.contains("-> scrypt "));
    assert_eq!(scrypt_work_factor(&password_slot), Some(18));
    assert_eq!(scrypt_work_factor(&recovery_slot), None);
}

#[test]
fn work_factor_19_is_refused_before_kdf() {
    let crafted = b"age-encryption.org/v1\n-> scrypt c2FsdA 19\nbody\n--- mac\n";
    assert_eq!(check_work_factor(crafted), Err(LockedError::UnsupportedKdf));
    assert!(matches!(
        locked_store::crypto::decrypt_password_slot(&password(), crafted, 1024),
        Err(LockedError::UnsupportedKdf)
    ));
}

#[test]
fn truncated_age_stream_never_exposes_plaintext() {
    let identity = ContainerIdentity::generate();
    let mut ciphertext = encrypt_to_recipient(identity.recipient(), b"top secret").unwrap();
    ciphertext.truncate(ciphertext.len() - 12);
    let result = decrypt_content(&identity, &ciphertext, 1024);
    assert!(result.is_err());
    let text = format!("{:?}", result.unwrap_err());
    assert!(!text.contains("top secret"));
}

#[test]
fn wrong_password_is_generic() {
    let ciphertext = encrypt_password_slot(&password(), b"secret index").unwrap();
    let error = locked_store::crypto::decrypt_password_slot(
        &SecretString::from("another twelve chars".to_string()),
        &ciphertext,
        1024,
    )
    .unwrap_err();
    assert_eq!(error, LockedError::BadPasswordOrCorrupt);
    assert_eq!(error.code(), "locked.bad_password_or_corrupt");
}

#[test]
fn recovery_file_roundtrips_without_printing_the_secret() {
    let container_id = Uuid::new_v4();
    let recovery = ContainerIdentity::generate();
    let file = build_recovery_file(container_id, &recovery);
    let bytes = encode_recovery_file(&file).unwrap();
    let parsed = parse_recovery_bytes(&bytes).unwrap();
    assert_eq!(parsed.container_id, container_id);
    assert_eq!(
        recovery_secret(&parsed).expose_secret(),
        recovery.secret().expose_secret()
    );
    let text = format!("{parsed:?}");
    assert!(!text.contains(recovery.secret().expose_secret()));
}

#[test]
fn recovery_stream_can_be_decrypted_with_the_exported_secret() {
    let identity = ContainerIdentity::generate();
    let ciphertext = encrypt_to_recipient(identity.recipient(), b"recovery payload").unwrap();
    let plain =
        decrypt_recovery_slot(identity.secret().expose_secret(), &ciphertext, 1024).unwrap();
    assert_eq!(&*plain, b"recovery payload");
}
