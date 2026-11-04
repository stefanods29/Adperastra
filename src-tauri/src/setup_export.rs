//! No-replace setup ZIP writer (Step 10e T5, E4 export).
//!
//! The bytes are written through `fs_service::owned_io` into an owned staging
//! file next to the chosen destination and published without replacing
//! anything. A collision keeps both files; a failure disposes only the
//! staging handle (R-SAFE-3, U6).

use std::collections::BTreeMap;
use std::path::Path;

use fs_service::owned_io::{OwnedIoError, OwnedOutput, PinnedDirectory};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::setup_archive::sha256_hex;
use crate::setup_types::{
    validate_manifest, SetupManifest, MAX_SETUP_ENTRIES, MAX_SETUP_EXPANDED_BYTES,
};

fn io_error() -> String {
    "setup.io".to_string()
}

fn invalid() -> String {
    "setup.invalid".to_string()
}

/// Write `manifest.json` plus exactly the declared data/assets. Returns the
/// published byte count.
pub fn write_setup_archive(
    dest_path: &Path,
    manifest: &SetupManifest,
    files: &[(String, Vec<u8>)],
) -> Result<u64, String> {
    validate_manifest(manifest)?;
    if files.len() + 1 > MAX_SETUP_ENTRIES {
        return Err("setup.too_large".to_string());
    }
    let expanded: u64 = files.iter().map(|(_, bytes)| bytes.len() as u64).sum();
    if expanded > MAX_SETUP_EXPANDED_BYTES {
        return Err("setup.too_large".to_string());
    }
    let provided: BTreeMap<&str, &[u8]> = files
        .iter()
        .map(|(name, bytes)| (name.as_str(), bytes.as_slice()))
        .collect();
    if provided.len() != manifest.entries.len() || provided.len() != files.len() {
        return Err(invalid());
    }
    for entry in &manifest.entries {
        let bytes = provided.get(entry.name.as_str()).ok_or_else(invalid)?;
        if bytes.len() as u64 != entry.byte_len || sha256_hex(bytes) != entry.sha256 {
            return Err(invalid());
        }
    }
    let file_name = dest_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(invalid)?;
    if !file_name.to_ascii_lowercase().ends_with(".adperastra-setup") {
        return Err(invalid());
    }
    let parent = dest_path.parent().ok_or_else(invalid)?;
    let directory = PinnedDirectory::open(parent).map_err(|_| io_error())?;
    let mut output = OwnedOutput::create(&directory, file_name).map_err(|error| match error {
        OwnedIoError::StagingTaken => "setup.io".to_string(),
        _ => io_error(),
    })?;
    let manifest_bytes = serde_json::to_vec(manifest).map_err(|_| invalid())?;
    if expanded.saturating_add(manifest_bytes.len() as u64) > MAX_SETUP_EXPANDED_BYTES {
        return Err("setup.too_large".to_string());
    }
    {
        let mut writer = ZipWriter::new(output.file_mut());
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        writer.start_file("manifest.json", options).map_err(|_| io_error())?;
        std::io::Write::write_all(&mut writer, &manifest_bytes).map_err(|_| io_error())?;
        for (name, bytes) in files {
            writer.start_file(name.as_str(), options).map_err(|_| io_error())?;
            std::io::Write::write_all(&mut writer, bytes).map_err(|_| io_error())?;
        }
        writer.finish().map_err(|_| io_error())?;
    }
    output.flush_sync().map_err(|_| io_error())?;
    let published = output.publish_name(file_name).map_err(|_| "setup.changed".to_string())?;
    let bytes = std::fs::metadata(&published).map(|metadata| metadata.len()).map_err(|_| io_error())?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::setup_types::{SetupManifestEntry, SetupPart};
    use std::fs;
    use tempfile::tempdir;

    fn manifest_for(data: &[u8]) -> SetupManifest {
        SetupManifest {
            schema_version: 1,
            app_version: "0.1.16".to_string(),
            parts: vec![SetupPart::Menus],
            entries: vec![SetupManifestEntry {
                name: "data/menus.json".to_string(),
                byte_len: data.len() as u64,
                sha256: crate::setup_archive::sha256_hex(data),
            }],
            contains_personal_paths: false,
            created_unix: 1_800_000_000,
        }
    }

    #[test]
    fn export_collision_keeps_both_files() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("shared.adperastra-setup");
        fs::write(&target, b"original").unwrap();
        let data = b"[]".to_vec();
        let manifest = manifest_for(&data);
        let result = write_setup_archive(&target, &manifest, &[("data/menus.json".to_string(), data)]);
        assert!(result.is_err());
        assert_eq!(fs::read(&target).unwrap(), b"original");
        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".partial"))
            .collect();
        assert!(leftovers.is_empty(), "only the owned staging file was removed");
    }

    #[test]
    fn export_writes_a_readable_archive() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("new.adperastra-setup");
        let data = b"[]".to_vec();
        let manifest = manifest_for(&data);
        let bytes = write_setup_archive(&target, &manifest, &[("data/menus.json".to_string(), data)]).unwrap();
        assert!(bytes > 0);
        let read = crate::setup_archive::read_setup_archive(&target).unwrap();
        assert_eq!(read.manifest, manifest);
    }
}
