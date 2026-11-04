//! Bounded `.adperastra-setup` reader and owned quarantine (Step 10e T5).
//! Not the generic extractor: only fixed entry names, every SHA-256 checked
//! before a preview exists (D7).

use std::collections::{BTreeMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};
use sha2::{Digest, Sha256};
use zip::ZipArchive;
use crate::setup_types::{
    classify_entry, is_canonical_uuid, validate_manifest, SetupEntryKind, SetupManifest,
    SetupManifestEntry, MAX_SETUP_ASSET_BYTES, MAX_SETUP_COMPRESSED_BYTES, MAX_SETUP_ENTRIES,
    MAX_SETUP_EXPANDED_BYTES, MAX_SETUP_PART_BYTES, MAX_SETUP_RATIO, SETUP_SCHEMA_VERSION,
};

const MANIFEST_NAME: &str = "manifest.json";
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;

pub struct SetupArchiveContents {
    pub manifest: SetupManifest,
    pub files: BTreeMap<String, Vec<u8>>,
}

impl std::fmt::Debug for SetupArchiveContents {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SetupArchiveContents")
            .field("manifest", &self.manifest)
            .field("file_count", &self.files.len())
            .finish()
    }
}

fn invalid() -> String {
    "setup.invalid".to_string()
}

fn too_large() -> String {
    "setup.too_large".to_string()
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut text = String::with_capacity(64);
    for byte in digest.iter() {
        text.push_str(&format!("{byte:02x}"));
    }
    text
}

fn read_entry_bounded<R: Read>(reader: R, byte_len: u64, max_bytes: u64) -> Result<Vec<u8>, String> {
    let limit = byte_len.min(max_bytes).saturating_add(1);
    let mut bytes = Vec::new();
    reader.take(limit).read_to_end(&mut bytes).map_err(|_| invalid())?;
    if bytes.len() as u64 != byte_len {
        return Err(invalid());
    }
    Ok(bytes)
}

/// Read and fully validate a setup archive. Nothing is applied or written.
pub fn read_setup_archive(path: &Path) -> Result<SetupArchiveContents, String> {
    let metadata = fs::metadata(path).map_err(|_| invalid())?;
    if !metadata.is_file() {
        return Err(invalid());
    }
    let archive_size = metadata.len();
    if archive_size > MAX_SETUP_COMPRESSED_BYTES {
        return Err(too_large());
    }
    let file = File::open(path).map_err(|_| invalid())?;
    let mut archive = ZipArchive::new(BufReader::new(file)).map_err(|_| invalid())?;
    if archive.len() > MAX_SETUP_ENTRIES {
        return Err(too_large());
    }

    let mut names: Vec<String> = Vec::new();
    let mut folded = HashSet::new();
    let mut sizes: BTreeMap<String, u64> = BTreeMap::new();
    let mut expanded_total = 0u64;
    let mut manifest_index: Option<usize> = None;
    for index in 0..archive.len() {
        let (name, size, is_manifest) = {
            let entry = archive.by_index(index).map_err(|_| invalid())?;
            if entry.encrypted() || entry.is_symlink() || entry.is_dir() {
                return Err(invalid());
            }
            let name = entry.name().map_err(|_| invalid())?.to_string();
            match classify_entry(&name) {
                Some(SetupEntryKind::Manifest) => (name, entry.size(), true),
                Some(_) => (name, entry.size(), false),
                None => return Err(invalid()),
            }
        };
        if !folded.insert(name.to_lowercase()) {
            return Err(invalid());
        }
        expanded_total = expanded_total.saturating_add(size);
        sizes.insert(name.clone(), size);
        names.push(name);
        if is_manifest {
            if manifest_index.is_some() {
                return Err(invalid());
            }
            manifest_index = Some(index);
        }
    }
    if expanded_total > MAX_SETUP_EXPANDED_BYTES {
        return Err(too_large());
    }
    if expanded_total > archive_size.max(1).saturating_mul(MAX_SETUP_RATIO) {
        return Err(too_large());
    }
    let Some(manifest_index) = manifest_index else {
        return Err(invalid());
    };

    let manifest_bytes = {
        let entry = archive.by_index(manifest_index).map_err(|_| invalid())?;
        let size = entry.size();
        if size > MAX_MANIFEST_BYTES {
            return Err(too_large());
        }
        read_entry_bounded(entry, size, MAX_MANIFEST_BYTES)?
    };
    let manifest: SetupManifest = serde_json::from_slice(&manifest_bytes).map_err(|_| invalid())?;
    validate_manifest(&manifest)?;
    if manifest.schema_version != SETUP_SCHEMA_VERSION {
        return Err("setup.unsupported_version".to_string());
    }

    let declared: BTreeMap<&str, &SetupManifestEntry> = manifest
        .entries
        .iter()
        .map(|entry| (entry.name.as_str(), entry))
        .collect();
    for name in names.iter().filter(|name| name.as_str() != MANIFEST_NAME) {
        if !declared.contains_key(name.as_str()) {
            return Err(invalid());
        }
    }
    if declared.len() != sizes.len().saturating_sub(1) {
        return Err(invalid());
    }

    let mut files = BTreeMap::new();
    for (index, name) in names.iter().enumerate() {
        if name.as_str() == MANIFEST_NAME {
            continue;
        }
        let declared_entry = declared.get(name.as_str()).ok_or_else(invalid)?;
        let size = *sizes.get(name).ok_or_else(invalid)?;
        if size != declared_entry.byte_len {
            return Err(invalid());
        }
        let bytes = {
            let max_bytes = if name.starts_with("assets/") {
                MAX_SETUP_ASSET_BYTES
            } else {
                MAX_SETUP_PART_BYTES
            };
            let entry = archive.by_index(index).map_err(|_| invalid())?;
            read_entry_bounded(entry, size, max_bytes)?
        };
        if sha256_hex(&bytes) != declared_entry.sha256 {
            return Err(invalid());
        }
        if name.starts_with("assets/") && !bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
            return Err(invalid());
        }
        files.insert(name.clone(), bytes);
    }
    Ok(SetupArchiveContents { manifest, files })
}

