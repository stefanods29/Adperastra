//! Typed AI-action suggestions and their bounded native store.
//!
//! A suggestion is an opaque result: it is never an OS path and never a
//! document provider. The store keeps at most 16 results, expires an idle
//! result after five minutes, keeps sensitive results in RAM only and
//! refuses ids issued to another profile. Closing a result tab revokes new
//! reads; leases that were already granted finish normally.
#![allow(dead_code)]


use ai_runtime::{AiCitation, AiInputRef};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use uuid::Uuid;

use crate::ai_action_types::{
    AiActionId, ERR_INVALID, ERR_SOURCE_CHANGED, ERR_TOO_LARGE, ERR_UNSUPPORTED, MAX_ACTION_ITEMS,
    MAX_BLOCKS, MAX_CITATIONS, MAX_COMPARISON_POINTS, MAX_FAQ_PAIRS, MAX_MOMENTS,
    MAX_MODEL_REVISION, MAX_PLAIN_TEXT, MAX_TRANSLATION_PAIRS, MAX_WARNINGS,
};

pub const MAX_RETAINED_RESULTS: usize = 16;
pub const MAX_RESULT_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_SENSITIVE_RESULT_BYTES: u64 = 4 * 1024 * 1024;
pub const RESULT_IDLE_EXPIRY: Duration = Duration::from_secs(300);
pub const RESULT_MEMORY_BUDGET: u64 = 256 * 1024 * 1024;

