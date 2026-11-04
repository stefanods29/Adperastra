//! Native snapshot boundary tests for Step 08a T2. These use no Tauri window
//! and no app data outside a temporary directory.

use std::sync::Arc;

use fs_service::SourceStamp;
use uuid::Uuid;

use crate::export_snapshot_types::{
    ExportSnapshot, SnapshotBeginRequest, StoragePolicy, MAX_SNAPSHOT_BYTES,
};
use crate::export_snapshots::{ExportSnapshots, SnapshotLease};
use crate::file_grant_backing::GrantedBacking;

struct Fixture {
    snapshots: Arc<ExportSnapshots>,
    _dir: tempfile::TempDir,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let snapshots = ExportSnapshots::new(dir.path().join("export-input")).unwrap();
    Fixture {
        snapshots: Arc::new(snapshots),
        _dir: dir,
    }
}

fn stamp() -> SourceStamp {
    SourceStamp {
        path_key: r"c:\pictures\original.jpg".to_string(),
        volume_id: "0a1b2c3d".to_string(),
        file_id: "0123456789abcdef".to_string(),
        modified_ticks: "133000000000000000".to_string(),
        size_bytes: 1234,
    }
}

fn authority(
    fixture: &Fixture,
    name: &str,
    mime: &str,
    source: Option<SourceStamp>,
    sensitive: bool,
) -> Uuid {
    fixture
        .snapshots
        .authorities()
        .register_native(Uuid::new_v4(), name, mime, source, sensitive)
        .unwrap()
        .document_id
}

fn begin(
    fixture: &Fixture,
    document_id: Uuid,
    mime: &str,
    bytes: u64,
    source: Option<SourceStamp>,
) -> Result<(String, String), String> {
    fixture
        .snapshots
        .begin(SnapshotBeginRequest {
            document_id,
            revision: 1,
            content_id: Uuid::new_v4(),
            mime: mime.to_string(),
            byte_len: bytes,
            source,
        })
        .map(|reply| (reply.snapshot_id, reply.upload_token))
}

fn append_all(
    fixture: &Fixture,
    snapshot_id: &str,
    token: &str,
    bytes: &[u8],
) -> Result<(), String> {
    let mut offset = 0u64;
    for chunk in bytes.chunks(64 * 1024) {
        fixture
            .snapshots
            .append(snapshot_id, token, offset, chunk)?;
        offset += chunk.len() as u64;
    }
    Ok(())
}

#[test]
fn unregistered_authority_is_refused() {
    let fixture = fixture();
    let result = begin(&fixture, Uuid::new_v4(), "image/png", 4, None);
    assert_eq!(result.err().as_deref(), Some("snapshot.bad_request"));
}

#[test]
fn original_jpeg_authorized_png_capture_succeeds() {
    let fixture = fixture();
    let source = stamp();
    let document = authority(
        &fixture,
        "photo.jpg",
        "image/jpeg",
        Some(source.clone()),
        false,
    );
    fixture
        .snapshots
        .authorities()
        .permit_capture_mime(document, "image/png")
        .unwrap();
    let (snapshot_id, token) = begin(&fixture, document, "image/png", 4, Some(source)).unwrap();
    append_all(&fixture, &snapshot_id, &token, b"PNG!").unwrap();
    let snapshot = fixture.snapshots.finish(&snapshot_id).unwrap();
    assert_eq!(snapshot.mime, "image/png");
    assert_eq!(snapshot.byte_len, 4);
    assert_eq!(snapshot.storage_policy, StoragePolicy::Ordinary);
}

#[test]
fn original_docx_authorized_pdf_export_succeeds() {
    let fixture = fixture();
    let source = stamp();
    let document = authority(
        &fixture,
        "report.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        Some(source.clone()),
        false,
    );
    fixture
        .snapshots
        .authorities()
        .permit_capture_mime(document, "application/pdf")
        .unwrap();
    let (snapshot_id, token) =
        begin(&fixture, document, "application/pdf", 5, Some(source)).unwrap();
    append_all(&fixture, &snapshot_id, &token, b"%PDF!").unwrap();
    let snapshot = fixture.snapshots.finish(&snapshot_id).unwrap();
    assert_eq!(snapshot.mime, "application/pdf");
}

