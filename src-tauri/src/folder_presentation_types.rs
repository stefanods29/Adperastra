use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ColumnId { Name, Modified, Kind, Size, Width, Height, DateTaken, CameraModel, DurationMs, Author, PageCount, AudioTitle, AudioArtist, AudioAlbum, Dimensions }
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ColumnSpec { pub id: ColumnId, pub width: u32 }
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GroupBy { None, Name, Modified, Type, Size }
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FolderPresentation {
    pub view_mode: String,
    pub sort: fs_service::SortSpec,
    pub group_by: GroupBy,
    pub columns: Vec<ColumnSpec>,
}
pub fn default_columns() -> Vec<ColumnSpec> {
    [(ColumnId::Name, 320), (ColumnId::Modified, 180), (ColumnId::Kind, 160), (ColumnId::Size, 100)]
        .into_iter().map(|(id, width)| ColumnSpec { id, width }).collect()
}
impl FolderPresentation {
    pub fn legacy(mode: &str) -> Self {
        Self { view_mode: mode.to_string(), sort: fs_service::SortSpec::default(), group_by: GroupBy::None, columns: default_columns() }
    }
    pub fn validate(&self) -> Result<(), String> {
        let invalid = || "presentation.invalid".to_string();
        if !fs_service::is_view_mode(&self.view_mode) || self.columns.is_empty() || self.columns.len() > 15 || self.columns[0].id != ColumnId::Name {
            return Err(invalid());
        }
        let mut ids = HashSet::new();
        for column in &self.columns {
            let bounds = if column.id == ColumnId::Name { 160..=1000 } else { 96..=600 };
            if !ids.insert(column.id) || !bounds.contains(&column.width) { return Err(invalid()); }
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn legacy_mode_retained() { assert_eq!(FolderPresentation::legacy("list").view_mode, "list"); }
    #[test] fn name_column_required() {
        let mut value = FolderPresentation::legacy("details"); value.columns.remove(0); assert!(value.validate().is_err());
    }
    #[test] fn duplicate_column_refused() {
        let mut value = FolderPresentation::legacy("details"); value.columns.push(value.columns[1].clone()); assert!(value.validate().is_err());
    }
    #[test] fn width95_refused() {
        let mut value = FolderPresentation::legacy("details"); value.columns[1].width = 95; assert!(value.validate().is_err());
    }
}
