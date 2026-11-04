//! Tag wire types and validation (Step 11b, interface revision tags-1).
//!
//! Every field name and bound here is the canonical definition used by
//! `src/services/tags.ts`, the tag store and the coordinator-owned commands.
//! Identities are the Step 07a `FileIdentityKey`; this module never invents
//! a second identity type.

use std::collections::HashSet;

use fs_service::FileIdentityKey;
use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

/// The `.adptags` and tag database schema this build writes.
pub const TAG_SCHEMA_VERSION: u32 = 1;
/// Most tags in one catalog.
pub const MAX_TAGS: usize = 1000;
/// Most tag links across the whole profile.
pub const MAX_LINKS: u64 = 1_000_000;
/// Longest tag name, in Unicode scalar values, after trimming.
pub const MAX_TAG_NAME: usize = 60;
/// Largest serialized catalog accepted from or returned to the UI.
pub const MAX_CATALOG_BYTES: usize = 256 * 1024;
/// Physical size of `tags.sqlite` including its WAL.
pub const MAX_DB_BYTES: u64 = 128 * 1024 * 1024;
/// Largest state one tag history entry may hold (Step 09a limit).
pub const MAX_HISTORY_STATE_BYTES: usize = 4 * 1024 * 1024;
/// Largest total tag history kept in memory (Step 09a global limit).
pub const MAX_HISTORY_BYTES: usize = 16 * 1024 * 1024;
/// Most history entries kept (Step 09a).
pub const MAX_HISTORY_ENTRIES: usize = 100;
/// Most keys one `getAssignments` call may ask for.
pub const MAX_ASSIGNMENT_KEYS: usize = 256;
/// Most keys one mutation may touch.
pub const MAX_MUTATION_KEYS: usize = 10_000;
/// Most tag IDs one assignment may carry.
pub const MAX_ASSIGNMENT_TAGS: usize = 1000;
/// Largest safe integer JSON may carry.
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// The seven reserved tag identifiers. They never change, so a tag keeps
/// its meaning across exports, imports and profiles. The visible names come
/// from `tags.red` … `tags.gray` until the user renames the tag. Seeding
/// itself runs in the UI service, which owns the translated names.
#[allow(dead_code)]
pub const DEFAULT_TAG_IDS: [&str; 7] = [
    "0f8fad1e-0001-4a3b-9c4d-000000000001",
    "0f8fad1e-0002-4a3b-9c4d-000000000002",
    "0f8fad1e-0003-4a3b-9c4d-000000000003",
    "0f8fad1e-0004-4a3b-9c4d-000000000004",
    "0f8fad1e-0005-4a3b-9c4d-000000000005",
    "0f8fad1e-0006-4a3b-9c4d-000000000006",
    "0f8fad1e-0007-4a3b-9c4d-000000000007",
];

/// The default colors of the seven reserved tags, in the same order.
#[allow(dead_code)]
pub const DEFAULT_TAG_COLORS: [&str; 7] = [
    "#D32F2F", "#EF6C00", "#F9A825", "#2E7D32", "#1565C0", "#7B1FA2", "#616161",
];

/// The four icons a tag may use.
pub const TAG_ICON_IDS: [&str; 4] = ["tag", "dot", "star", "flag"];

/// One tag in the catalog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: String,
    pub icon_id: String,
    pub created_unix: u64,
    pub modified_unix: u64,
    pub revision: u64,
}

/// The tags of one file or folder, keyed by verified identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TagAssignment {
    pub key: FileIdentityKey,
    pub display_path: String,
    pub tag_ids: Vec<String>,
    pub revision: u64,
}

/// One add/remove batch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TagMutation {
    pub keys: Vec<FileIdentityKey>,
    pub paths: Vec<String>,
    pub add: Vec<String>,
    pub remove: Vec<String>,
    pub expected_revisions: Vec<u64>,
}

/// One item that could not be changed, with its error code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TagSkipped {
    pub path: String,
    pub code: String,
}

/// What one mutation did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TagMutationResult {
    pub changed_count: u32,
    pub skipped: Vec<TagSkipped>,
    pub next_cursor: Option<String>,
    pub history_id: String,
    pub complete: bool,
}

/// The whole tag catalog.
///
/// `history_id` is an additive optional extension of the `tags-1` table: it
/// is present only on the answer of a catalog write and names the native
/// Undo entry that write reserved. Reads and import previews omit it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TagCatalog {
    pub schema_version: u32,
    pub tags: Vec<Tag>,
    pub revision: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub history_id: Option<String>,
}

