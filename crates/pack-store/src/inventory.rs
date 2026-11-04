//! Signed-inventory verification: every installed file must match the exact
//! size and SHA-256 in the descriptor, and no extra file may exist.

use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::error::{map_io, PackError, PackResult};
use crate::types::PackDescriptor;
use crate::validation::validate_capability;

const HASH_CHUNK: usize = 64 * 1024;

/// The maximum number of files one installed tree may hold.
pub const MAX_INVENTORY_FILES: usize = 100_000;

/// Hash one file with SHA-256, streaming and bounded only by the file itself.
pub fn hash_file(path: &Path) -> PackResult<String> {
    let mut file = std::fs::File::open(path).map_err(|error| map_io(&error))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; HASH_CHUNK];
    loop {
        let read = file.read(&mut buffer).map_err(|error| map_io(&error))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex(hasher.finalize()))
}

fn hex(digest: impl AsRef<[u8]>) -> String {
    let mut text = String::with_capacity(64);
    for byte in digest.as_ref() {
        use std::fmt::Write;
        let _ = write!(text, "{byte:02x}");
    }
    text
}

/// Verify a complete installed directory against the descriptor. Missing,
/// extra, oversized, undersized or changed files all fail the activation.
pub fn verify_tree(root: &Path, descriptor: &PackDescriptor) -> PackResult<()> {
    let metadata = std::fs::symlink_metadata(root).map_err(|error| map_io(&error))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(PackError::Failed);
    }
    let expected: HashMap<String, &crate::types::PackFile> = descriptor
        .files
        .iter()
        .map(|file| (file.path.to_ascii_lowercase(), file))
        .collect();
    let mut seen = HashSet::new();
    let mut pending = vec![root.to_path_buf()];
    let mut checked = 0usize;
    while let Some(directory) = pending.pop() {
        for entry in std::fs::read_dir(&directory).map_err(|error| map_io(&error))? {
            let entry = entry.map_err(|error| map_io(&error))?;
            let path = entry.path();
            let file_type = entry.file_type().map_err(|error| map_io(&error))?;
            if file_type.is_symlink() {
                return Err(PackError::BadRequest);
            }
            if file_type.is_dir() {
                pending.push(path);
                continue;
            }
            if !file_type.is_file() {
                return Err(PackError::BadRequest);
            }
            checked += 1;
            if checked > MAX_INVENTORY_FILES {
                return Err(PackError::Failed);
            }
            let relative = relative_text(root, &path)?;
            let key = relative.to_ascii_lowercase();
            let Some(expected_file) = expected.get(&key) else {
                return Err(PackError::Changed);
            };
            if !seen.insert(key) {
                return Err(PackError::BadRequest);
            }
            let size = entry.metadata().map_err(|error| map_io(&error))?.len();
            if size != expected_file.size {
                return Err(PackError::Changed);
            }
            if hash_file(&path)? != expected_file.sha256 {
                return Err(PackError::BadHash);
            }
        }
    }
    if seen.len() != expected.len() {
        return Err(PackError::Changed);
    }
    Ok(())
}

fn relative_text(root: &Path, path: &Path) -> PackResult<String> {
    let relative = path.strip_prefix(root).map_err(|_| PackError::BadRequest)?;
    let mut text = String::new();
    for component in relative.components() {
        let part = component.as_os_str().to_string_lossy();
        if part.is_empty() || part == "." || part == ".." || part.contains('\\') {
            return Err(PackError::BadRequest);
        }
        if !text.is_empty() {
            text.push('/');
        }
        text.push_str(&part);
    }
    if text.is_empty() {
        return Err(PackError::BadRequest);
    }
    Ok(text)
}

/// Resolve one capability to an installed file after revalidating its size
/// and hash. Used before a trusted native caller launches the file.
pub fn capability_path(
    root: &Path,
    descriptor: &PackDescriptor,
    capability: &str,
) -> PackResult<PathBuf> {
    validate_capability(descriptor, capability)?;
    let relative = descriptor
        .entrypoint(capability)
        .ok_or(PackError::CapabilityMissing)?;
    crate::validation::validate_relative_path(relative)?;
    let path = root.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR));
    let canonical_root = root.canonicalize().map_err(|error| map_io(&error))?;
    let canonical = path.canonicalize().map_err(|error| map_io(&error))?;
    if !canonical.starts_with(&canonical_root) {
        return Err(PackError::CapabilityMissing);
    }
    let expected = descriptor
        .files
        .iter()
        .find(|file| file.path.eq_ignore_ascii_case(relative))
        .ok_or(PackError::CapabilityMissing)?;
    let metadata = std::fs::symlink_metadata(&canonical).map_err(|error| map_io(&error))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(PackError::CapabilityMissing);
    }
    if metadata.len() != expected.size || hash_file(&canonical)? != expected.sha256 {
        return Err(PackError::Changed);
    }
    Ok(canonical)
}
