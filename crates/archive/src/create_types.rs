//! Creating archives (Step 06e D3, D7, D9): the format and password choices,
//! their limits and the spool report. Passwords are never printed.

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::error::ArchiveError;
use crate::plan::SkippedEntry;

/// The most selected roots one creation may have.
pub const MAX_CREATE_SOURCES: usize = 1_000;
/// The most UTF-8 bytes all root paths may take together.
pub const MAX_CREATE_PATH_BYTES: usize = 262_144;
/// The most archive-relative name text one plan may hold.
pub const MAX_CREATE_MANIFEST_BYTES: u64 = 33_554_432;
/// The largest archive one creation may write (8 GiB).
pub const MAX_CREATE_OUTPUT_BYTES: u64 = 8_589_934_592;
/// The largest total of source bytes one creation may read (1 TiB).
pub const MAX_CREATE_TOTAL_BYTES: u64 = 1_099_511_627_776;
/// The password limits from D9.
pub const MAX_PASSWORD_CHARS: usize = 256;
pub const MAX_PASSWORD_BYTES: usize = 1_024;
pub const MAX_REMEMBERED_PASSWORDS: usize = 8;

/// The formats creation offers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CreateFormat {
    Zip,
    SevenZ,
}

/// How the new archive protects its data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CreateEncryption {
    None,
    Aes256,
    ZipCrypto,
}

/// Everything the writer needs to know.
#[derive(Clone, Serialize, Deserialize)]
pub struct CreateOptions {
    pub format: CreateFormat,
    pub encryption: CreateEncryption,
    pub password: Option<String>,
    pub encrypt_names: bool,
    pub include_hidden: bool,
}

impl fmt::Debug for CreateOptions {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CreateOptions")
            .field("format", &self.format)
            .field("encryption", &self.encryption)
            .field("password", &self.password.as_ref().map(|_| "<redacted>"))
            .field("encrypt_names", &self.encrypt_names)
            .field("include_hidden", &self.include_hidden)
            .finish()
    }
}

impl CreateOptions {
    /// Every combination the dialog may offer; anything else is refused
    /// before a spool or a job exists.
    pub fn validate(&self) -> Result<(), ArchiveError> {
        if self.encrypt_names
            && (self.format != CreateFormat::SevenZ || self.encryption == CreateEncryption::None)
        {
            return Err(ArchiveError::BadRequest);
        }
        if self.encryption == CreateEncryption::ZipCrypto && self.format != CreateFormat::Zip {
            return Err(ArchiveError::BadRequest);
        }
        if self.encryption != CreateEncryption::None && self.format == CreateFormat::Zip {
            // ZIP offers AES and ZipCrypto only, both with a password.
            if !matches!(
                self.encryption,
                CreateEncryption::Aes256 | CreateEncryption::ZipCrypto
            ) {
                return Err(ArchiveError::BadRequest);
            }
        }
        match self.encryption {
            CreateEncryption::None => {
                if self.password.is_some() || self.encrypt_names {
                    return Err(ArchiveError::BadRequest);
                }
            }
            CreateEncryption::Aes256 | CreateEncryption::ZipCrypto => {
                let Some(password) = &self.password else {
                    return Err(ArchiveError::InvalidPassword);
                };
                validate_password(password)?;
            }
        }
        Ok(())
    }
}

/// D9: 1 to 256 Unicode scalar values, at most 1,024 UTF-8 bytes, and no
/// control characters or line breaks. The exact string is kept.
pub fn validate_password(password: &str) -> Result<(), ArchiveError> {
    let characters = password.chars().count();
    if characters == 0 || characters > MAX_PASSWORD_CHARS || password.len() > MAX_PASSWORD_BYTES {
        return Err(ArchiveError::InvalidPassword);
    }
    if password.chars().any(|character| character.is_control()) {
        return Err(ArchiveError::InvalidPassword);
    }
    Ok(())
}

/// What the helper produced in its app-owned spool (Step 06e D6).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CreateSpoolReport {
    pub files_written: u64,
    pub folders_written: u64,
    pub source_bytes: u64,
    pub archive_size: u64,
    pub skipped: Vec<SkippedEntry>,
    pub skipped_more: u64,
    pub cancelled: bool,
    /// The spool's exact size, checked by the parent.
    pub size: u64,
    /// 64 lower-case hex characters of BLAKE3 over the spool.
    pub blake3: String,
}

/// The bounds one plan obeys. Tests inject smaller numbers; no test ever
/// allocates a default-limit fixture.
#[derive(Debug, Clone)]
pub struct CreateLimits {
    pub max_sources: usize,
    pub max_root_path_bytes: usize,
    pub max_entries: usize,
    pub max_manifest_bytes: u64,
    pub max_depth: usize,
    pub max_inner_path_chars: usize,
    pub max_total_bytes: u64,
    pub max_output_bytes: u64,
}

impl Default for CreateLimits {
    fn default() -> Self {
        Self {
            max_sources: MAX_CREATE_SOURCES,
            max_root_path_bytes: MAX_CREATE_PATH_BYTES,
            max_entries: 200_000,
            max_manifest_bytes: MAX_CREATE_MANIFEST_BYTES,
            max_depth: 64,
            max_inner_path_chars: 1_024,
            max_total_bytes: MAX_CREATE_TOTAL_BYTES,
            max_output_bytes: MAX_CREATE_OUTPUT_BYTES,
        }
    }
}
