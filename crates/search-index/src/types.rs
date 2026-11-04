//! Canonical search DTOs (Step 11a). Field names are snake_case on both
//! sides; enum values are the literal strings in the guide.

use fs_service::owned_io::PinnedSource;
// Re-exported because native adapters and later search consumers construct
// these canonical types through `search_index::types`.
pub use fs_service::source_stamp::{FileIdentityKey, SourceStamp};
pub use fs_service::{ItemKind, SortDirection, SortKey, SortSpec};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use crate::limits::{
    content_chars_allowed, is_safe_u64, DB_LIMIT_MAX_MB, DB_LIMIT_MIN_MB, MAX_EXTRACTED_CHARS,
    MAX_EXTRACTED_METADATA, MAX_FILTER_CLAUSES, MAX_FILTER_DEPTH, MAX_QUERY_BYTES, MAX_ROOTS,
    MAX_ROOT_PATH_UNITS, MAX_SAVED_SEARCH_NAME_CHARS, MAX_TAG_IDS, MAX_TAG_UPDATE_IDS,
};
use crate::SearchError;

/// The four native query modes. `ask`, `photo` and `similar` are never
/// accepted here; 17c routes them through its own provider boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SearchMode {
    #[default]
    Name,
    Content,
    Filters,
    Regex,
}

impl SearchMode {
    pub fn label_key(self) -> &'static str {
        match self {
            SearchMode::Name => "search.name",
            SearchMode::Content => "search.content",
            SearchMode::Filters => "search.filters",
            SearchMode::Regex => "search.regex",
        }
    }
}

/// Which text a regex inspects.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum RegexScope {
    #[default]
    Name,
    Content,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StringField {
    Kind,
    Ext,
    Author,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StringOp {
    Eq,
    Contains,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NumberField {
    Size,
    Width,
    Height,
    DurationMs,
    Pages,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NumberOp {
    Eq,
    Gte,
    Lte,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DateField {
    Modified,
    Created,
    DateTaken,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TagMatch {
    All,
    Any,
}

/// The typed filter AST. The root is depth 1; at most 32 clauses and depth 4.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SearchFilter {
    All {
        clauses: Vec<SearchFilter>,
    },
    Any {
        clauses: Vec<SearchFilter>,
    },
    Not {
        clause: Box<SearchFilter>,
    },
    String {
        field: StringField,
        op: StringOp,
        value: String,
    },
    Number {
        field: NumberField,
        op: NumberOp,
        value: f64,
    },
    Date {
        field: DateField,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from_unix: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        to_unix: Option<u64>,
    },
    /// A fixed set of extensions, used by "By kind" and the photo map.
    ExtList {
        values: Vec<String>,
        exclude: bool,
    },
    /// Select rows whose chosen date is absent, rather than applying no date constraint.
    MissingDate {
        field: DateField,
    },
    Tags {
        tag_ids: Vec<String>,
        #[serde(rename = "match")]
        match_kind: TagMatch,
    },
}

impl SearchFilter {
    pub fn validate(&self) -> Result<(), SearchError> {
        let mut clauses = 0usize;
        validate_filter(self, 1, &mut clauses)
    }
}

#[allow(clippy::collapsible_if)]
fn validate_filter(
    filter: &SearchFilter,
    depth: usize,
    clauses: &mut usize,
) -> Result<(), SearchError> {
    if depth > MAX_FILTER_DEPTH {
        return Err(SearchError::Invalid);
    }
    *clauses += 1;
    if *clauses > MAX_FILTER_CLAUSES {
        return Err(SearchError::Invalid);
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
                return Err(SearchError::Invalid);
            }
        }
        SearchFilter::Number { value, .. } => {
            if !value.is_finite() || *value < 0.0 {
                return Err(SearchError::Invalid);
            }
        }
        SearchFilter::Date {
            from_unix, to_unix, ..
        } => {
            if let Some(from) = from_unix {
                if !is_safe_u64(*from) {
                    return Err(SearchError::Invalid);
                }
            }
            if let Some(to) = to_unix {
                if !is_safe_u64(*to) {
                    return Err(SearchError::Invalid);
                }
            }
            if let (Some(from), Some(to)) = (from_unix, to_unix) {
                if from > to {
                    return Err(SearchError::Invalid);
                }
            }
        }
        SearchFilter::ExtList { values, .. } => {
            if values.len() > 256 {
                return Err(SearchError::Invalid);
            }
            let mut seen = std::collections::HashSet::new();
            for value in values {
                let normalized = value.trim().trim_start_matches('.').to_ascii_lowercase();
                if normalized.is_empty()
                    || normalized.len() > 32
                    || !normalized
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
                    || !seen.insert(normalized)
                {
                    return Err(SearchError::Invalid);
                }
            }
        }
        SearchFilter::MissingDate { .. } => {}
        SearchFilter::Tags { tag_ids, .. } => {
            if tag_ids.len() > MAX_TAG_IDS {
                return Err(SearchError::Invalid);
            }
            let mut seen = std::collections::HashSet::new();
            for id in tag_ids {
                validate_uuid(id)?;
                if !seen.insert(id.to_lowercase()) {
                    return Err(SearchError::Invalid);
                }
            }
        }
    }
    Ok(())
}

/// One explicitly chosen indexed folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndexRoot {
    pub id: String,
    pub path: String,
    #[serde(default = "default_true")]
    pub filename: bool,
    #[serde(default)]
    pub content: bool,
    #[serde(default)]
    pub ocr: bool,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

impl IndexRoot {
    pub fn new(path: impl Into<String>) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            path: path.into(),
            filename: true,
            content: false,
            ocr: false,
            enabled: true,
        }
    }

    pub fn validate(&self) -> Result<(), SearchError> {
        validate_uuid(&self.id)?;
        validate_absolute_path(&self.path)?;
        Ok(())
    }
}

