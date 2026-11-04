//! Pure column-set validation/presets. Persistence and command registration
//! wait for the catalog/history authority; this module performs no disk I/O.
#![allow(dead_code)]

use uuid::Uuid;

use crate::folder_customization_types::{ColumnSet, FolderType};
use crate::folder_presentation_types::{default_columns, ColumnId, ColumnSpec, FolderPresentation};

pub fn validate_column_set(value: &ColumnSet) -> Result<(), String> {
    let invalid = || "folder_custom.invalid".to_string();
    let parsed = Uuid::parse_str(&value.id).map_err(|_| invalid())?;
    if parsed.to_string() != value.id || value.version != 1 || !(1..=60).contains(&value.name.chars().count()) {
        return Err(invalid());
    }
    // Reuse the producer's canonical column validation, including Name first,
    // unique IDs and per-column width bounds. Do not copy sort/group/view DTOs.
    let mut presentation = FolderPresentation::legacy("details");
    presentation.columns = value.columns.clone();
    presentation.validate().map_err(|_| invalid())
}

pub fn default_column_set_columns(kind: FolderType) -> Vec<ColumnSpec> {
    let defaults = default_columns();
    let ids = match kind {
        FolderType::General => return defaults,
        FolderType::Photos => vec![ColumnId::Name, ColumnId::DateTaken, ColumnId::Dimensions, ColumnId::CameraModel],
        FolderType::Music => vec![ColumnId::Name, ColumnId::AudioTitle, ColumnId::AudioArtist, ColumnId::AudioAlbum, ColumnId::DurationMs],
        FolderType::Documents => vec![ColumnId::Name, ColumnId::Author, ColumnId::PageCount, ColumnId::Modified],
    };
    ids.into_iter().map(|id| ColumnSpec {
        id,
        width: defaults.iter().find(|column| column.id == id).map_or(140, |column| column.width),
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set() -> ColumnSet {
        ColumnSet {
            id: "12345678-1234-4234-8234-123456789abc".into(),
            name: "Photos".into(), columns: default_column_set_columns(FolderType::Photos),
            folder_type: Some(FolderType::Photos), version: 1,
        }
    }

    #[test]
    fn name_cannot_remove() {
        let mut value = set();
        assert!(validate_column_set(&value).is_ok());
        value.columns.remove(0);
        assert!(validate_column_set(&value).is_err());
    }

    #[test]
    fn column_set_uses_presentation_bounds_and_unique_ids() {
        let mut value = set();
        value.columns[1].width = 95;
        assert!(validate_column_set(&value).is_err());
        value.columns[1].width = 600;
        assert!(validate_column_set(&value).is_ok());
        value.columns[1].width = 601;
        assert!(validate_column_set(&value).is_err());
        value = set();
        value.columns.push(value.columns[1].clone());
        assert!(validate_column_set(&value).is_err());
    }

    #[test]
    fn column_set_rejects_noncanonical_id_version_and_long_name() {
        let mut value = set();
        value.id = value.id.to_uppercase();
        assert!(validate_column_set(&value).is_err());
        value = set();
        value.version = 2;
        assert!(validate_column_set(&value).is_err());
        value = set();
        value.name = "⭐".repeat(60);
        assert!(validate_column_set(&value).is_ok());
        value.name.push('⭐');
        assert!(validate_column_set(&value).is_err());
    }

    #[test]
    fn manual_presets_use_canonical_ids_and_widths() {
        assert_eq!(default_column_set_columns(FolderType::Photos).iter().map(|column| column.id).collect::<Vec<_>>(),
            vec![ColumnId::Name, ColumnId::DateTaken, ColumnId::Dimensions, ColumnId::CameraModel]);
        let music = default_column_set_columns(FolderType::Music);
        assert_eq!(music.iter().map(|column| column.id).collect::<Vec<_>>(),
            vec![ColumnId::Name, ColumnId::AudioTitle, ColumnId::AudioArtist, ColumnId::AudioAlbum, ColumnId::DurationMs]);
        assert!(music[1..].iter().all(|column| column.width == 140));
        assert_eq!(default_column_set_columns(FolderType::General), default_columns());
    }
}
