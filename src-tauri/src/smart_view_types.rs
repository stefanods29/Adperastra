//! Canonical smart-view DTOs (Step 11b, `smart-views-1`).
//!
//! These types are the wire contract between `smartViews.ts` and the native
//! indexed-view commands. A smart folder stores only the id of a saved search;
//! a view page always carries real `SearchResult` rows from Step 11a, never a
//! second filesystem list.

use serde::{Deserialize, Serialize};

use search_index::limits::is_safe_u64;
use search_index::types::{validate_uuid, DateField, SearchQuery, SearchResult};

pub const MAX_VIEW_BUCKETS: usize = 128;
pub const MAX_VIEW_RESULTS: usize = 256;
pub const MAX_VIEW_PAGE_BYTES: usize = 768 * 1024;
pub const MAX_SMART_FOLDERS: usize = 100;
pub const MAX_SMART_FOLDER_NAME: usize = 60;
pub const MAX_SMART_FOLDER_BYTES: usize = 256 * 1024;
pub const SMART_FOLDER_SCHEMA_VERSION: u32 = 1;

/// The five indexed views. `indexed_views.rs` serves the first three; the
/// activity ring (T5) and the map (T6) own the other two.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum IndexedView {
    #[default]
    Timeline,
    Calendar,
    ByKind,
    RecentActivity,
    Map,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum DateSource {
    #[default]
    Modified,
    Created,
    DateTaken,
}

impl DateSource {
    pub fn field(self) -> DateField {
        match self {
            DateSource::Modified => DateField::Modified,
            DateSource::Created => DateField::Created,
            DateSource::DateTaken => DateField::DateTaken,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ViewGroup {
    #[default]
    Day,
    Week,
    Month,
    Year,
}

/// Fixed groups of the By kind view. Order is the order the view shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewKind {
    Documents,
    Spreadsheets,
    Presentations,
    Pdf,
    Images,
    Video,
    Audio,
    Archives,
    Code,
    Other,
}

impl ViewKind {
    pub const ALL: [ViewKind; 10] = [
        ViewKind::Documents,
        ViewKind::Spreadsheets,
        ViewKind::Presentations,
        ViewKind::Pdf,
        ViewKind::Images,
        ViewKind::Video,
        ViewKind::Audio,
        ViewKind::Archives,
        ViewKind::Code,
        ViewKind::Other,
    ];

    pub fn id(self) -> &'static str {
        match self {
            ViewKind::Documents => "documents",
            ViewKind::Spreadsheets => "spreadsheets",
            ViewKind::Presentations => "presentations",
            ViewKind::Pdf => "pdf",
            ViewKind::Images => "images",
            ViewKind::Video => "video",
            ViewKind::Audio => "audio",
            ViewKind::Archives => "archives",
            ViewKind::Code => "code",
            ViewKind::Other => "other",
        }
    }

    pub fn label_key(self) -> &'static str {
        match self {
            ViewKind::Documents => "views.kindDocuments",
            ViewKind::Spreadsheets => "views.kindSpreadsheets",
            ViewKind::Presentations => "views.kindPresentations",
            ViewKind::Pdf => "views.kindPdf",
            ViewKind::Images => "views.kindImages",
            ViewKind::Video => "views.kindVideo",
            ViewKind::Audio => "views.kindAudio",
            ViewKind::Archives => "views.kindArchives",
            ViewKind::Code => "views.kindCode",
            ViewKind::Other => "views.kindOther",
        }
    }

