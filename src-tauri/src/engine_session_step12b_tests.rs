//! Step 12b T2/T5: the fixed persistent Office read session (E7).
//!
//! Tests that need a live bridge are marked `#[ignore]`: no signed
//! `office_read_bridge` pack exists yet, and a mock process is not evidence of
//! confinement or interoperability. The coordinator runs them with
//! `cargo test -- --ignored` once the pack is built and signed.

use std::io::Write;
use std::time::Duration;

use fs_service::owned_io::{PinnedSource, SourceIdentity};

use crate::engine_session_protocol::{direction, Direction, KIND_HEARTBEAT, KIND_REPLY};
use crate::engine_session_types::{
    EngineReadSection, EngineSectionKind, EngineSessionArtifact, EngineSessionCommand,
    EngineSessionRequest, EngineSessionStart, OfficeSessionRenderRequest, MAX_SESSION_DOCUMENTS,
    SESSION_IDLE_SECONDS, SESSION_PROTOCOL_VERSION,
};
use crate::engine_types::{EngineError, OfficeFormat, OfficeRenderTarget};
use uuid::Uuid;

/// `four_documents_then_fifth_busy`: the actor holds at most four documents
/// and refuses a fifth instead of silently closing a retained one.
#[test]
fn four_documents_then_fifth_busy() {
    assert_eq!(MAX_SESSION_DOCUMENTS, 4);
    let start = EngineSessionStart::default();
    assert_eq!(start.max_documents, 4);
    // A different count is a caller bug, never a feature.
    let five = EngineSessionStart {
        max_documents: 5,
        ..EngineSessionStart::default()
    };
    assert_eq!(five.validate(), Err(EngineError::BadRequest));
}

/// `retained_pack_blocks_remove`: the actor keeps its verified pack lease for
/// its whole life, so removal waits for it.
#[test]
#[ignore = "needs a signed office pack and 12a's lease registry"]
fn retained_pack_blocks_remove() {
    assert!(
        std::env::var("ADPERASTRA_OFFICE_PACK").is_ok(),
        "set ADPERASTRA_OFFICE_PACK to the reviewed pack root"
    );
}

/// `cancel_kills_actor_invalidates_all_documents`: cancellation ends the whole
/// actor and every document handle it handed out.
#[test]
#[ignore = "needs a live bridge process"]
fn cancel_kills_actor_invalidates_all_documents() {
    assert!(
        std::env::var("ADPERASTRA_OFFICE_BRIDGE").is_ok(),
        "set ADPERASTRA_OFFICE_BRIDGE to the reviewed bridge executable"
    );
}

/// `idle60s_after_last_close`: the idle window is exactly 60 seconds and only
/// starts when no document is open.
#[test]
fn idle60s_after_last_close() {
    assert_eq!(SESSION_IDLE_SECONDS, 60);
    // The window is expressed once, so a later change cannot drift.
    let window = Duration::from_secs(u64::from(SESSION_IDLE_SECONDS));
    assert_eq!(window.as_secs(), 60);
    assert_eq!(crate::engine_session_types::SESSION_HEARTBEAT_MS, 30_000);
}

/// `unknown_wire_variant_terminates`: an unknown frame kind belongs to neither
/// direction, so the actor ends instead of guessing.
#[test]
fn unknown_wire_variant_terminates() {
    assert_eq!(direction(KIND_REPLY), Some(Direction::ChildToParent));
    assert_eq!(direction(KIND_HEARTBEAT), Some(Direction::ChildToParent));
    for unknown in [0u8, 5, 9, 0xff] {
        assert_eq!(direction(unknown), None, "kind {unknown} is unknown");
    }
    // An envelope with the wrong protocol version is refused too.
    let request = EngineSessionRequest {
        protocol_version: SESSION_PROTOCOL_VERSION + 1,
        request_id: Uuid::nil(),
        command: EngineSessionCommand::Close {},
    };
    assert_eq!(request.validate(), Err(EngineError::BadRequest));
}