/// A catalog name used twice during import.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TagImportConflict {
    pub name: String,
    pub incoming_id: String,
    pub existing_id: String,
}

/// What an import file contains, before anything is changed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TagImportPreview {
    pub preview_id: String,
    pub catalog: TagCatalog,
    pub contains_paths: bool,
    pub conflicts: Vec<TagImportConflict>,
}

/// What the user chose for one conflicting name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TagImportChoice {
    pub incoming_id: String,
    /// `merge` or `rename`.
    pub action: String,
    pub target_id: Option<String>,
    pub name: Option<String>,
}

/// A complete before/after state kept for Undo.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TagStateSnapshot {
    pub catalog: TagCatalog,
    pub assignments: Vec<TagAssignment>,
}

/// Whether `value` is a canonical lower-case UUID.
pub fn is_uuid(value: &str) -> bool {
    if value.len() != 36 {
        return false;
    }
    let bytes = value.as_bytes();
    for (index, byte) in bytes.iter().enumerate() {
        let hyphen = matches!(index, 8 | 13 | 18 | 23);
        if hyphen {
            if *byte != b'-' {
                return false;
            }
        } else if !(byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()) {
            return false;
        }
    }
    true
}

/// A color exactly in `#RRGGBB` form.
pub fn is_hex_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// Whether an icon ID is one the catalog accepts.
pub fn is_valid_icon(icon: &str) -> bool {
    TAG_ICON_IDS.contains(&icon)
}

/// Trim and NFC-normalize a name; the result is what the store keeps.
pub fn normalize_tag_name(name: &str) -> String {
    name.nfc().collect::<String>().trim().to_string()
}

/// The casefold key used to refuse duplicate names. `to_lowercase` is the
/// standard Unicode lowercase mapping; the plan's "casefold" test data is
/// ASCII, where the two agree.
pub fn tag_name_fold(name: &str) -> String {
    normalize_tag_name(name).to_lowercase()
}

/// 1 to 60 characters after normalization, no control characters.
pub fn is_valid_tag_name(name: &str) -> bool {
    let normalized = normalize_tag_name(name);
    let count = normalized.chars().count();
    (1..=MAX_TAG_NAME).contains(&count) && !normalized.chars().any(char::is_control)
}

/// A tag is valid when every stored field is in range.
pub fn validate_tag(tag: &Tag) -> Result<(), String> {
    if !is_uuid(&tag.id) {
        return Err("tags.invalid".to_string());
    }
    if !is_valid_tag_name(&tag.name) {
        return Err("tags.invalid".to_string());
    }
    if !is_hex_color(&tag.color) || !is_valid_icon(&tag.icon_id) {
        return Err("tags.invalid".to_string());
    }
    if tag.created_unix > MAX_SAFE_INTEGER
        || tag.modified_unix > MAX_SAFE_INTEGER
        || tag.revision > MAX_SAFE_INTEGER
    {
        return Err("tags.invalid".to_string());
    }
    Ok(())
}

