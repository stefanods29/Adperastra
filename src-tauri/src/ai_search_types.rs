//! Canonical AI-search DTOs (Step 17c, revision `ai-search-1`).
//!
//! Native mirrors of `src/services/aiSearchTypes.ts`. SearchQuery,
//! SearchFilter and SearchResult come from Step 11a; FileIdentityKey and
//! SourceStamp come from Step 07a; AiInputRef/AiCitation come from Step 14c.
//! No caller supplies SQL, regex, a shell command or a path in a model shape.
#![allow(dead_code)]


use std::collections::HashSet;
use std::fmt;

use fs_service::source_stamp::{FileIdentityKey, SourceStamp};
use search_index::types::{IndexRoot, SearchFilter, SearchQuery, SearchResult};
use serde::{Deserialize, Serialize};

use crate::local_ai_types::{AiCitation, AiInputRef};

pub const MAX_AI_SEARCH_ROOTS: usize = 32;
pub const MAX_AI_DESTINATIONS: usize = 32;
pub const MAX_DISABLED_SORT_EXTENSIONS: usize = 100;
pub const MAX_AI_NAME_INPUTS: usize = 100;
pub const MAX_AI_NAME_STEM_SCALARS: usize = 180;
pub const MAX_SEMANTIC_TEXT_SCALARS: usize = 1024;
pub const MAX_SEMANTIC_ROOTS: usize = 32;
pub const MAX_SEMANTIC_RESULTS: usize = 100;
pub const DEFAULT_SEMANTIC_LIMIT: u16 = 50;
pub const TEXT_EMBEDDING_DIMENSIONS: u16 = 384;
pub const IMAGE_EMBEDDING_DIMENSIONS: u16 = 768;
pub const MAX_TEXT_CHUNKS_PER_FILE: usize = 64;
pub const TEXT_CHUNK_SCALARS: usize = 384;
pub const TEXT_CHUNK_OVERLAP: usize = 64;
pub const MAX_INDEXED_FILE_SCALARS: usize = 24_000;
pub const MAX_INDEXED_TEXT_CHUNKS: u64 = 50_000;
pub const MAX_INDEXED_IMAGES: u64 = 25_000;
pub const MAX_EMBEDDING_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_SEMANTIC_WORKING_BYTES: u64 = 64 * 1024 * 1024;
pub const PREVIEW_TTL_SECONDS: u64 = 300;
pub const MAX_NATURAL_QUERY_SCALARS: usize = 1024;
pub const MAX_NATURAL_EXPLANATION_SCALARS: usize = 1024;
pub const MAX_UNSUPPORTED_TERMS: usize = 16;
pub const MAX_SORT_HISTORY_ROWS: usize = 100;
pub const MAX_SORT_COUNTS: usize = 3200;
pub const MAX_SORT_HISTORY_BYTES: usize = 256 * 1024;

pub const SEARCH_QUERY_SCHEMA_ID: &str = "search.query.v1";
pub const SEARCH_NAMES_SCHEMA_ID: &str = "search.names.v1";
pub const SEARCH_DESTINATION_SCHEMA_ID: &str = "search.destination.v1";

/// Why an AI-search request stopped. Commands expose the code verbatim; the
/// UI translates `errors.ai_search.<reason>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiSearchError {
    Invalid,
    Unavailable,
    Changed,
    TooLarge,
    Denied,
    OnlineOnly,
    Sensitive,
    Ambiguous,
    Failed,
}

impl AiSearchError {
    pub fn code(self) -> &'static str {
        match self {
            AiSearchError::Invalid => "ai_search.invalid",
            AiSearchError::Unavailable => "ai_search.unavailable",
            AiSearchError::Changed => "ai_search.changed",
            AiSearchError::TooLarge => "ai_search.too_large",
            AiSearchError::Denied => "ai_search.denied",
            AiSearchError::OnlineOnly => "ai_search.online_only",
            AiSearchError::Sensitive => "ai_search.sensitive",
            AiSearchError::Ambiguous => "ai_search.ambiguous",
            AiSearchError::Failed => "ai_search.failed",
        }
    }
}

