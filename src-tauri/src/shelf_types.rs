//! Shelf wire types (Step 09g, revision `shelf-1`).
//!
//! The mirror of `src/services/shelf.ts`. A shelf item is a reference,
//! never a moved or copied file. Only disk references are persisted;
//! virtual (locked-folder) references stay in memory and are marked
//! `runtime_sensitive`. A draft reference is not a file and is refused.

use std::path::Path;

use fs_service::CompletedItem;
use serde::{Deserialize, Serialize};

use crate::document_types::DocumentRef;

pub const SHELF_SCHEMA: u32 = 1;
pub const MAX_SHELF_ITEMS: usize = 1000;
pub const MAX_SHELF_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_DISPLAY_NAME_UTF16: usize = 255;
/// The largest integer the UI can read back exactly.
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub const ERR_SHELF_INVALID: &str = "shelf.invalid";
pub const ERR_SHELF_CHANGED: &str = "shelf.changed";
pub const ERR_SHELF_LIMIT: &str = "shelf.limit";
pub const ERR_SHELF_IO: &str = "shelf.io";
pub const ERR_SHELF_CANCELLED: &str = "shelf.cancelled";

/// What the last availability check found. `changed` means the location
/// moved without a paired identity and is uncertain until a refresh.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ShelfState {
    Available,
    Missing,
    Changed,
    #[default]
    Unavailable,
}

/// One reference on the shelf.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShelfItem {
    pub id: String,
    pub source: DocumentRef,
    /// Shown name; editing it never renames the original path.
    pub display_name: String,
    pub added_unix: u64,
    #[serde(default)]
    pub state: ShelfState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_checked_unix: Option<u64>,
    /// True only for virtual locked-folder references (memory only).
    #[serde(default)]
    pub runtime_sensitive: bool,
}