/// Reuses 14c's translated expiry message; a closed tab is `source_changed`.
pub const ERR_EXPIRED_CODE: &str = "ai.expired";
pub const ERR_CLOSED_CODE: &str = ERR_SOURCE_CHANGED;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiSuggestionKind {
    Paragraph,
    Bullet,
    Heading,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiSuggestionBlock {
    pub id: Uuid,
    pub kind: AiSuggestionKind,
    pub plain_text: String,
    pub citations: Vec<AiCitation>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiFaqPair {
    pub question: String,
    pub answer: String,
    pub citations: Vec<AiCitation>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiSourceLocationRef {
    pub input_id: Uuid,
    pub location: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiTranslationPair {
    pub source_input_id: Uuid,
    pub source_location: AiSourceLocationRef,
    pub source_text: String,
    pub translated_text: String,
    pub target_language: String,
    pub citations: Vec<AiCitation>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiActionItem {
    pub text: String,
    pub assignee: Option<String>,
    pub due_text: Option<String>,
    pub citations: Vec<AiCitation>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiMoment {
    pub id: Uuid,
    pub segment_indices: Vec<u32>,
    pub start_us: u64,
    pub end_us: u64,
    pub label: String,
    pub citations: Vec<AiCitation>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiComparisonKind {
    Agreement,
    Difference,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiComparisonPoint {
    pub kind: AiComparisonKind,
    pub left_text: String,
    pub right_text: String,
    pub left_citations: Vec<AiCitation>,
    pub right_citations: Vec<AiCitation>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiImagePayload {
    pub artifact_id: Uuid,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiTranscriptRef {
    pub id: Uuid,
    pub source_input_id: Uuid,
    pub source_revision: u64,
    pub language: String,
    pub duration_us: u64,
    pub segment_count: u32,
    pub partial: bool,
    pub model_id: String,
    pub model_revision: String,
    pub expires_unix: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiFolderSkipped {
    pub label: String,
    pub reason_code: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AiActionPayload {
    Image { image: AiImagePayload },
    Text { blocks: Vec<AiSuggestionBlock> },
    Faq { pairs: Vec<AiFaqPair> },
    Translation { pairs: Vec<AiTranslationPair> },
    KeyPoints { points: Vec<AiSuggestionBlock>, actions: Vec<AiActionItem> },
    Transcript { info: AiTranscriptRef },
    Moments { items: Vec<AiMoment> },
    Comparison { points: Vec<AiComparisonPoint> },
    FolderSummary {
        blocks: Vec<AiSuggestionBlock>,
        included_input_ids: Vec<Uuid>,
        skipped: Vec<AiFolderSkipped>,
        partial: bool,
        names_only: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiActionResult {
    pub id: Uuid,
    pub action: AiActionId,
    pub inputs: Vec<AiInputRef>,
    pub payload: AiActionPayload,
    pub backend: String,
    pub provider_id: Option<String>,
    pub model_id: String,
    pub model_revision: String,
    pub citations: Vec<AiCitation>,
    pub warnings: Vec<String>,
    pub sensitive: bool,
    pub created_unix: u64,
    pub expires_unix: u64,
    pub generation: u32,
}

/// One transcript segment range a moment must stay inside.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SegmentSpan {
    pub index: u32,
    pub start_us: u64,
    pub end_us: u64,
}

fn text_fits(value: &str, max: usize) -> bool {
    value.chars().count() <= max
}

fn citations_fit(citations: &[AiCitation]) -> bool {
    citations.len() <= 16
}

fn moment_segment_union(spans: &[SegmentSpan], indices: &[u32]) -> Option<(u64, u64, u32)> {
    let mut start = u64::MAX;
    let mut end = 0u64;
    let mut found = 0u32;
    for index in indices {
        {
            let span = spans.iter().find(|candidate| candidate.index == *index)?;
            start = start.min(span.start_us);
            end = end.max(span.end_us);
            found += 1;
        }
    }
    (found > 0).then_some((start, end, found))
}

/// Every claimed range stays inside real, existing transcript segments.
pub fn validate_moments(items: &[AiMoment], spans: &[SegmentSpan], duration_us: u64) -> Result<(), String> {
    if items.len() > MAX_MOMENTS {
        return Err(ERR_TOO_LARGE.to_string());
    }
    for moment in items {
        if moment.segment_indices.is_empty() || moment.segment_indices.len() > 100 {
            return Err(ERR_INVALID.to_string());
        }
        if moment.end_us <= moment.start_us || moment.end_us > duration_us {
            return Err(ERR_INVALID.to_string());
        }
        let Some((start, end, _)) = moment_segment_union(spans, &moment.segment_indices) else {
            return Err(ERR_INVALID.to_string());
        };
        if start < moment.start_us || end > moment.end_us {
            return Err(ERR_INVALID.to_string());
        }
        if !text_fits(&moment.label, 512) || !citations_fit(&moment.citations) {
            return Err(ERR_INVALID.to_string());
        }
    }
    Ok(())
}

/// Comparison needs both sides cited for a claim; `unknown` may cite none.
pub fn validate_comparison(points: &[AiComparisonPoint], input_ids: &[Uuid]) -> Result<(), String> {
    if points.len() > MAX_COMPARISON_POINTS {
        return Err(ERR_TOO_LARGE.to_string());
    }
    if input_ids.len() != 2 {
        return Err(ERR_INVALID.to_string());
    }
    for point in points {
        if !text_fits(&point.left_text, 4_096) || !text_fits(&point.right_text, 4_096) {
            return Err(ERR_INVALID.to_string());
        }
        if point.kind == AiComparisonKind::Unknown {
            continue;
        }
        if point.left_citations.is_empty() || point.right_citations.is_empty() {
            return Err(ERR_INVALID.to_string());
        }
        if !citations_fit(&point.left_citations) || !citations_fit(&point.right_citations) {
            return Err(ERR_INVALID.to_string());
        }
    }
    Ok(())
}

/// Validates any payload against the action that must have produced it.
pub fn validate_payload(action: AiActionId, payload: &AiActionPayload) -> Result<(), String> {
    let wrong = || ERR_INVALID.to_string();
    match (action, payload) {
        (AiActionId::RemoveBackground | AiActionId::BlurBackground | AiActionId::EraseObject | AiActionId::Upscale, AiActionPayload::Image { image }) => {
            if image.width == 0 || image.height == 0 || image.width > 32_768 || image.height > 32_768 {
                return Err(wrong());
            }
            Ok(())
        }
        (AiActionId::Summarize | AiActionId::AskFile | AiActionId::AskImage, AiActionPayload::Text { blocks }) => {
            if blocks.len() > MAX_BLOCKS {
                return Err(ERR_TOO_LARGE.to_string());
            }
            for block in blocks {
                if !text_fits(&block.plain_text, MAX_PLAIN_TEXT) || !citations_fit(&block.citations) {
                    return Err(wrong());
                }
            }
            Ok(())
        }
        (AiActionId::CreateFaq, AiActionPayload::Faq { pairs }) => {
            if pairs.len() > MAX_FAQ_PAIRS {
                return Err(ERR_TOO_LARGE.to_string());
            }
            for pair in pairs {
                if !text_fits(&pair.question, 512) || !text_fits(&pair.answer, 4_096) || !citations_fit(&pair.citations) {
                    return Err(wrong());
                }
            }
            Ok(())
        }
        (AiActionId::Translate, AiActionPayload::Translation { pairs }) => {
            if pairs.len() > MAX_TRANSLATION_PAIRS {
                return Err(ERR_TOO_LARGE.to_string());
            }
            for pair in pairs {
                if pair.target_language != pair.target_language.to_ascii_lowercase()
                    && !pair.target_language.contains('-')
                {
                    return Err(wrong());
                }
                if !text_fits(&pair.source_text, MAX_PLAIN_TEXT)
                    || !text_fits(&pair.translated_text, 16_384)
                    || !citations_fit(&pair.citations)
                {
                    return Err(wrong());
                }
            }
            Ok(())
        }
        (AiActionId::KeyPoints, AiActionPayload::KeyPoints { points, actions }) => {
            if points.len() > 12 || actions.len() > MAX_ACTION_ITEMS {
                return Err(ERR_TOO_LARGE.to_string());
            }
            for action_item in actions {
                if !text_fits(&action_item.text, 1_024)
                    || action_item.assignee.as_deref().is_some_and(|value| !text_fits(value, 128))
                    || action_item.due_text.as_deref().is_some_and(|value| !text_fits(value, 128))
                {
                    return Err(wrong());
                }
            }
            Ok(())
        }
        (AiActionId::DescribeImage, AiActionPayload::Text { .. }) => Ok(()),
        (AiActionId::Transcribe, AiActionPayload::Transcript { info }) => {
            if info.model_id.chars().count() > 96 || info.model_revision.chars().count() > MAX_MODEL_REVISION {
                return Err(wrong());
            }
            if info.language.chars().count() > 32 || info.segment_count > 100_000 {
                return Err(ERR_TOO_LARGE.to_string());
            }
            Ok(())
        }
        (AiActionId::SummarizeMedia, AiActionPayload::Text { blocks }) => {
            if blocks.len() > MAX_BLOCKS {
                return Err(ERR_TOO_LARGE.to_string());
            }
            for block in blocks {
                if !text_fits(&block.plain_text, MAX_PLAIN_TEXT) || !citations_fit(&block.citations) {
                    return Err(wrong());
                }
            }
            Ok(())
        }
        (AiActionId::FindMoments, AiActionPayload::Moments { .. }) => Ok(()),
        (AiActionId::CompareDocuments, AiActionPayload::Comparison { .. }) => Ok(()),
        (AiActionId::SummarizeFolder, AiActionPayload::FolderSummary { blocks, included_input_ids, skipped, .. }) => {
            if blocks.len() > MAX_BLOCKS || included_input_ids.len() > 100 || skipped.len() > 100 {
                return Err(ERR_TOO_LARGE.to_string());
            }
            if included_input_ids.len() != included_input_ids.iter().collect::<std::collections::BTreeSet<_>>().len() {
                return Err(wrong());
            }
            Ok(())
        }
        (AiActionId::CopyText, _) => Err(ERR_UNSUPPORTED.to_string()),
        _ => Err(wrong()),
    }
}

/// Validates the whole result before it is stored, shown or exported.
pub fn validate_result(result: &AiActionResult) -> Result<(), String> {
    if result.inputs.len() > 100 || result.citations.len() > MAX_CITATIONS || result.warnings.len() > MAX_WARNINGS {
        return Err(ERR_TOO_LARGE.to_string());
    }
    if result.model_id.is_empty() || result.model_id.chars().count() > 96 {
        return Err(ERR_INVALID.to_string());
    }
    if result.model_revision.chars().count() > MAX_MODEL_REVISION {
        return Err(ERR_INVALID.to_string());
    }
    if result.backend != "local" && result.backend != "api" {
        return Err(ERR_INVALID.to_string());
    }
    if result.generation < 1 || result.expires_unix <= result.created_unix {
        return Err(ERR_INVALID.to_string());
    }
    if result.action.local_only() && result.backend != "local" {
        return Err(ERR_UNSUPPORTED.to_string());
    }
    validate_payload(result.action, &result.payload)
}

/// The tab a result opens in: an opaque id, never a path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AiResultTabDescriptor {
    pub tab_kind: String,
    pub result_id: Uuid,
    pub label_key: String,
}

pub fn result_tab_descriptor(result_id: Uuid) -> Result<AiResultTabDescriptor, String> {
    let label_key = "aiActions.title".to_string();
    Ok(AiResultTabDescriptor { tab_kind: "ai_result".to_string(), result_id, label_key })
}

/// A tab id must be opaque: no drive letter, separator or `..` segment.
pub fn validate_result_tab_id(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 128 {
        return Err(ERR_INVALID.to_string());
    }
    if value.contains('\\') || value.contains('/') || value.contains(':') && !value.starts_with("ai-result:") {
        return Err(ERR_INVALID.to_string());
    }
    if value.split(['\\', '/']).any(|part| part == "..") {
        return Err(ERR_INVALID.to_string());
    }
    Ok(())
}

struct StoredResult {
    result: AiActionResult,
    profile_id: Uuid,
    sensitive: bool,
    closed: bool,
    leases: u32,
    last_read: Instant,
    bytes: u64,
}

/// Profile-bound result store. All methods are lock-then-work only.
pub struct AiActionResultStore {
    entries: Mutex<HashMap<Uuid, StoredResult>>,
}

impl Default for AiActionResultStore {
    fn default() -> Self {
        Self::new()
    }
}

impl AiActionResultStore {
    pub fn new() -> Self {
        Self { entries: Mutex::new(HashMap::new()) }
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, HashMap<Uuid, StoredResult>>, String> {
        self.entries.lock().map_err(|_| "ai_action_results lock poisoned".to_string())
    }

    fn prune(entries: &mut HashMap<Uuid, StoredResult>) {
        entries.retain(|_, entry| {
            if entry.closed && entry.leases == 0 {
                return false;
            }
            entry.last_read.elapsed() <= RESULT_IDLE_EXPIRY || entry.leases > 0
        });
    }

    fn total_bytes(entries: &HashMap<Uuid, StoredResult>) -> u64 {
        entries.values().map(|entry| entry.bytes).sum()
    }

    /// Stores one validated result for `profile_id`.
    pub fn insert(&self, result: AiActionResult, profile_id: Uuid, bytes: u64) -> Result<(), String> {
        validate_result(&result)?;
        let mut entries = self.lock()?;
        Self::prune(&mut entries);
        if entries.len() >= MAX_RETAINED_RESULTS {
            return Err(ERR_TOO_LARGE.to_string());
        }
        let limit = if result.sensitive { MAX_SENSITIVE_RESULT_BYTES } else { MAX_RESULT_BYTES };
        if bytes > limit || Self::total_bytes(&entries) + bytes > RESULT_MEMORY_BUDGET {
            return Err(ERR_TOO_LARGE.to_string());
        }
        entries.insert(
            result.id,
            StoredResult {
                sensitive: result.sensitive,
                result,
                profile_id,
                closed: false,
                leases: 0,
                last_read: Instant::now(),
                bytes,
            },
        );
        Ok(())
    }

    /// Reads one result; foreign profile, closed tab and expiry all refuse.
    pub fn get(&self, id: Uuid, profile_id: Uuid) -> Result<AiActionResult, String> {
        let mut entries = self.lock()?;
        Self::prune(&mut entries);
        let Some(entry) = entries.get_mut(&id) else {
            return Err(ERR_EXPIRED_CODE.to_string());
        };
        if entry.profile_id != profile_id {
            return Err(ERR_SOURCE_CHANGED.to_string());
        }
        if entry.closed {
            return Err(ERR_CLOSED_CODE.to_string());
        }
        if entry.last_read.elapsed() > RESULT_IDLE_EXPIRY {
            return Err(ERR_EXPIRED_CODE.to_string());
        }
        entry.last_read = Instant::now();
        Ok(entry.result.clone())
    }

    /// Grants a read lease; already-open readers keep working after close.
    pub fn acquire(&self, id: Uuid, profile_id: Uuid) -> Result<AiActionResult, String> {
        let result = self.get(id, profile_id)?;
        let mut entries = self.lock()?;
        if let Some(entry) = entries.get_mut(&id) {
            entry.leases += 1;
        }
        Ok(result)
    }

    /// Drops one lease; the entry disappears when closed and unleased.
    pub fn release_lease(&self, id: Uuid) {
        if let Ok(mut entries) = self.lock() {
            if let Some(entry) = entries.get_mut(&id) {
                entry.leases = entry.leases.saturating_sub(1);
                if entry.closed && entry.leases == 0 {
                    entries.remove(&id);
                }
            }
        }
    }

    /// Closing a tab revokes new reads.
    pub fn close(&self, id: Uuid, profile_id: Uuid) -> Result<(), String> {
        let mut entries = self.lock()?;
        let Some(entry) = entries.get_mut(&id) else {
            return Ok(());
        };
        if entry.profile_id != profile_id {
            return Err(ERR_SOURCE_CHANGED.to_string());
        }
        entry.closed = true;
        if entry.leases == 0 {
            entries.remove(&id);
        }
        Ok(())
    }

    pub fn is_sensitive(&self, id: Uuid) -> bool {
        self.lock().ok().and_then(|entries| entries.get(&id).map(|entry| entry.sensitive)).unwrap_or(false)
    }

    pub fn retained(&self) -> usize {
        self.lock().map(|entries| entries.len()).unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn citation(id: Uuid) -> AiCitation {
        AiCitation {
            input_id: id,
            revision: 1,
            location: ai_runtime::AiSourceLocation::Page { page: 1 },
            quote: "Budget 120.".to_string(),
        }
    }

    #[test]
    fn comparison_claim_needs_both_citations() {
        let left = Uuid::new_v4();
        let right = Uuid::new_v4();
        let point = AiComparisonPoint {
            kind: AiComparisonKind::Difference,
            left_text: "120".to_string(),
            right_text: "150".to_string(),
            left_citations: vec![citation(left)],
            right_citations: vec![],
        };
        assert_eq!(validate_comparison(&[point], &[left, right]).unwrap_err(), ERR_INVALID);
    }

    #[test]
    fn unknown_comparison_needs_no_citation() {
        let left = Uuid::new_v4();
        let right = Uuid::new_v4();
        let point = AiComparisonPoint {
            kind: AiComparisonKind::Unknown,
            left_text: "unknown".to_string(),
            right_text: "unknown".to_string(),
            left_citations: vec![],
            right_citations: vec![],
        };
        assert!(validate_comparison(&[point], &[left, right]).is_ok());
    }
}