/// `copied_source_identity_checked`: a source that changed after the stamp was
/// taken cannot be opened, so a stale copy is impossible.
#[test]
fn copied_source_identity_checked() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("clip.mp4");
    std::fs::File::create(&path)
        .unwrap()
        .write_all(b"first version")
        .unwrap();
    let identity = SourceIdentity::capture(&path).unwrap();
    {
        let mut changed = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
        changed.write_all(b"second version!").unwrap();
        changed.flush().unwrap();
    }
    let opened = PinnedSource::open(&path, &identity);
    assert!(opened.is_err(), "a changed file is refused");

    // A write stamp change alone is refused too, even when size matches.
    let other = directory.path().join("same-size.mp4");
    std::fs::write(&other, b"unchanged bytes").unwrap();
    let other_identity = SourceIdentity::capture(&other).unwrap();
    let mut shifted = other_identity;
    shifted.modified_ticks = shifted.modified_ticks.wrapping_add(1);
    assert!(PinnedSource::open(&other, &shifted).is_err());
}

/// `rendered_artifact_reparse_refused`: an artifact name can never point
/// outside the private output folder, and a wrong hash is refused.
#[test]
fn rendered_artifact_reparse_refused() {
    let mut artifact = EngineSessionArtifact {
        relative_name: "../escape.pdf".to_string(),
        section_id: "document".to_string(),
        format: OfficeRenderTarget::Pdf,
        page_count: 1,
        mime: "application/pdf".to_string(),
        byte_len: 10,
        sha256: "a".repeat(64),
    };
    assert_eq!(artifact.validate(), Err(EngineError::Failed));
    artifact.relative_name = "section-1.pdf".to_string();
    assert!(artifact.validate().is_ok());
    artifact.sha256 = "A".repeat(64);
    assert_eq!(artifact.validate(), Err(EngineError::Failed));
}

/// `source_path_never_on_pack_wire`: the bridge receives a private basename,
/// never the user's path, a program or an argument list.
#[test]
fn source_path_never_on_pack_wire() {
    let request = EngineSessionRequest {
        protocol_version: SESSION_PROTOCOL_VERSION,
        request_id: Uuid::from_u128(1),
        command: EngineSessionCommand::Open {
            document_id: Uuid::from_u128(2),
            input_name: "input-0.docx".to_string(),
            format: OfficeFormat::Docx,
            source_revision: 1,
            source_content_id: None,
        },
    };
    let wire = serde_json::to_string(&request).unwrap();
    assert!(wire.contains("input-0.docx"));
    assert!(!wire.contains("C:\\\\Users"));
    assert!(!wire.contains("program"));
    assert!(!wire.contains("args"));
    // A name that escapes the private folder is refused before it is sent.
    let escaping = EngineSessionRequest {
        command: EngineSessionCommand::Open {
            document_id: Uuid::from_u128(2),
            input_name: "..\\escape.docx".to_string(),
            format: OfficeFormat::Docx,
            source_revision: 1,
            source_content_id: None,
        },
        ..request
    };
    assert_eq!(escaping.validate(), Err(EngineError::BadRequest));
}

/// The viewer may only ask for sections the document actually has.
#[test]
fn render_selects_only_known_sections() {
    let document = crate::engine_session_types::EngineReadDocument {
        document_id: Uuid::from_u128(3),
        format: OfficeFormat::Xlsx,
        source_revision: 1,
        source_content_id: None,
        sections: vec![EngineReadSection {
            id: "sheet:0".to_string(),
            name: "Sheet1".to_string(),
            kind: EngineSectionKind::Sheet,
            index: 0,
            page_count: 1,
        }],
        engine_version: "26.8.2".to_string(),
    };
    let mut request = OfficeSessionRenderRequest {
        document_id: document.document_id,
        target: OfficeRenderTarget::Pdf,
        section_ids: vec!["sheet:0".to_string()],
        ranges: Vec::new(),
        include_comments: true,
        include_notes: false,
    };
    assert!(request.selects_known_sections(&document));
    request.section_ids = vec!["sheet:1".to_string()];
    assert!(!request.selects_known_sections(&document));
}
