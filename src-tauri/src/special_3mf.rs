//! Bounded 3MF archive preflight (Step 07g U4/D2).
//!
//! A 3MF file is a ZIP archive. The app never hands the archive to a
//! generic unpacker: this module validates every entry's name and declared
//! size, then reads only the texture resources the helper may request.
//! The original archive reaches the isolated helper as one guarded grant.

use std::io::Read;
use std::path::Path;

use fs_service::owned_io::{PinnedSource, SourceIdentity};

pub const MAX_ENTRIES: usize = 10_000;
pub const MAX_EXPANDED: u64 = 512 * 1024 * 1024;
pub const MAX_RATIO: u64 = 500;
pub const MAX_PATH: usize = 1024;
pub const MAX_DEPTH: usize = 64;
pub const MAX_TEXTURES: usize = 32;
pub const MAX_TEXTURE_BYTES: u64 = 16 * 1024 * 1024;
pub const MAX_TEXTURES_TOTAL: u64 = 128 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct ThreeMfTexture {
    /// Normalized archive path without a leading slash, for example
    /// `3D/Textures/wood.png`.
    pub name: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Default)]
pub struct ThreeMfResources {
    pub textures: Vec<ThreeMfTexture>,
    pub partial: bool,
}

fn refused() -> String {
    "special_view.unsupported".to_string()
}

fn corrupt() -> String {
    "special_view.corrupt".to_string()
}

/// Normalize an archive name and refuse absolute paths, drive letters, UNC
/// names, `..`, empty segments and over-deep paths.
pub fn safe_entry_name(name: &str) -> Result<String, String> {
    if name.is_empty() || name.len() > MAX_PATH {
        return Err(refused());
    }
    let slashed = name.replace('\\', "/");
    if slashed.starts_with('/')
        || slashed.starts_with("//")
        || (slashed.as_bytes().get(1) == Some(&b':')
            && slashed
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_alphabetic))
    {
        return Err(refused());
    }
    let segments: Vec<&str> = slashed.split('/').collect();
    if segments.len() > MAX_DEPTH
        || segments
            .iter()
            .any(|segment| segment.is_empty() || *segment == "." || *segment == "..")
    {
        return Err(refused());
    }
    Ok(segments.join("/"))
}

fn texture_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.starts_with("3d/textures/")
        && (lower.ends_with(".png") || lower.ends_with(".jpg") || lower.ends_with(".jpeg"))
}

/// Open one guarded 3MF, enforce every archive bound, and copy at most 32
/// small texture resources into memory. No other entry is read.
pub fn read_3mf_resources(path: &Path) -> Result<ThreeMfResources, String> {
    let identity =
        SourceIdentity::capture(path).map_err(|_| "special_view.unavailable".to_string())?;
    let mut source = PinnedSource::open_background(path, &identity)
        .map_err(|_| "special_view.changed".to_string())?;
    let mut archive = zip::ZipArchive::new(source.file_mut()).map_err(|_| corrupt())?;
    if archive.len() > MAX_ENTRIES {
        return Err("special_view.too_large".to_string());
    }

    let mut names: Vec<String> = Vec::new();
    let mut expanded = 0u64;
    for index in 0..archive.len() {
        let entry = archive.by_index_raw(index).map_err(|_| corrupt())?;
        if entry.is_dir() {
            continue;
        }
        let name = safe_entry_name(&entry.name().map_err(|_| corrupt())?)?;
        if names
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(&name))
        {
            return Err(corrupt());
        }
        names.push(name);
        let size = entry.size();
        expanded = expanded
            .checked_add(size)
            .ok_or_else(|| "special_view.too_large".to_string())?;
        if expanded > MAX_EXPANDED {
            return Err("special_view.too_large".to_string());
        }
        let compressed = entry.compressed_size();
        if size > 0 && (compressed == 0 || size / compressed.max(1) > MAX_RATIO) {
            return Err("special_view.too_large".to_string());
        }
        if entry.encrypted() {
            return Err(refused());
        }
    }

    let mut resources = ThreeMfResources::default();
    let mut total = 0u64;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|_| corrupt())?;
        if entry.is_dir() {
            continue;
        }
        let name = safe_entry_name(&entry.name().map_err(|_| corrupt())?)?;
        if !texture_name(&name) {
            continue;
        }
        if name.len() > 255 {
            resources.partial = true;
            continue;
        }
        if resources.textures.len() >= MAX_TEXTURES {
            resources.partial = true;
            continue;
        }
        let size = entry.size();
        if size == 0 || size > MAX_TEXTURE_BYTES {
            resources.partial = true;
            continue;
        }
        total = total
            .checked_add(size)
            .ok_or_else(|| "special_view.too_large".to_string())?;
        if total > MAX_TEXTURES_TOTAL {
            resources.partial = true;
            continue;
        }
        let mut bytes = Vec::with_capacity(size as usize);
        let mut limited = (&mut entry).take(size + 1);
        limited.read_to_end(&mut bytes).map_err(|_| corrupt())?;
        if bytes.len() as u64 != size {
            return Err(corrupt());
        }
        resources.textures.push(ThreeMfTexture { name, bytes });
    }
    drop(archive);
    source
        .verify_after_read()
        .map_err(|_| "special_view.changed".to_string())?;
    Ok(resources)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    fn zip_with(entries: &[(&str, &[u8])], name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("adperastra-3mf-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("model.3mf");
        let file = fs::File::create(&path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        for (entry_name, bytes) in entries {
            writer
                .start_file(*entry_name, zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap();
        path
    }

    #[test]
    fn reads_only_bounded_textures() {
        let path = zip_with(
            &[
                ("3D/3dmodel.model", b"<model/>"),
                ("3D/Textures/wood.png", b"not-a-real-png"),
            ],
            "textures",
        );
        let resources = read_3mf_resources(&path).unwrap();
        assert_eq!(resources.textures.len(), 1);
        assert_eq!(resources.textures[0].name, "3D/Textures/wood.png");
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn refuses_traversal_entries() {
        let path = zip_with(&[("3D/Textures/../../evil.png", b"x")], "traversal");
        assert!(read_3mf_resources(&path).is_err());
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn refuses_duplicate_names_case_insensitively() {
        let path = zip_with(
            &[("3D/Textures/a.png", b"a"), ("3D/Textures/A.png", b"b")],
            "duplicate",
        );
        assert!(read_3mf_resources(&path).is_err());
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}
