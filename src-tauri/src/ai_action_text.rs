//! Grounded text suggestions (D10/D11, `ai-actions-1` T6).
//!
//! The model never runs here: 17a's selected gateway does, after its own
//! outbound review. This module owns the exact schema ids, the prompt
//! template names, the source budget, the API-consent gate and the structural
//! checks every answer must pass before a suggestion is shown.
#![allow(dead_code)]


use uuid::Uuid;

use crate::ai_action_results::{AiComparisonPoint, AiTranslationPair};
use crate::ai_action_sources::{PreparedSource, ERR_TOO_LARGE, ERR_INVALID};
use crate::ai_action_types::{AiActionId, ERR_LANGUAGE, ERR_UNSUPPORTED};

pub const SCHEMA_SUMMARY: &str = "ai-action-summary-v1";
pub const SCHEMA_FAQ: &str = "ai-action-faq-v1";
pub const SCHEMA_TRANSLATION: &str = "ai-action-translation-v1";
pub const SCHEMA_KEY_POINTS: &str = "ai-action-key-points-v1";
pub const SCHEMA_MOMENTS: &str = "ai-action-moments-v1";
pub const SCHEMA_COMPARE: &str = "ai-action-compare-v1";
pub const SCHEMA_FOLDER: &str = "ai-action-folder-v1";
pub const SCHEMA_DESCRIPTION: &str = "ai-action-description-v1";

pub const PROMPT_SUMMARY: &str = "actions.summary.v1";
pub const PROMPT_FAQ: &str = "actions.faq.v1";
pub const PROMPT_TRANSLATION: &str = "actions.translation.v1";
pub const PROMPT_KEY_POINTS: &str = "actions.key-points.v1";
pub const PROMPT_MOMENTS: &str = "actions.moments.v1";
pub const PROMPT_COMPARE: &str = "actions.compare.v1";
pub const PROMPT_FOLDER: &str = "actions.folder.v1";
pub const PROMPT_DESCRIPTION: &str = "actions.description.v1";

pub const MAX_PARAGRAPH_PAIRS: usize = 32;
pub const MAX_SUMMARY_POINTS: usize = 12;

pub const ERR_OUTBOUND_REQUIRED: &str = "assistant.outbound_required";

/// The task instruction appended to the shared system prompt (guide table).
pub fn task_instruction(action: AiActionId, spanish: bool) -> Option<&'static str> {
    Some(match (action, spanish) {
        (AiActionId::Summarize, false) => "Summarize the stated facts in at most 12 points, citing each point.",
        (AiActionId::Summarize, true) => "Resume los hechos indicados en un máximo de 12 puntos y cita cada uno.",
        (AiActionId::CreateFaq, false) => "Create questions answerable from these sources; at most 12 pairs.",
        (AiActionId::CreateFaq, true) => "Crea preguntas que puedan responderse con estos orígenes; máximo 12 pares.",
        (AiActionId::Translate, false) => {
            "Translate each supplied paragraph into the selected language; preserve paragraph order and all facts."
        }
        (AiActionId::Translate, true) => {
            "Traduce cada párrafo al idioma elegido; conserva el orden y todos los datos."
        }
        (AiActionId::KeyPoints, false) => "List stated key points and explicit action items; do not invent owners or dates.",
        (AiActionId::KeyPoints, true) => "Enumera puntos clave y tareas explícitas; no inventes responsables ni fechas.",
        (AiActionId::FindMoments, false) => {
            "Return transcript ranges that answer the query, using only existing segment IDs/times."
        }
        (AiActionId::FindMoments, true) => {
            "Devuelve intervalos de la transcripción que respondan la consulta, usando solo sus segmentos y tiempos."
        }
        (AiActionId::CompareDocuments, false) => {
            "Compare only the two supplied documents, citing both sides of each agreement or difference."
        }
        (AiActionId::CompareDocuments, true) => {
            "Compara solo los dos documentos proporcionados, citando ambos lados de cada coincidencia o diferencia."
        }
        (AiActionId::SummarizeFolder, false) => {
            "Summarize only the approved file list and readable content; explicitly state partial or names-only coverage."
        }
        (AiActionId::SummarizeFolder, true) => {
            "Resume solo la lista aprobada y el contenido legible; indica si es parcial o solo nombres."
        }
        (AiActionId::DescribeImage, false) => {
            "Describe visible content; distinguish observation from uncertainty; cite the image."
        }
        (AiActionId::DescribeImage, true) => {
            "Describe el contenido visible, distingue lo observado de la incertidumbre y cita la imagen."
        }
        _ => return None,
    })
}

