//! What an archive read may need besides its path (Step 06e D9, D11). The
//! password travels in memory only; the Debug form never prints it.

use std::fmt;
use std::path::PathBuf;

/// Options for one listing or extraction. Old callers use the defaults.
#[derive(Clone, Default)]
pub struct ArchiveReadOptions {
    /// The exact password bytes, when the user supplied one.
    pub password: Option<String>,
    /// The separately installed 7-Zip used for RAR. Never set from the UI.
    pub seven_zip: Option<PathBuf>,
}

impl fmt::Debug for ArchiveReadOptions {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ArchiveReadOptions")
            .field("password", &self.password.as_ref().map(|_| "<redacted>"))
            .field("seven_zip", &self.seven_zip)
            .finish()
    }
}

impl ArchiveReadOptions {
    pub fn with_password(password: Option<String>) -> Self {
        Self {
            password,
            seven_zip: None,
        }
    }
}
