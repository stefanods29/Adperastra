//! Step 09k T4: verified encrypted copies without source removal.

use std::fs;
use std::io::{self, Cursor, Seek, SeekFrom, Write};
use std::path::Path;

use age::secrecy::SecretString;
use fs_service::new_cancellation_token;
use locked_store::create::{create_locked_copy, write_new_container, CreateDeps};
use locked_store::crypto::ContainerIdentity;
use locked_store::format::{write_container, ContainerParts};
use locked_store::index::{build_index, encode_index};
use locked_store::keyslots::{seal_password_slot, seal_recovery_slot};
use locked_store::limits::Limits;
use locked_store::sources::collect_sources;
use locked_store::types::{
    LockedCreateRequest, LockedEntry, LockedEntryKind, LockedHeader, LockedIndex,
};
use locked_store::verify::{hash_source, verify_candidate, ExpectedContainer};
use locked_store::LockedError;
use uuid::Uuid;

struct FailWriter {
    inner: Cursor<Vec<u8>>,
    limit: u64,
    written: u64,
}

impl Write for FailWriter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        if self.written + buffer.len() as u64 > self.limit {
            return Err(io::Error::from_raw_os_error(112));
        }
        let written = self.inner.write(buffer)?;
        self.written += written as u64;
        Ok(written)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

impl Seek for FailWriter {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        self.inner.seek(position)
    }
}

fn request(source: &Path, dest: &Path, recovery: &Path) -> LockedCreateRequest {
    LockedCreateRequest {
        source_dir: source.to_string_lossy().into_owned(),
        dest_path: dest.to_string_lossy().into_owned(),
        password: SecretString::from("a twelve char password".to_string()),
        recovery_dest_path: recovery.to_string_lossy().into_owned(),
        keep_original: true,
        confirm_original_unprotected: true,
    }
}

fn source_folder(root: &Path) -> std::path::PathBuf {
    let source = root.join("source");
    fs::create_dir_all(source.join("nested")).unwrap();
    fs::write(source.join("a.txt"), b"alpha").unwrap();
    fs::write(source.join("nested").join("b.txt"), b"beta").unwrap();
    fs::write(source.join("empty.txt"), b"").unwrap();
    source
}

#[test]
fn plaintext_original_warning_is_required() {
    let root = tempfile::tempdir().unwrap();
    let source = source_folder(root.path());
    let mut request = request(
        &source,
        &root.path().join("v.adplock"),
        &root.path().join("v.adprecovery"),
    );
    request.confirm_original_unprotected = false;
    let zone = |_: &Path| false;
    let token = new_cancellation_token();
    let mut deps = CreateDeps::quiet(&zone, &token);
    assert_eq!(
        create_locked_copy(&request, &mut deps).unwrap_err(),
        LockedError::Invalid
    );
    assert!(!root.path().join("v.adplock").exists());
}

#[test]
fn cancel_leaves_original_untouched_and_publishes_nothing() {
    let root = tempfile::tempdir().unwrap();
    let source = source_folder(root.path());
    let before = hash_source(&source.join("a.txt")).unwrap();
    let request = request(
        &source,
        &root.path().join("v.adplock"),
        &root.path().join("v.adprecovery"),
    );
    let zone = |_: &Path| false;
    let token = new_cancellation_token();
    token.store(true, std::sync::atomic::Ordering::Relaxed);
    let mut deps = CreateDeps::quiet(&zone, &token);
    assert_eq!(
        create_locked_copy(&request, &mut deps).unwrap_err(),
        LockedError::Cancelled
    );
    assert!(!root.path().join("v.adplock").exists());
    assert_eq!(hash_source(&source.join("a.txt")).unwrap(), before);
}

#[test]
fn no_space_keeps_the_original_and_writes_nothing() {
    let root = tempfile::tempdir().unwrap();
    let source = source_folder(root.path());
    let before = hash_source(&source.join("a.txt")).unwrap();
    let tree = collect_sources(&source, &|_: &Path| false).unwrap();
    let identity = ContainerIdentity::generate();
    let recovery = ContainerIdentity::generate();
    let password = SecretString::from("a twelve char password".to_string());
    let zone = |_: &Path| false;
    let token = new_cancellation_token();
    let mut deps = CreateDeps::quiet(&zone, &token);
    let mut writer = FailWriter {
        inner: Cursor::new(Vec::new()),
        limit: 32,
        written: 0,
    };
    let result = write_new_container(
        &mut writer,
        Uuid::new_v4(),
        &identity,
        &recovery,
        &password,
        &tree,
        &mut deps,
        Limits::default(),
    );
    assert_eq!(result.unwrap_err(), LockedError::NoSpace);
    assert_eq!(hash_source(&source.join("a.txt")).unwrap(), before);
}

