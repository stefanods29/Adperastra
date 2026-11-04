//! Stable error codes for privacy inspection and cleaning (Step 08c).
//!
//! Rust never returns display text; the UI translates
//! `errors.privacy.<reason>`.

use thiserror::Error;

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum PrivacyError {
    #[error("the privacy request is not valid")]
    BadRequest,
    #[error("this information cannot be removed safely here")]
    Unsupported,
    #[error("the source changed")]
    Changed,
    #[error("removal could not be verified")]
    Unverified,
    #[error("the file is too large")]
    TooLarge,
    #[error("there is not enough space")]
    NoSpace,
    #[error("the work was cancelled")]
    Cancelled,
    #[error("the file could not be read or written")]
    Failed,
    #[error("a version could not be kept")]
    VersionFailed,
}

impl PrivacyError {
    /// The exact stable code returned through IPC.
    pub fn code(self) -> &'static str {
        match self {
            PrivacyError::BadRequest => "privacy.bad_request",
            PrivacyError::Unsupported => "privacy.unsupported",
            PrivacyError::Changed => "privacy.changed",
            PrivacyError::Unverified => "privacy.unverified",
            PrivacyError::TooLarge => "privacy.too_large",
            PrivacyError::NoSpace => "privacy.no_space",
            PrivacyError::Cancelled => "privacy.cancelled",
            PrivacyError::Failed => "privacy.failed",
            PrivacyError::VersionFailed => "privacy.version_failed",
        }
    }
}

impl From<std::io::Error> for PrivacyError {
    fn from(error: std::io::Error) -> Self {
        // ERROR_DISK_FULL (112) and ERROR_HANDLE_DISK_FULL (39).
        match error.raw_os_error() {
            Some(39) | Some(112) => PrivacyError::NoSpace,
            _ if error.kind() == std::io::ErrorKind::WriteZero => PrivacyError::NoSpace,
            _ => PrivacyError::Failed,
        }
    }
}

impl From<lopdf::Error> for PrivacyError {
    fn from(_: lopdf::Error) -> Self {
        PrivacyError::Unsupported
    }
}
