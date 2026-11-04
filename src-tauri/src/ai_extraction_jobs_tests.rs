//! Native job-planning and pagination tests for Step 17d T3.

use uuid::Uuid;

use super::{
    plan_sections, retain_outcomes, validate_model_payload, PageOutcome, ReviewPager,
    MAX_SECTION_PAGES,
};
use crate::ai_extraction_types::{
    ExtractionBlock, ExtractionBlockKind, ExtractionReview, ExtractionSource, ExtractionValue,
    ExtractionValueStatus,
};
use crate::local_ai_types::{AiInputKind, AiInputRef};
use crate::pdf_types::PdfSourceIdentity;
use fs_service::SourceStamp;

fn source(pages: u32) -> ExtractionSource {
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
        page_count: pages,
        sensitive: false,
    }
}

fn value(text: &str) -> ExtractionValue {
    ExtractionValue {
        id: Uuid::new_v4(),
        original: text.to_string(),
        value: text.to_string(),
        confidence: 0.95,
        status: ExtractionValueStatus::Certain,
        anchors: Vec::new(),
        correction_revision: 0,
    }
}

fn paragraph(id: Uuid, order: u32, text: &str) -> ExtractionBlock {
    ExtractionBlock {
        id,
        kind: ExtractionBlockKind::Paragraph,
        order,
        heading_level: None,
        text: Some(value(text)),
        list_items: Vec::new(),
        table_id: None,
    }
}

fn review(blocks: Vec<ExtractionBlock>) -> ExtractionReview {
    ExtractionReview {
        id: Uuid::new_v4(),
        revision: 3,
        content_id: Uuid::new_v4(),
        sources: vec![source(1)],
        blocks,
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
fn extraction_pages_200_limit() {
    assert_eq!(
        plan_sections(&[source(201)]).err().as_deref(),
        Some("ai_extract.too_large")
    );
    let sections = plan_sections(&[source(200)]).unwrap();
    assert_eq!(sections.len(), 20);
    assert_eq!(sections[0].count(), MAX_SECTION_PAGES);
    assert_eq!(sections[19].first, 191);
    assert_eq!(sections[19].last, 200);
    assert_eq!(plan_sections(&[]).err().as_deref(), Some("ai_extract.too_large"));
}

#[test]
fn extraction_failed_sources_retained() {
    let counts = retain_outcomes(&[
        PageOutcome::Done { pages: 3 },
        PageOutcome::Failed {
            pages: 2,
            code: "ai_extract.failed".to_string(),
        },
    ]);
    assert_eq!(counts.done_sources, 1);
    assert_eq!(counts.failed_sources, 1);
    assert_eq!(counts.pages, 5);
    assert_eq!(counts.warnings, vec!["ai_extract.failed".to_string()]);
}

#[test]
fn extraction_model_payload_limit() {
    assert!(validate_model_payload(&vec![0u8; 262_144]).is_ok());
    assert_eq!(
        validate_model_payload(&vec![0u8; 262_145]).err().as_deref(),
        Some("ai_extract.too_large")
    );
}

#[test]
fn extraction_pager_is_bounded_and_ordered() {
    let ids: Vec<Uuid> = (0..30).map(|_| Uuid::new_v4()).collect();
    let blocks: Vec<ExtractionBlock> = ids
        .iter()
        .enumerate()
        .map(|(index, id)| paragraph(*id, index as u32, &"word ".repeat(120)))
        .collect();
    let mut pager = ReviewPager::new(review(blocks)).unwrap();
    let mut seen = Vec::new();
    let mut pages = 0;
    loop {
        let (page, cursor) = pager.next_page(4096).unwrap();
        pages += 1;
        assert!(pages <= 40);
        if let Some(cursor) = cursor {
            assert_eq!(page.next_cursor, Some(cursor));
        }
        seen.extend(page.blocks.iter().map(|block| block.id));
        if cursor.is_none() {
            break;
        }
    }
    assert!(pages > 1);
    assert_eq!(seen, ids);
}