/// Settings schema 34's search section.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchSettings {
    #[serde(default)]
    pub roots: Vec<IndexRoot>,
    #[serde(default)]
    pub default_mode: SearchMode,
    #[serde(default = "default_index_limit_mb")]
    pub index_limit_mb: u32,
    #[serde(default = "default_content_max_chars")]
    pub content_max_chars: u32,
    #[serde(default)]
    pub usn_enabled: bool,
    #[serde(default)]
    pub excluded_paths: Vec<String>,
}

fn default_index_limit_mb() -> u32 {
    crate::limits::DB_LIMIT_DEFAULT_MB
}

fn default_content_max_chars() -> u32 {
    MAX_EXTRACTED_CHARS as u32
}

impl Default for SearchSettings {
    fn default() -> Self {
        Self {
            roots: Vec::new(),
            default_mode: SearchMode::Name,
            index_limit_mb: default_index_limit_mb(),
            content_max_chars: default_content_max_chars(),
            usn_enabled: false,
            excluded_paths: Vec::new(),
        }
    }
}

impl SearchSettings {
    pub fn validate(&self) -> Result<(), SearchError> {
        if self.roots.len() > MAX_ROOTS || self.excluded_paths.len() > 100 {
            return Err(SearchError::Invalid);
        }
        if !(DB_LIMIT_MIN_MB..=DB_LIMIT_MAX_MB).contains(&self.index_limit_mb) {
            return Err(SearchError::Invalid);
        }
        if !(1_000..=MAX_EXTRACTED_CHARS as u32).contains(&self.content_max_chars) {
            return Err(SearchError::Invalid);
        }
        // Two roots may name the same or overlapping folder; membership is
        // many-to-many, so a file is still stored once and removal of one
        // root leaves the other valid.
        for root in &self.roots {
            root.validate()?;
        }
        for path in &self.excluded_paths {
            validate_absolute_path(path)?;
        }
        Ok(())
    }

    pub fn enabled_roots(&self) -> Vec<IndexRoot> {
        self.roots
            .iter()
            .filter(|root| root.enabled && root.filename)
            .cloned()
            .collect()
    }
}

/// One search request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SearchQuery {
    pub mode: SearchMode,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub roots: Vec<String>,
    #[serde(default)]
    pub filter: Option<SearchFilter>,
    #[serde(default)]
    pub regex_scope: RegexScope,
    #[serde(default)]
    pub match_case: bool,
    /// Optional date-field ordering for indexed Timeline views.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort_date: Option<DateField>,
    #[serde(default)]
    pub sort: SortSpec,
}

