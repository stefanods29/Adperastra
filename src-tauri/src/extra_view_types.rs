//! Wire types for the read-only extra viewers (Step 07f, interface
//! `extra-viewers-1`): e-books, notebooks, email, subtitles, logs and SQLite.
//!
//! These are the single canonical Rust definitions consumed by
//! `src/services/extraViews.ts` and by every handler of this step. The pure
//! parser types live in the `data-views` crate and are re-exported here; no
//! type is copied. Nothing here executes file content: every field is data
//! that the UI displays or a lease that it owns.

#![allow(dead_code)] // shared limits/wire fields are also used by later steps.

use std::path::Path;

use cache_store::CacheLease;
use fs_service::SourceStamp;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[allow(unused_imports)] // Re-exported for later consumers of the extra-view contract.
pub use data_views::log::{LogLevel, LogRecord};
#[allow(unused_imports)] // Re-exported for later consumers of the extra-view contract.
pub use data_views::mail::{EmailAddress, EmailAttachment, EmailSummary};
#[allow(unused_imports)] // Re-exported for later consumers of the extra-view contract.
pub use data_views::sqlite::{SqliteCell, SqliteColumn, SqliteRow, SqliteTableInfo};
pub use data_views::subtitle::SubtitleCue;

use data_views::notebook::{NotebookCellKind, NotebookOutputKind};

/// The formats this step renders inside the app.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtraViewKind {
    Book,
    Notebook,
    Email,
    Subtitle,
    Log,
    Sqlite,
}

impl ExtraViewKind {
    /// The extension list of the handler of this kind.
    pub fn extensions(self) -> &'static [&'static str] {
        match self {
            ExtraViewKind::Book => &["epub", "mobi", "azw3"],
            ExtraViewKind::Notebook => &["ipynb"],
            ExtraViewKind::Email => &["eml"],
            ExtraViewKind::Subtitle => &["srt", "vtt"],
            ExtraViewKind::Log => &["log"],
            ExtraViewKind::Sqlite => &["sqlite", "sqlite3", "db"],
        }
    }

    /// `.db` is claimed only when the bytes say SQLite; every other extension
    /// is claimed by name but its content must still be validated by the
    /// parser before anything is shown (T7, R-OPEN-2).
    pub fn requires_content_for(self, extension: &str) -> bool {
        matches!((self, extension), (ExtraViewKind::Sqlite, "db"))
    }

    /// The help page of the handler of this kind.
    pub fn help_slug(self) -> &'static str {
        match self {
            ExtraViewKind::Book => "reading-e-books",
            ExtraViewKind::Notebook => "viewing-notebooks",
            ExtraViewKind::Email => "viewing-email",
            ExtraViewKind::Subtitle => "viewing-subtitles",
            ExtraViewKind::Log => "viewing-logs",
            ExtraViewKind::Sqlite => "viewing-sqlite",
        }
    }
}

/// The largest source each viewer accepts (D4, format table).
pub const MAX_BOOK_SOURCE_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_NOTEBOOK_SOURCE_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_EMAIL_SOURCE_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_SUBTITLE_SOURCE_BYTES: u64 = 32 * 1024 * 1024;
/// Logs are read by ranges, so the source may be very large.
pub const MAX_LOG_SOURCE_BYTES: u64 = 1024 * 1024 * 1024 * 1024;
pub const MAX_SQLITE_SOURCE_BYTES: u64 = 4 * 1024 * 1024 * 1024;

/// Page and chunk bounds (D5).
pub const MAX_PAGE_BYTES: usize = 768 * 1024;
pub const MAX_PAGE_RECORDS: usize = 256;
pub const MAX_TEXT_CHUNK_CHARS: usize = 64 * 1024;
pub const MAX_HTML_CHARS: usize = 256 * 1024;
pub const MAX_LIVE_CURSORS: u32 = 64;

/// Session bounds (D4).
pub const MAX_NATIVE_SESSIONS: usize = 8;
pub const MAX_BOOK_SESSIONS: usize = 2;
pub const MAX_ATTACHMENTS_PER_MESSAGE: u32 = 1_000;
pub const MAX_EMAIL_ADDRESSES: usize = 100;

/// E-book bounds (format table and D3).
pub const MAX_EPUB_ENTRIES: usize = 50_000;
pub const MAX_EPUB_TOTAL_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_EPUB_RATIO: u64 = 500;
pub const MAX_EPUB_DEPTH: usize = 64;
pub const MAX_EPUB_PATH_CHARS: usize = 1_024;
pub const MAX_BOOK_SECTION_BYTES: u64 = 4 * 1024 * 1024;
pub const MAX_BOOK_PAGE_SCALARS: usize = 4_000;
pub const MAX_BOOK_PAGE_BLOCKS: usize = 24;
pub const MAX_BOOK_CONTENTS_ITEMS: usize = 5_000;
pub const MAX_BOOK_SECTIONS: usize = 5_000;
pub const MAX_BOOK_CONTENTS_DEPTH: usize = 32;
pub const MAX_BOOK_RESOURCES: usize = 32;
pub const MAX_BOOK_IMAGE_ENCODED_BYTES: u64 = 4 * 1024 * 1024;
pub const MAX_BOOK_IMAGE_DECODED_BYTES: u64 = 16 * 1024 * 1024;