#[test]
fn ui_cannot_add_capture_mime() {
    // There is deliberately no Tauri command for this method; only native
    // providers call it. An unknown authority is refused and the list stays
    // bounded at sixteen unique values.
    let fixture = fixture();
    assert!(fixture
        .snapshots
        .authorities()
        .permit_capture_mime(Uuid::new_v4(), "image/png")
        .is_err());
    let document = authority(&fixture, "photo.jpg", "image/jpeg", None, false);
    for index in 0..15 {
        fixture
            .snapshots
            .authorities()
            .permit_capture_mime(document, &format!("image/x-test-{index}"))
            .unwrap();
    }
    assert_eq!(
        fixture
            .snapshots
            .authorities()
            .capture_mimes(document)
            .unwrap()
            .len(),
        16
    );
}

#[test]
fn seventeenth_mime_is_refused() {
    let fixture = fixture();
    let document = authority(&fixture, "photo.jpg", "image/jpeg", None, false);
    for index in 0..15 {
        fixture
            .snapshots
            .authorities()
            .permit_capture_mime(document, &format!("image/x-test-{index}"))
            .unwrap();
    }
    assert_eq!(
        fixture
            .snapshots
            .authorities()
            .permit_capture_mime(document, "image/x-seventeenth")
            .err()
            .as_deref(),
        Some("snapshot.too_large")
    );
    // A duplicate value is idempotent, not a seventeenth entry.
    fixture
        .snapshots
        .authorities()
        .permit_capture_mime(document, "image/jpeg")
        .unwrap();
}

#[test]
fn sensitive_authority_cannot_downgrade_by_omitting_source() {
    let fixture = fixture();
    let source = stamp();
    let document = authority(
        &fixture,
        "secret.png",
        "image/png",
        Some(source.clone()),
        true,
    );
    // Omitting the source does not change the policy: the authority's
    // native stamp is used and the capture stays sensitive.
    let (snapshot_id, token) = begin(&fixture, document, "image/png", 1, None).unwrap();
    append_all(&fixture, &snapshot_id, &token, b"x").unwrap();
    let snapshot = fixture.snapshots.finish(&snapshot_id).unwrap();
    assert_eq!(snapshot.storage_policy, StoragePolicy::Sensitive);
    assert_eq!(snapshot.source, Some(source.clone()));
    // A caller-provided source that differs from the authority is refused.
    let mut other = stamp();
    other.modified_ticks = "133000000000000001".to_string();
    assert_eq!(
        begin(&fixture, document, "image/png", 1, Some(other))
            .err()
            .as_deref(),
        Some("snapshot.bad_request")
    );
}

#[test]
fn chunk_offset_gap_and_duplicate_are_rejected_without_foreign_write() {
    let fixture = fixture();
    let document = authority(&fixture, "a.bin", "application/octet-stream", None, false);
    let (first_id, first_token) =
        begin(&fixture, document, "application/octet-stream", 4, None).unwrap();
    let (second_id, second_token) =
        begin(&fixture, document, "application/octet-stream", 4, None).unwrap();
    fixture
        .snapshots
        .append(&first_id, &first_token, 0, b"ab")
        .unwrap();
    // A gap (2) is refused, then the duplicate of 0 is refused.
    assert!(fixture
        .snapshots
        .append(&first_id, &first_token, 3, b"d")
        .is_err());
    assert!(fixture
        .snapshots
        .append(&first_id, &first_token, 0, b"zz")
        .is_err());
    // The other snapshot was not altered by either refused write.
    fixture
        .snapshots
        .append(&second_id, &second_token, 0, b"wxyz")
        .unwrap();
    let snapshot = fixture.snapshots.finish(&second_id).unwrap();
    assert_eq!(snapshot.byte_len, 4);
}

#[test]
fn byte_257_mib_is_refused_before_allocating() {
    let fixture = fixture();
    let document = authority(
        &fixture,
        "huge.bin",
        "application/octet-stream",
        None,
        false,
    );
    let result = begin(
        &fixture,
        document,
        "application/octet-stream",
        MAX_SNAPSHOT_BYTES + 1,
        None,
    );
    assert_eq!(result.err().as_deref(), Some("snapshot.bad_request"));
}