impl Default for SearchQuery {
    fn default() -> Self {
        Self {
            mode: SearchMode::Name,
            text: String::new(),
            roots: Vec::new(),
            filter: None,
            regex_scope: RegexScope::Name,
            match_case: false,
            sort_date: None,
            sort: SortSpec::default(),
        }
    }
}

impl SearchQuery {
    pub fn validate(&self) -> Result<(), SearchError> {
        if self.text.len() > MAX_QUERY_BYTES {
            return Err(SearchError::TooLarge);
        }
        if self.roots.len() > MAX_ROOTS {
            return Err(SearchError::Invalid);
        }
        let mut seen = std::collections::HashSet::new();
        for root in &self.roots {
            validate_uuid(root)?;
            if !seen.insert(root.to_lowercase()) {
                return Err(SearchError::Invalid);
            }
        }
        if let Some(filter) = &self.filter {
            filter.validate()?;
        }
        Ok(())
    }

    /// Cursor identity: roots sorted, text trimmed, filter unchanged.
    pub fn captured(&self) -> SearchQuery {
        let mut captured = self.clone();
        captured.text = self.text.trim().to_string();
        captured.roots.sort_by_key(|root| root.to_lowercase());
        captured.roots.dedup_by_key(|root| root.to_lowercase());
        captured
    }

    pub fn is_empty(&self) -> bool {
        self.text.trim().is_empty()
    }
}

/// One row shown in the results view.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SearchResult {
    pub item: ExplorerItem,
    pub key: FileIdentityKey,
    pub found_by: SearchMode,
    #[serde(default)]
    pub snippet: Option<String>,
    #[serde(default)]
    pub content_truncated: bool,
    #[serde(default)]
    pub metadata_available: bool,
    /// Creation time for the indexed Timeline source; safe unix seconds.
    #[serde(default)]
    pub created_unix: u64,
    #[serde(default)]
    pub date_taken_unix: Option<u64>,
}

