//! Native contract tests for Step 17d T1 (`ai-extraction-1`).

use std::collections::HashSet;

use serde_json::json;
use uuid::Uuid;

use crate::ai_extraction_requests::{ExtractionPublish, ExtractionRequest};
use crate::ai_extraction_types::{
    ExtractionKind, ExtractionLocale, ExtractionOutputFormat, ExtractionValueStatus,
    OCR_UNKNOWN_CERTAINTY,
};
use crate::ai_extraction_validation::{
    confidence, status_for, validate_anchor_words, validate_publish, validate_request,
};
use crate::local_ai_types::{AiInputKind, AiInputRef};
use crate::pdf_types::PdfSourceIdentity;

fn input() -> AiInputRef {
    AiInputRef {
        kind: AiInputKind::Document,
        id: Uuid::new_v4(),
        expected_revision: 1,
    }
}

fn request(inputs: Vec<AiInputRef>) -> ExtractionRequest {
    ExtractionRequest {
        inputs,
        kind: ExtractionKind::Document,
        locale: ExtractionLocale::En,
        ocr_language: "auto".to_string(),
        request_revision: 1,
    }
}

#[test]
fn extraction_confidence_ignores_model_claim_and_unknown_ocr() {
    // There is deliberately no model-confidence argument: the only way to
    // reach a value is OCR, layout and parser agreement.
    let value = confidence(None, 1.0, 1.0);
    assert_eq!(value, OCR_UNKNOWN_CERTAINTY);
    assert_eq!(status_for(value), ExtractionValueStatus::Uncertain);
    assert_eq!(status_for(0.85), ExtractionValueStatus::Certain);
    assert_eq!(status_for(0.8499), ExtractionValueStatus::Uncertain);
    assert_eq!(confidence(Some(0.9), 0.8, 1.0), 0.8);
}

#[test]
fn extraction_unknown_fields_refused() {
    let raw = json!({
        "inputs": [{
            "kind": "document",
            "id": Uuid::new_v4(),
            "expected_revision": 1
        }],
        "kind": "document",
        "locale": "en",
        "ocr_language": "auto",
        "request_revision": 1,
        "script": "alert(1)"
    });
    assert!(serde_json::from_value::<ExtractionRequest>(raw).is_err());
}

#[test]
fn extraction_snapshot_identity_has_no_stamp() {
    let identity = PdfSourceIdentity::Snapshot {
        document_id: "doc".to_string(),
        revision: 3,
        content_id: Uuid::new_v4(),
        sensitive: false,
    };
    let value = serde_json::to_value(&identity).unwrap();
    assert_eq!(value["kind"], "snapshot");
    assert!(value.get("stamp").is_none());
    assert!(value.get("content_id").is_some());
}

#[test]
fn extraction_anchor_refuses_invented_word() {
    let known: HashSet<u32> = [1, 2, 3].into_iter().collect();
    assert!(validate_anchor_words(&[1, 3], &known).is_ok());
    assert_eq!(
        validate_anchor_words(&[1, 99], &known).err().as_deref(),
        Some("ai_extract.invalid")
    );
    assert!(validate_anchor_words(&[], &known).is_err());
}

#[test]
fn extraction_request_limits() {
    assert!(validate_request(&request(vec![input()])).is_ok());
    let too_many: Vec<AiInputRef> = (0..101).map(|_| input()).collect();
    assert_eq!(
        validate_request(&request(too_many)).err().as_deref(),
        Some("ai_extract.invalid")
    );
    let mut bad_language = request(vec![input()]);
    bad_language.ocr_language = "es ES".to_string();
    assert!(validate_request(&bad_language).is_err());
}

#[test]
fn extraction_publish_refuses_names_and_unknown_warning_budget() {
    let valid = ExtractionPublish {
        review_id: Uuid::new_v4(),
        expected_revision: 1,
        expected_content_id: Uuid::new_v4(),
        format: ExtractionOutputFormat::Docx,
        table_id: None,
        dest_dir: "C:\\Out".to_string(),
        name: "Letter".to_string(),
        accepted_warning_codes: vec!["layout_loss".to_string()],
        include_source_labels: true,
    };
    assert!(validate_publish(&valid).is_ok());
    let mut script_name = valid.clone();
    script_name.name = "letter.docx:stream".to_string();
    assert!(validate_publish(&script_name).is_err());
    let mut too_many = valid.clone();
    too_many.accepted_warning_codes = (0..65).map(|_| "layout_loss".to_string()).collect();
    assert!(validate_publish(&too_many).is_err());
}
