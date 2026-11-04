//! Guarded archive extraction, inventory verification and versioned
//! activation. A new version is never written over the active directory; the
//! active pointer only moves after the inventory and probe succeed.

use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use zip::ZipArchive;

use crate::error::{map_io, PackError, PackResult};
use crate::inventory::verify_tree;
use crate::types::{PackCatalog, PackDescriptor, PackFile, PackId, MAX_PACK_FILES};
use crate::validation::{
    install_limit, is_sha256_hex, is_valid_semver, validate_artifact_hash, validate_relative_path,
    MAX_ENTRY_RATIO, MAX_INSTALLED_BYTES,
};

pub const ACTIVE_SCHEMA_VERSION: u32 = 1;
const CHUNK: usize = 64 * 1024;

/// The app-state pointer that selects one immutable installed version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActiveVersion {
    pub schema_version: u32,
    pub pack_id: PackId,
    pub version: String,
    /// A validated relative path such as `versions/media/1.0.0`.
    pub directory: String,
    pub descriptor_sha256: String,
    pub previous_version: Option<String>,
    pub activated_unix: u64,
}

/// Reads and atomically replaces `<packs>/active/<pack>.json`.
#[derive(Debug, Clone)]
pub struct ActiveVersions {
    root: PathBuf,
}

impl ActiveVersions {
    pub fn new(packs_root: &Path) -> Self {
        Self {
            root: packs_root.to_path_buf(),
        }
    }

    pub fn packs_root(&self) -> &Path {
        &self.root
    }

    fn directory(&self) -> PathBuf {
        self.root.join("active")
    }

    pub fn pointer_path(&self, id: PackId) -> PathBuf {
        self.directory().join(format!("{}.json", id.as_str()))
    }

    pub fn read(&self, id: PackId) -> PackResult<Option<ActiveVersion>> {
        let path = self.pointer_path(id);
        let bytes = match std::fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(map_io(&error)),
        };
        if bytes.len() > 16 * 1024 {
            return Err(PackError::BadRequest);
        }
        let pointer: ActiveVersion =
            serde_json::from_slice(&bytes).map_err(|_| PackError::BadRequest)?;
        validate_pointer(id, &pointer)?;
        Ok(Some(pointer))
    }

    /// Every pack with an active pointer, used by the storage rows and by
    /// startup pending-removal completion. A damaged pointer is skipped so
    /// one bad file does not hide the other installed packs.
    pub fn list_ids(&self) -> PackResult<Vec<PackId>> {
        let entries = match std::fs::read_dir(self.directory()) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(map_io(&error)),
        };
        let mut ids = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
                continue;
            };
            let Some(id) = PackId::parse(stem) else {
                continue;
            };
            if matches!(self.read(id), Ok(Some(_))) && !ids.contains(&id) {
                ids.push(id);
            }
        }
        Ok(ids)
    }

    pub fn write(&self, pointer: &ActiveVersion) -> PackResult<()> {
        validate_pointer(pointer.pack_id, pointer)?;
        std::fs::create_dir_all(self.directory()).map_err(|error| map_io(&error))?;
        let bytes = serde_json::to_vec(pointer).map_err(|_| PackError::Failed)?;
        crate::download_state::write_atomic(&self.pointer_path(pointer.pack_id), &bytes)
    }

    pub fn clear(&self, id: PackId) -> PackResult<()> {
        match std::fs::remove_file(self.pointer_path(id)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(map_io(&error)),
        }
    }

    /// The absolute installed directory named by a validated pointer.
    pub fn version_root(&self, pointer: &ActiveVersion) -> PackResult<PathBuf> {
        validate_pointer(pointer.pack_id, pointer)?;
        let root = self.root.join(
            pointer
                .directory
                .replace('/', std::path::MAIN_SEPARATOR_STR),
        );
        if !root.starts_with(&self.root) {
            return Err(PackError::BadRequest);
        }
        Ok(root)
    }
}

fn validate_pointer(id: PackId, pointer: &ActiveVersion) -> PackResult<()> {
    if pointer.schema_version != ACTIVE_SCHEMA_VERSION
        || pointer.pack_id != id
        || !is_valid_semver(&pointer.version)
        || !is_sha256_hex(&pointer.descriptor_sha256)
        || pointer.directory != format!("versions/{}/{}", id.as_str(), pointer.version)
        || pointer
            .previous_version
            .as_deref()
            .is_some_and(|version| !is_valid_semver(version))
    {
        return Err(PackError::BadRequest);
    }
    validate_relative_path(&pointer.directory)
}

