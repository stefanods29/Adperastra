//! Errors of the extra viewers (Step 07f). The code is translated by the UI;
//! it never carries file text, a path or a parser message (R-LANG-7).

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ViewerError {
    /// The request or the file's structure is not valid for this viewer.
    BadRequest,
    /// The format or a document feature is not supported safely.
    Unsupported,
    /// The source, a cell, an output or a page exceeds its limit.
    TooLarge,
    /// The source changed after the session opened it.
    Changed,
    /// The bytes are malformed.
    Corrupt,
    /// Viewing would write or needs a write-side change (WAL, editing).
    ReadOnly,
    /// The viewer/helper is not available.
    Unavailable,
    /// The user cancelled the work.
    Cancelled,
}

impl ViewerError {
    pub fn code(&self) -> &'static str {
        match self {
            ViewerError::BadRequest => "extra_view.bad_request",
            ViewerError::Unsupported => "extra_view.unsupported",
            ViewerError::TooLarge => "extra_view.too_large",
            ViewerError::Changed => "extra_view.changed",
            ViewerError::Corrupt => "extra_view.corrupt",
            ViewerError::ReadOnly => "extra_view.read_only",
            ViewerError::Unavailable => "extra_view.unavailable",
            ViewerError::Cancelled => "extra_view.unavailable",
        }
    }
}

impl fmt::Display for ViewerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code())
    }
}

impl std::error::Error for ViewerError {}

impl From<std::io::Error> for ViewerError {
    fn from(_: std::io::Error) -> Self {
        ViewerError::Unavailable
    }
}