    /// Lower-case extensions without the leading dot. `Other` has none: it is
    /// every extension outside the union of the other groups.
    pub fn extensions(self) -> &'static [&'static str] {
        match self {
            ViewKind::Documents => &["doc", "docx", "odt", "rtf", "txt", "md", "markdown"],
            ViewKind::Spreadsheets => &["xls", "xlsx", "ods", "csv", "tsv"],
            ViewKind::Presentations => &["ppt", "pptx", "odp"],
            ViewKind::Pdf => &["pdf"],
            ViewKind::Images => &[
                "png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff", "webp", "ico", "heic", "avif",
                "raw",
            ],
            ViewKind::Video => &["mp4", "mkv", "mov", "avi", "webm", "wmv", "m4v"],
            ViewKind::Audio => &["mp3", "wav", "flac", "ogg", "m4a", "aac", "wma"],
            ViewKind::Archives => &["zip", "7z", "rar", "tar", "gz", "xz", "bz2", "zst"],
            ViewKind::Code => &[
                "rs", "ts", "tsx", "js", "jsx", "py", "c", "h", "cpp", "cs", "go", "java", "json",
                "xml", "html", "css",
            ],
            ViewKind::Other => &[],
        }
    }

    #[allow(dead_code)]
    pub fn from_name(name: &str) -> ViewKind {
        let extension = name
            .rsplit_once('.')
            .map(|(_, value)| value.to_ascii_lowercase())
            .unwrap_or_default();
        ViewKind::from_extension(&extension)
    }

    pub fn from_extension(extension: &str) -> ViewKind {
        for kind in ViewKind::ALL {
            if kind != ViewKind::Other && kind.extensions().contains(&extension) {
                return kind;
            }
        }
        ViewKind::Other
    }

    /// Every extension claimed by a group other than `Other`.
    pub fn known_extensions() -> Vec<String> {
        let mut values: Vec<String> = ViewKind::ALL
            .iter()
            .filter(|kind| **kind != ViewKind::Other)
            .flat_map(|kind| kind.extensions().iter().map(|value| (*value).to_string()))
            .collect();
        values.sort();
        values.dedup();
        values
    }
}

/// One page request. `month` is a local calendar month, `kind` a By kind
/// group, and `cursor` the opaque `next_cursor` of the previous page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IndexedViewQuery {
    pub view: IndexedView,
    pub query: SearchQuery,
    #[serde(default)]
    pub date_source: DateSource,
    #[serde(default)]
    pub group: ViewGroup,
    #[serde(default)]
    pub month: Option<String>,
    #[serde(default)]
    pub kind: Option<ViewKind>,
    #[serde(default)]
    pub cursor: Option<String>,
}

impl IndexedViewQuery {
    pub fn validate(&self) -> Result<(), String> {
        self.query
            .validate()
            .map_err(|_| "views.invalid".to_string())?;
        if let Some(month) = &self.month {
            if parse_month(month).is_none() {
                return Err("views.invalid".to_string());
            }
        }
        if let Some(cursor) = &self.cursor {
            validate_uuid(cursor).map_err(|_| "views.invalid".to_string())?;
        }
        Ok(())
    }