impl fmt::Display for AiSearchError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code())
    }
}

impl std::error::Error for AiSearchError {}

pub type AiSearchResult<T> = Result<T, AiSearchError>;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AiSearchSettings {
    #[serde(default)]
    pub semantic_text: bool,
    #[serde(default)]
    pub photo_index: bool,
    #[serde(default)]
    pub natural_query: bool,
    #[serde(default)]
    pub rename: bool,
    #[serde(default)]
    pub sort: bool,
    #[serde(default)]
    pub roots: Vec<AiSemanticRoot>,
    #[serde(default)]
    pub destinations: Vec<AiDestination>,
    #[serde(default)]
    pub disabled_sort_extensions: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiSemanticRoot {
    pub root_id: String,
    #[serde(default)]
    pub text: bool,
    #[serde(default)]
    pub photos: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiDestination {
    pub id: String,
    pub path: String,
    pub name: String,
}

impl AiSearchSettings {
    /// Independent consent: an 11a root is eligible only when it still exists
    /// enabled, this block opts it in for the mode, and 09k does not mark it
    /// sensitive. No path is stored here and no root is inferred from a file.
    pub fn eligible_roots(&self, index_roots: &[IndexRoot], sensitive: &[String]) -> Vec<&AiSemanticRoot> {
        let sensitive: HashSet<&str> = sensitive.iter().map(String::as_str).collect();
        self.roots
            .iter()
            .filter(|root| {
                !sensitive.contains(root.root_id.as_str())
                    && index_roots
                        .iter()
                        .any(|candidate| candidate.id == root.root_id && candidate.enabled)
            })
            .collect()
    }

    pub fn validate(&self, index_roots: &[IndexRoot], sensitive: &[String]) -> AiSearchResult<()> {
        if self.roots.len() > MAX_AI_SEARCH_ROOTS || self.destinations.len() > MAX_AI_DESTINATIONS {
            return Err(AiSearchError::TooLarge);
        }
        let mut seen_roots = HashSet::new();
        for root in &self.roots {
            if !is_canonical_uuid(&root.root_id) || !seen_roots.insert(root.root_id.to_lowercase()) {
                return Err(AiSearchError::Invalid);
            }
            if !root.text && !root.photos {
                return Err(AiSearchError::Invalid);
            }
            if sensitive.iter().any(|id| id == &root.root_id) {
                return Err(AiSearchError::Sensitive);
            }
            if !index_roots
                .iter()
                .any(|candidate| candidate.id == root.root_id && candidate.enabled)
            {
                return Err(AiSearchError::Denied);
            }
        }
        let mut ids = HashSet::new();
        let mut paths = HashSet::new();
        for destination in &self.destinations {
            if !is_canonical_uuid(&destination.id) || !ids.insert(destination.id.to_lowercase()) {
                return Err(AiSearchError::Invalid);
            }
            if !is_ordinary_absolute_path(&destination.path) {
                return Err(AiSearchError::Invalid);
            }
            if !paths.insert(normalized_path_key(&destination.path)) {
                return Err(AiSearchError::Invalid);
            }
            let name = destination.name.trim();
            if name.is_empty() || name.chars().count() > 60 {
                return Err(AiSearchError::Invalid);
            }
        }
        if self.disabled_sort_extensions.len() > MAX_DISABLED_SORT_EXTENSIONS {
            return Err(AiSearchError::TooLarge);
        }
        let mut extensions = HashSet::new();
        for extension in &self.disabled_sort_extensions {
            if canonical_extension(extension).as_deref() != Some(extension.as_str()) {
                return Err(AiSearchError::Invalid);
            }
            if !extensions.insert(extension.clone()) {
                return Err(AiSearchError::Invalid);
            }
        }
        Ok(())
    }
}

/// Roots eligible for one indexing mode. This function is the single rule
/// used by both settings validation and the indexing worker.
pub fn eligible_roots_for_mode<'a>(
    settings: &'a AiSearchSettings,
    index_roots: &[IndexRoot],
    sensitive: &[String],
    mode: &str,
) -> Vec<&'a AiSemanticRoot> {
    settings
        .eligible_roots(index_roots, sensitive)
        .into_iter()
        .filter(|root| match mode {
            "text" => root.text,
            "photos" => root.photos,
            _ => false,
        })
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SemanticVectorKind {
    Text,
    Image,
}

impl SemanticVectorKind {
    pub fn dimensions(self) -> u16 {
        match self {
            SemanticVectorKind::Text => TEXT_EMBEDDING_DIMENSIONS,
            SemanticVectorKind::Image => IMAGE_EMBEDDING_DIMENSIONS,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            SemanticVectorKind::Text => "text",
            SemanticVectorKind::Image => "image",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SemanticQueryKind {
    Text,
    Photo,
    SimilarText,
    SimilarImage,
}

impl SemanticQueryKind {
    pub fn vector_kind(self) -> SemanticVectorKind {
        match self {
            SemanticQueryKind::Text => SemanticVectorKind::Text,
            SemanticQueryKind::Photo => SemanticVectorKind::Image,
            SemanticQueryKind::SimilarText => SemanticVectorKind::Text,
            SemanticQueryKind::SimilarImage => SemanticVectorKind::Image,
        }
    }

    pub fn is_similar(self) -> bool {
        matches!(self, SemanticQueryKind::SimilarText | SemanticQueryKind::SimilarImage)
    }
}

/// Native-only row. The vector never crosses IPC.
#[derive(Debug, Clone)]
pub struct SemanticVectorRecord {
    pub identity: FileIdentityKey,
    pub source: SourceStamp,
    pub root_ids: Vec<String>,
    pub model_id: String,
    pub model_revision: String,
    pub extractor_revision: u32,
    pub kind: SemanticVectorKind,
    pub chunk_index: u16,
    pub start: Option<u32>,
    pub end: Option<u32>,
    pub dimensions: u16,
    pub vector: Vec<f32>,
    pub partial: bool,
}

impl SemanticVectorRecord {
    pub fn byte_len(&self) -> u64 {
        self.vector.len() as u64 * 4
    }

    pub fn validate(&self) -> AiSearchResult<()> {
        self.source.validate().map_err(|_| AiSearchError::Invalid)?;
        if self.identity.volume_id != self.source.volume_id
            || self.identity.file_id != self.source.file_id
            || self.identity.path_key != self.source.path_key
        {
            return Err(AiSearchError::Changed);
        }
        if self.root_ids.is_empty() || self.root_ids.len() > MAX_SEMANTIC_ROOTS {
            return Err(AiSearchError::Invalid);
        }
        let mut roots = HashSet::new();
        for root in &self.root_ids {
            if !is_canonical_uuid(root) || !roots.insert(root.to_lowercase()) {
                return Err(AiSearchError::Invalid);
            }
        }
        if !is_ascii_bounded(&self.model_id, 96) || !is_ascii_bounded(&self.model_revision, 64) {
            return Err(AiSearchError::Invalid);
        }
        if self.extractor_revision == 0 || self.dimensions != self.kind.dimensions() {
            return Err(AiSearchError::Invalid);
        }
        if self.vector.len() != usize::from(self.dimensions) {
            return Err(AiSearchError::Invalid);
        }
        if self.vector.iter().any(|value| !value.is_finite()) {
            return Err(AiSearchError::Invalid);
        }
        match self.kind {
            SemanticVectorKind::Text => {
                if self.chunk_index as usize >= MAX_TEXT_CHUNKS_PER_FILE {
                    return Err(AiSearchError::Invalid);
                }
                let start = self.start.ok_or(AiSearchError::Invalid)?;
                let end = self.end.ok_or(AiSearchError::Invalid)?;
                if end <= start || usize::try_from(end).map_err(|_| AiSearchError::Invalid)? > MAX_INDEXED_FILE_SCALARS + TEXT_CHUNK_SCALARS {
                    return Err(AiSearchError::Invalid);
                }
            }
            SemanticVectorKind::Image => {
                if self.start.is_some() || self.end.is_some() || self.chunk_index != 0 {
                    return Err(AiSearchError::Invalid);
                }
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SemanticQuery {
    pub kind: SemanticQueryKind,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub input: Option<AiInputRef>,
    pub root_ids: Vec<String>,
    #[serde(default = "default_semantic_limit")]
    pub limit: u16,
    pub request_revision: u32,
    #[serde(default)]
    pub sensitive_consent_id: Option<String>,
}

fn default_semantic_limit() -> u16 {
    DEFAULT_SEMANTIC_LIMIT
}

impl SemanticQuery {
    pub fn validate(&self) -> AiSearchResult<()> {
        match self.kind {
            SemanticQueryKind::Text | SemanticQueryKind::Photo => {
                let text = self.text.as_deref().ok_or(AiSearchError::Invalid)?;
                if text.trim().is_empty() || text.chars().count() > MAX_SEMANTIC_TEXT_SCALARS {
                    return Err(AiSearchError::Invalid);
                }
                if self.input.is_some() {
                    return Err(AiSearchError::Invalid);
                }
            }
            SemanticQueryKind::SimilarText | SemanticQueryKind::SimilarImage => {
                if self.text.is_some() || self.input.is_none() {
                    return Err(AiSearchError::Invalid);
                }
                let input = self.input.as_ref().ok_or(AiSearchError::Invalid)?;
                if input.id.is_nil() || input.expected_revision == 0 {
                    return Err(AiSearchError::Invalid);
                }
            }
        }
        if self.root_ids.is_empty() || self.root_ids.len() > MAX_SEMANTIC_ROOTS {
            return Err(AiSearchError::Invalid);
        }
        let mut roots = HashSet::new();
        for root in &self.root_ids {
            if !is_canonical_uuid(root) || !roots.insert(root.to_lowercase()) {
                return Err(AiSearchError::Invalid);
            }
        }
        if self.limit == 0 || self.limit > MAX_SEMANTIC_RESULTS as u16 || self.request_revision == 0 {
            return Err(AiSearchError::Invalid);
        }
        if let Some(consent) = &self.sensitive_consent_id {
            if !is_canonical_uuid(consent) {
                return Err(AiSearchError::Invalid);
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticHit {
    pub item: SearchResult,
    pub score: f64,
    pub chunk_index: u16,
    pub source_revision: u64,
    pub model_id: String,
    pub model_revision: String,
    #[serde(default)]
    pub snippet: Option<String>,
    #[serde(default)]
    pub partial: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SemanticCoverage {
    Pending,
    Partial,
    Complete,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticPage {
    pub hits: Vec<SemanticHit>,
    pub request_revision: u32,
    pub index_generation: u64,
    pub scanned: u32,
    pub eligible: u32,
    pub skipped: u32,
    pub complete: bool,
    pub coverage: SemanticCoverage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticStatus {
    pub generation: u64,
    pub text_chunks: u32,
    pub images: u32,
    pub bytes: u64,
    pub pending: u32,
    pub skipped: u32,
    pub paused: bool,
    pub reason_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NaturalQueryRequest {
    pub text: String,
    pub root_ids: Vec<String>,
    pub now_unix: u64,
    pub timezone: String,
    pub locale: String,
    pub request_revision: u32,
}

impl NaturalQueryRequest {
    pub fn validate(&self) -> AiSearchResult<()> {
        if self.text.trim().is_empty() || self.text.chars().count() > MAX_NATURAL_QUERY_SCALARS {
            return Err(AiSearchError::Invalid);
        }
        if self.root_ids.is_empty() || self.root_ids.len() > MAX_SEMANTIC_ROOTS {
            return Err(AiSearchError::Invalid);
        }
        let mut roots = HashSet::new();
        for root in &self.root_ids {
            if !is_canonical_uuid(root) || !roots.insert(root.to_lowercase()) {
                return Err(AiSearchError::Invalid);
            }
        }
        if !is_safe_u64(self.now_unix) || self.request_revision == 0 {
            return Err(AiSearchError::Invalid);
        }
        if self.timezone.is_empty() || self.timezone.chars().count() > 64 {
            return Err(AiSearchError::Invalid);
        }
        if !matches!(self.locale.as_str(), "en" | "es") {
            return Err(AiSearchError::Invalid);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NaturalQueryPreview {
    pub id: String,
    pub request_revision: u32,
    pub status: String,
    pub query: Option<SearchQuery>,
    pub explanation: String,
    pub unsupported: Vec<String>,
    pub captured_now_unix: u64,
    pub expires_unix: u64,
}

impl NaturalQueryPreview {
    pub fn validate(&self) -> AiSearchResult<()> {
        if !is_canonical_uuid(&self.id) || self.request_revision == 0 {
            return Err(AiSearchError::Invalid);
        }
        if !matches!(self.status.as_str(), "ready" | "clarify") {
            return Err(AiSearchError::Invalid);
        }
        if self.explanation.chars().count() > MAX_NATURAL_EXPLANATION_SCALARS
            || self.unsupported.len() > MAX_UNSUPPORTED_TERMS
            || self.unsupported.iter().any(|term| term.chars().count() > 128)
        {
            return Err(AiSearchError::Invalid);
        }
        if self.status == "ready" {
            if self.query.is_none() || !self.unsupported.is_empty() {
                return Err(AiSearchError::Invalid);
            }
            if let Some(query) = &self.query {
                query
                    .validate()
                    .map_err(|_| AiSearchError::Invalid)?;
            }
        } else if self.query.is_some() {
            return Err(AiSearchError::Invalid);
        }
        if self.expires_unix <= self.captured_now_unix {
            return Err(AiSearchError::Invalid);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiNamingToken {
    Date,
    Topic,
    Company,
    Type,
    Month,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiNamingPattern {
    pub pattern: String,
    pub tokens: Vec<AiNamingToken>,
    pub locale: String,
    pub date: String,
    pub month: String,
}

impl AiNamingPattern {
    pub fn validate(&self) -> AiSearchResult<()> {
        if self.pattern.chars().count() > 256 || self.tokens.is_empty() || self.tokens.len() > 5 {
            return Err(AiSearchError::Invalid);
        }
        let mut seen = HashSet::new();
        for token in &self.tokens {
            let name = format!("{token:?}");
            if !seen.insert(name) {
                return Err(AiSearchError::Invalid);
            }
        }
        if !matches!(self.locale.as_str(), "en" | "es") {
            return Err(AiSearchError::Invalid);
        }
        if !self.date.is_empty() && !valid_date(&self.date) {
            return Err(AiSearchError::Invalid);
        }
        if !self.month.is_empty() && !valid_month(&self.month) {
            return Err(AiSearchError::Invalid);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiNameSuggestion {
    pub source: AiInputRef,
    pub source_stamp: SourceStamp,
    pub proposed_stem: String,
    pub reason: String,
    pub confidence: f64,
    pub citations: Vec<AiCitation>,
}

impl AiNameSuggestion {
    pub fn validate(&self) -> AiSearchResult<()> {
        if self.source.id.is_nil() || self.source.expected_revision == 0 {
            return Err(AiSearchError::Invalid);
        }
        self.source_stamp.validate().map_err(|_| AiSearchError::Invalid)?;
        if self.proposed_stem.trim().is_empty()
            || self.proposed_stem.chars().count() > MAX_AI_NAME_STEM_SCALARS
            || self.proposed_stem.contains('\0')
        {
            return Err(AiSearchError::Invalid);
        }
        if self.reason.chars().count() > 512
            || !self.confidence.is_finite()
            || !(0.0..=1.0).contains(&self.confidence)
            || self.citations.len() > 8
        {
            return Err(AiSearchError::Invalid);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiSortSuggestion {
    pub id: String,
    pub identity: FileIdentityKey,
    pub source_stamp: SourceStamp,
    pub destination_id: String,
    pub score: f64,
    pub basis: String,
    pub reason: String,
    pub extension: String,
    pub expires_unix: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SortCount {
    pub extension: String,
    pub destination_id: String,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SortHistory {
    pub schema_version: u32,
    pub revision: u64,
    pub counts: Vec<SortCount>,
    pub disabled: Vec<String>,
}

impl Default for SortHistory {
    fn default() -> Self {
        Self {
            schema_version: 1,
            revision: 1,
            counts: Vec::new(),
            disabled: Vec::new(),
        }
    }
}

impl SortHistory {
    pub fn validate(&self) -> AiSearchResult<()> {
        if self.schema_version != 1 || !is_safe_u64(self.revision) || self.revision == 0 {
            return Err(AiSearchError::Invalid);
        }
        if self.counts.len() > MAX_SORT_COUNTS || self.disabled.len() > MAX_DISABLED_SORT_EXTENSIONS {
            return Err(AiSearchError::TooLarge);
        }
        let mut keys = HashSet::new();
        for row in &self.counts {
            if canonical_extension(&row.extension).as_deref() != Some(row.extension.as_str()) {
                return Err(AiSearchError::Invalid);
            }
            if !is_canonical_uuid(&row.destination_id)
                || row.count > 100_000
                || !keys.insert((row.extension.clone(), row.destination_id.clone()))
            {
                return Err(AiSearchError::Invalid);
            }
        }
        let mut disabled = HashSet::new();
        for extension in &self.disabled {
            if canonical_extension(extension).as_deref() != Some(extension.as_str())
                || !disabled.insert(extension.clone())
            {
                return Err(AiSearchError::Invalid);
            }
        }
        Ok(())
    }
}

pub fn is_canonical_uuid(value: &str) -> bool {
    match uuid::Uuid::parse_str(value) {
        Ok(parsed) => parsed.to_string() == value,
        Err(_) => false,
    }
}

pub fn is_safe_u64(value: u64) -> bool {
    value <= 9_007_199_254_740_991
}

pub fn is_ascii_bounded(value: &str, max: usize) -> bool {
    !value.is_empty() && value.len() <= max && value.bytes().all(|byte| byte.is_ascii_graphic() || byte == b' ')
}

pub fn is_ordinary_absolute_path(value: &str) -> bool {
    if value.is_empty() || value.encode_utf16().count() > 32_768 || value.contains('\0') {
        return false;
    }
    let path = std::path::Path::new(value);
    if !path.is_absolute() {
        return false;
    }
    if path
        .components()
        .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return false;
    }
    let text = value.replace('/', "\\");
    let drive = text.len() >= 3
        && text.as_bytes()[0].is_ascii_alphabetic()
        && text.as_bytes()[1] == b':'
        && text.as_bytes()[2] == b'\\';
    let unc = text.starts_with(r"\\") && text[2..].split('\\').filter(|part| !part.is_empty()).count() >= 2;
    drive || unc
}

pub fn canonical_extension(value: &str) -> Option<String> {
    let canonical = value.trim().trim_start_matches('.').to_lowercase();
    if canonical.is_empty()
        || canonical.len() > 32
        || !canonical
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'+' | b'-'))
    {
        return None;
    }
    Some(canonical)
}

fn normalized_path_key(value: &str) -> String {
    value.replace('/', "\\").trim_end_matches('\\').to_lowercase()
}

pub fn valid_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && bytes[5..7].iter().all(u8::is_ascii_digit)
        && bytes[8..].iter().all(u8::is_ascii_digit)
        && (1..=12).contains(&value[5..7].parse::<u8>().unwrap_or(0))
        && (1..=31).contains(&value[8..10].parse::<u8>().unwrap_or(0))
}

pub fn valid_month(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 7
        && bytes[4] == b'-'
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && bytes[5..].iter().all(u8::is_ascii_digit)
        && (1..=12).contains(&value[5..7].parse::<u8>().unwrap_or(0))
}

/// Re-check an interpreted query before it reaches 11a search. The model can
/// only produce the 11a AST; unknown fields, operators or modes fail.
pub fn validate_interpreted_query(query: &SearchQuery) -> AiSearchResult<()> {
    if query.mode != search_index::types::SearchMode::Filters {
        return Err(AiSearchError::Invalid);
    }
    if query.text.chars().count() > 1024
        || query.roots.len() > MAX_SEMANTIC_ROOTS
        || query.match_case
        || query.regex_scope != search_index::types::RegexScope::Name
    {
        return Err(AiSearchError::Invalid);
    }
    let mut roots = HashSet::new();
    for root in &query.roots {
        if !is_canonical_uuid(root) || !roots.insert(root.to_lowercase()) {
            return Err(AiSearchError::Invalid);
        }
    }
    if let Some(filter) = &query.filter {
        let mut clauses = 0;
        validate_filter(filter, 1, &mut clauses)?;
    }
    Ok(())
}

fn validate_filter(filter: &SearchFilter, depth: usize, clauses: &mut usize) -> AiSearchResult<()> {
    if depth > 4 {
        return Err(AiSearchError::Invalid);
    }
    *clauses += 1;
    if *clauses > 32 {
        return Err(AiSearchError::Invalid);
    }
    match filter {
        SearchFilter::All { clauses: children } | SearchFilter::Any { clauses: children } => {
            for child in children {
                validate_filter(child, depth + 1, clauses)?;
            }
        }
        SearchFilter::Not { clause } => validate_filter(clause, depth + 1, clauses)?,
        SearchFilter::String { value, .. } => {
            if value.chars().count() > 256 {
                return Err(AiSearchError::Invalid);
            }
        }
        SearchFilter::ExtList { values, .. } => {
            if values.len() > 256 {
                return Err(AiSearchError::Invalid);
            }
            let mut seen = HashSet::new();
            for value in values {
                let normalized = value.trim().trim_start_matches('.').to_ascii_lowercase();
                if normalized.is_empty()
                    || normalized.len() > 32
                    || !normalized
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
                    || !seen.insert(normalized)
                {
                    return Err(AiSearchError::Invalid);
                }
            }
        }
        SearchFilter::MissingDate { .. } => {}
        SearchFilter::Number { value, .. } => {
            if !value.is_finite() || *value < 0.0 {
                return Err(AiSearchError::Invalid);
            }
        }
        SearchFilter::Date { from_unix, to_unix, .. } => {
            if from_unix.is_some_and(|value| !is_safe_u64(value))
                || to_unix.is_some_and(|value| !is_safe_u64(value))
                || matches!((from_unix, to_unix), (Some(from), Some(to)) if from > to)
            {
                return Err(AiSearchError::Invalid);
            }
        }
        SearchFilter::Tags { tag_ids, .. } => {
            if tag_ids.len() > 100 {
                return Err(AiSearchError::Invalid);
            }
            let mut seen = HashSet::new();
            for id in tag_ids {
                if !is_canonical_uuid(id) || !seen.insert(id.to_lowercase()) {
                    return Err(AiSearchError::Invalid);
                }
            }
        }
    }
    Ok(())
}
