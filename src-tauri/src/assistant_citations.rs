//! Citation verification against captured source chunks (Step 17a T2).
//!
//! A citation is accepted only when the input ID, revision and location match
//! a captured chunk and the quote appears in that chunk after whitespace
//! normalization. The model cannot invent a page or a source.
#![allow(dead_code)]


use ai_runtime::validation;
use serde::{Deserialize, Serialize};

use crate::assistant_sources::{normalize_quote, source_is_current, EvidenceChunk, ExtractedSource};
use crate::local_ai_types::{AiCitation, AiSourceLocation};

pub const MAX_QUOTE_SCALARS: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CitationCheck {
    pub valid: bool,
    pub error_code: Option<String>,
    pub citation: Option<AiCitation>,
}

fn cannot_verify() -> CitationCheck {
    CitationCheck {
        valid: false,
        error_code: Some("assistant.cannot_verify".to_string()),
        citation: None,
    }
}

/// The canonical 14c location/revision/quote bounds plus a non-blank quote.
/// Source identity and chunk containment are checked separately.
pub fn citation_shape_valid(citation: &AiCitation) -> bool {
    validation::validate_citation(citation).is_ok() && !normalize_quote(&citation.quote).is_empty()
}

fn same_location(left: &AiSourceLocation, right: &AiSourceLocation) -> bool {
    // Location enums are canonical 14c values; comparing their serialized
    // form avoids adding a derive requirement to the producer type.
    serde_json::to_value(left).ok() == serde_json::to_value(right).ok()
}

/// Find the first chunk that contains the quote and matches the optional
/// requested location. Page 2 text cannot satisfy a page 1 citation.
pub fn citation_for_quote(
    source: &ExtractedSource,
    quote: &str,
    expected: Option<&AiSourceLocation>,
) -> CitationCheck {
    let quote_len = quote.chars().count();
    if quote_len == 0 || quote_len > MAX_QUOTE_SCALARS {
        return cannot_verify();
    }
    let needle = normalize_quote(quote);
    if needle.is_empty() {
        return cannot_verify();
    }
    for chunk in &source.chunks {
        if let Some(location) = expected {
            if !same_location(location, &chunk.location) {
                continue;
            }
        }
        if normalize_quote(&chunk.text).contains(&needle) {
            return CitationCheck {
                valid: true,
                error_code: None,
                citation: Some(AiCitation {
                    input_id: source.input_id,
                    revision: source.revision,
                    location: chunk.location.clone(),
                    quote: quote.to_string(),
                }),
            };
        }
    }
    cannot_verify()
}

/// Validate a citation the model returned in a final answer.
pub fn validate_citation(
    citation: &AiCitation,
    chunks: &[EvidenceChunk],
    source: &ExtractedSource,
) -> Result<(), String> {
    if citation.revision != source.revision || citation.input_id != source.input_id {
        return Err("assistant.source_changed".to_string());
    }
    // 14c owns the canonical source-location shape and quote cap. A missing
    // or malformed location is never accepted from model text.
    if !citation_shape_valid(citation) {
        return Err("assistant.cannot_verify".to_string());
    }
    let needle = normalize_quote(&citation.quote);
    let found = chunks.iter().any(|chunk| {
        chunk.input_id == citation.input_id
            && chunk.revision == citation.revision
            && same_location(&chunk.location, &citation.location)
            && normalize_quote(&chunk.text).contains(&needle)
    });
    if found {
        Ok(())
    } else {
        Err("assistant.cannot_verify".to_string())
    }
}

/// A source identity changed after capture: every citation is stale.
pub fn require_current_source(
    source: &ExtractedSource,
    current_identity: &str,
    current_revision: u64,
) -> Result<(), String> {
    if source_is_current(source, current_identity, current_revision) {
        Ok(())
    } else {
        Err("assistant.source_changed".to_string())
    }
}

/// Validate every citation in an answer. One invalid citation fails the
/// answer; partial fabricated evidence is never shown as verified.
pub fn validate_answer_citations(
    citations: &[AiCitation],
    source: &ExtractedSource,
) -> Result<(), String> {
    if citations.len() > 256 {
        return Err("assistant.cannot_verify".to_string());
    }
    for citation in citations {
        validate_citation(citation, &source.chunks, source)?;
    }
    Ok(())
}

/// Citations must be deterministic for a source; a missing quote can only be
/// reported as cannot-verify, never replaced with a nearby sentence.
pub fn cannot_verify_error() -> String {
    "assistant.cannot_verify".to_string()
}
