//! Step 09k T3: bounded, authenticated container format.

use age::secrecy::SecretString;
use fs_service::owned_io::{OwnedOutput, PinnedDirectory};
use locked_store::chunks::{decrypt_chunk, encrypt_chunk, sha256_hex};
use locked_store::crypto::{encrypt_to_recipient, ContainerIdentity};
use locked_store::format::{write_container, ContainerFile, ContainerParts};
use locked_store::index::{build_index, encode_index};
use locked_store::keyslots::{seal_password_slot, seal_recovery_slot};
use locked_store::limits::{Limits, MAX_CHUNK_PLAIN_BYTES};
use locked_store::types::{LockedChunk, LockedEntry, LockedEntryKind, LockedHeader, LockedIndex};
use locked_store::validation::{
    outer_entry_kind, validate_header, validate_index, validate_outer_names,
};
use locked_store::LockedError;
use uuid::Uuid;

fn chunk(id: Uuid, plain_len: u32) -> LockedChunk {
    LockedChunk {
        id,
        cipher_sha256: "a".repeat(64),
        plain_sha256: "b".repeat(64),
        plain_len,
    }
}

fn file_entry(name: &str, size: u64, chunks: Vec<Uuid>) -> LockedEntry {
    LockedEntry {
        id: Uuid::new_v4(),
        parent_id: None,
        name: name.to_string(),
        kind: LockedEntryKind::File,
        mime: "text/plain".to_string(),
        size,
        modified_unix: 1,
        chunks,
        from_internet: false,
        hidden: false,
        system: false,
        read_only: false,
    }
}

fn folder_entry(name: &str) -> LockedEntry {
    LockedEntry {
        id: Uuid::new_v4(),
        parent_id: None,
        name: name.to_string(),
        kind: LockedEntryKind::Folder,
        mime: String::new(),
        size: 0,
        modified_unix: 1,
        chunks: Vec::new(),
        from_internet: false,
        hidden: false,
        system: false,
        read_only: false,
    }
}

fn header_for(
    index: &LockedIndex,
    identity: &ContainerIdentity,
    password_slot: &[u8],
    recovery_slot: &[u8],
    index_cipher: &[u8],
) -> LockedHeader {
    LockedHeader {
        schema_version: 1,
        container_id: index.container_id,
        content_recipient: identity.recipient().to_string(),
        created_unix: 1,
        chunk_count: index.chunk_records.len() as u32,
        index_cipher_sha256: sha256_hex(index_cipher),
        password_slot_sha256: sha256_hex(password_slot),
        recovery_slot_sha256: sha256_hex(recovery_slot),
    }
}

#[test]
fn path_traversal_and_unknown_outer_names_are_refused() {
    assert!(outer_entry_kind("../header.json").is_none());
    assert!(outer_entry_kind("chunks/../../x.age").is_none());
    assert!(outer_entry_kind("chunks\\x.age").is_none());
    let header = LockedHeader {
        schema_version: 1,
        container_id: Uuid::new_v4(),
        content_recipient: "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq".to_string(),
        created_unix: 1,
        chunk_count: 0,
        index_cipher_sha256: "a".repeat(64),
        password_slot_sha256: "b".repeat(64),
        recovery_slot_sha256: "c".repeat(64),
    };
    let names = vec![
        "header.json".to_string(),
        "keyslots/password.age".to_string(),
        "keyslots/recovery.age".to_string(),
        "index.age".to_string(),
        "chunks/../escape.age".to_string(),
    ];
    assert_eq!(
        validate_outer_names(&names, &header),
        Err(LockedError::Invalid)
    );
}

#[test]
fn duplicate_chunk_is_refused() {
    let id = Uuid::new_v4();
    let entry = file_entry("a.txt", 10, vec![id]);
    let index = build_index(
        Uuid::new_v4(),
        1,
        vec![entry],
        vec![chunk(id, 5), chunk(id, 5)],
    );
    assert_eq!(
        validate_index(&index, &Limits::default()),
        Err(LockedError::Invalid)
    );
}

#[test]
fn case_collision_is_refused() {
    let index = build_index(
        Uuid::new_v4(),
        1,
        vec![
            file_entry("Report.txt", 0, Vec::new()),
            file_entry("report.TXT", 0, Vec::new()),
        ],
        Vec::new(),
    );
    assert_eq!(
        validate_index(&index, &Limits::default()),
        Err(LockedError::Invalid)
    );
}

#[test]
fn reference_with_wrong_hash_is_refused() {
    let id = Uuid::new_v4();
    let entry = file_entry("a.txt", 5, vec![id]);
    let mut record = chunk(id, 5);
    record.plain_sha256 = "NOT-A-HASH".to_string();
    let index = build_index(Uuid::new_v4(), 1, vec![entry], vec![record]);
    assert_eq!(
        validate_index(&index, &Limits::default()),
        Err(LockedError::Invalid)
    );
}

