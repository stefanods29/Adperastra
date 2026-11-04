//! Wire types and validation for Windows integration (Step 16, revision
//! `windows-integration-1`).
//!
//! Registry keys and command text never come from the UI: this module only
//! accepts fixed identifiers, extension names from a closed allowlist, and
//! bounded byte values. The registry itself is touched only by
//! `registry_ledger.rs` and `windows_integration.rs`.
#![allow(dead_code)]


use serde::{Deserialize, Serialize};

/// The registry ledger format. Bumped only with a migration.
pub const LEDGER_SCHEMA: u32 = 1;
/// Most file associations one request may select.
pub const MAX_ASSOCIATIONS: usize = 128;
/// Most bytes of one registry value the app will ever write or restore.
pub const MAX_REGISTRY_VALUE_BYTES: usize = 64 * 1024;
/// Most entries one ledger may hold.
pub const MAX_LEDGER_VALUES: usize = 4096;
/// Longest registry key the ledger accepts.
pub const MAX_KEY_CHARS: usize = 512;
/// Longest registry value name the ledger accepts.
pub const MAX_NAME_CHARS: usize = 255;
/// Longest activation path, in UTF-16 code units.
pub const MAX_PATH_UTF16: usize = 32_768;
/// Largest integer that survives JSON in every supported runtime.
pub const MAX_SAFE_WIRE: u64 = 9_007_199_254_740_991;

/// The modern Windows 11 menu needs an approved package identity and a
/// trusted deployment (guide D1). It stays false until the owner checkpoint
/// is resolved and the coordinator updates both this constant and the
/// TypeScript mirror. No code path promotes the classic menu silently.
pub const MODERN_MENU_APPROVED: bool = false;

/// The modern-menu state reported to the UI. Spellings are the wire values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModernMenuState {
    Unavailable,
    AwaitingOwner,
    Available,
    Enabled,
}

/// What the Settings page and the installer read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IntegrationStatus {
    pub classic_enabled: bool,
    pub modern: ModernMenuState,
    /// Selected and still-current extension names, lower case, no dot.
    pub associations: Vec<String>,
    pub startup_enabled: bool,
    pub reason_code: Option<String>,
}

impl IntegrationStatus {
    /// The truthful state before anything is registered: the classic menu is
    /// available but off, and the modern menu waits for the owner decision.
    pub fn disabled() -> Self {
        Self {
            classic_enabled: false,
            modern: if MODERN_MENU_APPROVED {
                ModernMenuState::Available
            } else {
                ModernMenuState::AwaitingOwner
            },
            associations: Vec::new(),
            startup_enabled: false,
            reason_code: None,
        }
    }
}

/// A registry value type the ledger can write and restore.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RegistryValueType {
    String,
    ExpandString,
    Binary,
    Dword,
    None,
}

/// One value the app installed and therefore owns.
///
/// `previous_value_type` is an additive extension to the guide's field table
/// (guide `windows-integration-1`): restoring bytes with the wrong Windows
/// type would corrupt the previous value, so the type is kept with it. Older
/// ledgers without the field fall back to `value_type`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RegistryOwnedValue {
    /// Fixed app-owned key, relative to `HKEY_CURRENT_USER`.
    pub key: String,
    pub name: String,
    pub installed_value: Vec<u8>,
    #[serde(default)]
    pub previous_value: Option<Vec<u8>>,
    #[serde(default)]
    pub previous_value_type: Option<RegistryValueType>,
    pub value_type: RegistryValueType,
    pub app_version: String,
    pub ledger_schema: u32,
}

/// What the Settings page asks for. There is no field for a key, executable
/// or command line.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct IntegrationRequest {
    pub classic_enabled: bool,
    pub extensions: Vec<String>,
    pub start_with_windows: bool,
    pub modern_requested: bool,
}

/// Which fixed entry point Explorer starts. It is carried as data; no UI text
/// ever becomes a command line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivationIntent {
    Open,
    Convert,
}

impl ActivationIntent {
    pub fn flag(self) -> &'static str {
        match self {
            ActivationIntent::Open => "--open",
            ActivationIntent::Convert => "--convert",
        }
    }
}