#[test]
fn sensitive_input_never_reaches_disk() {
    let fixture = fixture();
    let source = stamp();
    let document = authority(
        &fixture,
        "secret.png",
        "image/png",
        Some(source.clone()),
        true,
    );
    let (snapshot_id, token) = begin(&fixture, document, "image/png", 4, Some(source)).unwrap();
    append_all(&fixture, &snapshot_id, &token, b"DATA").unwrap();
    let _snapshot = fixture.snapshots.finish(&snapshot_id).unwrap();
    let files = std::fs::read_dir(fixture.snapshots.root()).unwrap().count();
    assert_eq!(files, 0);
    let lease = fixture
        .snapshots
        .resolve(&snapshot_id, &document.to_string(), 1)
        .unwrap();
    match lease.backing.as_ref() {
        GrantedBacking::Memory {
            bytes, sensitive, ..
        } => {
            assert!(*sensitive);
            assert_eq!(bytes.as_slice(), b"DATA");
        }
        _ => panic!("a sensitive snapshot must be memory-only"),
    }
}

#[test]
fn revision_1_stays_revision_1_after_edit_2() {
    let fixture = fixture();
    let document = authority(&fixture, "notes.txt", "text/plain", None, false);
    let (snapshot_id, token) = begin(&fixture, document, "text/plain", 3, None).unwrap();
    append_all(&fixture, &snapshot_id, &token, b"one").unwrap();
    let snapshot = fixture.snapshots.finish(&snapshot_id).unwrap();
    assert_eq!(snapshot.revision, 1);
    assert!(fixture
        .snapshots
        .resolve(&snapshot_id, &document.to_string(), 1)
        .is_ok());
    assert!(fixture
        .snapshots
        .resolve(&snapshot_id, &document.to_string(), 2)
        .is_err());
}

#[test]
fn pdf_snapshot_content_id_mismatch_is_refused() {
    let fixture = fixture();
    let document = authority(&fixture, "plan.pdf", "application/pdf", None, false);
    let content_id = Uuid::new_v4();
    let (snapshot_id, token) = fixture
        .snapshots
        .begin(SnapshotBeginRequest {
            document_id: document,
            revision: 1,
            content_id,
            mime: "application/pdf".to_string(),
            byte_len: 4,
            source: None,
        })
        .map(|reply| (reply.snapshot_id, reply.upload_token))
        .unwrap();
    append_all(&fixture, &snapshot_id, &token, b"%PDF").unwrap();
    fixture.snapshots.finish(&snapshot_id).unwrap();
    assert!(fixture
        .snapshots
        .resolve_exact(
            &snapshot_id,
            &document.to_string(),
            1,
            &Uuid::new_v4().to_string()
        )
        .is_err());
    assert!(fixture
        .snapshots
        .resolve_exact(
            &snapshot_id,
            &document.to_string(),
            1,
            &content_id.to_string()
        )
        .is_ok());
}

#[test]
fn released_snapshot_cannot_open_again_but_a_live_lease_keeps_its_bytes() {
    let fixture = fixture();
    let document = authority(&fixture, "secret.png", "image/png", None, true);
    let (snapshot_id, token) = begin(&fixture, document, "image/png", 4, None).unwrap();
    append_all(&fixture, &snapshot_id, &token, b"KEEP").unwrap();
    fixture.snapshots.finish(&snapshot_id).unwrap();
    let lease: SnapshotLease = fixture
        .snapshots
        .resolve(&snapshot_id, &document.to_string(), 1)
        .unwrap();
    fixture.snapshots.release(&snapshot_id).unwrap();
    assert!(fixture
        .snapshots
        .resolve(&snapshot_id, &document.to_string(), 1)
        .is_err());
    match lease.backing.as_ref() {
        GrantedBacking::Memory { bytes, .. } => assert_eq!(bytes.as_slice(), b"KEEP"),
        _ => panic!("the lease must still own its bytes"),
    }
}

