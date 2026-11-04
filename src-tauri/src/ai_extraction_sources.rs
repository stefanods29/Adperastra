//! Immutable extraction inputs (Step 17d T2, decisions D1/D2).
//!
//! Every input is resolved once through a native-authorized resolver: an
//! opened document backing or an immutable 08a snapshot. Online-only sources
//! and sensitive sources are classified natively; the UI can never lower a
//! classification. Before the next source starts, the caller revalidates the
//! exact identity and aborts with zero usable sources on any change.
#![allow(dead_code)]


use uuid::Uuid;

use crate::ai_extraction_requests::ExtractionRequest;
use crate::ai_extraction_types::{
    ExtractionSource, MAX_EXTRACTION_BATCH_BYTES, MAX_EXTRACTION_INPUT_BYTES, MAX_EXTRACTION_INPUTS,
    MAX_EXTRACTION_PAGES,
};
use crate::local_ai_types::AiInputRef;
use crate::pdf_types::PdfSourceIdentity;

/// One resolver answer. `online_only` and `sensitive` are native facts.
#[derive(Debug, Clone, PartialEq)]
pub struct SourceCandidate {
    pub id: Uuid,
    pub input: AiInputRef,
    pub identity: PdfSourceIdentity,
    pub display_name: String,
    pub page_count: u32,
    pub sensitive: bool,
    pub online_only: bool,
    pub byte_len: u64,
}

/// Implemented by the native document/snapshot authority. A browser request
/// can never implement this trait.
pub trait ExtractionSourceResolver {
    fn resolve(&self, input: &AiInputRef) -> Result<SourceCandidate, String>;
    fn current_identity(&self, source_id: &Uuid) -> Result<PdfSourceIdentity, String>;
}

#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedSources {
    pub sources: Vec<ExtractionSource>,
    pub pages: u32,
    pub bytes: u64,
}

/// Resolve 1..100 inputs, at most 200 pages and 512 MiB per batch.
pub fn resolve_sources(
    request: &ExtractionRequest,
    resolver: &dyn ExtractionSourceResolver,
) -> Result<ResolvedSources, String> {
    if request.inputs.is_empty() || request.inputs.len() > MAX_EXTRACTION_INPUTS {
        return Err("ai_extract.invalid".to_string());
    }
    let mut sources = Vec::with_capacity(request.inputs.len());
    let mut pages = 0u32;
    let mut bytes = 0u64;
    for input in &request.inputs {
        let candidate = resolver.resolve(input)?;
        if candidate.online_only {
            // Never hydrate a cloud file in the background (R-FS-1).
            return Err("ai_extract.unsupported".to_string());
        }
        if candidate.page_count == 0 || candidate.page_count > MAX_EXTRACTION_PAGES {
            return Err("ai_extract.too_large".to_string());
        }
        if candidate.byte_len > MAX_EXTRACTION_INPUT_BYTES {
            return Err("ai_extract.too_large".to_string());
        }
        pages = pages
            .checked_add(candidate.page_count)
            .ok_or_else(|| "ai_extract.too_large".to_string())?;
        bytes = bytes
            .checked_add(candidate.byte_len)
            .ok_or_else(|| "ai_extract.too_large".to_string())?;
        if pages > MAX_EXTRACTION_PAGES || bytes > MAX_EXTRACTION_BATCH_BYTES {
            return Err("ai_extract.too_large".to_string());
        }
        if let PdfSourceIdentity::Snapshot { sensitive, .. } = &candidate.identity {
            if *sensitive && !candidate.sensitive {
                // Snapshot classification is sticky and cannot be lowered.
                return Err("ai_extract.unsupported".to_string());
            }
        }
        sources.push(ExtractionSource {
            id: candidate.id,
            input: candidate.input,
            identity: candidate.identity,
            display_name: candidate.display_name,
            page_count: candidate.page_count,
            sensitive: candidate.sensitive,
        });
    }
    Ok(ResolvedSources { sources, pages, bytes })
}

/// Revalidate every source before work continues; on any mismatch the caller
/// gets zero sources and `ai_extract.changed` (no partial output).
pub fn revalidate_sources(
    sources: &[ExtractionSource],
    resolver: &dyn ExtractionSourceResolver,
) -> Result<Vec<ExtractionSource>, String> {
    for source in sources {
        let current = resolver.current_identity(&source.id)?;
        if current != source.identity {
            return Err("ai_extract.changed".to_string());
        }
    }
    Ok(sources.to_vec())
}

#[cfg(test)]
#[path = "ai_extraction_sources_tests.rs"]
mod tests;