/// Extract a pack archive into an empty staging directory after checking
/// every entry against the signed inventory. No absolute path, parent
/// traversal, drive/ADS name, link or extra file is accepted.
pub fn extract_archive(
    archive_path: &Path,
    descriptor: &PackDescriptor,
    staging: &Path,
) -> PackResult<()> {
    if descriptor.files.len() > MAX_PACK_FILES {
        return Err(PackError::BadRequest);
    }
    std::fs::create_dir_all(staging).map_err(|error| map_io(&error))?;
    ensure_empty_directory(staging)?;
    let file = std::fs::File::open(archive_path).map_err(|error| map_io(&error))?;
    let mut archive =
        ZipArchive::new(std::io::BufReader::new(file)).map_err(|_| PackError::BadRequest)?;
    if archive.len() > MAX_PACK_FILES {
        return Err(PackError::BadRequest);
    }
    let limit = install_limit(descriptor).min(MAX_INSTALLED_BYTES);
    let expected: HashMap<String, &PackFile> = descriptor
        .files
        .iter()
        .map(|entry| (entry.path.to_ascii_lowercase(), entry))
        .collect();
    let mut seen = HashSet::new();
    let mut declared_total: u64 = 0;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|_| PackError::BadRequest)?;
        let name = entry.name().map_err(|_| PackError::BadRequest)?.to_string();
        validate_relative_path(&name)?;
        if entry.is_symlink() || unix_mode_is_link(entry.unix_mode()) {
            return Err(PackError::BadRequest);
        }
        if entry.is_dir() {
            let target = target_path(staging, &name)?;
            std::fs::create_dir_all(&target).map_err(|error| map_io(&error))?;
            continue;
        }
        if !entry.is_file() {
            return Err(PackError::BadRequest);
        }
        let Some(expected_file) = expected.get(&name.to_ascii_lowercase()) else {
            return Err(PackError::Changed);
        };
        if entry.size() != expected_file.size {
            return Err(PackError::Changed);
        }
        declared_total = declared_total.saturating_add(entry.size());
        if declared_total > limit {
            return Err(PackError::BadRequest);
        }
        let compressed = entry.compressed_size();
        if entry.size() > 0 && (compressed == 0 || entry.size() / compressed > MAX_ENTRY_RATIO) {
            return Err(PackError::BadRequest);
        }
        if !seen.insert(name.to_ascii_lowercase()) {
            return Err(PackError::BadRequest);
        }
        let target = target_path(staging, &name)?;
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|error| map_io(&error))?;
        }
        let mut output = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&target)
            .map_err(|error| map_io(&error))?;
        copy_entry(&mut entry, &mut output, expected_file.size)?;
        output.flush().map_err(|error| map_io(&error))?;
        output.sync_all().map_err(|error| map_io(&error))?;
        if crate::inventory::hash_file(&target)? != expected_file.sha256 {
            return Err(PackError::BadHash);
        }
    }
    if seen.len() != expected.len() {
        return Err(PackError::Changed);
    }
    Ok(())
}

fn ensure_empty_directory(path: &Path) -> PackResult<()> {
    let mut entries = std::fs::read_dir(path).map_err(|error| map_io(&error))?;
    if entries.next().is_some() {
        return Err(PackError::Changed);
    }
    Ok(())
}

fn unix_mode_is_link(mode: Option<u32>) -> bool {
    mode.is_some_and(|mode| mode & 0o170000 == 0o120000)
}

fn target_path(staging: &Path, relative: &str) -> PackResult<PathBuf> {
    validate_relative_path(relative)?;
    let target = staging.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR));
    if !target.starts_with(staging) {
        return Err(PackError::BadRequest);
    }
    Ok(target)
}