    /// A copy with the cursor removed, used as the paging fingerprint.
    pub fn without_cursor(&self) -> Self {
        let mut copy = self.clone();
        copy.cursor = None;
        copy
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ViewBucket {
    /// Stable id: `YYYY-MM-DD`, `YYYY-MM`, `YYYY`, `undated`, or a kind id.
    pub id: String,
    #[serde(default)]
    pub label_key: Option<String>,
    #[serde(default)]
    pub date_from_unix: Option<u64>,
    #[serde(default)]
    pub date_to_unix: Option<u64>,
    pub count: u32,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IndexedViewPage {
    pub buckets: Vec<ViewBucket>,
    pub results: Vec<SearchResult>,
    #[serde(default)]
    pub next_cursor: Option<String>,
    pub complete: bool,
    pub generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SmartFolder {
    pub id: String,
    pub name: String,
    pub saved_search_id: String,
    pub created_unix: u64,
    pub modified_unix: u64,
}

impl SmartFolder {
    pub fn validate(&self) -> Result<(), String> {
        validate_uuid(&self.id).map_err(|_| "views.invalid".to_string())?;
        validate_uuid(&self.saved_search_id).map_err(|_| "views.invalid".to_string())?;
        let name = self.name.trim();
        if name.is_empty()
            || name.chars().count() > MAX_SMART_FOLDER_NAME
            || name.chars().any(char::is_control)
            || self.name.chars().count() > MAX_SMART_FOLDER_NAME
            || !is_safe_u64(self.created_unix)
            || !is_safe_u64(self.modified_unix)
        {
            return Err("views.invalid".to_string());
        }
        Ok(())
    }
}

/// The five enabled-view switches plus the date-source default. Schema 35
/// stores this section; it is defined here so the view code and settings
/// agree on one shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnabledViews {
    #[serde(default = "default_true")]
    pub timeline: bool,
    #[serde(default = "default_true")]
    pub calendar: bool,
    #[serde(default = "default_true")]
    pub by_kind: bool,
    #[serde(default = "default_true")]
    pub recent_activity: bool,
    #[serde(default)]
    pub map: bool,
}

fn default_true() -> bool {
    true
}

impl Default for EnabledViews {
    fn default() -> Self {
        Self {
            timeline: true,
            calendar: true,
            by_kind: true,
            recent_activity: true,
            map: false,
        }
    }
}

impl EnabledViews {
    #[allow(dead_code)]
    pub fn enabled(&self, view: IndexedView) -> bool {
        match view {
            IndexedView::Timeline => self.timeline,
            IndexedView::Calendar => self.calendar,
            IndexedView::ByKind => self.by_kind,
            IndexedView::RecentActivity => self.recent_activity,
            IndexedView::Map => self.map,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ViewsSettings {
    #[serde(default)]
    pub enabled_views: EnabledViews,
    #[serde(default)]
    pub date_source: DateSource,
    #[serde(default = "default_true")]
    pub activity_enabled: bool,
    #[serde(default)]
    pub map_online_enabled: bool,
    #[serde(default)]
    pub write_embedded_tags: bool,
}

impl Default for ViewsSettings {
    fn default() -> Self {
        Self {
            enabled_views: EnabledViews::default(),
            date_source: DateSource::Modified,
            activity_enabled: true,
            map_online_enabled: false,
            write_embedded_tags: false,
        }
    }
}

/// `YYYY-MM` with a four-digit year. Years before 1601 cannot be represented
/// by the Windows local-time conversion and are refused.
pub fn parse_month(value: &str) -> Option<(i32, u32)> {
    if value.len() != 7 || value.as_bytes()[4] != b'-' {
        return None;
    }
    let bytes = value.as_bytes();
    if !bytes[..4].iter().all(u8::is_ascii_digit) || !bytes[5..].iter().all(u8::is_ascii_digit) {
        return None;
    }
    let year: i32 = value[..4].parse().ok()?;
    let month: u32 = value[5..].parse().ok()?;
    if !(1601..=9998).contains(&year) || !(1..=12).contains(&month) {
        return None;
    }
    Some((year, month))
}

#[cfg(test)]
mod step11b_view_type_tests {
    use super::*;

    #[test]
    fn month_parser_accepts_only_four_digit_calendar_months() {
        assert_eq!(parse_month("2026-11"), Some((2026, 11)));
        assert_eq!(parse_month("2026-13"), None);
        assert_eq!(parse_month("26-11"), None);
        assert_eq!(parse_month("2026-1"), None);
        assert_eq!(parse_month("2026/11"), None);
        assert_eq!(parse_month("1600-01"), None);
    }

    #[test]
    fn every_kind_extension_maps_back_to_its_group() {
        for kind in ViewKind::ALL {
            for extension in kind.extensions() {
                assert_eq!(ViewKind::from_extension(extension), kind);
            }
        }
        assert_eq!(ViewKind::from_extension("unknown"), ViewKind::Other);
        assert_eq!(ViewKind::from_name("PHOTO.JPG"), ViewKind::Images);
    }

    #[test]
    fn smart_folder_names_stop_at_sixty_characters() {
        let folder = SmartFolder {
            id: uuid::Uuid::new_v4().to_string(),
            name: "x".repeat(MAX_SMART_FOLDER_NAME),
            saved_search_id: uuid::Uuid::new_v4().to_string(),
            created_unix: 1,
            modified_unix: 1,
        };
        assert!(folder.validate().is_ok());
        let mut too_long = folder;
        too_long.name.push('x');
        assert_eq!(too_long.validate(), Err("views.invalid".to_string()));
    }
}
