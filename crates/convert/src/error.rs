//! Why one conversion could not produce a usable result (Step 08a).
//!
//! The UI never sees text from this crate: every variant maps to one stable
//! `convert.<reason>` code translated by `errors.convert.<reason>`.

use thiserror::Error;

/// One failure of the pure conversion layer. The native parent and the
/// helper process both map these to the same stable codes.
#[derive(Debug, Error)]
pub enum ConvertError {
    #[error("the conversion request is not valid")]
    BadRequest,
    #[error("this conversion is not supported")]
    Unsupported,
    #[error("the input or output exceeds the conversion limits")]
    TooLarge,
    #[error("the source changed")]
    Changed,
    #[error("the conversion was cancelled")]
    Cancelled,
    #[error("the requested metadata cannot be kept")]
    MetadataLoss,
    #[error("a required warning was not accepted")]
    WarningRequired,
    #[error("there is not enough free space")]
    NoSpace,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl ConvertError {
    /// The stable code the UI translates (`convert.bad_request`, ...).
    pub fn code(&self) -> &'static str {
        match self {
            ConvertError::BadRequest => "convert.bad_request",
            ConvertError::Unsupported => "convert.unsupported",
            ConvertError::TooLarge => "convert.too_large",
            ConvertError::Changed => "convert.changed",
            ConvertError::Cancelled => "convert.cancelled",
            ConvertError::MetadataLoss => "convert.metadata_loss",
            ConvertError::WarningRequired => "convert.warning_required",
            ConvertError::NoSpace => "convert.no_space",
            ConvertError::Io(_) => "convert.io",
        }
    }

    pub fn cancelled() -> Self {
        ConvertError::Cancelled
    }

    /// True when the parent should report the item as cancelled rather than
    /// failed; both still keep every already published output.
    pub fn is_cancelled(&self) -> bool {
        matches!(self, ConvertError::Cancelled)
    }
}

impl From<image::ImageError> for ConvertError {
    fn from(error: image::ImageError) -> Self {
        use image::ImageError;
        match error {
            ImageError::IoError(inner) => ConvertError::Io(inner),
            ImageError::Limits(_) => ConvertError::TooLarge,
            ImageError::Unsupported(_) => ConvertError::Unsupported,
            _ => ConvertError::Unsupported,
        }
    }
}

impl From<serde_json::Error> for ConvertError {
    fn from(_: serde_json::Error) -> Self {
        ConvertError::BadRequest
    }
}
