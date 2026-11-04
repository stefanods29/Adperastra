//! Finding a separately installed 7-Zip (Step 06e T7). Only the standard
//! install folders are searched: never the working directory, PATH or a path
//! the UI supplies. Nothing is installed, downloaded or loaded as a DLL.

use std::path::PathBuf;

use crate::error::ArchiveError;

/// The standard locations of the 64-bit and 32-bit 7-Zip.
pub fn discover() -> Result<PathBuf, ArchiveError> {
    for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
        let Ok(root) = std::env::var(variable) else {
            continue;
        };
        if root.trim().is_empty() {
            continue;
        }
        let candidate = PathBuf::from(root).join("7-Zip").join("7z.exe");
        if !candidate.is_file() {
            continue;
        }
        let resolved =
            std::fs::canonicalize(&candidate).map_err(|_| ArchiveError::SevenZipMissing)?;
        if resolved.is_file() {
            return Ok(resolved);
        }
    }
    Err(ArchiveError::SevenZipMissing)
}

/// The version line of the probe output, or `None` when it is not 7-Zip.
pub fn parse_version(output: &str) -> Option<String> {
    for line in output.lines().take(20) {
        let trimmed = line.trim();
        if !trimmed.starts_with("7-Zip") {
            continue;
        }
        let mut parts = trimmed.split_whitespace();
        let _name = parts.next();
        // "[64]" is the architecture marker, not a version.
        let version = parts.find(|part| {
            part.chars()
                .next()
                .is_some_and(|first| first.is_ascii_digit())
                && part.contains('.')
        })?;
        return Some(version.to_string());
    }
    None
}
