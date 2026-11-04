//! Native correction-history oracles for Step 17d T4.

use uuid::Uuid;

use super::{apply_corrections, MAX_TABLE_COLUMNS};
use crate::ai_extraction_requests::ExtractionCorrection;
use crate::ai_extraction_types::{
    ExtractionColumn, ExtractionColumnType, ExtractionReview, ExtractionSource, ExtractionTable,
    ExtractionValue, ExtractionValueStatus,
};
use crate::local_ai_types::{AiInputKind, AiInputRef};
use crate::pdf_types::PdfSourceIdentity;
use fs_service::SourceStamp;

const SOURCE_ID: Uuid = Uuid::from_u128(0x9999_9999_9999_4999_8999_9999_9999_9999);

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

fn cell(id: &str, text: &str) -> ExtractionValue {
    let mut value = value(text);
    value.id = Uuid::parse_str(id).unwrap();
    value
}

fn table() -> ExtractionTable {
    ExtractionTable {
        id: Uuid::from_u128(0x7777_7777_7777_4777_8777_7777_7777_7777),
        source_ids: vec![SOURCE_ID],
        columns: vec![
            ExtractionColumn {
                id: Uuid::from_u128(0xaaaa_1111_1111_4111_8111_1111_1111_1111),
                name: cell("aaaa2222-2222-4222-8222-222222222222", "A,B"),
                column_type: ExtractionColumnType::Text,
            },
            ExtractionColumn {
                id: Uuid::from_u128(0xbbbb_1111_1111_4111_8111_1111_1111_1111),
                name: cell("bbbb2222-2222-4222-8222-222222222222", "Total"),
                column_type: ExtractionColumnType::Text,
            },
        ],
        rows: vec![crate::ai_extraction_types::ExtractionRow {
            id: Uuid::from_u128(0xcccc_1111_1111_4111_8111_1111_1111_1111),
            cells: vec![
                cell("cccc2222-2222-4222-8222-222222222222", "A,B"),
                cell("cccc3333-3333-4333-8333-333333333333", "R"),
            ],
        }],
        header: true,
    }
}

fn review() -> ExtractionReview {
    let line_items = table();
    let source = ExtractionSource {
        id: SOURCE_ID,
        input: AiInputRef {
            kind: AiInputKind::Document,
            id: Uuid::new_v4(),
            expected_revision: 1,
        },
        identity: PdfSourceIdentity::Disk {
            stamp: SourceStamp {
                path_key: "c:\\scans\\receipt.pdf".to_string(),
                volume_id: "1a2b3c4d".to_string(),
                file_id: "0011223344556677".to_string(),
                modified_ticks: "100".to_string(),
                size_bytes: 2048,
            },
        },
        display_name: "receipt.pdf".to_string(),
        page_count: 1,
        sensitive: false,
    };
    ExtractionReview {
        id: Uuid::new_v4(),
        revision: 3,
        content_id: Uuid::new_v4(),
        sources: vec![source],
        blocks: Vec::new(),
        tables: Vec::new(),
        receipts: vec![crate::ai_extraction_types::ReceiptRecord {
            id: Uuid::new_v4(),
            source_id: SOURCE_ID,
            vendor: value("Acme"),
            tax_id: value("000123"),
            date: value("2026-11-03"),
            currency: value("PEN"),
            subtotal: value("100.00"),
            tax: value("18.00"),
            total: value("118.00"),
            line_items,
            date_iso: Some("2026-11-03".to_string()),
            currency_code: Some("PEN".to_string()),
            subtotal_minor: Some(10_000),
            tax_minor: Some(1_800),
            total_minor: Some(11_800),
            arithmetic_ok: Some(true),
        }],
        complete: true,
        warnings: Vec::new(),
        next_cursor: None,
        expires_unix: 2_000_000_000,
        sensitive: false,
    }
}

fn table_id() -> Uuid {
    Uuid::from_u128(0x7777_7777_7777_4777_8777_7777_7777_7777)
}

#[test]
fn review_correct_one_cell() {
    let review = review();
    let row_id = Uuid::from_u128(0xcccc_1111_1111_4111_8111_1111_1111_1111);
    let column_id = Uuid::from_u128(0xbbbb_1111_1111_4111_8111_1111_1111_1111);
    let next = apply_corrections(
        &review,
        3,
        &[ExtractionCorrection::TableCell {
            table_id: table_id(),
            row_id,
            column_id,
            expected: "R".to_string(),
            value: "R+1".to_string(),
        }],
    )
    .unwrap();
    assert_eq!(next.revision, 4);
    assert_ne!(next.content_id, review.content_id);
    let changed = &next.receipts[0].line_items.rows[0].cells[1];
    assert_eq!(changed.value, "R+1");
    assert_eq!(changed.status, ExtractionValueStatus::Corrected);
    assert_eq!(changed.correction_revision, 4);
    assert_eq!(next.receipts[0].line_items.rows[0].cells[0].value, "A,B");
    // The passed review is unchanged.
    assert_eq!(review.receipts[0].line_items.rows[0].cells[1].value, "R");
}

#[test]
fn review_stale_correction() {
    let review = review();
    let corrected = apply_corrections(
        &review,
        3,
        &[ExtractionCorrection::Field {
            id: review.receipts[0].vendor.id,
            expected: "Acme".to_string(),
            value: "Acme S.A.".to_string(),
        }],
    )
    .unwrap();
    assert_eq!(
        apply_corrections(
            &corrected,
            3,
            &[ExtractionCorrection::Field {
                id: review.receipts[0].vendor.id,
                expected: "Acme S.A.".to_string(),
                value: "Other".to_string(),
            }],
        )
        .err()
        .as_deref(),
        Some("ai_extract.changed")
    );
    // A field whose text no longer matches also fails without a revision bump.
    assert_eq!(
        apply_corrections(
            &review,
            3,
            &[ExtractionCorrection::Field {
                id: review.receipts[0].vendor.id,
                expected: "Stale".to_string(),
                value: "Other".to_string(),
            }],
        )
        .err()
        .as_deref(),
        Some("ai_extract.changed")
    );
}

#[test]
fn review_split_column() {
    let review = review();
    let column_id = Uuid::from_u128(0xaaaa_1111_1111_4111_8111_1111_1111_1111);
    let next = apply_corrections(
        &review,
        3,
        &[ExtractionCorrection::SplitColumn {
            table_id: table_id(),
            column_id,
            separator: ",".to_string(),
        }],
    )
    .unwrap();
    let table = &next.receipts[0].line_items;
    let names: Vec<&str> = table.columns.iter().map(|column| column.name.value.as_str()).collect();
    assert_eq!(names, vec!["A", "B", "Total"]);
    assert!(table.columns.len() <= MAX_TABLE_COLUMNS);
    assert!(table.rows.iter().all(|row| row.cells.len() == table.columns.len()));
    let texts: Vec<&str> = table.rows[0].cells.iter().map(|cell| cell.value.as_str()).collect();
    assert_eq!(texts, vec!["A", "B", "R"]);
}
