//! Session-only archive credentials (Step 06e D9, D10). At most eight
//! verified passwords stay in bounded memory, keyed by the archive's
//! canonical path, size and exact modified time. Nothing is written to disk,
//! settings, sessions or reports, and the Debug form never prints a secret.

use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

/// The most passwords kept at once.
pub const MAX_REMEMBERED_PASSWORDS: usize = 8;
/// The most bytes one remembered password may take.
pub const MAX_PASSWORD_BYTES: usize = 1_024;
/// The most characters a password may have.
pub const MAX_PASSWORD_CHARS: usize = 256;

/// One password the user supplied for this operation.
#[derive(Clone, Serialize, Deserialize)]
pub struct ArchiveAuth {
    pub password: String,
    #[serde(default)]
    pub remember_session: bool,
}

impl fmt::Debug for ArchiveAuth {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ArchiveAuth")
            .field("password", &"<redacted>")
            .field("remember_session", &self.remember_session)
            .finish()
    }
}

impl ArchiveAuth {
    /// Exact strings, never trimmed (D9).
    pub fn validate(&self) -> Result<(), String> {
        validate_password(&self.password)
    }
}

/// 1 to 256 Unicode scalar values, at most 1,024 UTF-8 bytes, no control
/// characters or line breaks.
pub fn validate_password(password: &str) -> Result<(), String> {
    let characters = password.chars().count();
    if characters == 0 || characters > MAX_PASSWORD_CHARS || password.len() > MAX_PASSWORD_BYTES {
        return Err("archive.invalid_password".to_string());
    }
    if password.chars().any(|character| character.is_control()) {
        return Err("archive.invalid_password".to_string());
    }
    Ok(())
}

struct Credential {
    path: PathBuf,
    size: u64,
    modified_unix: u64,
    password: String,
    used: u64,
}

/// The app's bounded password memory (managed state).
#[derive(Default)]
pub struct ArchivePasswords {
    entries: Mutex<Vec<Credential>>,
    clock: AtomicU64,
}

impl ArchivePasswords {
    fn lock(&self) -> Result<MutexGuard<'_, Vec<Credential>>, String> {
        self.entries.lock().map_err(|_| "archive.other".to_string())
    }

    /// The verified password for this exact archive, when one is remembered.
    /// A changed or missing archive drops its credential.
    pub fn get(&self, path: &Path) -> Option<String> {
        let (resolved, size, modified) = identity(path)?;
        let mut entries = self.lock().ok()?;
        entries.retain(|entry| {
            !(same_path(&entry.path, &resolved)
                && (entry.size != size || entry.modified_unix != modified))
        });
        let used = self.clock.fetch_add(1, Ordering::Relaxed) + 1;
        let entry = entries
            .iter_mut()
            .find(|entry| same_path(&entry.path, &resolved))?;
        entry.used = used;
        Some(entry.password.clone())
    }

    /// Remember one password after a verified read. The LRU entry goes when
    /// nine are held.
    pub fn remember(&self, path: &Path, password: &str) -> Result<(), String> {
        if password.len() > MAX_PASSWORD_BYTES {
            return Err("archive.invalid_password".to_string());
        }
        let (resolved, size, modified) = identity(path).ok_or("archive.not_found")?;
        let used = self.clock.fetch_add(1, Ordering::Relaxed) + 1;
        let mut entries = self.lock()?;
        entries.retain(|entry| !same_path(&entry.path, &resolved));
        entries.push(Credential {
            path: resolved,
            size,
            modified_unix: modified,
            password: password.to_string(),
            used,
        });
        while entries.len() > MAX_REMEMBERED_PASSWORDS {
            let Some(oldest) = entries
                .iter()
                .enumerate()
                .min_by_key(|(_, entry)| entry.used)
                .map(|(index, _)| index)
            else {
                break;
            };
            entries.remove(oldest);
        }
        Ok(())
    }

    /// Forget the credential for this archive (a wrong password, or a file
    /// that disappeared).
    pub fn invalidate(&self, path: &Path) {
        let Ok(mut entries) = self.lock() else {
            return;
        };
        entries.retain(|entry| !same_path(&entry.path, path));
    }

    /// How many credentials are held (tests only).
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.lock().map(|entries| entries.len()).unwrap_or(0)
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

