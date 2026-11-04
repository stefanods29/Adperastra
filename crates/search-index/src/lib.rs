//! Bounded local search index for Adperastra (Step 11a, revision
//! `search-index-1`).
//!
//! The crate owns the SQLite schema, root traversal, typed query evaluation,
//! regex scanning, watch routing and the content-extractor registry. Tauri
//! commands, settings and the UI live outside it. Nothing here accepts SQL,
//! runs a program, writes a user file or reads an online-only placeholder for
//! its content.

pub mod content_extractors;
pub mod filter;
pub mod index_watch;
pub mod limits;
pub mod paging;
pub mod query;
pub mod regex_scan;
pub mod scan;
pub mod search_tags;
pub mod store;
pub mod types;
pub mod usn_records;

pub use types::*;

/// Why a search or index request stopped. Commands expose `code()` verbatim;
/// the UI translates `errors.search.<reason>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SearchError {
    /// The query, filter or root set is not valid.
    Invalid,
    /// The regular expression is unsupported or too expensive.
    Regex,
    /// The request or one of its bounds is too large.
    TooLarge,
    /// The index generation or source identity changed.
    Changed,
    /// The index cannot be opened or is not ready.
    Unavailable,
    /// The record or physical storage limit was reached.
    IndexLimit,
    /// The request was not allowed (roots, helper, sensitive source).
    Denied,
    /// Any other failure.
    Failed,
}

impl SearchError {
    pub fn code(self) -> &'static str {
        match self {
            SearchError::Invalid => "search.invalid",
            SearchError::Regex => "search.regex",
            SearchError::TooLarge => "search.too_large",
            SearchError::Changed => "search.changed",
            SearchError::Unavailable => "search.unavailable",
            SearchError::IndexLimit => "search.index_limit",
            SearchError::Denied => "search.denied",
            SearchError::Failed => "search.failed",
        }
    }
}

impl std::fmt::Display for SearchError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.code())
    }
}

impl std::error::Error for SearchError {}

pub type SearchOutcome<T> = Result<T, SearchError>;