#[test]
fn foreign_partial_and_existing_output_are_kept() {
    let root = tempfile::tempdir().unwrap();
    let source = source_folder(root.path());
    let dest = root.path().join("v.adplock");
    fs::write(&dest, b"foreign-output").unwrap();
    let partial = root.path().join("~adp-v-00000000.partial");
    fs::write(&partial, b"foreign-partial").unwrap();
    let request = request(&source, &dest, &root.path().join("v.adprecovery"));
    let zone = |_: &Path| false;
    let token = new_cancellation_token();
    let mut deps = CreateDeps::quiet(&zone, &token);
    assert_eq!(
        create_locked_copy(&request, &mut deps).unwrap_err(),
        LockedError::Invalid
    );
    assert_eq!(fs::read(&dest).unwrap(), b"foreign-output");
    assert_eq!(fs::read(&partial).unwrap(), b"foreign-partial");
}

#[test]
fn a_corrupt_candidate_is_never_reported_as_verified() {
    let root = tempfile::tempdir().unwrap();
    let source = source_folder(root.path());
    let dest = root.path().join("v.adplock");
    let recovery = root.path().join("v.adprecovery");
    let request = request(&source, &dest, &recovery);
    let zone = |_: &Path| false;
    let token = new_cancellation_token();
    let mut deps = CreateDeps::quiet(&zone, &token);
    create_locked_copy(&request, &mut deps).unwrap();
    let before = hash_source(&source.join("a.txt")).unwrap();
    // The source remains unchanged even when a verifier is handed a wrong
    // expectation; the container is not published from that attempt.
    let index = build_index(
        Uuid::new_v4(),
        1,
        vec![LockedEntry {
            id: Uuid::new_v4(),
            parent_id: None,
            name: "a.txt".to_string(),
            kind: LockedEntryKind::File,
            mime: "text/plain".to_string(),
            size: 5,
            modified_unix: 1,
            chunks: vec![Uuid::new_v4()],
            from_internet: false,
            hidden: false,
            system: false,
            read_only: false,
        }],
        Vec::new(),
    );
    let error = verify_candidate(
        &dest,
        &ExpectedContainer {
            index,
            sources: Vec::new(),
        },
        &request.password,
        "not the recovery secret",
        Limits::default(),
    )
    .unwrap_err();
    assert!(matches!(
        error,
        LockedError::BadPasswordOrCorrupt | LockedError::Changed
    ));
    assert_eq!(hash_source(&source.join("a.txt")).unwrap(), before);
}

#[test]
fn all_chunks_are_verified_before_publication() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path();
    let container_id = Uuid::new_v4();
    let identity = ContainerIdentity::generate();
    let recovery = ContainerIdentity::generate();
    let password = SecretString::from("a twelve char password".to_string());
    let record = locked_store::types::LockedChunk {
        id: Uuid::new_v4(),
        cipher_sha256: "a".repeat(64),
        plain_sha256: "b".repeat(64),
        plain_len: 5,
    };
    let entry = LockedEntry {
        id: Uuid::new_v4(),
        parent_id: None,
        name: "missing.txt".to_string(),
        kind: LockedEntryKind::File,
        mime: "text/plain".to_string(),
        size: 5,
        modified_unix: 1,
        chunks: vec![record.id],
        from_internet: false,
        hidden: false,
        system: false,
        read_only: false,
    };
    let index = build_index(container_id, 1, vec![entry], vec![record]);
    let index_plain = encode_index(&index, &Limits::default()).unwrap();
    let index_cipher =
        locked_store::crypto::encrypt_to_recipient(identity.recipient(), &index_plain).unwrap();
    let password_slot = seal_password_slot(&identity, container_id, &password).unwrap();
    let recovery_slot = seal_recovery_slot(&identity, container_id, recovery.recipient()).unwrap();
    let header = LockedHeader {
        schema_version: 1,
        container_id,
        content_recipient: identity.recipient().to_string(),
        created_unix: 1,
        chunk_count: 0,
        index_cipher_sha256: locked_store::chunks::sha256_hex(&index_cipher),
        password_slot_sha256: locked_store::chunks::sha256_hex(&password_slot),
        recovery_slot_sha256: locked_store::chunks::sha256_hex(&recovery_slot),
    };
    let pin = fs_service::owned_io::PinnedDirectory::open(dir).unwrap();
    let mut output = fs_service::owned_io::OwnedOutput::create(&pin, "incomplete").unwrap();
    write_container(
        &mut output,
        &ContainerParts {
            header: &header,
            password_slot: &password_slot,
            recovery_slot: &recovery_slot,
            index_cipher: &index_cipher,
            chunks: &[],
        },
    )
    .unwrap();
    output.flush_sync().unwrap();
    let path = dir.join("incomplete.adplock");
    output.close().publish_to(&path).unwrap();
    use age::secrecy::ExposeSecret;
    let error = verify_candidate(
        &path,
        &ExpectedContainer {
            index: LockedIndex::empty(container_id, 1),
            sources: Vec::new(),
        },
        &password,
        recovery.secret().expose_secret(),
        Limits::default(),
    )
    .unwrap_err();
    assert!(matches!(
        error,
        LockedError::BadPasswordOrCorrupt | LockedError::Changed | LockedError::Invalid
    ));
}
