//! What can go wrong while a table or a JSON file is read. The code is what
//! the UI translates; it never carries file text.

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DataError {
    /// The file or the tree is over its limit.
    TooLarge,
    /// The JSON nests deeper than serde_json allows.
    TooDeep,
    /// The JSON is not valid, at this 1-based line and column.
    Invalid { line: u64, column: u64 },
    /// The work was cancelled by the user.
    Cancelled,
    /// The file could not be read.
    Io,
}

impl DataError {
    pub fn code(&self) -> &'static str {
        match self {
            DataError::TooLarge => "data.too_large",
            DataError::TooDeep => "data.too_deep",
            DataError::Invalid { .. } => "data.invalid",
            DataError::Cancelled => "data.cancelled",
            DataError::Io => "data.read_failed",
        }
    }
}

impl fmt::Display for DataError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code())
    }
}

impl std::error::Error for DataError {}

impl From<std::io::Error> for DataError {
    fn from(_: std::io::Error) -> Self {
        DataError::Io
    }
}
