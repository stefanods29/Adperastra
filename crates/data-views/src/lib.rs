//! Pure table and JSON logic for the data viewers (Step 06f): text decoding,
//! CSV/TSV parsing, sorting and filtering, and the JSON tree. No Tauri types
//! here, so everything is testable without an app.

pub mod decode;
pub mod error;
pub mod limits;
pub mod table;

pub use decode::{decode_text, TextEncodingId};
pub use error::DataError;
pub use table::{detect_delimiter, first_row_is_header, parse_table, Table, TableLimits};