/// Extension families Adperastra may offer in "Open with". The list is closed
/// and lower case; the UI mirror is `WINDOWS_ASSOCIATION_EXTENSIONS` in
/// `src/services/windowsIntegration.ts` and must stay equal to this list.
pub const ASSOCIATION_ALLOWLIST: &[&str] = &[
    "7z", "aac", "arw", "ass", "avif", "avi", "azw3", "bmp", "bz2", "c", "cjs", "cpp", "cr2",
    "cs", "css", "csv", "db", "dng", "docx", "eml", "epub", "fb2", "flac", "fon", "gif", "go",
    "gz", "h", "heic", "heif", "hpp", "htm", "html", "ico", "ics", "ini", "java", "jpeg", "jpg",
    "js", "json", "jsx", "lrc", "m4a", "m4v", "markdown", "md", "mkv", "mobi", "mov", "mp3",
    "mp4", "msg", "mjs", "nef", "odp", "ods", "odt", "ogg", "opus", "otf", "pdf", "php", "png",
    "pptx", "ps1", "psd", "py", "rb", "rar", "raw", "rs", "rtf", "scss", "sh", "sql", "sqlite",
    "sqlite3", "srt", "svg", "tar", "tbz", "tbz2", "tif", "tiff", "toml", "ts", "tsv", "tsx",
    "ttf", "txt", "vcf", "vtt", "wav", "webm", "webp", "wmv", "woff", "woff2", "xlsx", "xml",
    "xz", "yaml", "yml", "zip", "zst",
];

/// True for a lower-case alphanumeric extension name from the allowlist.
pub fn is_allowed_extension(extension: &str) -> bool {
    !extension.is_empty()
        && extension.len() <= 32
        && extension
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        && ASSOCIATION_ALLOWLIST.contains(&extension)
}

/// Validate and normalize one request. The length cap is checked before the
/// allowlist so an oversized request never reaches any other work.
pub fn validate_integration_request(
    request: &IntegrationRequest,
) -> Result<IntegrationRequest, String> {
    if request.extensions.len() > MAX_ASSOCIATIONS {
        return Err("windows_integration.bad_request".to_string());
    }
    let mut extensions = Vec::new();
    for extension in &request.extensions {
        if !is_allowed_extension(extension) {
            return Err("windows_integration.bad_request".to_string());
        }
        if !extensions.contains(extension) {
            extensions.push(extension.clone());
        }
    }
    if request.modern_requested && !MODERN_MENU_APPROVED {
        return Err("windows_integration.identity_required".to_string());
    }
    Ok(IntegrationRequest {
        classic_enabled: request.classic_enabled,
        extensions,
        start_with_windows: request.start_with_windows,
        modern_requested: request.modern_requested,
    })
}

/// `major.minor.patch`, optional `-prerelease` and `+build`, no leading zero
/// in a numeric component and no overflow.
pub fn is_semver(text: &str) -> bool {
    let (without_build, build) = match text.split_once('+') {
        Some((left, right)) => (left, Some(right)),
        None => (text, None),
    };
    if let Some(build) = build {
        if build.is_empty()
            || !build
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-')
        {
            return false;
        }
    }
    let (core, prerelease) = match without_build.split_once('-') {
        Some((left, right)) => (left, Some(right)),
        None => (without_build, None),
    };
    if let Some(prerelease) = prerelease {
        if prerelease.is_empty()
            || !prerelease
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-')
        {
            return false;
        }
    }
    let mut parts = core.split('.');
    let (Some(major), Some(minor), Some(patch)) = (parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    if parts.next().is_some() {
        return false;
    }
    [major, minor, patch].iter().all(|part| {
        !part.is_empty()
            && part.bytes().all(|byte| byte.is_ascii_digit())
            && (part.len() == 1 || !part.starts_with('0'))
            && part.parse::<u64>().is_ok()
    })
}

/// An absolute drive path (`C:\`) or UNC path (`\\server`).
pub fn is_absolute_windows_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    let drive = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/');
    drive || path.starts_with("\\\\")
}

/// Validate a path received from a fixed native entry point: absolute, no
/// `..`, no NUL, bounded UTF-16 length.
pub fn validate_activation_path(path: &str) -> Result<(), String> {
    let invalid_character = path.chars().skip(2).any(|character| {
        matches!(character, '"' | '<' | '>' | '|' | '?' | '*') || character.is_control()
    });
    if !is_absolute_windows_path(path)
        || path.contains('\0')
        || invalid_character
        || path.encode_utf16().count() > MAX_PATH_UTF16
        || path
            .split(['\\', '/'])
            .any(|component| component == "..")
    {
        return Err("windows_integration.bad_request".to_string());
    }
    Ok(())
}

fn has_allowed_family(rest: &str) -> bool {
    match rest.split_once('\\') {
        Some((family, _)) => is_allowed_extension(family),
        None => is_allowed_extension(rest),
    }
}