/// Write a validated setup into an app-owned quarantine directory. Existing
/// data is never replaced; a collision is an error and the caller keeps the
/// original preview.
pub fn write_quarantine(base_dir: &Path, preview_id: &str, contents: &SetupArchiveContents) -> Result<PathBuf, String> {
    if !is_canonical_uuid(preview_id) || !base_dir.is_absolute() {
        return Err(invalid());
    }
    let root = base_dir.join("setups");
    fs::create_dir_all(&root).map_err(|_| "setup.io".to_string())?;
    let directory = root.join(preview_id);
    fs::create_dir(&directory).map_err(|_| "setup.io".to_string())?;
    let write = |name: &str, bytes: &[u8]| -> Result<(), String> {
        let target = directory.join(name.replace('/', "__"));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|_| "setup.io".to_string())?;
        file.write_all(bytes).map_err(|_| "setup.io".to_string())?;
        file.sync_all().map_err(|_| "setup.io".to_string())
    };
    let manifest_bytes = serde_json::to_vec(&contents.manifest).map_err(|_| invalid())?;
    write(MANIFEST_NAME, &manifest_bytes)?;
    for (name, bytes) in &contents.files {
        write(name, bytes)?;
    }
    Ok(directory)
}

/// Read a quarantine back and verify it again before Apply.
pub fn read_quarantine(directory: &Path) -> Result<SetupArchiveContents, String> {
    let manifest_bytes = fs::read(directory.join(MANIFEST_NAME)).map_err(|_| invalid())?;
    if manifest_bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(too_large());
    }
    let manifest: SetupManifest = serde_json::from_slice(&manifest_bytes).map_err(|_| invalid())?;
    validate_manifest(&manifest)?;
    let mut files = BTreeMap::new();
    for entry in &manifest.entries {
        let bytes = fs::read(directory.join(entry.name.replace('/', "__"))).map_err(|_| invalid())?;
        if bytes.len() as u64 != entry.byte_len || sha256_hex(&bytes) != entry.sha256 {
            return Err("setup.changed".to_string());
        }
        files.insert(entry.name.clone(), bytes);
    }
    Ok(SetupArchiveContents { manifest, files })
}