fn identity(path: &Path) -> Option<(PathBuf, u64, u64)> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    let resolved = std::fs::canonicalize(path).ok()?;
    let modified_unix = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|age| age.as_secs())
        .unwrap_or(0);
    Some((resolved, metadata.len(), modified_unix))
}

fn same_path(left: &Path, right: &Path) -> bool {
    let text = |path: &Path| {
        path.to_string_lossy()
            .trim_start_matches(r"\\?\")
            .replace('/', "\\")
            .to_lowercase()
    };
    text(left) == text(right)
}

#[cfg(test)]
mod tests {
    use super::{validate_password, ArchiveAuth, ArchivePasswords, MAX_REMEMBERED_PASSWORDS};

    fn file(folder: &std::path::Path, name: &str, text: &str) -> std::path::PathBuf {
        let path = folder.join(name);
        std::fs::write(&path, text).unwrap();
        path
    }

    #[test]
    fn auth_rejects_controls_and_oversized_utf8() {
        assert!(validate_password("").is_err());
        assert!(validate_password("line\nbreak").is_err());
        assert!(validate_password("bell\u{7}").is_err());
        assert!(validate_password("nul\0").is_err());
        assert!(validate_password(&"x".repeat(257)).is_err());
        // 256 characters of a 4-byte script exceed the byte cap.
        assert!(validate_password(&"😀".repeat(256)).is_err());
        assert!(validate_password("a normal passphrase").is_ok());
    }

    #[test]
    fn auth_preserves_spaces_and_unicode() {
        let auth = ArchiveAuth {
            password: "  contraseña con espacios  ".to_string(),
            remember_session: false,
        };
        assert!(auth.validate().is_ok());
        assert_eq!(auth.password, "  contraseña con espacios  ");
    }

    #[test]
    fn remembered_passwords_require_success() {
        let folder = tempfile::tempdir().unwrap();
        let path = file(folder.path(), "a.zip", "archive");
        let cache = ArchivePasswords::default();
        // Nothing is remembered before a verified read.
        assert!(cache.get(&path).is_none());
        cache.remember(&path, "secret").unwrap();
        assert_eq!(cache.get(&path).as_deref(), Some("secret"));
    }

    #[test]
    fn credential_identity_change_invalidates() {
        let folder = tempfile::tempdir().unwrap();
        let path = file(folder.path(), "a.zip", "archive");
        let cache = ArchivePasswords::default();
        cache.remember(&path, "secret").unwrap();
        std::fs::write(&path, "archive changed and longer").unwrap();
        assert!(cache.get(&path).is_none(), "a changed archive drops it");
        assert!(cache.is_empty());
    }

    #[test]
    fn credential_lru_is_bounded() {
        let folder = tempfile::tempdir().unwrap();
        let cache = ArchivePasswords::default();
        let mut paths = Vec::new();
        for index in 0..=MAX_REMEMBERED_PASSWORDS {
            let path = file(folder.path(), &format!("{index}.zip"), "archive");
            cache.remember(&path, &format!("secret-{index}")).unwrap();
            paths.push(path);
        }
        assert_eq!(cache.len(), MAX_REMEMBERED_PASSWORDS);
        assert!(cache.get(&paths[0]).is_none(), "the least used one goes");
        assert!(cache.get(&paths[MAX_REMEMBERED_PASSWORDS]).is_some());
    }

    #[test]
    fn auth_debug_is_redacted() {
        let auth = ArchiveAuth {
            password: "top secret phrase".to_string(),
            remember_session: true,
        };
        let text = format!("{auth:?}");
        assert!(!text.contains("top secret"));
        assert!(text.contains("<redacted>"));
    }
}
