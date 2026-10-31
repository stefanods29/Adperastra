//! Pure table and JSON logic for the data viewers (Step 06f): text decoding,
//! CSV/TSV parsing, sorting and filtering, and the JSON tree. No Tauri types
//! here, so everything is testable without an app.

pub mod decode;
pub mod error;
pub mod limits;

pub use decode::{decode_text, TextEncodingId};
pub use error::DataError;