#[test]
fn reordered_chunk_records_are_refused() {
    let first = Uuid::from_u128(1);
    let second = Uuid::from_u128(2);
    let index = LockedIndex {
        schema_version: 1,
        container_id: Uuid::new_v4(),
        revision: 1,
        entries: vec![file_entry("a.txt", 10, vec![first, second])],
        chunk_records: vec![chunk(second, 5), chunk(first, 5)],
    };
    assert_eq!(
        validate_index(&index, &Limits::default()),
        Err(LockedError::Invalid)
    );
}

#[test]
fn newer_container_version_is_refused() {
    let identity = ContainerIdentity::generate();
    let index = LockedIndex::empty(Uuid::new_v4(), 1);
    let mut header = header_for(&index, &identity, &[], &[], &[]);
    header.schema_version = 2;
    assert_eq!(validate_header(&header), Err(LockedError::Unsupported));
}

#[test]
fn oversized_index_is_refused_before_writing() {
    let index = build_index(
        Uuid::new_v4(),
        1,
        vec![file_entry("a.txt", 0, Vec::new())],
        Vec::new(),
    );
    let limits = Limits {
        max_index_plain_bytes: 16,
        ..Limits::default()
    };
    assert_eq!(
        encode_index(&index, &limits).unwrap_err(),
        LockedError::TooLarge
    );
}

#[test]
fn zero_and_empty_files_have_exact_lengths() {
    let index = build_index(
        Uuid::new_v4(),
        1,
        vec![folder_entry("empty"), file_entry("zero.txt", 0, Vec::new())],
        Vec::new(),
    );
    assert_eq!(validate_index(&index, &Limits::default()), Ok(()));
    let identity = ContainerIdentity::generate();
    let zero = index
        .entries
        .iter()
        .find(|entry| entry.name == "zero.txt")
        .unwrap();
    let bytes = locked_store::chunks::read_entry_range(&identity, zero, &[], 0, 0, |_| {
        Err(LockedError::Invalid)
    })
    .unwrap();
    assert!(bytes.is_empty());
}

#[test]
fn final_auth_is_checked_before_plaintext() {
    let identity = ContainerIdentity::generate();
    let (mut ciphertext, record) = encrypt_chunk(identity.recipient(), b"secret").unwrap();
    let last = ciphertext.len() - 1;
    ciphertext[last] ^= 0x01;
    let result = decrypt_chunk(&identity, &record, &ciphertext);
    assert!(matches!(
        result,
        Err(LockedError::BadPasswordOrCorrupt) | Err(LockedError::Changed)
    ));
}

#[test]
fn full_container_roundtrips_and_verifies_every_chunk() {
    let dir = tempfile::tempdir().unwrap();
    let container_id = Uuid::new_v4();
    let identity = ContainerIdentity::generate();
    let recovery = ContainerIdentity::generate();
    let password = SecretString::from("a long enough password".to_string());
    let (ciphertext, record) = encrypt_chunk(identity.recipient(), b"hello").unwrap();
    let entry = file_entry("hello.txt", 5, vec![record.id]);
    let index = build_index(container_id, 1, vec![entry], vec![record.clone()]);
    let index_plain = encode_index(&index, &Limits::default()).unwrap();
    let index_cipher = encrypt_to_recipient(identity.recipient(), &index_plain).unwrap();
    let password_slot = seal_password_slot(&identity, container_id, &password).unwrap();
    let recovery_slot = seal_recovery_slot(&identity, container_id, recovery.recipient()).unwrap();
    let header = header_for(
        &index,
        &identity,
        &password_slot,
        &recovery_slot,
        &index_cipher,
    );
    let pin = PinnedDirectory::open(dir.path()).unwrap();
    let mut output = OwnedOutput::create(&pin, "format").unwrap();
    write_container(
        &mut output,
        &ContainerParts {
            header: &header,
            password_slot: &password_slot,
            recovery_slot: &recovery_slot,
            index_cipher: &index_cipher,
            chunks: &[(record.id, ciphertext)],
        },
    )
    .unwrap();
    output.flush_sync().unwrap();
    let path = dir.path().join("vault.adplock");
    output.close().publish_to(&path).unwrap();
    let mut container = ContainerFile::open(&path, Limits::default()).unwrap();
    let opened = container.verify_all(&identity).unwrap();
    assert_eq!(opened.entries.len(), 1);
    assert_eq!(opened.chunk_records.len(), 1);
    assert_eq!(opened.chunk_records[0].plain_len as u64, 5);
    assert!(opened.chunk_records[0].plain_len as u64 <= MAX_CHUNK_PLAIN_BYTES);
}
