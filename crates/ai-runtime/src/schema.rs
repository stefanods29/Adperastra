//! The closed output-schema allowlist (D2, T2).
//!
//! A schema id is only usable when the app registered it. Registering a
//! future id here grants no capability: each task still needs its verified
//! pack, model and independently registered capability.

use serde_json::Value;

use crate::types::MAX_STRUCTURED_OUTPUT_BYTES;

/// App-registered schema ids. Future steps add ids; the model never chooses.
pub const KNOWN_SCHEMAS: &[&str] = &[
    "assistant.actions.v1",
    "assistant.answer.v1",
    "assistant.rename.v1",
    "assistant.search_filter.v1",
    "extract.document.v1",
    "extract.table.v1",
    "sheet.formula.v1",
    "deck.outline.v1",
    "inline.completion.v1",
];

pub fn is_known_schema(schema_id: &str) -> bool {
    KNOWN_SCHEMAS.contains(&schema_id)
}

/// `canonical_json` is the exact compact form produced by the native side:
/// no insignificant whitespace and object keys in sorted order.
pub fn validate_canonical(schema_id: &str, canonical_json: &str) -> Result<(), String> {
    if !is_known_schema(schema_id) {
        return Err("ai.schema_invalid".into());
    }
    if canonical_json.len() > MAX_STRUCTURED_OUTPUT_BYTES {
        return Err("ai.schema_invalid".into());
    }
    let value: Value = serde_json::from_str(canonical_json).map_err(|_| "ai.schema_invalid")?;
    if !value.is_object() {
        return Err("ai.schema_invalid".into());
    }
    let reserialized = serde_json::to_string(&value).map_err(|_| "ai.schema_invalid")?;
    if reserialized != canonical_json {
        return Err("ai.schema_invalid".into());
    }
    Ok(())
}

/// Register a schema at runtime (native/static callers only in later steps).
/// Duplicate ids are idempotent; malformed ids are refused.
pub fn validate_schema_id(schema_id: &str) -> Result<(), String> {
    if schema_id.is_empty()
        || schema_id.len() > crate::types::MAX_SCHEMA_ID
        || !schema_id.is_ascii()
    {
        return Err("ai.bad_request".into());
    }
    Ok(())
}
