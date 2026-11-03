//! Pure table, JSON and extra-viewer logic (Steps 06f/07f): text decoding,
//! CSV/TSV parsing, sorting and filtering, the JSON tree, and bounded
//! notebook, email, subtitle, log and SQLite readers. No Tauri types here, so
//! everything is testable without an app.

pub mod ansi;
pub mod decode;
pub mod error;
pub mod json;
pub mod limits;
pub mod log;
pub mod mail;
pub mod markup;
pub mod notebook;
pub mod sqlite;
pub mod subtitle;
pub mod table;
pub mod table_view;
pub mod viewer_error;

pub use decode::{decode_text, TextEncodingId};
pub use error::DataError;
pub use json::{JsonDoc, JsonKind, JsonMatch, JsonNodeInfo};
pub use log::{LogLevel, LogRecord};
pub use mail::{EmailAddress, EmailAttachment, EmailSummary};
pub use notebook::{NotebookCellKind, NotebookDoc, NotebookOutputKind};
pub use sqlite::{SqliteCell, SqliteColumn, SqliteRow, SqliteTableInfo};
pub use subtitle::SubtitleCue;
pub use table::{detect_delimiter, first_row_is_header, parse_table, Table, TableLimits};
pub use table_view::{build_order, page_rows, SortDirection, TableViewRequest};
pub use viewer_error::ViewerError;