#[test]
fn cancellation_removes_only_the_owned_input() {
    let fixture = fixture();
    let document = authority(&fixture, "a.bin", "application/octet-stream", None, false);
    let (first, first_token) =
        begin(&fixture, document, "application/octet-stream", 1, None).unwrap();
    let (second, second_token) =
        begin(&fixture, document, "application/octet-stream", 1, None).unwrap();
    fixture
        .snapshots
        .append(&first, &first_token, 0, b"a")
        .unwrap();
    fixture
        .snapshots
        .append(&second, &second_token, 0, b"b")
        .unwrap();
    let foreign = fixture.snapshots.root().join("foreign.partial");
    std::fs::write(&foreign, b"not ours").unwrap();
    fixture.snapshots.abort_upload(&first).unwrap();
    assert!(foreign.exists());
    assert_eq!(
        std::fs::read_dir(fixture.snapshots.root()).unwrap().count(),
        2 // the foreign file and the second owned staging file
    );
    let snapshot = fixture.snapshots.finish(&second).unwrap();
    assert_eq!(snapshot.byte_len, 1);
}

#[test]
fn finalized_snapshot_keeps_its_identity() {
    let fixture = fixture();
    let document = authority(&fixture, "a.bin", "application/octet-stream", None, false);
    let content_id = Uuid::new_v4();
    let reply = fixture
        .snapshots
        .begin(SnapshotBeginRequest {
            document_id: document,
            revision: 7,
            content_id,
            mime: "application/octet-stream".to_string(),
            byte_len: 2,
            source: None,
        })
        .unwrap();
    append_all(&fixture, &reply.snapshot_id, &reply.upload_token, b"ok").unwrap();
    let snapshot: ExportSnapshot = fixture.snapshots.finish(&reply.snapshot_id).unwrap();
    assert_eq!(snapshot.revision, 7);
    assert_eq!(snapshot.content_id, content_id);
    assert_eq!(snapshot.document_id, document.to_string());
}

#[test]
fn ordinary_snapshot_keeps_owned_handle_and_never_deletes_foreign_file() {
    let fixture = fixture();
    let document = authority(&fixture, "a.bin", "application/octet-stream", None, false);
    let (id, token) = begin(&fixture, document, "application/octet-stream", 4, None).unwrap();
    append_all(&fixture, &id, &token, b"KEEP").unwrap();
    fixture.snapshots.finish(&id).unwrap();
    let lease = fixture
        .snapshots
        .resolve(&id, &document.to_string(), 1)
        .unwrap();
    let foreign = fixture.snapshots.root().join(format!("{id}.bin"));
    std::fs::write(&foreign, b"FOREIGN").unwrap();
    fixture.snapshots.release(&id).unwrap();
    assert_eq!(lease.backing.read_range(0, 4).unwrap(), b"KEEP");
    drop(lease);
    assert_eq!(std::fs::read(&foreign).unwrap(), b"FOREIGN");
    assert_eq!(
        std::fs::read_dir(fixture.snapshots.root()).unwrap().count(),
        1
    );
}

#[test]
fn expired_snapshot_keeps_live_bytes_and_releases_budget_after_the_last_lease() {
    let fixture = fixture();
    let document = authority(&fixture, "note.txt", "text/plain", None, true);
    let (id, token) = begin(&fixture, document, "text/plain", 4, None).unwrap();
    append_all(&fixture, &id, &token, b"live").unwrap();
    let snapshot = fixture.snapshots.finish(&id).unwrap();
    let lease = fixture.snapshots.resolve(&id, &snapshot.document_id, 1).unwrap();
    {
        let entries = fixture.snapshots.finalized_lock().unwrap();
        let entry = entries.get(&Uuid::parse_str(&id).unwrap()).unwrap();
        *entry.expires_at.lock().unwrap() = std::time::Instant::now() - std::time::Duration::from_secs(1);
    }
    fixture.snapshots.cleanup_expired();
    assert_eq!(fixture.snapshots.finalized_lock().unwrap().len(), 1);
    assert_eq!(fixture.snapshots.budget.reserved.load(std::sync::atomic::Ordering::Relaxed), 4);
    drop(lease);
    fixture.snapshots.cleanup_expired();
    assert!(fixture.snapshots.finalized_lock().unwrap().is_empty());
    assert_eq!(fixture.snapshots.budget.reserved.load(std::sync::atomic::Ordering::Relaxed), 0);
}
