//! Bounds that every caller applies before queueing work (D6-D8).
//!
//! All failures are stable `ai.*` codes; the UI translates them.

pub use crate::output_validation::{
    retry_after_gpu_start_failure, validate_citation, validate_embeddings, validate_result_shape,
    validate_text_page, DeviceRetry,
};

use std::collections::BTreeSet;

use serde_json::Value;

use crate::schema;
use crate::types::*;

const BAD_REQUEST: &str = "ai.bad_request";

/// 1..=64 ASCII letters, digits, `-` or `_`.
pub fn valid_request_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_REQUEST_ID
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub fn ascii_bounded(value: &str, max: usize) -> bool {
    !value.is_empty() && value.len() <= max && value.is_ascii()
}

pub fn scalar_count(value: &str) -> usize {
    value.chars().count()
}

/// Bounds shared by every task, before any pack or device is touched.
pub fn validate_request_shape(request: &AiTaskRequest) -> Result<(), String> {
    if !valid_request_id(&request.request_id) {
        return Err(BAD_REQUEST.into());
    }
    if request.options.kind() != request.task {
        return Err(BAD_REQUEST.into());
    }
    if request.inputs.len() > MAX_INPUTS {
        return Err(BAD_REQUEST.into());
    }
    for input in &request.inputs {
        if input.expected_revision < 1 {
            return Err(BAD_REQUEST.into());
        }
    }
    let inputs = request.inputs.len();
    match request.task {
        AiTaskKind::Upscale
        | AiTaskKind::EmbedImage
        | AiTaskKind::Inpaint
        | AiTaskKind::Transcribe
        | AiTaskKind::ForegroundMask => {
            if inputs != 1 {
                return Err(BAD_REQUEST.into());
            }
        }
        AiTaskKind::VisionAnswer => {
            if inputs > 16 {
                return Err(BAD_REQUEST.into());
            }
        }
        AiTaskKind::StructuredText | AiTaskKind::EmbedText => {}
    }
    match request.task {
        AiTaskKind::StructuredText | AiTaskKind::VisionAnswer => {
            let prompt = request.prompt.as_ref().ok_or(BAD_REQUEST)?;
            validate_prompt(prompt)?;
        }
        _ => {
            if request.prompt.is_some() {
                return Err(BAD_REQUEST.into());
            }
        }
    }
    validate_options(&request.options)
}

pub fn validate_prompt(prompt: &AiPromptRequest) -> Result<(), String> {
    if !ascii_bounded(&prompt.template_id, MAX_TEMPLATE_ID)
        || prompt.template_revision == 0
        || !ascii_bounded(&prompt.output_schema_id, MAX_SCHEMA_ID)
    {
        return Err(BAD_REQUEST.into());
    }
    if !schema::is_known_schema(&prompt.output_schema_id) {
        return Err("ai.schema_invalid".into());
    }
    if prompt.arguments.len() > MAX_PROMPT_ARGUMENTS {
        return Err(BAD_REQUEST.into());
    }
    let mut names = BTreeSet::new();
    for argument in &prompt.arguments {
        if !ascii_bounded(&argument.name, MAX_ARGUMENT_NAME)
            || scalar_count(&argument.value) > MAX_PROMPT_VALUE_SCALARS
        {
            return Err(BAD_REQUEST.into());
        }
        if !names.insert(argument.name.as_str()) {
            return Err(BAD_REQUEST.into());
        }
    }
    Ok(())
}

