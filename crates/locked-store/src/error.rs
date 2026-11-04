//! Stable locked-folder failures. Rust never returns display text; the UI
//! translates `code()` under `errors.locked.<reason>`.

use std::io;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LockedError {
    Invalid,
    Unsupported,
    UnsupportedKdf,
    BadPasswordOrCorrupt,
    Changed,
    TooLarge,
    NoSpace,
    Cancelled,
    Locked,
    LockPending,
    UnencryptedCopyRequired,
    RecoveryRequired,
    SaveCopyRequired,
    Io,
}

impl LockedError {
    pub fn code(self) -> &'static str {
        match self {
            LockedError::Invalid => "locked.invalid",
            LockedError::Unsupported => "locked.unsupported",
            LockedError::UnsupportedKdf => "locked.unsupported_kdf",
            LockedError::BadPasswordOrCorrupt => "locked.bad_password_or_corrupt",
            LockedError::Changed => "locked.changed",
            LockedError::TooLarge => "locked.too_large",
            LockedError::NoSpace => "locked.no_space",
            LockedError::Cancelled => "locked.cancelled",
            LockedError::Locked => "locked.locked",
            LockedError::LockPending => "locked.lock_pending",
            LockedError::UnencryptedCopyRequired => "locked.unencrypted_copy_required",
            LockedError::RecoveryRequired => "locked.recovery_required",
            LockedError::SaveCopyRequired => "locked.save_copy_required",
            LockedError::Io => "locked.io",
        }
    }
}

impl From<LockedError> for String {
    fn from(error: LockedError) -> Self {
        error.code().to_string()
    }
}

impl From<io::Error> for LockedError {
    fn from(error: io::Error) -> Self {
        match error.kind() {
            io::ErrorKind::StorageFull => LockedError::NoSpace,
            _ => match error.raw_os_error() {
                // ERROR_DISK_FULL / ERROR_HANDLE_DISK_FULL
                Some(39) | Some(112) => LockedError::NoSpace,
                _ => LockedError::Io,
            },
        }
    }
}

impl From<fs_service::owned_io::OwnedIoError> for LockedError {
    fn from(error: fs_service::owned_io::OwnedIoError) -> Self {
        use fs_service::owned_io::OwnedIoError;
        match error {
            OwnedIoError::SourceChanged => LockedError::Changed,
            OwnedIoError::TargetExists => LockedError::Changed,
            OwnedIoError::Io(io) => LockedError::from(io),
            OwnedIoError::ReparseRefused | OwnedIoError::InvalidName => LockedError::Invalid,
            OwnedIoError::StagingTaken | OwnedIoError::OutputChanged => LockedError::Changed,
        }
    }
}

pub type LockedResult<T> = Result<T, LockedError>;
