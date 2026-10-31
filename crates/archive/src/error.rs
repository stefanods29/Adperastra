//! Archive errors (Step 06d). Every failure is one variant, and `code()`
//! gives the stable `archive.<reason>` string the UI translates
//! (plan/rules.md, error codes in plan/conventions.md 3.1).

use thiserror::Error;

/// Everything that can go wrong while reading, browsing or extracting an
/// archive. `code()` is what leaves the crate; the words live in the
/// translation files under `errors.archive.<reason>`.
#[derive(Debug, Error)]
pub enum ArchiveError {
    #[error("the archive was not found")]
    NotFound,
    #[error("this kind of archive is not supported")]
    Unsupported,
    #[error("the archive is damaged")]
    Corrupt,
    #[error("the archive needs a password")]
    PasswordRequired,
    #[error("the archive holds too many entries")]
    TooManyEntries,
    #[error("the archive would expand too far")]
    Bomb,
    #[error("there is not enough free space")]
    NoSpace,
    #[error("the archive changed since it was opened")]
    Changed,
    #[error("the work was cancelled")]
    Cancelled,
    #[error("the request is not valid")]
    BadRequest,
    #[error("only files can be opened")]
    NotAFile,
    #[error("the destination folder is missing")]
    DestMissing,
    #[error("access denied")]
    AccessDenied,
    #[error("io error: {0}")]
    Io(std::io::Error),
}

impl ArchiveError {
    /// The stable code the UI turns into `errors.<code>`.
    pub fn code(&self) -> &'static str {
        match self {
            ArchiveError::NotFound => "archive.not_found",
            ArchiveError::Unsupported => "archive.unsupported",
            ArchiveError::Corrupt => "archive.corrupt",
            ArchiveError::PasswordRequired => "archive.password_required",
            ArchiveError::TooManyEntries => "archive.too_many_entries",
            ArchiveError::Bomb => "archive.bomb",
            ArchiveError::NoSpace => "archive.no_space",
            ArchiveError::Changed => "archive.changed",
            ArchiveError::Cancelled => "archive.cancelled",
            ArchiveError::BadRequest => "archive.bad_request",
            ArchiveError::NotAFile => "archive.not_a_file",
            ArchiveError::DestMissing => "archive.dest_missing",
            ArchiveError::AccessDenied => "archive.access_denied",
            ArchiveError::Io(_) => "archive.other",
        }
    }
}

impl From<std::io::Error> for ArchiveError {
    fn from(error: std::io::Error) -> Self {
        match error.kind() {
            std::io::ErrorKind::NotFound => ArchiveError::NotFound,
            std::io::ErrorKind::PermissionDenied => ArchiveError::AccessDenied,
            _ => ArchiveError::Io(error),
        }
    }
}