pub fn validate_options(options: &AiTaskOptions) -> Result<(), String> {
    match options {
        AiTaskOptions::StructuredText {
            max_output_tokens,
            temperature,
            ..
        }
        | AiTaskOptions::VisionAnswer {
            max_output_tokens,
            temperature,
            ..
        } => {
            if !(1..=MAX_OUTPUT_TOKENS).contains(max_output_tokens)
                || !temperature.is_finite()
                || !(0.0..=1.0).contains(temperature)
            {
                return Err(BAD_REQUEST.into());
            }
        }
        AiTaskOptions::EmbedText {
            truncate_tokens, ..
        } => {
            if *truncate_tokens != 512 {
                return Err(BAD_REQUEST.into());
            }
        }
        AiTaskOptions::EmbedImage { .. } => {}
        AiTaskOptions::Transcribe {
            start_us, end_us, ..
        } => {
            if end_us.is_some_and(|end| end <= *start_us) {
                return Err(BAD_REQUEST.into());
            }
        }
        AiTaskOptions::Upscale { preview_region, .. } => {
            if let Some(region) = preview_region {
                validate_rect_shape(region)?;
                // D9: a preview crop is at most 256x256 for both scales.
                if region.width > 256 || region.height > 256 {
                    return Err(BAD_REQUEST.into());
                }
            }
        }
        AiTaskOptions::ForegroundMask { threshold, .. } => {
            if !threshold.is_finite() || !(0.0..=1.0).contains(threshold) {
                return Err(BAD_REQUEST.into());
            }
        }
        AiTaskOptions::Inpaint {
            mask_artifact_id, ..
        } => {
            if mask_artifact_id.is_nil() {
                return Err(BAD_REQUEST.into());
            }
        }
    }
    Ok(())
}

pub fn validate_rect_shape(rect: &ImageRect) -> Result<(), String> {
    if rect.width == 0 || rect.height == 0 {
        return Err(BAD_REQUEST.into());
    }
    let right = u64::from(rect.x) + u64::from(rect.width);
    let bottom = u64::from(rect.y) + u64::from(rect.height);
    if right > u64::from(u32::MAX) || bottom > u64::from(u32::MAX) {
        return Err(BAD_REQUEST.into());
    }
    Ok(())
}

/// A crop must lie inside the oriented source.
pub fn validate_rect_inside(rect: &ImageRect, width: u32, height: u32) -> Result<(), String> {
    validate_rect_shape(rect)?;
    let right = u64::from(rect.x) + u64::from(rect.width);
    let bottom = u64::from(rect.y) + u64::from(rect.height);
    if rect.x >= width || rect.y >= height || right > u64::from(width) || bottom > u64::from(height)
    {
        return Err(BAD_REQUEST.into());
    }
    Ok(())
}

/// Reject unknown option fields before serde can silently ignore them.
pub fn validate_options_keys(value: &Value, task: AiTaskKind) -> Result<(), String> {
    let object = value.as_object().ok_or(BAD_REQUEST)?;
    let mut allowed: BTreeSet<&str> = BTreeSet::new();
    allowed.insert("kind");
    match task {
        AiTaskKind::StructuredText | AiTaskKind::VisionAnswer => {
            allowed.extend(["max_output_tokens", "temperature", "seed"]);
        }
        AiTaskKind::EmbedText => {
            allowed.extend(["mode", "model", "truncate_tokens"]);
        }
        AiTaskKind::EmbedImage => {
            allowed.extend(["model"]);
        }
        AiTaskKind::Transcribe => {
            allowed.extend(["language", "translate_to_english", "start_us", "end_us"]);
        }
        AiTaskKind::Upscale => {
            allowed.extend(["scale", "model", "preview_region", "device"]);
        }
        AiTaskKind::ForegroundMask => {
            allowed.extend(["model", "threshold"]);
        }
        AiTaskKind::Inpaint => {
            allowed.extend(["model", "mask_artifact_id"]);
        }
    }
    if object.keys().any(|key| !allowed.contains(key.as_str())) {
        return Err(BAD_REQUEST.into());
    }
    let tag = object
        .get("kind")
        .and_then(Value::as_str)
        .ok_or(BAD_REQUEST)?;
    if tag != task.as_str() {
        return Err(BAD_REQUEST.into());
    }
    Ok(())
}