/// The existing Explorer item shape, mirrored with snake_case fields.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExplorerItem {
    pub path: String,
    pub name: String,
    pub kind: ItemKind,
    pub size: u64,
    pub modified_unix: u64,
    pub hidden: bool,
    pub system: bool,
    pub is_link: bool,
    pub online_only: bool,
    pub file_id: Option<String>,
    pub file_id_stable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SearchCoverage {
    Pending,
    #[default]
    Partial,
    Complete,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchPage {
    pub results: Vec<SearchResult>,
    #[serde(default)]
    pub next_cursor: Option<String>,
    /// Native-only scan position for the next page; never serialized.
    #[serde(skip)]
    pub next_offset: Option<usize>,
    pub generation: u64,
    pub total_estimate: u32,
    #[serde(default)]
    pub total_bytes: u64,
    pub total_exact: bool,
    pub complete: bool,
    pub coverage: SearchCoverage,
    pub skipped_count: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IndexStatus {
    pub generation: u64,
    pub files_count: u32,
    pub disk_bytes: u64,
    pub running: bool,
    pub paused: bool,
    pub coverage: SearchCoverage,
    pub skipped_count: u32,
    pub limit_reached: bool,
    #[serde(default)]
    pub reason_code: Option<String>,
}

impl Default for IndexStatus {
    fn default() -> Self {
        Self {
            generation: 1,
            files_count: 0,
            disk_bytes: 0,
            running: false,
            paused: false,
            coverage: SearchCoverage::Complete,
            skipped_count: 0,
            limit_reached: false,
            reason_code: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedSearch {
    pub id: String,
    pub name: String,
    pub query: SearchQuery,
    pub created_unix: u64,
    pub modified_unix: u64,
    #[serde(default = "default_saved_version")]
    pub version: u32,
}

fn default_saved_version() -> u32 {
    1
}

impl SavedSearch {
    pub fn validate(&self) -> Result<(), SearchError> {
        validate_uuid(&self.id)?;
        let name = self.name.trim();
        if name.is_empty()
            || name.chars().count() > MAX_SAVED_SEARCH_NAME_CHARS
            || name.chars().any(|character| character.is_control())
        {
            return Err(SearchError::Invalid);
        }
        if self.version != 1 || !is_safe_u64(self.created_unix) || !is_safe_u64(self.modified_unix)
        {
            return Err(SearchError::Invalid);
        }
        self.query.validate()
    }
}

/// One stored file row used by native tests and the scanner.
#[derive(Debug, Clone)]
pub struct ScannedFile {
    pub identity: FileIdentityKey,
    pub stamp: SourceStamp,
    pub path: PathBuf,
    pub name: String,
    pub extension: String,
    pub kind: ItemKind,
    pub size: u64,
    pub modified_unix: u64,
    pub created_unix: u64,
    pub date_taken_unix: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration_ms: Option<u64>,
    pub pages: Option<u32>,
    pub author: Option<String>,
    pub hidden: bool,
    pub system: bool,
    pub is_link: bool,
    pub online_only: bool,
}

impl ScannedFile {
    pub fn path_string(&self) -> String {
        self.path.to_string_lossy().to_string()
    }

    pub fn metadata_available(&self) -> bool {
        self.width.is_some()
            || self.height.is_some()
            || self.duration_ms.is_some()
            || self.pages.is_some()
            || self.author.is_some()
            || self.date_taken_unix.is_some()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtractionCoverage {
    Complete,
    Partial,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MetadataField {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExtractedText {
    pub text: String,
    pub truncated: bool,
    pub coverage: ExtractionCoverage,
    #[serde(default)]
    pub metadata: Vec<MetadataField>,
}

impl ExtractedText {
    pub fn validate(&self) -> Result<(), SearchError> {
        if self.text.chars().count() > MAX_EXTRACTED_CHARS
            || self.text.len() > crate::limits::MAX_EXTRACTED_BYTES
            || self.text.contains('\0')
            || self.metadata.len() > MAX_EXTRACTED_METADATA
        {
            return Err(SearchError::TooLarge);
        }
        for field in &self.metadata {
            if field.name.is_empty()
                || field.name.chars().count() > 128
                || field.value.chars().count() > 1024
                || field.name.contains('\0')
                || field.value.contains('\0')
            {
                return Err(SearchError::TooLarge);
            }
        }
        Ok(())
    }
}

/// What one extractor needs. The parent keeps the pinned source alive for the
/// whole helper read; extractors never reopen a path.
pub struct ExtractorRequest {
    pub path: PathBuf,
    pub stamp: SourceStamp,
    pub max_chars: u32,
    pub deadline: Instant,
    pub pinned: Arc<PinnedSource>,
}

impl ExtractorRequest {
    pub fn char_budget(&self) -> usize {
        content_chars_allowed(self.max_chars)
    }

    pub fn is_expired(&self) -> bool {
        Instant::now() >= self.deadline
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagSearchUpdate {
    pub key: FileIdentityKey,
    pub tag_ids: Vec<String>,
    #[serde(default)]
    pub deleted: bool,
    pub revision: u64,
}

impl TagSearchUpdate {
    pub fn validate(&self) -> Result<(), SearchError> {
        if self.tag_ids.len() > MAX_TAG_UPDATE_IDS || !is_safe_u64(self.revision) {
            return Err(SearchError::Invalid);
        }
        let mut seen = std::collections::HashSet::new();
        for id in &self.tag_ids {
            validate_uuid(id)?;
            if !seen.insert(id.to_lowercase()) {
                return Err(SearchError::Invalid);
            }
        }
        Ok(())
    }
}

pub fn validate_uuid(value: &str) -> Result<(), SearchError> {
    uuid::Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| SearchError::Invalid)
}

/// Absolute Windows folder path with no parent traversal.
pub fn validate_absolute_path(value: &str) -> Result<(), SearchError> {
    if value.trim().is_empty() || value.encode_utf16().count() > MAX_ROOT_PATH_UNITS {
        return Err(SearchError::Invalid);
    }
    let path = Path::new(value);
    if !path.is_absolute() {
        return Err(SearchError::Invalid);
    }
    if path
        .components()
        .any(|part| matches!(part, Component::ParentDir))
    {
        return Err(SearchError::Invalid);
    }
    Ok(())
}