/// Delete only one owned UUID quarantine directory. A preview still leased
/// by the dialog or referenced by history is retained.
pub fn remove_quarantine(base_dir: &Path, preview_id: &str, in_use: bool) -> Result<(), String> {
    if in_use {
        return Ok(());
    }
    if !is_canonical_uuid(preview_id) {
        return Err(invalid());
    }
    let directory = base_dir.join("setups").join(preview_id);
    let Ok(metadata) = fs::symlink_metadata(&directory) else {
        return Ok(());
    };
    if metadata.file_type().is_symlink() {
        return Err(invalid());
    }
    fs::remove_dir_all(&directory).map_err(|_| "setup.io".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::setup_types::{SetupManifestEntry, SetupPart};
    use std::io::Write;
    use tempfile::tempdir;

    fn manifest_for(files: &[(&str, &[u8])]) -> SetupManifest {
        SetupManifest {
            schema_version: 1,
            app_version: "0.1.16".to_string(),
            parts: vec![SetupPart::Menus],
            entries: files
                .iter()
                .map(|(name, data)| SetupManifestEntry {
                    name: name.to_string(),
                    byte_len: data.len() as u64,
                    sha256: sha256_hex(data),
                })
                .collect(),
            contains_personal_paths: false,
            created_unix: 1_800_000_000,
        }
    }

    fn write_zip(path: &Path, files: &[(&str, &[u8])], symlink: Option<&str>) {
        let mut writer = zip::ZipWriter::new(File::create(path).unwrap());
        let base = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (name, data) in files {
            let options = if symlink == Some(*name) {
                // zip 9 masks the type bits from unix_permissions; the raw
                // external attributes keep S_IFLNK so the reader sees a link.
                base.external_attributes(0o120777 << 16)
                    .system(zip::System::Unix)
            } else {
                base
            };
            writer.start_file(*name, options).unwrap();
            writer.write_all(data).unwrap();
        }
        writer.finish().unwrap();
    }

    fn valid_zip(dir: &Path) -> PathBuf {
        let path = dir.join("valid.adperastra-setup");
        let data = b"[]";
        let manifest = manifest_for(&[("data/menus.json", data)]);
        let manifest_bytes = serde_json::to_vec(&manifest).unwrap();
        write_zip(
            &path,
            &[(MANIFEST_NAME, &manifest_bytes), ("data/menus.json", data)],
            None,
        );
        path
    }

    #[test]
    fn valid_setup_reads_after_all_hashes_match() {
        let dir = tempdir().unwrap();
        let contents = read_setup_archive(&valid_zip(dir.path())).unwrap();
        assert_eq!(contents.manifest.parts, vec![SetupPart::Menus]);
        assert_eq!(contents.files.get("data/menus.json").map(Vec::as_slice), Some(&b"[]"[..]));
    }

    #[test]
    fn traversal_entry_refused() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("bad.adperastra-setup");
        let manifest = manifest_for(&[("data/menus.json", b"[]")]);
        let manifest_bytes = serde_json::to_vec(&manifest).unwrap();
        write_zip(
            &path,
            &[(MANIFEST_NAME, &manifest_bytes), ("data/menus.json", b"[]"), ("../evil.txt", b"x")],
            None,
        );
        assert_eq!(read_setup_archive(&path).unwrap_err(), "setup.invalid");
    }

    #[test]
    fn duplicate_casefold_entry_refused() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("bad.adperastra-setup");
        let manifest = manifest_for(&[("data/menus.json", b"[]")]);
        let manifest_bytes = serde_json::to_vec(&manifest).unwrap();
        write_zip(
            &path,
            &[
                (MANIFEST_NAME, &manifest_bytes),
                ("data/menus.json", b"[]"),
                ("DATA/MENUS.JSON", b"[]"),
            ],
            None,
        );
        assert_eq!(read_setup_archive(&path).unwrap_err(), "setup.invalid");
    }

    #[test]
    fn symlink_entry_refused() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("link.adperastra-setup");
        let manifest = manifest_for(&[("data/menus.json", b"[]")]);
        let manifest_bytes = serde_json::to_vec(&manifest).unwrap();
        write_zip(
            &path,
            &[(MANIFEST_NAME, &manifest_bytes), ("data/menus.json", b"[]")],
            Some("data/menus.json"),
        );
        assert_eq!(read_setup_archive(&path).unwrap_err(), "setup.invalid");
    }

    #[test]
    fn executable_entry_refused() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("exe.adperastra-setup");
        let manifest = manifest_for(&[("data/menus.json", b"[]")]);
        let manifest_bytes = serde_json::to_vec(&manifest).unwrap();
        write_zip(
            &path,
            &[(MANIFEST_NAME, &manifest_bytes), ("data/setup.exe", b"MZ")],
            None,
        );
        assert_eq!(read_setup_archive(&path).unwrap_err(), "setup.invalid");
    }

    #[test]
    fn ratio_101_refused() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("bomb.adperastra-setup");
        let data = vec![b'a'; 1024 * 1024];
        let manifest = manifest_for(&[("data/menus.json", &data)]);
        let manifest_bytes = serde_json::to_vec(&manifest).unwrap();
        write_zip(
            &path,
            &[(MANIFEST_NAME, &manifest_bytes), ("data/menus.json", &data)],
            None,
        );
        assert_eq!(read_setup_archive(&path).unwrap_err(), "setup.too_large");
    }

    #[test]
    fn hash_mismatch_before_preview() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("hash.adperastra-setup");
        let mut manifest = manifest_for(&[("data/menus.json", b"[]")]);
        manifest.entries[0].sha256 = "0".repeat(64);
        let manifest_bytes = serde_json::to_vec(&manifest).unwrap();
        write_zip(
            &path,
            &[(MANIFEST_NAME, &manifest_bytes), ("data/menus.json", b"[]")],
            None,
        );
        assert_eq!(read_setup_archive(&path).unwrap_err(), "setup.invalid");
    }

    #[test]
    fn quarantine_roundtrip_and_owned_cleanup() {
        let dir = tempdir().unwrap();
        let contents = read_setup_archive(&valid_zip(dir.path())).unwrap();
        let id = "00000000-0000-4000-a000-000000000001";
        let quarantine = write_quarantine(dir.path(), id, &contents).unwrap();
        let again = read_quarantine(&quarantine).unwrap();
        assert_eq!(again.manifest, contents.manifest);
        remove_quarantine(dir.path(), id, true).unwrap();
        assert!(quarantine.exists(), "an in-use preview stays");
        remove_quarantine(dir.path(), id, false).unwrap();
        assert!(!quarantine.exists());
        assert!(dir.path().join("setups").exists(), "never deletes the base");
    }
}
