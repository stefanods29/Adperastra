//! Result-side validation (split from `validation.rs` for the 400-line rule).

use std::collections::BTreeSet;

use crate::schema;
use crate::types::*;
use crate::types_ui::AiTextPage;
use crate::validation::{ascii_bounded, scalar_count, valid_request_id};

pub fn validate_embeddings(bytes: &[u8], rows: u32, dimensions: u16) -> Result<(), String> {
    if rows == 0 || rows > MAX_EMBEDDING_ROWS || !matches!(dimensions, 384 | 768) {
        return Err("ai.bad_request".into());
    }
    let expected = (rows as usize)
        .checked_mul(dimensions as usize)
        .and_then(|count| count.checked_mul(4))
        .ok_or("ai.bad_request")?;
    if bytes.len() != expected {
        return Err("ai.model_output".into());
    }
    for row in bytes.chunks_exact(dimensions as usize * 4) {
        let mut norm = 0.0f64;
        for chunk in row.as_chunks::<4>().0 {
            let value = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
            if !value.is_finite() {
                return Err("ai.model_output".into());
            }
            norm += f64::from(value) * f64::from(value);
        }
        let norm = norm.sqrt();
        if norm <= f64::EPSILON || (norm - 1.0).abs() > 1e-5 {
            return Err("ai.model_output".into());
        }
    }
    Ok(())
}

pub fn validate_text_page(page: &AiTextPage, previous_after: u64) -> Result<(), String> {
    if page.chunks.len() > MAX_TEXT_CHUNKS {
        return Err("ai.model_output".into());
    }
    let mut previous = previous_after;
    let mut total = 0usize;
    for chunk in &page.chunks {
        if chunk.sequence <= previous || chunk.text.len() > MAX_TEXT_CHUNK_BYTES {
            return Err("ai.model_output".into());
        }
        previous = chunk.sequence;
        total = total
            .checked_add(chunk.text.len())
            .ok_or("ai.model_output")?;
    }
    if total > MAX_TEXT_PAGE_BYTES {
        return Err("ai.model_output".into());
    }
    if page.chunks.is_empty() {
        if page.done && page.after_sequence >= previous_after {
            return Ok(());
        }
        return Err("ai.model_output".into());
    }
    if page.after_sequence != previous {
        return Err("ai.model_output".into());
    }
    Ok(())
}

pub fn validate_citation(citation: &AiCitation) -> Result<(), String> {
    if citation.revision < 1
        || citation.input_id.is_nil()
        || scalar_count(&citation.quote) > MAX_CITATION_QUOTE_SCALARS
    {
        return Err("ai.model_output".into());
    }
    match &citation.location {
        AiSourceLocation::Text { start, end } if end > start => {}
        AiSourceLocation::Page { page } if *page >= 1 => {}
        AiSourceLocation::Time { start_us, end_us } if end_us > start_us => {}
        AiSourceLocation::Sheet { sheet_id, range }
            if !sheet_id.is_empty()
                && sheet_id.len() <= 128
                && !range.is_empty()
                && range.len() <= 64 => {}
        AiSourceLocation::Slide { slide_id } if !slide_id.is_empty() && slide_id.len() <= 128 => {}
        AiSourceLocation::Image { region } => {
            if let Some(region) = region {
                crate::validation::validate_rect_shape(region)
                    .map_err(|_| "ai.model_output".to_string())?;
            }
        }
        _ => return Err("ai.model_output".into()),
    }
    Ok(())
}

pub fn validate_result_shape(result: &AiTaskResult) -> Result<(), String> {
    let payload_matches = matches!(
        (result.task, &result.result),
        (
            AiTaskKind::StructuredText,
            AiResultPayload::Structured { .. }
        ) | (AiTaskKind::VisionAnswer, AiResultPayload::Structured { .. })
            | (AiTaskKind::EmbedText, AiResultPayload::Embeddings { .. })
            | (AiTaskKind::EmbedImage, AiResultPayload::Embeddings { .. })
            | (AiTaskKind::Transcribe, AiResultPayload::Transcript { .. })
            | (AiTaskKind::Upscale, AiResultPayload::Image { .. })
            | (AiTaskKind::ForegroundMask, AiResultPayload::Mask { .. })
            | (AiTaskKind::Inpaint, AiResultPayload::Mask { .. })
    );
    if !payload_matches
        || !valid_request_id(&result.job_id)
        || !ascii_bounded(&result.model_id, MAX_MODEL_ID)
        || !ascii_bounded(&result.model_revision, MAX_MODEL_REVISION)
        || result.citations.len() > MAX_CITATIONS
        || result.warnings.len() > MAX_WARNINGS
    {
        return Err("ai.model_output".into());
    }
    for citation in &result.citations {
        validate_citation(citation)?;
    }
    let mut seen = BTreeSet::new();
    for warning in &result.warnings {
        if !seen.insert(*warning as u8) {
            return Err("ai.model_output".into());
        }
    }
    match &result.result {
        AiResultPayload::Structured {
            schema_id,
            canonical_json,
        } => {
            if canonical_json.len() > MAX_STRUCTURED_OUTPUT_BYTES {
                return Err("ai.schema_invalid".into());
            }
            schema::validate_canonical(schema_id, canonical_json)?;
        }
        AiResultPayload::Embeddings {
            artifact_id,
            rows,
            dimensions,
            ..
        } => {
            if artifact_id.is_nil()
                || *rows == 0
                || *rows > MAX_EMBEDDING_ROWS
                || !matches!(*dimensions, 384 | 768)
            {
                return Err("ai.model_output".into());
            }
        }
        AiResultPayload::Transcript {
            artifact_id,
            segment_count,
            ..
        } => {
            if artifact_id.is_nil() || *segment_count > 100_000 {
                return Err("ai.model_output".into());
            }
        }
        AiResultPayload::Image {
            artifact_id,
            width,
            height,
            mime,
        } => {
            if artifact_id.is_nil() || *width == 0 || *height == 0 || mime != "image/png" {
                return Err("ai.model_output".into());
            }
        }
        AiResultPayload::Mask {
            artifact_id,
            width,
            height,
        } => {
            if artifact_id.is_nil() || *width == 0 || *height == 0 {
                return Err("ai.model_output".into());
            }
        }
    }
    Ok(())
}

impl AiResultPayload {
    pub fn kind(&self) -> AiTaskKind {
        match self {
            AiResultPayload::Structured { .. } => AiTaskKind::StructuredText,
            AiResultPayload::Embeddings { .. } => AiTaskKind::EmbedText,
            AiResultPayload::Transcript { .. } => AiTaskKind::Transcribe,
            AiResultPayload::Image { .. } => AiTaskKind::Upscale,
            AiResultPayload::Mask { .. } => AiTaskKind::ForegroundMask,
        }
    }
}

/// GPU policy: Automatic may retry once on the CPU after an out-of-memory
/// start failure; an explicit GPU request never silently changes device.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceRetry {
    RetryCpu,
    Fail,
}

pub fn retry_after_gpu_start_failure(requested: AiDevice, already_retried: bool) -> DeviceRetry {
    if requested == AiDevice::Auto && !already_retried {
        DeviceRetry::RetryCpu
    } else {
        DeviceRetry::Fail
    }
}
