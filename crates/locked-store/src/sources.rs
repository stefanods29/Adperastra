//! Explicit folder enumeration for one encrypted copy (Step 09k D7). Links,
//! reparse points, device/ADS names and online-only placeholders are skipped,
//! never followed and never hydrated. A skipped item is counted so the UI
//! can say the copy is partial.

use std::fs;
use std::path::{Path, PathBuf};

use fs_service::owned_io::SourceIdentity;

use crate::error::{LockedError, LockedResult};
use crate::limits::{MAX_DEPTH, MAX_INDEX_ENTRIES, MAX_NAME_UTF16, MAX_RELATIVE_PATH_UTF16};
use crate::validation::valid_name;

#[derive(Debug, Clone)]
pub struct SourceFolder {
    pub relative: Vec<String>,
    pub modified_unix: u64,
    pub hidden: bool,
    pub system: bool,
    pub read_only: bool,
}

#[derive(Debug, Clone)]
pub struct SourceFile {
    pub relative: Vec<String>,
    pub path: PathBuf,
    pub size: u64,
    pub modified_unix: u64,
    pub identity: SourceIdentity,
    pub from_internet: bool,
    pub hidden: bool,
    pub system: bool,
    pub read_only: bool,
}

#[derive(Debug, Default)]
pub struct SourceTree {
    pub folders: Vec<SourceFolder>,
    pub files: Vec<SourceFile>,
    pub skipped: u32,
}

pub fn relative_key(relative: &[String]) -> String {
    relative.join("\\").to_lowercase()
}

pub fn relative_path_units(relative: &[String]) -> usize {
    relative
        .iter()
        .map(|part| part.encode_utf16().count())
        .sum::<usize>()
        .saturating_add(relative.len().saturating_sub(1))
}

pub fn collect_sources(
    root: &Path,
    is_from_internet: &dyn Fn(&Path) -> bool,
) -> LockedResult<SourceTree> {
    let metadata = fs::symlink_metadata(root).map_err(|_| LockedError::Invalid)?;
    if !metadata.is_dir() || is_link(&metadata) {
        return Err(LockedError::Invalid);
    }
    let mut tree = SourceTree::default();
    walk(root, &mut Vec::new(), 0, is_from_internet, &mut tree)?;
    tree.folders.sort_by_key(|left| left.relative.join("\\"));
    tree.files.sort_by_key(|left| left.relative.join("\\"));
    Ok(tree)
}

fn walk(
    directory: &Path,
    relative: &mut Vec<String>,
    depth: usize,
    is_from_internet: &dyn Fn(&Path) -> bool,
    tree: &mut SourceTree,
) -> LockedResult<()> {
    if depth >= MAX_DEPTH {
        tree.skipped = tree.skipped.saturating_add(1);
        return Ok(());
    }
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(_) => {
            tree.skipped = tree.skipped.saturating_add(1);
            return Ok(());
        }
    };
    let mut children: Vec<_> = Vec::new();
    for child in entries {
        match child {
            Ok(child) => children.push(child),
            Err(_) => tree.skipped = tree.skipped.saturating_add(1),
        }
    }
    children.sort_by(|left, right| {
        left.file_name()
            .to_string_lossy()
            .to_lowercase()
            .cmp(&right.file_name().to_string_lossy().to_lowercase())
    });
    for child in children {
        let name = child.file_name().to_string_lossy().into_owned();
        if !valid_name(&name) || name.encode_utf16().count() > MAX_NAME_UTF16 {
            tree.skipped = tree.skipped.saturating_add(1);
            continue;
        }
        relative.push(name.clone());
        if relative_path_units(relative) > MAX_RELATIVE_PATH_UTF16 {
            relative.pop();
            tree.skipped = tree.skipped.saturating_add(1);
            continue;
        }
        let path = child.path();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => {
                relative.pop();
                tree.skipped = tree.skipped.saturating_add(1);
                continue;
            }
        };
        if is_link(&metadata) || is_online_only(&metadata) {
            relative.pop();
            tree.skipped = tree.skipped.saturating_add(1);
            continue;
        }
        if tree.folders.len().saturating_add(tree.files.len()) >= MAX_INDEX_ENTRIES {
            return Err(LockedError::TooLarge);
        }
        if metadata.is_dir() {
            tree.folders.push(SourceFolder {
                relative: relative.clone(),
                modified_unix: modified_of(&metadata),
                hidden: is_hidden(&metadata),
                system: is_system(&metadata),
                read_only: is_read_only(&metadata),
            });
            walk(&path, relative, depth + 1, is_from_internet, tree)?;
        } else if metadata.is_file() {
            let identity = match SourceIdentity::capture(&path) {
                Ok(identity) => identity,
                Err(_) => {
                    relative.pop();
                    tree.skipped = tree.skipped.saturating_add(1);
                    continue;
                }
            };
            let from_internet = is_from_internet(&path);
            tree.files.push(SourceFile {
                relative: relative.clone(),
                path,
                size: metadata.len(),
                modified_unix: modified_of(&metadata),
                identity,
                from_internet,
                hidden: is_hidden(&metadata),
                system: is_system(&metadata),
                read_only: is_read_only(&metadata),
            });
        } else {
            tree.skipped = tree.skipped.saturating_add(1);
        }
        relative.pop();
    }
    Ok(())
}

fn modified_of(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|age| age.as_secs())
        .unwrap_or(0)
}

#[cfg(windows)]
fn attributes(metadata: &fs::Metadata) -> u32 {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes()
}

#[cfg(not(windows))]
fn attributes(_metadata: &fs::Metadata) -> u32 {
    0
}

pub fn is_link(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink() || attributes(metadata) & 0x400 != 0
}

pub fn is_online_only(metadata: &fs::Metadata) -> bool {
    let flags = attributes(metadata);
    flags & (0x0000_1000 | 0x0004_0000 | 0x0040_0000) != 0
}

fn is_hidden(metadata: &fs::Metadata) -> bool {
    attributes(metadata) & 0x2 != 0
}

fn is_system(metadata: &fs::Metadata) -> bool {
    attributes(metadata) & 0x4 != 0
}

fn is_read_only(metadata: &fs::Metadata) -> bool {
    attributes(metadata) & 0x1 != 0
}

/// A small extension map for the presenters; no new dependency.
pub fn mime_for_name(name: &str) -> &'static str {
    let extension = name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "txt" | "log" | "ini" | "cfg" | "conf" | "env" | "srt" => "text/plain; charset=utf-8",
        "md" | "markdown" => "text/markdown; charset=utf-8",
        "csv" => "text/csv; charset=utf-8",
        "tsv" => "text/tab-separated-values; charset=utf-8",
        "json" | "ipynb" => "application/json",
        "xml" => "application/xml",
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" | "cjs" => "text/javascript; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" | "jfif" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "pdf" => "application/pdf",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "zip" => "application/zip",
        "7z" => "application/x-7z-compressed",
        _ => "application/octet-stream",
    }
}
