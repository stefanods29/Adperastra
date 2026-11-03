//! Why the preview cache refused to do something (Step 07a, E2).
//!
//! These are internal codes, never user text: each caller maps a variant to
//! its own `errors.<area>.<reason>` code (plan/rules.md R-LANG-7).

use std::fmt;

/// One cache failure. `BadRequest` and `TooLarge` describe the caller's
/// input; `Unavailable` describes the store; `Busy` means the budget or a
/// live lease refused admission; `Changed` means the source moved on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CacheError {
    BadRequest,
    Unavailable,
    TooLarge,
    Busy,
    Changed,
}

impl fmt::Display for CacheError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            CacheError::BadRequest => "cache request is not valid",
            CacheError::Unavailable => "cache is not available",
            CacheError::TooLarge => "cache result is too large",
            CacheError::Busy => "cache budget or a lease refused admission",
            CacheError::Changed => "source changed",
        })
    }
}

impl std::error::Error for CacheError {}

impl From<rusqlite::Error> for CacheError {
    fn from(_: rusqlite::Error) -> Self {
        CacheError::Unavailable
    }
}

impl From<std::io::Error> for CacheError {
    fn from(_: std::io::Error) -> Self {
        CacheError::Unavailable
    }
}

impl From<fs_service::owned_io::OwnedIoError> for CacheError {
    fn from(error: fs_service::owned_io::OwnedIoError) -> Self {
        use fs_service::owned_io::OwnedIoError;
        match error {
            OwnedIoError::SourceChanged => CacheError::Changed,
            OwnedIoError::InvalidName | OwnedIoError::StagingTaken => CacheError::BadRequest,
            OwnedIoError::TargetExists => CacheError::Busy,
            _ => CacheError::Unavailable,
        }
    }
}
