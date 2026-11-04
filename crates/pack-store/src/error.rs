//! Stable `packs.*` error codes. No user-visible text is built here; the UI
//! translates the code.

use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum PackError {
    #[error("packs.bad_request")]
    BadRequest,
    #[error("packs.bad_signature")]
    BadSignature,
    #[error("packs.bad_hash")]
    BadHash,
    #[error("packs.unsupported_schema")]
    UnsupportedSchema,
    #[error("packs.dependency_cycle")]
    DependencyCycle,
    #[error("packs.no_space")]
    NoSpace,
    #[error("packs.changed")]
    Changed,
    #[error("packs.unavailable")]
    Unavailable,
    #[error("packs.busy")]
    Busy,
    #[error("packs.cancelled")]
    Cancelled,
    #[error("packs.failed")]
    Failed,
    /// Reserved Office bridge capability without a signed protocol entrypoint.
    #[error("packs.capability_missing")]
    CapabilityMissing,
}

impl PackError {
    /// The exact code string returned over IPC.
    pub fn code(&self) -> &'static str {
        match self {
            PackError::BadRequest => "packs.bad_request",
            PackError::BadSignature => "packs.bad_signature",
            PackError::BadHash => "packs.bad_hash",
            PackError::UnsupportedSchema => "packs.unsupported_schema",
            PackError::DependencyCycle => "packs.dependency_cycle",
            PackError::NoSpace => "packs.no_space",
            PackError::Changed => "packs.changed",
            PackError::Unavailable => "packs.unavailable",
            PackError::Busy => "packs.busy",
            PackError::Cancelled => "packs.cancelled",
            PackError::Failed => "packs.failed",
            PackError::CapabilityMissing => "packs.capability_missing",
        }
    }
}

/// Map an I/O failure to the closest stable code without hiding the cause.
pub fn map_io(error: &std::io::Error) -> PackError {
    match error.kind() {
        std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::NotFound => {
            PackError::Unavailable
        }
        std::io::ErrorKind::AlreadyExists => PackError::Changed,
        _ => {
            // ERROR_DISK_FULL (Windows) and ENOSPC (Unix) both mean no space.
            #[cfg(windows)]
            if error.raw_os_error() == Some(112) {
                return PackError::NoSpace;
            }
            #[cfg(unix)]
            if error.raw_os_error() == Some(28) {
                return PackError::NoSpace;
            }
            PackError::Failed
        }
    }
}

pub type PackResult<T> = Result<T, PackError>;
