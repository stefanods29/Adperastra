use fs_service::SourceStamp;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const MAX_SOURCES: usize = 1000;
pub const MAX_PLAN_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_PAGE_ROWS: usize = 200;
pub const MAX_PAGE_BYTES: usize = 768 * 1024;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DateZone {
    #[default]
    Utc,
    Local,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NumberPosition {
    Prefix,
    Suffix,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CaseMode {
    Lower,
    Upper,
    Title,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExplicitRenameName {
    pub input_index: u32,
    pub new_name: String,
}
fn yes() -> bool {
    true
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum RenameOperation {
    Replace {
        find: String,
        replacement: String,
        #[serde(default)]
        regex: bool,
        #[serde(default = "yes")]
        match_case: bool,
    },
    Prefix {
        text: String,
    },
    Suffix {
        text: String,
    },
    Number {
        start: u32,
        step: u32,
        padding: u8,
        position: NumberPosition,
        separator: String,
    },
    Case {
        mode: CaseMode,
    },
    Template {
        pattern: String,
    },
    Remove {
        characters: String,
    },
    ExplicitNames {
        names: Vec<ExplicitRenameName>,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RenameRequest {
    pub paths: Vec<String>,
    pub operations: Vec<RenameOperation>,
    #[serde(default)]
    pub include_extension: bool,
    pub excluded_indices: Vec<u32>,
    #[serde(default)]
    pub date_zone: DateZone,
    pub request_revision: u32,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RenameStatus {
    Unchanged,
    Ready,
    Excluded,
    Invalid,
    Conflict,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenamePreviewRow {
    pub input_index: u32,
    pub source_path: String,
    pub source: SourceStamp,
    pub old_name: String,
    pub new_name: String,
    pub status: RenameStatus,
    pub reason: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenamePlanPage {
    pub plan_id: Uuid,
    pub request_revision: u32,
    pub rows: Vec<RenamePreviewRow>,
    pub next_cursor: Option<Uuid>,
    pub total: u32,
    pub ready: u32,
    pub invalid: u32,
    pub conflicts: u32,
    pub expires_unix: u64,
    pub all_rows_valid: bool,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RenameEffectStatus {
    Renamed,
    RolledBack,
    RecoveryRequired,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenameEffect {
    pub source: SourceStamp,
    pub original_path: String,
    pub current_path: String,
    pub target_path: String,
    pub status: RenameEffectStatus,
    pub reason: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenameReport {
    pub receipt_id: Uuid,
    pub effects: Vec<RenameEffect>,
    pub next_cursor: Option<Uuid>,
    pub done: u32,
    pub failed: u32,
    pub excluded: u32,
    pub cancelled: bool,
    pub recovery_required: bool,
    pub complete: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RenamePreset {
    pub id: Uuid,
    pub name: String,
    pub operations: Vec<RenameOperation>,
    pub include_extension: bool,
    pub date_zone: DateZone,
    pub version: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RenamePresetCatalog {
    pub schema_version: u32,
    pub revision: u64,
    pub presets: Vec<RenamePreset>,
}