impl ShelfItem {
    pub fn validate(&self) -> Result<(), String> {
        if uuid::Uuid::try_parse(&self.id).is_err()
            || self.display_name.is_empty()
            || self.display_name.encode_utf16().count() > MAX_DISPLAY_NAME_UTF16
            || self.added_unix > MAX_SAFE_INTEGER
            || self.last_checked_unix.is_some_and(|value| value > MAX_SAFE_INTEGER)
        {
            return Err(ERR_SHELF_INVALID.to_string());
        }
        self.source
            .validate()
            .map_err(|_| ERR_SHELF_INVALID.to_string())?;
        let sensitive = matches!(self.source, DocumentRef::Virtual { .. });
        if self.runtime_sensitive != sensitive {
            return Err(ERR_SHELF_INVALID.to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShelfCatalog {
    pub schema_version: u32,
    pub revision: u64,
    pub items: Vec<ShelfItem>,
}

impl Default for ShelfCatalog {
    fn default() -> Self {
        Self {
            schema_version: SHELF_SCHEMA,
            revision: 1,
            items: Vec::new(),
        }
    }
}

/// One revision-checked shelf change. `update_moved` carries only the
/// completed move effects projected from a real 09f report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ShelfPatch {
    Add { sources: Vec<DocumentRef> },
    Remove { ids: Vec<String> },
    Clear {},
    Reorder { ids: Vec<String> },
    UpdateMoved { moves: Vec<CompletedItem> },
}

/// The normalized key of a source. Disk paths use the same case and
/// trailing-separator rules as folder view keys; virtual entries use the
/// exact provider container and entry id.
pub fn source_key(source: &DocumentRef) -> Result<String, String> {
    match source {
        DocumentRef::Disk { path } => {
            let key = fs_service::path_key_of(Path::new(path))
                .map_err(|_| ERR_SHELF_INVALID.to_string())?;
            Ok(format!("disk:{key}"))
        }
        DocumentRef::Virtual {
            container_path,
            entry_id,
            ..
        } => {
            let key = fs_service::path_key_of(Path::new(container_path))
                .map_err(|_| ERR_SHELF_INVALID.to_string())?;
            Ok(format!("virtual:{key}:{}", entry_id.to_lowercase()))
        }
        DocumentRef::Draft { .. } => Err(ERR_SHELF_INVALID.to_string()),
    }
}

/// A safe default label for a new reference. Editing it later changes only
/// the label, never the original path.
pub fn display_name_for(source: &DocumentRef) -> Result<String, String> {
    match source {
        DocumentRef::Disk { path } => {
            let path = Path::new(path);
            let name = path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.to_string_lossy().into_owned());
            Ok(truncate_utf16(&name, MAX_DISPLAY_NAME_UTF16))
        }
        DocumentRef::Virtual { entry_id, .. } => Ok(entry_id.clone()),
        DocumentRef::Draft { .. } => Err(ERR_SHELF_INVALID.to_string()),
    }
}

fn truncate_utf16(value: &str, max_units: usize) -> String {
    let mut units = 0usize;
    let mut end = 0usize;
    for (index, character) in value.char_indices() {
        let length = character.len_utf16();
        if units + length > max_units {
            break;
        }
        units += length;
        end = index + character.len_utf8();
    }
    value[..end].to_string()
}

/// Refuse a patch before the store lock is taken.
pub fn validate_patch(patch: &ShelfPatch) -> Result<(), String> {
    match patch {
        ShelfPatch::Add { sources } => {
            if sources.is_empty() {
                return Err(ERR_SHELF_INVALID.to_string());
            }
            if sources.len() > MAX_SHELF_ITEMS {
                return Err(ERR_SHELF_LIMIT.to_string());
            }
            for source in sources {
                source
                    .validate()
                    .map_err(|_| ERR_SHELF_INVALID.to_string())?;
                source_key(source)?;
            }
            Ok(())
        }
        ShelfPatch::Remove { ids } | ShelfPatch::Reorder { ids } => {
            if ids.is_empty() || ids.len() > MAX_SHELF_ITEMS {
                return Err(ERR_SHELF_INVALID.to_string());
            }
            let mut seen = std::collections::HashSet::new();
            for id in ids {
                if uuid::Uuid::try_parse(id).is_err() || !seen.insert(id.to_lowercase()) {
                    return Err(ERR_SHELF_INVALID.to_string());
                }
            }
            Ok(())
        }
        ShelfPatch::Clear {} => Ok(()),
        ShelfPatch::UpdateMoved { moves } => {
            if moves.is_empty() || moves.len() > MAX_SHELF_ITEMS {
                return Err(ERR_SHELF_INVALID.to_string());
            }
            for item in moves {
                let from = item.from.to_string_lossy();
                let to = item.to.to_string_lossy();
                crate::validate_absolute_path(&from)
                    .map_err(|_| ERR_SHELF_INVALID.to_string())?;
                crate::validate_absolute_path(&to)
                    .map_err(|_| ERR_SHELF_INVALID.to_string())?;
            }
            Ok(())
        }
    }
}

/// Validate a catalog that may contain live virtual references.
pub fn validate_runtime_catalog(catalog: &ShelfCatalog) -> Result<(), String> {
    if catalog.schema_version != SHELF_SCHEMA {
        return Err(ERR_SHELF_INVALID.to_string());
    }
    if catalog.revision == 0 || catalog.revision > MAX_SAFE_INTEGER {
        return Err(ERR_SHELF_INVALID.to_string());
    }
    if catalog.items.len() > MAX_SHELF_ITEMS {
        return Err(ERR_SHELF_LIMIT.to_string());
    }
    let mut ids = std::collections::HashSet::new();
    let mut keys = std::collections::HashSet::new();
    for item in &catalog.items {
        item.validate()?;
        if !ids.insert(item.id.to_lowercase()) {
            return Err(ERR_SHELF_INVALID.to_string());
        }
        if !keys.insert(source_key(&item.source)?) {
            return Err(ERR_SHELF_INVALID.to_string());
        }
    }
    Ok(())
}

/// Validate what may be written to `<data>/shelf.json`: disk references
/// only, no sensitive flag, no virtual serialization.
pub fn validate_persisted_catalog(catalog: &ShelfCatalog) -> Result<(), String> {
    validate_runtime_catalog(catalog)?;
    for item in &catalog.items {
        if !matches!(&item.source, DocumentRef::Disk { .. }) || item.runtime_sensitive {
            return Err(ERR_SHELF_INVALID.to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        display_name_for, source_key, validate_patch, validate_persisted_catalog, ShelfCatalog,
        ShelfItem, ShelfPatch, ShelfState,
    };
    use crate::document_types::DocumentRef;

    fn disk(path: &str) -> DocumentRef {
        DocumentRef::Disk {
            path: path.to_string(),
        }
    }

    #[test]
    fn source_keys_are_normalized() {
        assert_eq!(
            source_key(&disk("\\\\?\\C:\\Shelf\\A.TXT")).unwrap(),
            source_key(&disk("c:/shelf/a.txt/")).unwrap()
        );
        let virtual_ref = DocumentRef::Virtual {
            provider: "locked".to_string(),
            container_path: "C:\\Sealed".to_string(),
            entry_id: "00000000-0000-4000-8000-000000000001".to_string(),
        };
        let key = source_key(&virtual_ref).unwrap();
        assert!(key.starts_with("virtual:c:\\sealed:"));
        assert!(source_key(&DocumentRef::Draft {
            draft_id: "00000000-0000-4000-8000-000000000002".to_string()
        })
        .is_err());
    }

    #[test]
    fn display_names_are_bounded_and_never_paths_for_virtual_entries() {
        assert_eq!(
            display_name_for(&disk("C:\\Shelf\\Report.txt")).unwrap(),
            "Report.txt"
        );
        let virtual_ref = DocumentRef::Virtual {
            provider: "locked".to_string(),
            container_path: "C:\\Sealed".to_string(),
            entry_id: "00000000-0000-4000-8000-000000000001".to_string(),
        };
        assert_eq!(
            display_name_for(&virtual_ref).unwrap(),
            "00000000-0000-4000-8000-000000000001"
        );
        let long = format!("C:\\{}", "a".repeat(400));
        assert!(display_name_for(&disk(&long)).unwrap().encode_utf16().count() <= 255);
    }

    #[test]
    fn virtual_items_must_stay_sensitive() {
        let item = ShelfItem {
            id: "00000000-0000-4000-8000-000000000003".to_string(),
            source: DocumentRef::Virtual {
                provider: "locked".to_string(),
                container_path: "C:\\Sealed".to_string(),
                entry_id: "00000000-0000-4000-8000-000000000001".to_string(),
            },
            display_name: "entry".to_string(),
            added_unix: 1,
            state: ShelfState::Available,
            last_checked_unix: None,
            runtime_sensitive: false,
        };
        assert!(item.validate().is_err());
    }

    #[test]
    fn persisted_catalogs_refuse_virtual_items() {
        let catalog = ShelfCatalog {
            schema_version: 1,
            revision: 2,
            items: vec![ShelfItem {
                id: "00000000-0000-4000-8000-000000000003".to_string(),
                source: DocumentRef::Virtual {
                    provider: "locked".to_string(),
                    container_path: "C:\\Sealed".to_string(),
                    entry_id: "00000000-0000-4000-8000-000000000001".to_string(),
                },
                display_name: "entry".to_string(),
                added_unix: 1,
                state: ShelfState::Available,
                last_checked_unix: None,
                runtime_sensitive: true,
            }],
        };
        assert!(super::validate_runtime_catalog(&catalog).is_ok());
        assert!(validate_persisted_catalog(&catalog).is_err());
    }

    #[test]
    fn patches_are_bounded() {
        assert!(validate_patch(&ShelfPatch::Add { sources: vec![] }).is_err());
        assert!(validate_patch(&ShelfPatch::Clear {}).is_ok());
        let ids = vec!["00000000-0000-4000-8000-000000000001".to_string(); 2];
        assert!(validate_patch(&ShelfPatch::Remove { ids }).is_err());
    }
}
