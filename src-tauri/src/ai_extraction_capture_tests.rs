//! Native capture tests for Step 17d T5 (decision D7).

use serde_json::Value;
use uuid::Uuid;

use super::{build_capture, validate_capture_bytes};
use crate::ai_extraction_requests::ExtractionPublish;
use crate::ai_extraction_types::{
    ExtractionOutputFormat, ExtractionReview, ExtractionSource, EXTRACTION_SNAPSHOT_MIME,
};
use crate::local_ai_types::{AiInputKind, AiInputRef};
use crate::pdf_types::PdfSourceIdentity;
use fs_service::SourceStamp;

fn source(sensitive: bool) -> ExtractionSource {
    ExtractionSource {
        id: Uuid::new_v4(),
        input: AiInputRef {
            kind: AiInputKind::Document,
            id: Uuid::new_v4(),
            expected_revision: 1,
        },
        identity: PdfSourceIdentity::Disk {
            stamp: SourceStamp {
                path_key: "c:\\secret\\letter.pdf".to_string(),
                volume_id: "1a2b3c4d".to_string(),
                file_id: "0011223344556677".to_string(),
                modified_ticks: "100".to_string(),
                size_bytes: 2048,
            },
        },
        display_name: "C:\\secret\\letter.pdf".to_string(),
        page_count: 1,
        sensitive,
    }
}

fn review(sensitive: bool) -> ExtractionReview {
    ExtractionReview {
        id: Uuid::new_v4(),
        revision: 3,
        content_id: Uuid::new_v4(),
        sources: vec![source(sensitive)],
        blocks: Vec::new(),
        tables: Vec::new(),
        receipts: Vec::new(),
        complete: true,
        warnings: Vec::new(),
        next_cursor: None,
        expires_unix: 2_000_000_000,
        sensitive,
    }
}

fn publish(review: &ExtractionReview, include_labels: bool) -> ExtractionPublish {
    ExtractionPublish {
        review_id: review.id,
        expected_revision: review.revision,
        expected_content_id: review.content_id,
        format: ExtractionOutputFormat::Docx,
        table_id: None,
        dest_dir: "C:\\Out".to_string(),
        name: "letter".to_string(),
        accepted_warning_codes: vec!["layout_loss".to_string()],
        include_source_labels: include_labels,
    }
}

fn assert_no_forbidden_keys(value: &Value) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                assert!(
                    !["token", "password", "capability", "formula", "script"].contains(&key.as_str()),
                    "forbidden key {key}"
                );
                assert_no_forbidden_keys(child);
            }
        }
        Value::Array(items) => {
            for item in items {
                assert_no_forbidden_keys(item);
            }
        }
        _ => {}
    }
}

#[test]
fn capture_is_inert_and_pathless_with_labels() {
    let review = review(false);
    let bytes = build_capture(&review, &publish(&review, true), &["letter.pdf".to_string()]).unwrap();
    let value = validate_capture_bytes(&bytes).unwrap();
    assert_eq!(value["schema"], 1);
    assert_eq!(value["mime"], EXTRACTION_SNAPSHOT_MIME);
    assert_eq!(value["review"]["sources"][0]["display_name"], "letter.pdf");
    assert_eq!(value["review"]["sources"][0]["identity"]["stamp"]["path_key"], "");
    assert_eq!(value["source_labels"][0], "letter.pdf");
    assert!(!String::from_utf8_lossy(&bytes).contains("secret"));
    assert_no_forbidden_keys(&value);
}

#[test]
fn capture_sensitive_never_writes_labels_or_names() {
    let review = review(true);
    assert_eq!(
        build_capture(&review, &publish(&review, true), &["label".to_string()])
            .err()
            .as_deref(),
        Some("ai_extract.unsupported")
    );
    let bytes = build_capture(&review, &publish(&review, false), &[]).unwrap();
    let value = validate_capture_bytes(&bytes).unwrap();
    assert_eq!(value["review"]["sources"][0]["display_name"], "");
    assert_eq!(value["source_labels"].as_array().unwrap().len(), 0);
    assert!(!String::from_utf8_lossy(&bytes).contains("secret"));
}

#[test]
fn capture_revision_and_content_are_bound() {
    let review = review(false);
    let mut stale = publish(&review, false);
    stale.expected_revision = 2;
    assert_eq!(
        build_capture(&review, &stale, &[]).err().as_deref(),
        Some("ai_extract.changed")
    );
    let mut wrong_content = publish(&review, false);
    wrong_content.expected_content_id = Uuid::new_v4();
    assert_eq!(
        build_capture(&review, &wrong_content, &[]).err().as_deref(),
        Some("ai_extract.changed")
    );
}

#[test]
fn capture_upload_is_validated() {
    assert_eq!(
        validate_capture_bytes(b"not json").err().as_deref(),
        Some("ai_extract.invalid")
    );
    let review = review(false);
    let bytes = build_capture(&review, &publish(&review, false), &[]).unwrap();
    assert!(validate_capture_bytes(&bytes).is_ok());
}
