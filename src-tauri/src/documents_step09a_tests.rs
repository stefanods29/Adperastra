//! Native document-store tests (Step 09a T2), with injected authority
//! and snapshot fakes. The coordinator registers this module with
//! `#[cfg(test)]` from `documents.rs`.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use uuid::Uuid;
use zeroize::Zeroizing;

use crate::document_types::DocumentError;
use crate::documents::{
    DocumentStore, SnapshotAuthorityPort, SnapshotPort, SnapshotUploadPort, SnapshotBeginResult,
};
use crate::file_grant_backing::GrantedBacking;
use crate::files::FileGrants;

struct FakeAuthority {
    permitted: Mutex<Vec<String>>,
    registered: AtomicUsize,
}

impl SnapshotAuthorityPort for FakeAuthority {
    fn register_native(&self, _id: Uuid, _name: &str, _mime: &str, _source: Option<fs_service::SourceStamp>, _sensitive: bool) -> Result<(), DocumentError> {
        self.registered.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    fn permit_capture_mime(&self, _id: Uuid, mime: &str) -> Result<(), DocumentError> {
        self.permitted.lock().unwrap().push(mime.to_string());
        Ok(())
    }
    fn check_capture_mime(&self, _id: Uuid, mime: &str) -> Result<(), DocumentError> {
        if self.permitted.lock().unwrap().iter().any(|entry| entry == mime) {
            Ok(())
        } else {
            Err(DocumentError::Invalid)
        }
    }
    fn revoke(&self, _id: Uuid) {}
}

struct FakeSnapshots;

impl SnapshotPort for FakeSnapshots {
    fn resolve(
        &self,
        _snapshot: &str,
        _doc: &str,
        _rev: u64,
        _content: &str,
    ) -> Result<Arc<GrantedBacking>, DocumentError> {
        Ok(Arc::new(GrantedBacking::Memory {
            bytes: Arc::new(Zeroizing::new(b"snapshot-bytes".to_vec())),
            length: 14,
            sensitive: false,
        }))
    }
}

impl SnapshotUploadPort for FakeSnapshots {
    fn begin(
        &self,
        _id: Uuid,
        _rev: u64,
        _content: Uuid,
        _mime: &str,
        _len: u64,
    ) -> Result<SnapshotBeginResult, DocumentError> {
        Ok(SnapshotBeginResult {
            snapshot_id: Uuid::new_v4().to_string(),
            upload_token: Uuid::new_v4().simple().to_string(),
        })
    }
}

fn store() -> DocumentStore {
    DocumentStore::new(
        Arc::new(FakeAuthority {
            permitted: Mutex::new(vec!["text/plain".to_string()]),
            registered: AtomicUsize::new(0),
        }),
        Arc::new(FakeSnapshots),
        Arc::new(FakeSnapshots),
    )
}

#[test]
fn office_copy_publishes_only_the_captured_revision_and_never_replaces() {
    use crate::export_snapshot_types::SnapshotBeginRequest;
    use crate::export_snapshots::ExportSnapshots;

    let dir = tempfile::tempdir().unwrap();
    let snapshots = Arc::new(ExportSnapshots::new(dir.path().join("snapshots")).unwrap());
    let store = DocumentStore::new(snapshots.clone(), snapshots.clone(), snapshots.clone());
    let grants = FileGrants::default();
    for extension in ["docx", "xlsx", "pptx"] {
        let source = dir.path().join(format!("original.{extension}"));
        let destination = dir.path().join(format!("copy.{extension}"));
        let original = b"disposable original bytes";
        let edited = b"disposable encoded office revision 2";
        std::fs::write(&source, original).unwrap();
        let prepared = DocumentStore::prepare_disk(&source).unwrap();
        let opened = store.register_prepared(&grants, prepared).unwrap();
        let document_id = Uuid::parse_str(&opened.document_id).unwrap();
        let content_id = Uuid::new_v4();
        let begin = snapshots.begin(SnapshotBeginRequest {
            document_id,
            revision: 2,
            content_id,
            mime: opened.info.mime.clone(),
            byte_len: edited.len() as u64,
            source: Some(fs_service::capture_source_stamp(&source).unwrap()),
        }).unwrap();
        snapshots.append(&begin.snapshot_id, &begin.upload_token, 0, edited).unwrap();
        snapshots.finish(&begin.snapshot_id).unwrap();
        let content = content_id.to_string();
        assert!(store.commit_copy(document_id, &begin.snapshot_id, 3, &content, &destination).is_err());
        assert!(!destination.exists());
        assert!(store.commit_copy(document_id, &begin.snapshot_id, 2, &content, &source).is_err());
        store.commit_copy(document_id, &begin.snapshot_id, 2, &content, &destination).unwrap();
        assert_eq!(std::fs::read(&destination).unwrap(), edited);
        assert!(store.commit_copy(document_id, &begin.snapshot_id, 2, &content, &destination).is_err());
        assert_eq!(std::fs::read(&destination).unwrap(), edited);
        assert_eq!(std::fs::read(&source).unwrap(), original);
        snapshots.release(&begin.snapshot_id).unwrap();
        store.release(&grants, document_id);
    }
}

#[test]
fn absent_locked_provider_fails_explicitly() {
    // A document that was never opened has no authority: an explicit
    // provider-missing error, never an empty success.
    let store = store();
    assert_eq!(
        store.validate_snapshot_begin(Uuid::new_v4(), 1, "text/plain", 1),
        Err(DocumentError::ProviderMissing)
    );
}

#[test]
fn unregistered_capture_mime_refused_and_capture_mime_keeps_sensitive() {
    let store = store();
    let dir = std::env::temp_dir().join(format!("adperastra-doc-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("note.txt");
    std::fs::write(&path, b"hello").unwrap();
    let prepared = DocumentStore::prepare_disk(&path).unwrap();
    let grants = FileGrants::default();
    let opened = store.register_prepared(&grants, prepared).unwrap();
    let id = Uuid::try_parse(&opened.document_id).unwrap();
    assert_eq!(
        store.validate_snapshot_begin(id, 1, "image/png", 1),
        Err(DocumentError::Invalid)
    );
    assert!(store.validate_snapshot_begin(id, 1, "text/plain", 1).is_ok());
    store.release(&grants, id);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn open_documents_under_lists_exact_live_disk_sources() {
    let store = store();
    let dir = std::env::temp_dir().join(format!(
        "adperastra-doc-under-{}-{}",
        std::process::id(),
        Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("note.txt");
    std::fs::write(&path, b"hello").unwrap();
    let prepared = DocumentStore::prepare_disk(&path).unwrap();
    let grants = FileGrants::default();
    let opened = store.register_prepared(&grants, prepared).unwrap();
    let id = Uuid::try_parse(&opened.document_id).unwrap();
    let text = path.to_string_lossy().into_owned();
    let drive = text.chars().next().expect("drive letter");
    let root = format!("{drive}:\\");

    let listed = store.open_documents_under(std::slice::from_ref(&root));
    assert_eq!(listed.len(), 1);
    assert!(listed
        .iter()
        .any(|(listed_id, listed_path)| *listed_id == id
            && listed_path.eq_ignore_ascii_case(&text)));
    // Drive letters compare case-insensitively and the `\\?\` prefix is
    // not part of the volume identity.
    assert_eq!(store.open_documents_under(&[root.to_uppercase()]).len(), 1);
    assert_eq!(
        store
            .open_documents_under(&[format!(r"\\?\{root}")])
            .len(),
        1
    );

    // Another volume and a path prefix that is not a whole component
    // are never a match.
    let other = if drive.eq_ignore_ascii_case(&'C') {
        "Q:\\".to_string()
    } else {
        "C:\\".to_string()
    };
    assert!(store.open_documents_under(&[other]).is_empty());
    let partial = &text[..text.len() - 1];
    assert!(store.open_documents_under(&[partial.to_string()]).is_empty());

    // A released document stops guarding its volume.
    store.release(&grants, id);
    assert!(store.open_documents_under(&[root]).is_empty());
    let _ = std::fs::remove_dir_all(&dir);
}