pub fn schema_for(action: AiActionId) -> Option<&'static str> {
    Some(match action {
        AiActionId::Summarize | AiActionId::SummarizeMedia => SCHEMA_SUMMARY,
        AiActionId::CreateFaq => SCHEMA_FAQ,
        AiActionId::Translate => SCHEMA_TRANSLATION,
        AiActionId::KeyPoints => SCHEMA_KEY_POINTS,
        AiActionId::FindMoments => SCHEMA_MOMENTS,
        AiActionId::CompareDocuments => SCHEMA_COMPARE,
        AiActionId::SummarizeFolder => SCHEMA_FOLDER,
        AiActionId::DescribeImage => SCHEMA_DESCRIPTION,
        _ => return None,
    })
}

pub fn prompt_for(action: AiActionId) -> Option<&'static str> {
    Some(match action {
        AiActionId::Summarize | AiActionId::SummarizeMedia => PROMPT_SUMMARY,
        AiActionId::CreateFaq => PROMPT_FAQ,
        AiActionId::Translate => PROMPT_TRANSLATION,
        AiActionId::KeyPoints => PROMPT_KEY_POINTS,
        AiActionId::FindMoments => PROMPT_MOMENTS,
        AiActionId::CompareDocuments => PROMPT_COMPARE,
        AiActionId::SummarizeFolder => PROMPT_FOLDER,
        AiActionId::DescribeImage => PROMPT_DESCRIPTION,
        _ => return None,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextBackend {
    Local,
    Api,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TextGatewayRequest {
    pub action: AiActionId,
    pub backend: TextBackend,
    pub schema_id: String,
    pub prompt_template_id: String,
    /// One-shot 17a file-payload consent; required for every API request.
    pub outbound_consent_id: Option<Uuid>,
    pub sources: Vec<PreparedSource>,
    pub target_language: Option<String>,
}

/// API sends need the exact one-shot consent; local never needs one.
pub fn consent_gate(backend: TextBackend, consent: Option<Uuid>) -> Result<(), String> {
    match backend {
        TextBackend::Local => Ok(()),
        TextBackend::Api => match consent {
            Some(_) => Ok(()),
            None => Err(ERR_OUTBOUND_REQUIRED.to_string()),
        },
    }
}

/// Builds a gateway request without contacting anything.
pub fn build_gateway_request(
    action: AiActionId,
    backend: TextBackend,
    consent: Option<Uuid>,
    sources: Vec<PreparedSource>,
    target_language: Option<String>,
) -> Result<TextGatewayRequest, String> {
    consent_gate(backend, consent)?;
    let schema_id = schema_for(action).ok_or_else(|| ERR_UNSUPPORTED.to_string())?;
    let prompt_template_id = prompt_for(action).ok_or_else(|| ERR_UNSUPPORTED.to_string())?;
    if action == AiActionId::Translate {
        let language = target_language.as_deref().unwrap_or_default();
        if language.is_empty() || language.chars().count() > 35 {
            return Err(ERR_LANGUAGE.to_string());
        }
    }
    if action == AiActionId::CompareDocuments && sources.len() != 2 {
        return Err(ERR_INVALID.to_string());
    }
    Ok(TextGatewayRequest {
        action,
        backend,
        schema_id: schema_id.to_string(),
        prompt_template_id: prompt_template_id.to_string(),
        outbound_consent_id: consent,
        sources,
        target_language,
    })
}

/// Every number that appears in the source must survive the translation.
pub fn numbers_preserved(source: &str, translated: &str) -> bool {
    let numbers = |text: &str| -> Vec<String> {
        text.split(|character: char| !character.is_ascii_digit())
            .filter(|part| !part.is_empty())
            .map(str::to_string)
            .collect()
    };
    let translated_numbers = numbers(translated);
    numbers(source).iter().all(|number| translated_numbers.contains(number))
}

/// One pair per source paragraph, at most 32; never claims the whole file.
pub fn validate_translation_pairs(pairs: &[AiTranslationPair]) -> Result<(), String> {
    if pairs.len() > MAX_PARAGRAPH_PAIRS {
        return Err(ERR_TOO_LARGE.to_string());
    }
    for pair in pairs {
        if !numbers_preserved(&pair.source_text, &pair.translated_text) {
            return Err(ERR_INVALID.to_string());
        }
    }
    Ok(())
}

/// A moment range must sit inside the actual transcript duration.
pub fn moment_range_ok(start_us: u64, end_us: u64, duration_us: u64) -> bool {
    end_us > start_us && end_us <= duration_us
}

/// Unknown comparison claims may not invent a citation on either side.
pub fn comparison_citation_gap(point: &AiComparisonPoint) -> bool {
    (point.left_citations.is_empty()) != (point.right_citations.is_empty())
}

/// Copy text reuses the existing 07e Windows OCR tool and calls no model.
pub fn copy_text_uses_ocr() -> bool {
    AiActionId::CopyText.required_capabilities().is_empty()
}
