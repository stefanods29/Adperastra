//! Native command-state tests for Step 17d (no Tauri window needed).

use uuid::Uuid;

use super::AiExtractionRuntime;
use crate::ai_extraction_requests::ExtractionCorrection;
use crate::ai_extraction_types::{
    ExtractionBlock, ExtractionBlockKind, ExtractionReview, ExtractionSource, ExtractionValue,
    ExtractionValueStatus,
};
use crate::local_ai_types::{AiInputKind, AiInputRef};
use crate::pdf_types::PdfSourceIdentity;
use fs_service::SourceStamp;

fn source() -> ExtractionSource {
    ExtractionSource {
        id: Uuid::new_v4(),
        input: AiInputRef {
            kind: AiInputKind::Document,
            id: Uuid::new_v4(),
            expected_revision: 1,
        },
        identity: PdfSourceIdentity::Disk {
            stamp: SourceStamp {
                path_key: "c:\\scans\\letter.pdf".to_string(),
                volume_id: "1a2b3c4d".to_string(),
                file_id: "0011223344556677".to_string(),
                modified_ticks: "100".to_string(),
                size_bytes: 2048,
            },
        },
        display_name: "letter.pdf".to_string(),
        page_count: 1,
        sensitive: false,
    }
}

fn review() -> ExtractionReview {
    let value = ExtractionValue {
        id: Uuid::new_v4(),
        original: "Acme".to_string(),
        value: "Acme".to_string(),
        confidence: 0.95,
        status: ExtractionValueStatus::Certain,
        anchors: Vec::new(),
        correction_revision: 0,
    };
    ExtractionReview {
        id: Uuid::new_v4(),
        revision: 1,
        content_id: Uuid::new_v4(),
        sources: vec![source()],
        blocks: vec![ExtractionBlock {
            id: Uuid::new_v4(),
            kind: ExtractionBlockKind::Paragraph,
            order: 0,
            heading_level: None,
            text: Some(value),
            list_items: Vec::new(),
            table_id: None,
        }],
        tables: Vec::new(),
        receipts: Vec::new(),
        complete: true,
        warnings: Vec::new(),
        next_cursor: None,
        expires_unix: 2_000_000_000,
        sensitive: false,
    }
}

#[test]
fn extraction_start_fails_closed_without_backend() {
    let runtime = AiExtractionRuntime::default();
    assert_eq!(
        runtime.extraction().err().as_deref(),
        Some("ai_extract.unavailable")
    );
    assert_eq!(
        runtime.capture_sink().err().as_deref(),
        Some("ai_extract.unavailable")
    );
    assert_eq!(
        runtime.inline_backend().err().as_deref(),
        Some("ai_inline.unavailable")
    );
}

#[test]
fn extraction_review_page_correct_and_release() {
    let runtime = AiExtractionRuntime::default();
    let review = review();
    let id = review.id;
    runtime.store_review(review).unwrap();
    let page = runtime.page(id, "").unwrap();
    assert_eq!(page.revision, 1);
    // A cursor that was never issued is refused.
    assert_eq!(
        runtime
            .page(id, &Uuid::new_v4().to_string())
            .err()
            .as_deref(),
        Some("ai_extract.changed")
    );
    let value_id = page.blocks[0].text.as_ref().unwrap().id;
    let corrected = runtime
        .correct(
            id,
            1,
            &[ExtractionCorrection::Field {
                id: value_id,
                expected: "Acme".to_string(),
                value: "Acme S.A.".to_string(),
            }],
        )
        .unwrap();
    assert_eq!(corrected.revision, 2);
    assert_eq!(
        runtime
            .correct(
                id,
                1,
                &[ExtractionCorrection::Field {
                    id: value_id,
                    expected: "Acme".to_string(),
                    value: "Other".to_string(),
                }],
            )
            .err()
            .as_deref(),
        Some("ai_extract.changed")
    );
    runtime.release(id);
    assert_eq!(
        runtime.page(id, "").err().as_deref(),
        Some("ai_extract.changed")
    );
    runtime.release(id);
}
