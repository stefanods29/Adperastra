//! The portable-copy manifest (Step 10c T6).
//!
//! The manifest is written last, inside the owned staging folder, and its
//! SHA-256 is returned only for a complete, verified copy. Every copied file
//! has a relative path, its exact byte length and its SHA-256.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const MANIFEST_SCHEMA: u32 = 1;
pub const MANIFEST_FILE_NAME: &str = "portable-copy-manifest.json";
pub const MAX_MANIFEST_FILES: usize = 200_000;
pub const MAX_RELATIVE_PATH_CHARS: usize = 1024;
pub const MAX_MANIFEST_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManifestFile {
    /// Forward-slash relative path below the app-data base.
    pub relative_path: String,
    pub bytes: u64,
    /// Lower-case SHA-256 of the copied bytes.
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PortableManifest {
    pub schema_version: u32,
    pub created_unix: u64,
    pub source_base: String,
    pub files: Vec<ManifestFile>,
    pub total_bytes: u64,
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn valid_relative_path(path: &str) -> bool {
    if path.is_empty()
        || path.len() > MAX_RELATIVE_PATH_CHARS
        || path.starts_with('/')
        || path.starts_with('\\')
        || path.contains('\\')
        || path.contains(':')
    {
        return false;
    }
    path.split('/').all(|part| {
        !part.is_empty() && part != "." && part != ".." && !part.contains('\0')
    })
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f'))
}

/// Build a deterministic manifest: files are ordered by their relative path.
pub fn build_manifest(
    source_base: &str,
    mut files: Vec<ManifestFile>,
    created_unix: u64,
) -> Result<PortableManifest, String> {
    files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    let total_bytes = files.iter().try_fold(0u64, |total, file| {
        total.checked_add(file.bytes).ok_or_else(|| "profiles.copy_failed".to_string())
    })?;
    let manifest = PortableManifest {
        schema_version: MANIFEST_SCHEMA,
        created_unix,
        source_base: source_base.to_string(),
        files,
        total_bytes,
    };
    validate_manifest(&manifest)?;
    Ok(manifest)
}

/// Serialize deterministically for the report hash and the file on disk.
pub fn manifest_bytes(manifest: &PortableManifest) -> Result<Vec<u8>, String> {
    let mut sorted = manifest.clone();
    sorted
        .files
        .sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    let bytes = serde_json::to_vec_pretty(&sorted).map_err(|_| "profiles.copy_failed".to_string())?;
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("profiles.copy_failed".to_string());
    }
    Ok(bytes)
}

pub fn manifest_sha256(manifest: &PortableManifest) -> Result<String, String> {
    Ok(sha256_hex(&manifest_bytes(manifest)?))
}

pub fn validate_manifest(manifest: &PortableManifest) -> Result<(), String> {
    if manifest.schema_version != MANIFEST_SCHEMA {
        return Err("profiles.copy_failed".to_string());
    }
    if manifest.files.len() > MAX_MANIFEST_FILES {
        return Err("profiles.copy_failed".to_string());
    }
    let mut seen = BTreeSet::new();
    let mut total = 0u64;
    for file in &manifest.files {
        if !valid_relative_path(&file.relative_path) || !valid_sha256(&file.sha256) {
            return Err("profiles.copy_failed".to_string());
        }
        if !seen.insert(file.relative_path.as_str()) {
            return Err("profiles.copy_failed".to_string());
        }
        total = total
            .checked_add(file.bytes)
            .ok_or_else(|| "profiles.copy_failed".to_string())?;
    }
    if total != manifest.total_bytes {
        return Err("profiles.copy_failed".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, bytes: &[u8]) -> ManifestFile {
        ManifestFile {
            relative_path: path.to_string(),
            bytes: bytes.len() as u64,
            sha256: sha256_hex(bytes),
        }
    }

    #[test]
    fn sorts_files_and_sums_the_exact_bytes() {
        let manifest = build_manifest(
            "C:\\Data",
            vec![file("z.txt", b"z"), file("a/b.txt", b"ab")],
            10,
        )
        .unwrap();
        assert_eq!(manifest.files[0].relative_path, "a/b.txt");
        assert_eq!(manifest.total_bytes, 3);
        assert_eq!(manifest.files[1].sha256, sha256_hex(b"z"));
    }

    #[test]
    fn refuses_parent_paths_and_bad_hashes() {
        let mut manifest = build_manifest("C:\\Data", vec![file("a.txt", b"a")], 10).unwrap();
        manifest.files[0].relative_path = "../escape.txt".to_string();
        assert!(validate_manifest(&manifest).is_err());

        let mut manifest = build_manifest("C:\\Data", vec![file("a.txt", b"a")], 10).unwrap();
        manifest.files[0].sha256 = "ABC".to_string();
        assert!(validate_manifest(&manifest).is_err());
    }

    #[test]
    fn the_manifest_hash_changes_with_a_file_hash() {
        let first = build_manifest("C:\\Data", vec![file("a.txt", b"a")], 10).unwrap();
        let second = build_manifest("C:\\Data", vec![file("a.txt", b"b")], 10).unwrap();
        assert_ne!(manifest_sha256(&first).unwrap(), manifest_sha256(&second).unwrap());
    }
}
