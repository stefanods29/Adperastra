//! Native adapter for converter id `image/ai-upscale` (T6, U6).
//!
//! 08a keeps request validation, naming, loss acknowledgment, report and
//! publication. This adapter only maps the approved conversion options to one
//! typed AI task and validates the result before 08a publishes a new PNG.
//! The original is never replaced: `keep_original` must stay true.
#![allow(dead_code)]


use ai_runtime::types::*;
use convert::MetadataCategory;
use uuid::Uuid;

/// Additive `ConvertOptions` variant owned with the 08a convert types.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AiUpscaleConversionOptions {
    pub scale: UpscaleScale,
    pub model: UpscaleModel,
    pub device: AiDevice,
}

pub const AI_UPSCALE_CONVERTER_ID: &str = "image/ai-upscale";
pub const AI_UPSCALE_OUTPUT_FORMAT: &str = "png";

/// An AI output is a new PNG; these source blocks are not promised to survive.
pub fn declared_metadata_loss() -> Vec<MetadataCategory> {
    vec![
        MetadataCategory::Exif,
        MetadataCategory::Gps,
        MetadataCategory::Camera,
        MetadataCategory::Date,
        MetadataCategory::Icc,
        MetadataCategory::Xmp,
        MetadataCategory::Iptc,
        MetadataCategory::Author,
        MetadataCategory::Comments,
    ]
}

pub fn validate_conversion_request(
    converter_id: &str,
    input_count: usize,
    keep_original: bool,
    output_format: &str,
    accepted_losses: &[MetadataCategory],
) -> Result<(), String> {
    if converter_id != AI_UPSCALE_CONVERTER_ID
        || output_format != AI_UPSCALE_OUTPUT_FORMAT
        || input_count == 0
        || input_count > ai_runtime::types::MAX_BATCH_ITEMS
        || !keep_original
    {
        return Err("ai.bad_request".into());
    }
    if declared_metadata_loss()
        .iter()
        .any(|category| !accepted_losses.contains(category))
    {
        return Err("convert.loss_unacknowledged".into());
    }
    Ok(())
}

pub fn build_task_request(
    request_id: &str,
    input: AiInputRef,
    options: AiUpscaleConversionOptions,
    locale: AiLocale,
) -> Result<AiTaskRequest, String> {
    if !ai_runtime::validation::valid_request_id(request_id) || input.expected_revision < 1 {
        return Err("ai.bad_request".into());
    }
    Ok(AiTaskRequest {
        request_id: request_id.to_string(),
        task: AiTaskKind::Upscale,
        locale,
        inputs: vec![input],
        prompt: None,
        options: AiTaskOptions::Upscale {
            scale: options.scale,
            model: options.model,
            preview_region: None,
            device: options.device,
        },
    })
}

/// 08a receives one output per input; this checks the released artifact only.
pub fn validate_conversion_output(result: &AiTaskResult, input_index: u32) -> Result<Uuid, String> {
    ai_runtime::validation::validate_result_shape(result)?;
    if result.task != AiTaskKind::Upscale {
        return Err("ai.model_output".into());
    }
    let AiResultPayload::Image {
        artifact_id,
        width,
        height,
        mime,
    } = &result.result
    else {
        return Err("ai.model_output".into());
    };
    if *width == 0
        || *height == 0
        || mime != "image/png"
        || input_index >= ai_runtime::types::MAX_BATCH_ITEMS as u32
    {
        return Err("ai.model_output".into());
    }
    Ok(*artifact_id)
}

pub fn batch_count_is_valid(count: usize) -> bool {
    (1..=ai_runtime::types::MAX_BATCH_ITEMS).contains(&count)
}
