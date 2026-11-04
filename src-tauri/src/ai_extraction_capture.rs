//! Immutable extraction capture (Step 17d T5, decision D7).
//!
//! The corrected review becomes one bounded, inert JSON snapshot with the
//! schema-1 envelope and the `application/vnd.adperastra.extraction+json`
//! MIME. It contains no capability, token, password, native path or executable
//! formula. Sensitive sources never write source labels; ordinary sources
//! include them only with the explicit checkbox.
#![allow(dead_code)]


use serde_json::{json, Value};

use crate::ai_extraction_requests::ExtractionPublish;
use crate::ai_extraction_types::{
    ExtractionReview, EXTRACTION_SNAPSHOT_MIME, EXTRACTION_SNAPSHOT_SCHEMA, MAX_REVIEW_BYTES,
};
use crate::ai_extraction_validation::{validate_publish, validate_review};

/// Hard cap of one captured model (D1).
pub const MAX_SNAPSHOT_BYTES: usize = 16 * 1024 * 1024;
/// Forbidden keys anywhere in the snapshot envelope.
const FORBIDDEN_KEYS: &[&str] = &["path", "token", "password", "capability", "formula", "script"];

/// Build the exact bytes the helper receives. No destination is touched.
pub fn build_capture(
    review: &ExtractionReview,
    publish: &ExtractionPublish,
    source_labels: &[String],
) -> Result<Vec<u8>, String> {
    validate_review(review)?;
    validate_publish(publish)?;
    if publish.expected_revision != review.revision {
        return Err("ai_extract.changed".to_string());
    }
    if publish.expected_content_id != review.content_id {
        return Err("ai_extract.changed".to_string());
    }
    if review.sensitive && publish.include_source_labels {
        // A sensitive source has only logical labels; refuse rather than
        // write anything that could resemble a disk path.
        return Err("ai_extract.unsupported".to_string());
    }
    let labels: Vec<String> = if publish.include_source_labels {
        source_labels
            .iter()
            .take(100)
            .map(|label| label.chars().take(255).collect::<String>())
            .collect()
    } else {
        Vec::new()
    };
    if labels.iter().any(|label| label.is_empty()) {
        return Err("ai_extract.invalid".to_string());
    }
    let mut review_value =
        serde_json::to_value(review).map_err(|_| "ai_extract.invalid".to_string())?;
    sanitize_sources(&mut review_value, publish.include_source_labels && !review.sensitive, &labels);
    let value = json!({
        "schema": EXTRACTION_SNAPSHOT_SCHEMA,
        "mime": EXTRACTION_SNAPSHOT_MIME,
        "review": review_value,
        "publish": {
            "format": publish.format,
            "table_id": publish.table_id,
            "include_source_labels": publish.include_source_labels,
            "name": publish.name,
        },
        "source_labels": labels,
    });
    let bytes = serde_json::to_vec(&value).map_err(|_| "ai_extract.invalid".to_string())?;
    if bytes.len() > MAX_SNAPSHOT_BYTES || bytes.len() > MAX_REVIEW_BYTES + 64 * 1024 {
        return Err("ai_extract.too_large".to_string());
    }
    // Defence in depth: the envelope never carries these keys.
    scan_keys(&value)?;
    Ok(bytes)
}

/// Remove every disk-path-bearing field from the captured source list. The
/// ordered labels are the only source text and only when the checkbox is on.
fn sanitize_sources(review: &mut Value, include_labels: bool, labels: &[String]) {
    let Some(sources) = review.get_mut("sources").and_then(Value::as_array_mut) else {
        return;
    };
    for (index, source) in sources.iter_mut().enumerate() {
        if let Some(object) = source.as_object_mut() {
            object.insert(
                "display_name".to_string(),
                Value::String(if include_labels {
                    labels
                        .get(index)
                        .cloned()
                        .unwrap_or_default()
                } else {
                    String::new()
                }),
            );
            if let Some(stamp) = object
                .get_mut("identity")
                .and_then(Value::as_object_mut)
                .and_then(|identity| identity.get_mut("stamp"))
                .and_then(Value::as_object_mut)
            {
                stamp.insert("path_key".to_string(), Value::String(String::new()));
            }
        }
    }
}

fn scan_keys(value: &Value) -> Result<(), String> {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                if FORBIDDEN_KEYS.contains(&key.as_str()) {
                    return Err("ai_extract.unsupported".to_string());
                }
                scan_keys(child)?;
            }
        }
        Value::Array(items) => {
            for item in items {
                scan_keys(item)?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// Parse and check a capture before it reaches the encoder.
pub fn validate_capture_bytes(bytes: &[u8]) -> Result<Value, String> {
    if bytes.len() > MAX_SNAPSHOT_BYTES {
        return Err("ai_extract.too_large".to_string());
    }
    let value: Value =
        serde_json::from_slice(bytes).map_err(|_| "ai_extract.invalid".to_string())?;
    if value.get("schema").and_then(Value::as_u64) != Some(EXTRACTION_SNAPSHOT_SCHEMA as u64) {
        return Err("ai_extract.invalid".to_string());
    }
    if value.get("mime").and_then(Value::as_str) != Some(EXTRACTION_SNAPSHOT_MIME) {
        return Err("ai_extract.invalid".to_string());
    }
    scan_keys(&value)?;
    Ok(value)
}

#[cfg(test)]
#[path = "ai_extraction_capture_tests.rs"]
mod tests;
