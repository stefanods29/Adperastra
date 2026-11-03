use super::{CACHE_LIMITS_MB, DEFAULT_CACHE_MB};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
/// Every background task kind this build understands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackgroundTaskKind {
    Thumbnails,
    Metadata,
    Ocr,
    FilenameIndex,
    ContentIndex,
    FolderSizes,
    StorageScan,
    VersionCleanup,
    PackDownload,
}

impl BackgroundTaskKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            BackgroundTaskKind::Thumbnails => "thumbnails",
            BackgroundTaskKind::Metadata => "metadata",
            BackgroundTaskKind::Ocr => "ocr",
            BackgroundTaskKind::FilenameIndex => "filename_index",
            BackgroundTaskKind::ContentIndex => "content_index",
            BackgroundTaskKind::FolderSizes => "folder_sizes",
            BackgroundTaskKind::StorageScan => "storage_scan",
            BackgroundTaskKind::VersionCleanup => "version_cleanup",
            BackgroundTaskKind::PackDownload => "pack_download",
        }
    }

    pub fn from_key(value: &str) -> Option<Self> {
        Some(match value {
            "thumbnails" => BackgroundTaskKind::Thumbnails,
            "metadata" => BackgroundTaskKind::Metadata,
            "ocr" => BackgroundTaskKind::Ocr,
            "filename_index" => BackgroundTaskKind::FilenameIndex,
            "content_index" => BackgroundTaskKind::ContentIndex,
            "folder_sizes" => BackgroundTaskKind::FolderSizes,
            "storage_scan" => BackgroundTaskKind::StorageScan,
            "version_cleanup" => BackgroundTaskKind::VersionCleanup,
            "pack_download" => BackgroundTaskKind::PackDownload,
            _ => return None,
        })
    }

    /// True for the tasks that exist at this step; later steps register
    /// their own kind only when the producer is installed.
    pub fn enabled_by_default(&self) -> bool {
        matches!(
            self,
            BackgroundTaskKind::Thumbnails
                | BackgroundTaskKind::Metadata
                | BackgroundTaskKind::Ocr
                | BackgroundTaskKind::VersionCleanup
        )
    }
}

/// Schema 12's background section.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackgroundSettings {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub only_idle: bool,
    #[serde(default)]
    pub only_ac: bool,
    #[serde(default)]
    pub paused: bool,
    #[serde(default = "default_tasks")]
    pub tasks: BTreeMap<String, bool>,
}

fn default_true() -> bool {
    true
}

fn default_tasks() -> BTreeMap<String, bool> {
    let mut tasks = BTreeMap::new();
    for kind in [
        BackgroundTaskKind::Thumbnails,
        BackgroundTaskKind::Metadata,
        BackgroundTaskKind::Ocr,
        BackgroundTaskKind::FilenameIndex,
        BackgroundTaskKind::ContentIndex,
        BackgroundTaskKind::FolderSizes,
        BackgroundTaskKind::StorageScan,
        BackgroundTaskKind::VersionCleanup,
        BackgroundTaskKind::PackDownload,
    ] {
        tasks.insert(kind.as_str().to_string(), kind.enabled_by_default());
    }
    tasks
}

impl Default for BackgroundSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            only_idle: false,
            only_ac: false,
            paused: false,
            tasks: default_tasks(),
        }
    }
}

impl BackgroundSettings {
    /// Every key must be a task this build knows. Missing tasks keep their
    /// default when the policy asks; extra keys are refused on save.
    pub fn validate(&self) -> Result<(), String> {
        for key in self.tasks.keys() {
            if BackgroundTaskKind::from_key(key).is_none() {
                return Err(format!("unsupported background task {key:?}"));
            }
        }
        Ok(())
    }

    pub fn task_enabled(&self, kind: BackgroundTaskKind) -> bool {
        self.tasks
            .get(kind.as_str())
            .copied()
            .unwrap_or_else(|| kind.enabled_by_default())
    }
}

/// Schema 12's cache section: one of `CACHE_LIMITS_MB`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CacheSettings {
    #[serde(default = "default_cache_mb")]
    pub max_mb: u32,
}

fn default_cache_mb() -> u32 {
    DEFAULT_CACHE_MB
}

impl Default for CacheSettings {
    fn default() -> Self {
        Self {
            max_mb: DEFAULT_CACHE_MB,
        }
    }
}

impl CacheSettings {
    pub fn validate(&self) -> Result<(), String> {
        if CACHE_LIMITS_MB.contains(&self.max_mb) {
            Ok(())
        } else {
            Err(format!(
                "unsupported cache.max_mb {} (expected one of {CACHE_LIMITS_MB:?})",
                self.max_mb
            ))
        }
    }

    pub fn limit_bytes(&self) -> u64 {
        u64::from(self.max_mb) * 1_048_576
    }
}