/// Notebook bounds (format table).
pub const MAX_NOTEBOOK_CELLS: usize = 5_000;
pub const MAX_NOTEBOOK_OUTPUTS_PER_CELL: usize = 64;
pub const MAX_NOTEBOOK_OUTPUT_BYTES: u64 = 32 * 1024 * 1024;

/// Email bounds (format table).
pub const MAX_EMAIL_PARTS: usize = 1_000;
pub const MAX_EMAIL_DEPTH: usize = 32;

/// Subtitle bounds (format table).
pub const MAX_SUBTITLE_CUES: usize = 200_000;

/// Log bounds (format table).
pub const MAX_LOG_INITIAL_BYTES: u64 = 1024 * 1024;
pub const MAX_LOG_LINES_PER_BLOCK: usize = 1_000;
pub const MAX_LOG_LINE_CHARS: usize = 64 * 1024;
pub const MAX_ANSI_ESCAPE_CHARS: usize = 4 * 1024;

/// SQLite bounds (format table).
pub const MAX_SQLITE_SCHEMA_OBJECTS: usize = 1_000;
pub const MAX_SQLITE_COLUMNS: usize = 2_000;
pub const MAX_SQLITE_ROWS_PER_PAGE: usize = 256;
pub const MAX_SQLITE_STEP_MILLIS: u64 = 2_000;
pub const MAX_SQLITE_VM_INSTRUCTIONS: i32 = 100_000;

/// One opened extra view. No parser object, helper handle or live source
/// handle crosses this wire type.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtraViewSession {
    pub session_id: String,
    pub source: SourceStamp,
    pub kind: ExtraViewKind,
    pub title: String,
    pub item_count: u32,
    pub partial: bool,
}

/// One entry of an e-book's table of contents.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookContentsItem {
    pub id: String,
    pub label: String,
    pub section: u32,
    pub children: Vec<BookContentsItem>,
}

/// One book page. `html` is sanitized in the parser helper and sanitized
/// again before display (R-SEC-4); `resource_refs` keeps every image lease
/// alive while the page is shown.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookPage {
    pub section: u32,
    pub page: u32,
    pub page_count: u32,
    pub html: String,
    pub resource_refs: Vec<CacheLease>,
    pub contents: Vec<BookContentsItem>,
    pub direction: BookDirection,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BookDirection {
    Ltr,
    Rtl,
}

/// One page of the e-book table of contents (E7).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookContentsPage {
    pub items: Vec<BookContentsItem>,
    pub next_cursor: Option<String>,
    pub complete: bool,
}

/// One notebook cell chunk. `next_source_offset` is set when the source was
/// longer than one bounded chunk; the UI says so instead of hiding text.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotebookCell {
    pub index: u32,
    pub kind: NotebookCellKind,
    pub source: String,
    pub language: String,
    pub outputs: Vec<NotebookOutput>,
    pub next_source_offset: Option<u32>,
}

/// One saved notebook output. It is inert data: no callback, URL script or
/// widget state exists here.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotebookOutput {
    pub kind: NotebookOutputKind,
    pub text: Option<String>,
    pub image: Option<CacheLease>,
    pub html: Option<String>,
}

/// One page of the read-only notebook.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ExtraViewPayload {
    Book {
        page: BookPage,
    },
    Notebook {
        cells: Vec<NotebookCell>,
    },
    Email {
        message: Option<EmailSummary>,
        attachments: Vec<EmailAttachment>,
    },
    Subtitle {
        cues: Vec<SubtitleCue>,
    },
    Log {
        lines: Vec<LogRecord>,
    },
    Sqlite {
        table: SqliteTableInfo,
        rows: Vec<SqliteRow>,
    },
}

/// One bounded page of any extra viewer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtraViewPage {
    pub session_id: String,
    pub kind: ExtraViewKind,
    pub payload: ExtraViewPayload,
    pub next_cursor: Option<String>,
    pub complete: bool,
    pub partial: bool,
}

/// What the UI asks for next. Arguments that do not belong to the session's
/// kind are refused instead of being ignored.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ExtraPageRequest {
    pub session_id: String,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub table: Option<String>,
    #[serde(default)]
    pub section: Option<u32>,
    #[serde(default)]
    pub page: Option<u32>,
    #[serde(default)]
    pub sort_column: Option<u32>,
    #[serde(default)]
    pub sort_direction: Option<SortDirectionWire>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortDirectionWire {
    Asc,
    Desc,
}

/// Validate a kind string received from the UI.
pub fn parse_kind(value: &str) -> Result<ExtraViewKind, String> {
    match value {
        "book" => Ok(ExtraViewKind::Book),
        "notebook" => Ok(ExtraViewKind::Notebook),
        "email" => Ok(ExtraViewKind::Email),
        "subtitle" => Ok(ExtraViewKind::Subtitle),
        "log" => Ok(ExtraViewKind::Log),
        "sqlite" => Ok(ExtraViewKind::Sqlite),
        _ => Err("extra_view.bad_request".to_string()),
    }
}