/// 8 lower-case hex characters for the volume and 16 for the file.
pub fn is_hex_id(value: &str, digits: usize) -> bool {
    value.len() == digits
        && value
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

/// A verified identity. With `stable == false` the zero IDs are allowed and
/// the path key is the fallback; callers must show `tags.unstable`.
pub fn is_valid_identity_key(key: &FileIdentityKey) -> bool {
    if !is_hex_id(&key.volume_id, 8) || !is_hex_id(&key.file_id, 16) {
        return false;
    }
    if key.path_key.is_empty() || key.path_key.encode_utf16().count() > 32_768 {
        return false;
    }
    if key.stable && key.volume_id == "00000000" && key.file_id == "0000000000000000"
    {
        return false;
    }
    true
}

/// The database lookup key of one assignment. Verified identities match by
/// volume and file; an unstable capture falls back to its path key and the UI
/// shows `tags.unstable`.
pub fn assignment_lookup(key: &FileIdentityKey) -> String {
    if key.stable {
        format!("i:{}:{}", key.volume_id, key.file_id)
    } else {
        format!("p:{}", key.path_key.to_lowercase())
    }
}

/// A catalog at most `MAX_CATALOG_BYTES` when serialized.
pub fn catalog_is_bounded(catalog: &TagCatalog) -> bool {
    serde_json::to_vec(catalog)
        .map(|bytes| bytes.len() <= MAX_CATALOG_BYTES)
        .unwrap_or(false)
}

/// Validate a mutation's shape before any database work.
pub fn validate_mutation(request: &TagMutation) -> Result<(), String> {
    let count = request.keys.len();
    if count == 0
        || count > MAX_MUTATION_KEYS
        || request.paths.len() != count
        || request.expected_revisions.len() != count
    {
        return Err("tags.invalid".to_string());
    }
    if request.add.is_empty() && request.remove.is_empty() {
        return Err("tags.invalid".to_string());
    }
    if request.add.len() > MAX_ASSIGNMENT_TAGS || request.remove.len() > MAX_ASSIGNMENT_TAGS {
        return Err("tags.invalid".to_string());
    }
    let mut seen_add: Vec<&str> = Vec::new();
    for id in &request.add {
        if !is_uuid(id) || request.remove.contains(id) || seen_add.contains(&id.as_str()) {
            return Err("tags.invalid".to_string());
        }
        seen_add.push(id);
    }
    let mut seen_remove: Vec<&str> = Vec::new();
    for id in &request.remove {
        if !is_uuid(id) || seen_remove.contains(&id.as_str()) {
            return Err("tags.invalid".to_string());
        }
        seen_remove.push(id);
    }
    for key in &request.keys {
        if !is_valid_identity_key(key) {
            return Err("tags.invalid".to_string());
        }
    }
    for path in &request.paths {
        if path.is_empty()
            || path.encode_utf16().count() > 32_768
            || path.contains('\0')
            || !std::path::Path::new(path).is_absolute()
        {
            return Err("tags.invalid".to_string());
        }
    }
    let mut seen_keys: HashSet<String> = HashSet::new();
    for key in &request.keys {
        if !seen_keys.insert(assignment_lookup(key)) {
            return Err("tags.invalid".to_string());
        }
    }
    for revision in &request.expected_revisions {
        if *revision > MAX_SAFE_INTEGER {
            return Err("tags.invalid".to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(volume: &str, file: &str, path: &str, stable: bool) -> FileIdentityKey {
        FileIdentityKey {
            volume_id: volume.to_string(),
            file_id: file.to_string(),
            path_key: path.to_string(),
            stable,
        }
    }

    #[test]
    fn seven_defaults_are_canonical_and_distinct() {
        assert_eq!(DEFAULT_TAG_IDS.len(), 7);
        let mut seen: Vec<&str> = Vec::new();
        for id in DEFAULT_TAG_IDS {
            assert!(is_uuid(id));
            assert!(!seen.contains(&id));
            seen.push(id);
        }
        for color in DEFAULT_TAG_COLORS {
            assert!(is_hex_color(color));
        }
    }

    #[test]
    fn names_are_trimmed_nfc_and_casefolded() {
        assert_eq!(normalize_tag_name("  Work  "), "Work");
        assert_eq!(tag_name_fold("WORK"), "work");
        assert!(!is_valid_tag_name("   "));
        assert!(!is_valid_tag_name(&"x".repeat(61)));
        assert!(is_valid_tag_name("Café"));
    }

    #[test]
    fn identity_shape_and_zero_ids() {
        assert!(is_valid_identity_key(&key(
            "1a2b3c4d",
            "0011223344556677",
            "C:\\a.txt",
            true
        )));
        assert!(!is_valid_identity_key(&key(
            "00000000",
            "0000000000000000",
            "C:\\a.txt",
            true
        )));
        assert!(is_valid_identity_key(&key(
            "00000000",
            "0000000000000000",
            "C:\\a.txt",
            false
        )));
    }

    #[test]
    fn mutation_shape() {
        let valid = TagMutation {
            keys: vec![key("1a2b3c4d", "0011223344556677", "C:\\a.txt", true)],
            paths: vec!["C:\\a.txt".to_string()],
            add: vec![DEFAULT_TAG_IDS[0].to_string()],
            remove: vec![],
            expected_revisions: vec![0],
        };
        assert!(validate_mutation(&valid).is_ok());
        let same = TagMutation {
            add: vec![DEFAULT_TAG_IDS[0].to_string()],
            remove: vec![DEFAULT_TAG_IDS[0].to_string()],
            ..valid.clone()
        };
        assert_eq!(validate_mutation(&same).err().as_deref(), Some("tags.invalid"));
        let empty = TagMutation {
            add: vec![],
            remove: vec![],
            ..valid
        };
        assert_eq!(validate_mutation(&empty).err().as_deref(), Some("tags.invalid"));
    }
}
