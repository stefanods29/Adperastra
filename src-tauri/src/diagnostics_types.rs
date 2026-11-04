//! Wire types and bounds for local diagnostic sessions (Step 09h,
//! interface revision `diagnostics-1`). A session is a reviewed set of
//! app-owned synthetic files; it is never uploaded and never contains a
//! user path by default.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// At most this many sessions exist at once.
pub const MAX_SESSIONS: usize = 4;
/// A session expires after five minutes.
pub const SESSION_TTL_SECONDS: u64 = 300;
/// All plain reports in one session.
pub const MAX_SESSION_BYTES: u64 = 67_108_864;
/// One session's file list.
pub const MAX_FILES: usize = 32;
/// One editable text file.
pub const MAX_TEXT_BYTES: u64 = 1_048_576;
/// Plain reports gathered in total before review.
pub const MAX_REPORT_BYTES: u64 = 4_194_304;
/// Recent log text appended to the session.
pub const MAX_LOG_BYTES: u64 = 524_288;
/// An optional crash dump.
pub const MAX_DUMP_BYTES: u64 = 33_554_432;
/// One saved diagnostic ZIP.
pub const MAX_ZIP_BYTES: u64 = 67_108_864;
/// Issue codes accepted by the prefilled page.
pub const MAX_ISSUE_CODES: usize = 32;
/// An issue title.
pub const MAX_TITLE_CHARS: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticsFileKind {
    Text,
    Dump,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiagnosticsFile {
    pub id: Uuid,
    pub relative_name: String,
    pub kind: DiagnosticsFileKind,
    pub bytes: u64,
    pub included: bool,
    pub redacted: bool,
    #[serde(default)]
    pub preview: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiagnosticsSession {
    pub id: Uuid,
    pub files: Vec<DiagnosticsFile>,
    pub expires_unix: u64,
    pub include_paths: bool,
    pub include_dumps: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiagnosticEdit {
    pub file_id: Uuid,
    pub included: bool,
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiagnosticsOptions {
    #[serde(default)]
    pub include_dumps: bool,
    /// Additive to the guide's option table: the "Mask paths and user names"
    /// checkbox is checked by default and can only be turned off explicitly.
    #[serde(default)]
    pub include_paths: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiagnosticsSaveResult {
    pub path: String,
    pub bytes: u64,
}

impl Default for DiagnosticsOptions {
    fn default() -> Self {
        Self {
            include_dumps: false,
            // The UI's mask-paths checkbox is checked unless turned off.
            include_paths: true,
        }
    }
}

/// One file that has been gathered but not yet exposed for review.
#[derive(Debug, Clone)]
pub struct CollectedFile {
    pub id: Uuid,
    pub relative_name: String,
    pub kind: DiagnosticsFileKind,
    pub text: Option<String>,
    pub dump: Option<std::path::PathBuf>,
    pub redacted: bool,
}

impl CollectedFile {
    pub fn bytes(&self) -> u64 {
        match self.kind {
            DiagnosticsFileKind::Text => self
                .text
                .as_ref()
                .map(|text| text.len() as u64)
                .unwrap_or(0),
            DiagnosticsFileKind::Dump => self
                .dump
                .as_ref()
                .and_then(|path| std::fs::metadata(path).ok())
                .map(|metadata| metadata.len())
                .unwrap_or(0),
        }
    }

    pub fn public(&self, included: bool) -> DiagnosticsFile {
        DiagnosticsFile {
            id: self.id,
            relative_name: self.relative_name.clone(),
            kind: self.kind,
            bytes: self.bytes(),
            included,
            redacted: self.redacted,
            preview: match self.kind {
                DiagnosticsFileKind::Text => self.text.clone(),
                DiagnosticsFileKind::Dump => None,
            },
        }
    }
}

/// A relative name is one plain component. ZIP traversal, streams and
/// reserved characters are refused before any archive is written.
pub fn validate_relative_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.chars().count() > 128
        || name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
        || name.contains(':')
        || name.contains('\0')
        || name.contains('*')
        || name.contains('?')
        || name.ends_with('.')
        || name.ends_with(' ')
    {
        return Err("diagnostics.invalid".to_string());
    }
    Ok(())
}

/// Validate an issue code; it is a stable app code, not free text.
pub fn validate_issue_code(code: &str) -> Result<(), String> {
    let valid = !code.is_empty()
        && code.len() <= 64
        && code
            .chars()
            .next()
            .is_some_and(|first| first.is_ascii_lowercase())
        && code
            .chars()
            .all(|character| character.is_ascii_lowercase() || character.is_ascii_digit() || "._-".contains(character));
    if valid {
        Ok(())
    } else {
        Err("diagnostics.invalid".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zip_traversal_names_are_refused() {
        for bad in ["..\\x", "../x", "a/b", "C:\\x", "", "x.", "x ", "a:b", "a\0b"] {
            assert_eq!(
                validate_relative_name(bad).unwrap_err(),
                "diagnostics.invalid",
                "{bad:?}"
            );
        }
        validate_relative_name("app-info.txt").unwrap();
    }

    #[test]
    fn issue_codes_are_stable_identifiers() {
        validate_issue_code("recovery.corrupt").unwrap();
        validate_issue_code("diagnostics_1").unwrap();
        let long = "a".repeat(65);
        for bad in ["", "Recovery.corrupt", "recovery corrupt", "-x", long.as_str()] {
            assert_eq!(
                validate_issue_code(bad).unwrap_err(),
                "diagnostics.invalid",
                "{bad:?}"
            );
        }
    }
}