/// Session and cursor ids are UUID strings, never arbitrary text.
pub fn parse_session_id(value: &str) -> Result<Uuid, String> {
    Uuid::parse_str(value).map_err(|_| "extra_view.bad_request".to_string())
}

pub fn parse_cursor(value: Option<&str>) -> Result<Option<Uuid>, String> {
    match value {
        None | Some("") => Ok(None),
        Some(text) => Uuid::parse_str(text)
            .map(Some)
            .map_err(|_| "extra_view.bad_request".to_string()),
    }
}

/// The source size each kind accepts, checked before a parser starts.
pub fn source_limit(kind: ExtraViewKind) -> u64 {
    match kind {
        ExtraViewKind::Book => MAX_BOOK_SOURCE_BYTES,
        ExtraViewKind::Notebook => MAX_NOTEBOOK_SOURCE_BYTES,
        ExtraViewKind::Email => MAX_EMAIL_SOURCE_BYTES,
        ExtraViewKind::Subtitle => MAX_SUBTITLE_SOURCE_BYTES,
        ExtraViewKind::Log => MAX_LOG_SOURCE_BYTES,
        ExtraViewKind::Sqlite => MAX_SQLITE_SOURCE_BYTES,
    }
}

/// Check one request before it reaches a live session. Book-only and
/// SQLite-only fields are refused for the other kinds (D5).
pub fn validate_page_request(
    request: &ExtraPageRequest,
    kind: ExtraViewKind,
) -> Result<(), String> {
    parse_session_id(&request.session_id)?;
    parse_cursor(request.cursor.as_deref())?;
    let asks_table = request.table.is_some()
        || request.sort_column.is_some()
        || request.sort_direction.is_some();
    if asks_table && kind != ExtraViewKind::Sqlite {
        return Err("extra_view.bad_request".to_string());
    }
    let asks_section = request.section.is_some() || request.page.is_some();
    if asks_section && kind != ExtraViewKind::Book {
        return Err("extra_view.bad_request".to_string());
    }
    Ok(())
}

/// One page never exceeds the shared JSON budget (P-10).
pub fn page_within_budget(page: &ExtraViewPage) -> Result<(), String> {
    let size = serde_json::to_vec(page)
        .map_err(|_| "extra_view.unavailable".to_string())?
        .len();
    if size > MAX_PAGE_BYTES {
        return Err("extra_view.too_large".to_string());
    }
    Ok(())
}

/// True when a path is a file this kind may open by name. Content validation
/// still happens in the parser (the `.db` case especially).
pub fn extension_matches(kind: ExtraViewKind, path: &Path) -> bool {
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    kind.extensions().contains(&extension.as_str())
}

/// Copy the first `MAX_BOOK_PAGE_SCALARS` scalars of a text, and the rest as
/// a continuation. Kept here so both the helper and native tests agree on the
/// exact scalar boundary; whitespace preference is applied by `bookPages.ts`
/// before calling this fallback.
pub fn split_scalars(text: &str, max: usize) -> (String, String) {
    let mut cut = text.len();
    for (count, (index, _character)) in text.char_indices().enumerate() {
        if count >= max {
            cut = index;
            break;
        }
    }
    (text[..cut].to_string(), text[cut..].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_kind_is_refused() {
        assert_eq!(
            parse_kind("video"),
            Err("extra_view.bad_request".to_string())
        );
        assert_eq!(parse_kind("sqlite"), Ok(ExtraViewKind::Sqlite));
    }

    #[test]
    fn only_book_accepts_section_and_page() {
        let request = ExtraPageRequest {
            session_id: Uuid::new_v4().to_string(),
            section: Some(1),
            ..ExtraPageRequest::default()
        };
        assert_eq!(
            validate_page_request(&request, ExtraViewKind::Notebook),
            Err("extra_view.bad_request".to_string())
        );
        assert_eq!(validate_page_request(&request, ExtraViewKind::Book), Ok(()));
    }

    #[test]
    fn cursor_must_be_a_uuid() {
        assert_eq!(
            parse_cursor(Some("../x")),
            Err("extra_view.bad_request".to_string())
        );
        assert!(parse_cursor(Some(&Uuid::new_v4().to_string())).is_ok());
        assert_eq!(parse_cursor(None), Ok(None));
    }

    #[test]
    fn scalar_split_keeps_surrogate_pairs_whole() {
        let input = "aé😀b";
        let (head, tail) = split_scalars(input, 3);
        assert_eq!(head, "aé😀");
        assert_eq!(tail, "b");
    }

    #[test]
    fn db_requires_content_but_sqlite_extension_does_not() {
        assert!(ExtraViewKind::Sqlite.requires_content_for("db"));
        assert!(!ExtraViewKind::Sqlite.requires_content_for("sqlite"));
    }
}
