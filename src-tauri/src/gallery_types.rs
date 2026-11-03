//! Gallery data contracts (Step 07c, revision `gallery-source-1`).
//!
//! Canonical Rust shapes for the Gallery sources, settings, items and pages.
//! The TypeScript mirror lives in `src/services/gallery.ts`; fields are
//! snake_case on both sides and no other module redeclares these types.
//!
//! Paths are stored exactly as the user chose them (display form). Comparison
//! uses `gallery_path_key`, which strips the `\\?\` prefix, normalizes
//! separators and ignores case, so a duplicate root cannot slip in through a
//! different spelling.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Component, Path};

/// Most picture folders one Gallery may use (decision D2).
pub const MAX_GALLERY_SOURCES: usize = 32;
/// Longest source path in UTF-16 units (decision D2).
pub const MAX_GALLERY_SOURCE_PATH_UTF16: usize = 32_768;
/// Most rows in one `GalleryPage` (decision D6).
pub const MAX_GALLERY_PAGE_ROWS: usize = 256;
/// The page stops before its JSON would exceed this size (decision D6).
pub const MAX_GALLERY_PAGE_BYTES: usize = 768 * 1024;
/// Most source ids carried by one item (D2 allows at most 32 sources).
pub const MAX_GALLERY_SOURCE_IDS: usize = 32;
/// Longest source id accepted from a saved setting.
pub const MAX_GALLERY_ID_CHARS: usize = 64;

fn default_true() -> bool {
    true
}

fn default_date_source() -> String {
    "taken".to_string()
}

/// One folder the user chose for the Gallery. `path` is kept in display form
/// (without the `\\?\` prefix) so it is exactly what the user picked.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GallerySource {
    pub id: String,
    pub path: String,
    #[serde(default = "default_true")]
    pub recursive: bool,
}

/// The persisted `gallery` settings section (schema 13). Only what the user
/// chose is stored: no results, grants or metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GallerySettings {
    #[serde(default)]
    pub sources: Vec<GallerySource>,
    #[serde(default = "default_date_source")]
    pub date_source: String,
}

impl Default for GallerySettings {
    fn default() -> Self {
        Self {
            sources: Vec::new(),
            date_source: default_date_source(),
        }
    }
}

/// Which date groups pictures: `Date taken` or `Date modified`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GalleryDateSource {
    Taken,
    Modified,
}

/// `"taken"` or `"modified"`; anything else is `gallery.bad_request`.
pub fn parse_date_source(value: &str) -> Result<GalleryDateSource, String> {
    match value {
        "taken" => Ok(GalleryDateSource::Taken),
        "modified" => Ok(GalleryDateSource::Modified),
        _ => Err("gallery.bad_request".to_string()),
    }
}

/// One picture in a Gallery page. `item` is the Explorer's own item shape
/// (Step 02), imported rather than redeclared.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GalleryItem {
    pub item: crate::explorer::ExplorerItem,
    /// Volume/file id when the listing provides a stable one; otherwise
    /// `path:<normalized path>`. Used to merge overlapping sources.
    pub identity: String,
    /// ISO UTC from the metadata service (Step 07b), when it was allowed to
    /// read it. Never filled from a cloud placeholder in the background.
    #[serde(default)]
    pub taken_utc: Option<String>,
    /// `YYYY-MM` (UTC) or `undated`; the UI reformats it for the local month.
    pub group_key: String,
    pub source_ids: Vec<String>,
}

/// One page of results. `next_cursor` is opaque and tied to the scan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GalleryPage {
    pub generation: String,
    pub items: Vec<GalleryItem>,
    pub next_cursor: Option<String>,
    pub complete: bool,
    pub partial: bool,
    pub skipped_count: u32,
    pub limit_reason: Option<String>,
}

/// What the UI asks Rust to scan. `request_id` is the shared job id; the
/// sources and flags are revalidated here, never trusted from the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GalleryStartRequest {
    #[serde(default)]
    pub request_id: String,
    pub sources: Vec<GallerySource>,
    #[serde(default = "default_date_source")]
    pub date_source: String,
    #[serde(default)]
    pub show_hidden: bool,
    #[serde(default)]
    pub show_system: bool,
}

/// The display form of a stored path (without `\\?\`).
pub fn display_gallery_path(path: &str) -> String {
    crate::explorer::display_path(path)
}

/// Comparison key for a source or file path: display form, `\` separators,
/// no trailing separator (except a drive root) and case-insensitive.
pub fn gallery_path_key(path: &str) -> String {
    let display = display_gallery_path(path);
    let mut key = display.replace('/', "\\");
    while key.len() > 3 && key.ends_with('\\') {
        key.pop();
    }
    key.to_lowercase()
}

/// The volume part of a path: `c:` or `\\server\share`. Used to keep file ids
/// from different volumes apart.
pub fn volume_key(path: &Path) -> String {
    let text = display_gallery_path(path.to_string_lossy().as_ref()).replace('/', "\\");
    if let Some(rest) = text.strip_prefix("\\\\") {
        let mut parts = rest.splitn(3, '\\');
        let server = parts.next().unwrap_or("");
        let share = parts.next().unwrap_or("");
        format!("\\\\{server}\\{share}").to_lowercase()
    } else if text.len() >= 2 && text.as_bytes()[1] == b':' {
        text[..2].to_lowercase()
    } else {
        String::new()
    }
}