fn copy_entry(
    entry: &mut dyn std::io::Read,
    output: &mut std::fs::File,
    expected: u64,
) -> PackResult<()> {
    let mut buffer = vec![0u8; CHUNK];
    let mut written = 0u64;
    loop {
        let read = entry.read(&mut buffer).map_err(|_| PackError::BadRequest)?;
        if read == 0 {
            break;
        }
        written = written.saturating_add(read as u64);
        if written > expected {
            return Err(PackError::Changed);
        }
        output
            .write_all(&buffer[..read])
            .map_err(|error| map_io(&error))?;
    }
    if written != expected {
        return Err(PackError::Changed);
    }
    Ok(())
}

/// A staging directory that this process has just checked against the exact
/// signed inventory. The private path can only be produced by
/// [`verify_staging`], so activation cannot skip the verification step.
#[derive(Debug)]
pub struct VerifiedStaging {
    path: PathBuf,
}

impl VerifiedStaging {
    pub fn path(&self) -> &Path {
        &self.path
    }
}

/// Verify a complete staging tree against the descriptor. The bounded pack
/// helper writes the tree; the parent (or [`install_and_activate`]) calls
/// this in its own process before activation.
pub fn verify_staging(staging: &Path, descriptor: &PackDescriptor) -> PackResult<VerifiedStaging> {
    verify_tree(staging, descriptor)?;
    Ok(VerifiedStaging {
        path: staging.to_path_buf(),
    })
}

/// Extract, verify, probe and activate one version. Any failure leaves the
/// previous active pointer and directory untouched.
///
/// H04: this is the pure worker used only by a bounded pack-helper process.
/// The main app must not call it from a Tauri job or any other in-process
/// installer; the `--pack-helper` child extracts, the parent verifies with
/// [`verify_staging`] and then calls [`activate_verified`]. Without that
/// helper, install/activation stays unavailable.
pub fn install_and_activate(
    archive_path: &Path,
    descriptor: &PackDescriptor,
    packs_root: &Path,
    now_unix: u64,
    probe: &dyn Fn(&Path, &PackDescriptor) -> Result<(), String>,
) -> PackResult<ActiveVersion> {
    if !is_valid_semver(&descriptor.version)
        || descriptor.files.len() > MAX_PACK_FILES
        || validate_artifact_hash(&descriptor.sha256).is_err()
    {
        return Err(PackError::BadRequest);
    }
    let staging = packs_root
        .join("staging")
        .join(uuid::Uuid::new_v4().to_string());
    if let Err(error) = extract_archive(archive_path, descriptor, &staging) {
        let _ = retire_to_trash(packs_root, &staging, "failed-staging");
        return Err(error);
    }
    let staged = match verify_staging(&staging, descriptor) {
        Ok(staged) => staged,
        Err(error) => {
            let _ = retire_to_trash(packs_root, &staging, "failed-inventory");
            return Err(error);
        }
    };
    activate_verified(staged, descriptor, packs_root, now_unix, probe)
}

/// Activate a staging tree that was verified against the descriptor. The
/// input token makes an unverified tree impossible to activate. The new
/// directory is never written over an existing version.
pub fn activate_verified(
    staged: VerifiedStaging,
    descriptor: &PackDescriptor,
    packs_root: &Path,
    now_unix: u64,
    probe: &dyn Fn(&Path, &PackDescriptor) -> Result<(), String>,
) -> PackResult<ActiveVersion> {
    if !is_valid_semver(&descriptor.version)
        || descriptor.files.len() > MAX_PACK_FILES
        || validate_artifact_hash(&descriptor.sha256).is_err()
    {
        return Err(PackError::BadRequest);
    }
    validate_owned_staging(packs_root, &staged.path)?;
    let staging = staged.path;
    let active = ActiveVersions::new(packs_root);
    let final_dir = packs_root
        .join("versions")
        .join(descriptor.id.as_str())
        .join(&descriptor.version);
    if final_dir.exists() {
        let _ = retire_to_trash(packs_root, &staging, "existing-version");
        return Err(PackError::Busy);
    }
    if let Some(parent) = final_dir.parent() {
        std::fs::create_dir_all(parent).map_err(|error| map_io(&error))?;
    }
    std::fs::rename(&staging, &final_dir).map_err(|error| map_io(&error))?;
    if probe(&final_dir, descriptor).is_err() {
        let _ = retire_to_trash(packs_root, &final_dir, "probe-failed");
        return Err(PackError::Failed);
    }
    let previous = active.read(descriptor.id)?.map(|pointer| pointer.version);
    let pointer = ActiveVersion {
        schema_version: ACTIVE_SCHEMA_VERSION,
        pack_id: descriptor.id,
        version: descriptor.version.clone(),
        directory: format!("versions/{}/{}", descriptor.id.as_str(), descriptor.version),
        descriptor_sha256: descriptor.digest(),
        previous_version: previous.filter(|version| version != &descriptor.version),
        activated_unix: now_unix,
    };
    if let Err(error) = active.write(&pointer) {
        let _ = retire_to_trash(packs_root, &final_dir, "pointer-failed");
        return Err(error);
    }
    Ok(pointer)
}