/// True only for keys this app may create or delete values in. Shared keys
/// (`.ext\OpenWithProgids`, `RegisteredApplications`, `Run`) are allowed, but
/// the value name is checked separately by `is_owned_value`.
pub fn is_owned_key(key: &str) -> bool {
    let key = key.trim_end_matches('\\').to_ascii_lowercase();
    if key.is_empty() || key.len() > MAX_KEY_CHARS {
        return false;
    }
    if key == "software\\registeredapplications"
        || key == "software\\microsoft\\windows\\currentversion\\run"
    {
        return true;
    }
    if let Some(rest) = key.strip_prefix("software\\classes\\adperastra.file.") {
        if !has_allowed_family(rest) {
            return false;
        }
        let tail = rest.split_once('\\').map(|(_, tail)| tail);
        return matches!(
            tail,
            None | Some("defaulticon")
                | Some("shell")
                | Some("shell\\open")
                | Some("shell\\open\\command")
                | Some("shell\\adperastra.convert")
                | Some("shell\\adperastra.convert\\command")
        );
    }
    if matches!(
        key.as_str(),
        "software\\classes\\*\\shell\\adperastra.open"
            | "software\\classes\\*\\shell\\adperastra.open\\command"
            | "software\\classes\\*\\shell\\adperastra.convert"
            | "software\\classes\\*\\shell\\adperastra.convert\\command"
    ) {
        return true;
    }
    if key == "software\\classes\\applications\\adperastra.exe" {
        return true;
    }
    if let Some(tail) = key.strip_prefix("software\\classes\\applications\\adperastra.exe\\") {
        return matches!(
            tail,
            "defaulticon"
                | "shell"
                | "shell\\open"
                | "shell\\open\\command"
                | "shell\\adperastra.convert"
                | "shell\\adperastra.convert\\command"
                | "supportedtypes"
        );
    }
    if key == "software\\adperastra\\capabilities"
        || key == "software\\adperastra\\capabilities\\fileassociations"
    {
        return true;
    }
    if let Some(rest) = key.strip_prefix("software\\classes\\.") {
        let Some((family, tail)) = rest.split_once('\\') else {
            return false;
        };
        return tail == "openwithprogids" && is_allowed_extension(family);
    }
    false
}

/// True for a value name the app may own inside `key`. The default value
/// (`""`) is allowed only under app-owned keys.
pub fn is_owned_value(key: &str, name: &str) -> bool {
    if !is_owned_key(key) || name.chars().count() > MAX_NAME_CHARS {
        return false;
    }
    let key = key.trim_end_matches('\\').to_ascii_lowercase();
    if key == "software\\microsoft\\windows\\currentversion\\run" {
        return name.eq_ignore_ascii_case("Adperastra");
    }
    if key == "software\\registeredapplications" {
        return name.eq_ignore_ascii_case("Adperastra");
    }
    if let Some(rest) = key.strip_prefix("software\\classes\\.") {
        let Some((family, _)) = rest.split_once('\\') else {
            return false;
        };
        return name.eq_ignore_ascii_case(&format!("Adperastra.File.{family}"));
    }
    if key == "software\\adperastra\\capabilities\\fileassociations"
        || key.ends_with("\\supportedtypes")
    {
        if !name.starts_with('.') {
            return false;
        }
        return is_allowed_extension(&name[1..].to_ascii_lowercase());
    }
    true
}

/// Validate one ledger row before it is read or written.
pub fn validate_owned_value(value: &RegistryOwnedValue) -> Result<(), String> {
    if value.ledger_schema != LEDGER_SCHEMA
        || !is_owned_value(&value.key, &value.name)
        || value.installed_value.len() > MAX_REGISTRY_VALUE_BYTES
        || value
            .previous_value
            .as_ref()
            .is_some_and(|bytes| bytes.len() > MAX_REGISTRY_VALUE_BYTES)
        || !is_semver(&value.app_version)
    {
        return Err("windows_integration.bad_request".to_string());
    }
    if value.value_type == RegistryValueType::Dword && value.installed_value.len() != 4 {
        return Err("windows_integration.bad_request".to_string());
    }
    Ok(())
}

/// A safe JSON integer.
pub fn is_safe_wire(value: u64) -> bool {
    value <= MAX_SAFE_WIRE
}

#[cfg(test)]
mod value_tests {
    use super::*;

    #[test]
    fn only_lowercase_allowlisted_extensions_pass() {
        assert!(is_allowed_extension("txt"));
        assert!(!is_allowed_extension("TXT"));
        assert!(!is_allowed_extension(".txt"));
        assert!(!is_allowed_extension("exe"));
    }

    #[test]
    fn owned_keys_exclude_user_choice() {
        assert!(is_owned_key(
            "Software\\Classes\\.txt\\OpenWithProgids"
        ));
        assert!(is_owned_key("Software\\Adperastra\\Capabilities"));
        assert!(!is_owned_key(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.txt\\UserChoice"
        ));
        assert!(!is_owned_key("Software\\Classes\\.txt"));
        assert!(!is_owned_value(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
            "OtherProgram"
        ));
        assert!(is_owned_value(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
            "Adperastra"
        ));
    }

    #[test]
    fn semver_rejects_leading_zeroes() {
        assert!(is_semver("0.4.0"));
        assert!(is_semver("1.2.3-rc.1+build.9"));
        assert!(!is_semver("01.2.3"));
        assert!(!is_semver("1.2"));
    }
}