/// An absolute Windows path without `..` parts, as the settings require.
pub fn is_absolute_gallery_path(path: &str) -> bool {
    let parsed = Path::new(path);
    fs_service::validate_path_input(path).is_ok()
        && !path.replace('/', "\\").split('\\').any(|part| part == ".")
        && parsed.is_absolute()
        && !parsed
            .components()
            .any(|part| matches!(part, Component::ParentDir))
}

/// Validate one source: UUID id, absolute path, at most 32,768 UTF-16 units.
pub fn validate_gallery_source(source: &GallerySource) -> Result<(), String> {
    if source.id.is_empty()
        || source.id.chars().count() > MAX_GALLERY_ID_CHARS
        || uuid::Uuid::parse_str(&source.id).is_err()
    {
        return Err("gallery.bad_request".to_string());
    }
    if source.path.is_empty()
        || source.path.encode_utf16().count() > MAX_GALLERY_SOURCE_PATH_UTF16
        || !is_absolute_gallery_path(&source.path)
    {
        return Err("gallery.bad_request".to_string());
    }
    Ok(())
}

/// Validate a whole source list: at most 32, unique after normalization.
pub fn validate_sources(sources: &[GallerySource]) -> Result<(), String> {
    if sources.len() > MAX_GALLERY_SOURCES {
        return Err("gallery.too_many".to_string());
    }
    let mut seen: HashSet<String> = HashSet::new();
    let mut ids = HashSet::new();
    for source in sources {
        validate_gallery_source(source)?;
        if !ids.insert(uuid::Uuid::parse_str(&source.id).map_err(|_| "gallery.bad_request")?) {
            return Err("gallery.bad_request".into());
        }
        if !seen.insert(gallery_path_key(source.path.as_str())) {
            return Err("gallery.bad_request".to_string());
        }
    }
    Ok(())
}

/// Validate the persisted settings section.
pub fn validate_gallery_settings(settings: &GallerySettings) -> Result<(), String> {
    parse_date_source(&settings.date_source)?;
    validate_sources(&settings.sources)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(index: u32, path: &str) -> GallerySource {
        GallerySource {
            id: format!("00000000-0000-4000-8000-{index:012}"),
            path: path.to_string(),
            recursive: true,
        }
    }

    #[test]
    fn empty_sources_are_valid() {
        let settings = GallerySettings::default();
        assert!(settings.sources.is_empty());
        assert_eq!(settings.date_source, "taken");
        assert!(validate_gallery_settings(&settings).is_ok());
    }

    #[test]
    fn thirty_three_sources_are_refused() {
        let sources: Vec<GallerySource> = (0..33)
            .map(|n| source(n, &format!("C:\\Pictures\\set{n}")))
            .collect();
        assert_eq!(validate_sources(&sources).unwrap_err(), "gallery.too_many");
    }

    #[test]
    fn duplicate_paths_with_case_and_long_prefix_are_refused() {
        let first = source(1, "C:\\Pictures\\Holiday");
        let second = source(2, "\\\\?\\c:\\pictures\\HOLIDAY\\");
        assert_eq!(
            validate_sources(&[first, second]).unwrap_err(),
            "gallery.bad_request"
        );
    }

    #[test]
    fn date_source_only_accepts_taken_or_modified() {
        assert_eq!(
            parse_date_source("taken").unwrap(),
            GalleryDateSource::Taken
        );
        assert_eq!(
            parse_date_source("modified").unwrap(),
            GalleryDateSource::Modified
        );
        assert_eq!(
            parse_date_source("created").unwrap_err(),
            "gallery.bad_request"
        );
    }

    #[test]
    fn relative_and_parent_paths_are_refused() {
        assert_eq!(
            validate_gallery_source(&source(1, "Pictures")).unwrap_err(),
            "gallery.bad_request"
        );
        assert_eq!(
            validate_gallery_source(&source(2, "C:\\Pictures\\..\\Secrets")).unwrap_err(),
            "gallery.bad_request"
        );
    }

    #[test]
    fn source_ids_must_be_uuids() {
        let mut bad = source(1, "C:\\Pictures");
        bad.id = "not-a-uuid".to_string();
        assert_eq!(
            validate_gallery_source(&bad).unwrap_err(),
            "gallery.bad_request"
        );
    }

    #[test]
    fn volume_keys_keep_volumes_apart() {
        assert_eq!(volume_key(Path::new("C:\\Pictures\\a.png")), "c:");
        assert_eq!(
            volume_key(Path::new("\\\\server\\share\\a.png")),
            "\\\\server\\share"
        );
        assert_eq!(
            volume_key(Path::new("\\\\?\\UNC\\server\\share\\a.png")),
            "\\\\server\\share"
        );
    }
}