/// The parent and the helper both accept only `<packs>/staging/<uuid>`.
fn validate_owned_staging(packs_root: &Path, staging: &Path) -> PackResult<()> {
    let expected = packs_root.join("staging");
    let relative = staging
        .strip_prefix(&expected)
        .map_err(|_| PackError::BadRequest)?;
    let mut components = relative.components();
    let Some(Component::Normal(name)) = components.next() else {
        return Err(PackError::BadRequest);
    };
    if components.next().is_some() {
        return Err(PackError::BadRequest);
    }
    let name = name.to_str().ok_or(PackError::BadRequest)?;
    let uuid = uuid::Uuid::parse_str(name).map_err(|_| PackError::BadRequest)?;
    if name.len() != 36 || uuid.hyphenated().to_string() != name.to_ascii_lowercase() {
        return Err(PackError::BadRequest);
    }
    Ok(())
}

/// Switch back to the previous version after verifying its inventory.
pub fn rollback(
    active: &ActiveVersions,
    catalog: &PackCatalog,
    id: PackId,
    now_unix: u64,
) -> PackResult<ActiveVersion> {
    let current = active.read(id)?.ok_or(PackError::Unavailable)?;
    let previous_version = current
        .previous_version
        .clone()
        .ok_or(PackError::Unavailable)?;
    let descriptor = catalog
        .descriptor(id, &previous_version)
        .ok_or(PackError::Unavailable)?;
    let directory = format!("versions/{}/{}", id.as_str(), previous_version);
    let root = active
        .packs_root()
        .join(directory.replace('/', std::path::MAIN_SEPARATOR_STR));
    verify_tree(&root, descriptor)?;
    let pointer = ActiveVersion {
        schema_version: ACTIVE_SCHEMA_VERSION,
        pack_id: id,
        version: previous_version,
        directory,
        descriptor_sha256: descriptor.digest(),
        previous_version: Some(current.version),
        activated_unix: now_unix,
    };
    active.write(&pointer)?;
    Ok(pointer)
}

/// Move an owned app directory out of the way instead of deleting it. The
/// move is a rename on the same volume; a foreign path is never guessed.
pub fn retire_to_trash(packs_root: &Path, path: &Path, reason: &str) -> PackResult<PathBuf> {
    if !path.exists() {
        return Ok(path.to_path_buf());
    }
    let trash = packs_root.join("trash");
    std::fs::create_dir_all(&trash).map_err(|error| map_io(&error))?;
    let name = format!(
        "{}-{}-{reason}",
        uuid::Uuid::new_v4(),
        path.file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| "owned".to_string())
    );
    let destination = trash.join(name);
    std::fs::rename(path, &destination).map_err(|error| map_io(&error))?;
    Ok(destination)
}

pub use crate::install_state::{
    clear_pending_remove, is_pending_remove, mark_pending_remove, retire_active_version,
    scan_states,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imported_version_paths_refuse_traversal() {
        let mut pointer = ActiveVersion {
            schema_version: ACTIVE_SCHEMA_VERSION,
            pack_id: PackId::Media,
            version: "1.0.0".to_string(),
            directory: "versions/media/../../outside".to_string(),
            descriptor_sha256: "a".repeat(64),
            previous_version: None,
            activated_unix: 1,
        };
        pointer.directory = "versions/media/../outside".to_string();
        let root = PathBuf::from("packs");
        let active = ActiveVersions::new(&root);
        // The validation is on the pointer text, before any join.
        assert!(validate_relative_path(&pointer.directory).is_err());
        assert!(active.version_root(&pointer).is_err());
    }
}
