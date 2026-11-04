//! Validation for extraction DTOs (Step 17d T1, decisions D1/D4).
//!
//! Kept apart from the DTO module so each file stays under the 400-line
//! project limit. The TypeScript mirror is `src/services/aiExtractionValidation.ts`.
#![allow(dead_code)]


use std::collections::HashSet;

use crate::ai_extraction_requests::{ExtractionPublish, ExtractionRequest};
use crate::ai_extraction_types::{
    ExtractionReview, ExtractionValueStatus, MAX_ANCHOR_WORDS, MAX_EXTRACTION_INPUTS,
    MAX_EXTRACTION_SCALARS, MAX_REVIEW_BYTES, MAX_TABLE_CELLS, OCR_UNKNOWN_CERTAINTY,
    UNCERTAIN_BELOW,
};

fn valid_language(tag: &str) -> bool {
    !tag.is_empty()
        && tag.len() <= 64
        && tag.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        && !tag.starts_with('-')
        && !tag.ends_with('-')
}

/// 1 to 100 inputs, 200 pages at most and a known language (D1).
pub fn validate_request(request: &ExtractionRequest) -> Result<(), String> {
    if request.inputs.is_empty() || request.inputs.len() > MAX_EXTRACTION_INPUTS {
        return Err("ai_extract.invalid".to_string());
    }
    if request
        .inputs
        .iter()
        .any(|input| input.id.is_nil() || input.expected_revision < 1)
    {
        return Err("ai_extract.invalid".to_string());
    }
    if request.ocr_language != "auto" && !valid_language(&request.ocr_language) {
        return Err("ai_extract.invalid".to_string());
    }
    if request.request_revision < 1 {
        return Err("ai_extract.invalid".to_string());
    }
    Ok(())
}

/// A publish never carries an overwrite flag or an unknown warning code.
pub fn validate_publish(publish: &ExtractionPublish) -> Result<(), String> {
    if publish.review_id.is_nil()
        || publish.expected_content_id.is_nil()
        || publish.expected_revision < 1
    {
        return Err("ai_extract.invalid".to_string());
    }
    let name = publish.name.as_str();
    let bad_char = name
        .chars()
        .any(|c| matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'));
    if name.is_empty()
        || name.chars().count() > 180
        || name == "."
        || name == ".."
        || bad_char
        || name.ends_with('.')
        || name.ends_with(' ')
    {
        return Err("ai_extract.invalid".to_string());
    }
    if publish.dest_dir.is_empty() || publish.dest_dir.encode_utf16().count() > 32_768 {
        return Err("ai_extract.invalid".to_string());
    }
    if publish.accepted_warning_codes.len() > 64 {
        return Err("ai_extract.invalid".to_string());
    }
    Ok(())
}

/// Heuristic certainty (D4). The model's own confidence is never an input.
pub fn confidence(ocr_certainty: Option<f64>, layout_alignment: f64, parser_agreement: f64) -> f64 {
    let ocr = match ocr_certainty {
        Some(value) if value.is_finite() => value.clamp(0.0, 1.0),
        _ => OCR_UNKNOWN_CERTAINTY,
    };
    let layout = if layout_alignment.is_finite() {
        layout_alignment.clamp(0.0, 1.0)
    } else {
        0.0
    };
    let parser = if parser_agreement.is_finite() {
        parser_agreement.clamp(0.0, 1.0)
    } else {
        0.0
    };
    ocr.min(layout).min(parser)
}

pub fn status_for(confidence: f64) -> ExtractionValueStatus {
    if confidence < UNCERTAIN_BELOW {
        ExtractionValueStatus::Uncertain
    } else {
        ExtractionValueStatus::Certain
    }
}

/// Every cited word ID must exist in the page's OCR result (T3).
pub fn validate_anchor_words(word_ids: &[u32], known: &HashSet<u32>) -> Result<(), String> {
    if word_ids.is_empty() || word_ids.len() > MAX_ANCHOR_WORDS {
        return Err("ai_extract.invalid".to_string());
    }
    if word_ids.iter().any(|id| !known.contains(id)) {
        return Err("ai_extract.invalid".to_string());
    }
    Ok(())
}

/// Serialized size, 16 MiB cap, cells and scalars (D1).
pub fn validate_review(review: &ExtractionReview) -> Result<(), String> {
    if !review.is_valid() {
        return Err("ai_extract.invalid".to_string());
    }
    if review.total_cells() > MAX_TABLE_CELLS {
        return Err("ai_extract.too_large".to_string());
    }
    let bytes = serde_json::to_vec(review).map_err(|_| "ai_extract.invalid".to_string())?;
    if bytes.len() > MAX_REVIEW_BYTES {
        return Err("ai_extract.too_large".to_string());
    }
    let scalars: usize = bytes
        .iter()
        .filter(|byte| **byte & 0b1100_0000 != 0b1000_0000)
        .count();
    if scalars > MAX_EXTRACTION_SCALARS {
        return Err("ai_extract.too_large".to_string());
    }
    Ok(())
}

#[cfg(test)]
#[path = "ai_extraction_types_tests.rs"]
mod tests;
