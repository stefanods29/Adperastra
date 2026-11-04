//! Pure validation for saved tab groups (Step 09b T1/T3).
//!
//! Errors are the `groups.*` codes of the guide; Rust never returns
//! display text. The same bounds run for the on-disk catalog, a single
//! write and an imported file, so no path can persist a group the UI
//! would refuse.
#![allow(dead_code)]


use std::collections::HashSet;

use crate::saved_group_types::{
    LiveTabGroup, SavedGroupCatalog, SavedTabDescriptor, SavedTabGroup, MAX_CATALOG_BYTES,
    MAX_GROUP_NAME_CHARS, MAX_SAFE_INTEGER, MAX_SAVED_GROUPS, MAX_SAVED_TABS, MAX_VIEW_BYTES,
    SAVED_GROUPS_SCHEMA,
};

pub const ERR_INVALID: &str = "groups.invalid";
pub const ERR_LIMIT: &str = "groups.limit";
pub const ERR_CHANGED: &str = "groups.changed";
pub const ERR_IO: &str = "groups.io";
pub const ERR_UNSUPPORTED: &str = "groups.unsupported_version";

const MAX_JSON_DEPTH: usize = 8;
const MAX_JSON_KEYS: usize = 64;
const MAX_JSON_STRING: usize = 8192;
const MAX_TITLE_CHARS: usize = 255;
const MAX_PATH_CHARS: usize = 32768;
const MAX_LIVE_GROUPS: usize = 32;

const FORBIDDEN_KEYS: &[&str] = &[
    "__proto__",
    "constructor",
    "prototype",
    "password",
    "passwd",
    "token",
    "access_token",
    "grant",
    "secret",
    "blob_url",
    "document_id",
    "group_id",
];

fn invalid() -> String {
    ERR_INVALID.to_string()
}

pub fn validate_group_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    let count = trimmed.chars().count();
    if count == 0 || count > MAX_GROUP_NAME_CHARS {
        return Err(invalid());
    }
    Ok(trimmed.to_string())
}

fn validate_json_value(value: &serde_json::Value, depth: usize) -> Result<(), String> {
    if depth > MAX_JSON_DEPTH {
        return Err(invalid());
    }
    match value {
        serde_json::Value::String(text) => {
            if text.chars().count() > MAX_JSON_STRING {
                return Err(invalid());
            }
            Ok(())
        }
        serde_json::Value::Number(number) => {
            if number.as_f64().is_some_and(|n| !n.is_finite()) {
                return Err(invalid());
            }
            Ok(())
        }
        serde_json::Value::Array(entries) => {
            for entry in entries {
                validate_json_value(entry, depth + 1)?;
            }
            Ok(())
        }
        serde_json::Value::Object(map) => {
            if map.len() > MAX_JSON_KEYS {
                return Err(invalid());
            }
            for (key, entry) in map {
                if FORBIDDEN_KEYS.contains(&key.to_lowercase().as_str()) {
                    return Err(invalid());
                }
                validate_json_value(entry, depth + 1)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

pub fn validate_descriptor(descriptor: &SavedTabDescriptor) -> Result<(), String> {
    // A split carries exactly two non-recursive sides; a non-split position
    // must not carry one, and content_view_id belongs to a promoted normal
    // tab only (Step 09i D7). Leaf bounds and secret caps are the split
    // validator's, mapped to the catalog's own stable code here.
    crate::split_types::validate_split_tab(
        &descriptor.kind,
        descriptor.split.as_ref(),
        descriptor.content_view_id.as_deref(),
    )
    .map_err(|_| invalid())?;
    if descriptor.pinned {
        return Err(invalid());
    }
    if descriptor.kind == "split" {
        let split = descriptor.split.as_ref().ok_or_else(invalid)?;
        // A saved split reuses the exact split descriptor: both sides and
        // no outer title, path, handler, source, folder, view or view id.
        if descriptor.title.is_some()
            || descriptor.path.is_some()
            || descriptor.handler.is_some()
            || descriptor.source.is_some()
            || descriptor.folder.is_some()
            || descriptor.view.is_some()
            || descriptor.view_version.is_some()
            || descriptor.content_view_id.is_some()
        {
            return Err(invalid());
        }
        for leaf in [&split.first, &split.second] {
            // A draft is a native runtime source and never a saved position.
            if matches!(
                &leaf.source,
                Some(crate::document_types::DocumentRef::Draft { .. })
            ) {
                return Err(invalid());
            }
            if let Some(view) = &leaf.view {
                validate_json_value(view, 0)?;
            }
        }
        return Ok(());
    }
    if descriptor.kind != "file" && descriptor.kind != "folder" {
        return Err(invalid());
    }
    if let Some(source) = &descriptor.source {
        // The source is the same allowlisted reference a session uses.
        // Drafts are runtime-only and never saved; an unknown provider
        // or a relative path is refused before anything is persisted.
        let parsed: crate::document_types::DocumentRef =
            serde_json::from_value(source.clone()).map_err(|_| invalid())?;
        if matches!(
            &parsed,
            crate::document_types::DocumentRef::Draft { .. }
        ) {
            return Err(invalid());
        }
        parsed.validate().map_err(|_| invalid())?;
        // Only the known fields of the shared reference are persisted.
        let normalized = serde_json::to_value(&parsed).map_err(|_| invalid())?;
        if normalized != *source {
            return Err(invalid());
        }
    }
    if descriptor.kind == "folder" {
        // A folder position restores through the same validated 09a
        // folder state a session stores.
        let folder = descriptor.folder.as_ref().ok_or_else(invalid)?;
        let parsed: crate::session::FolderTabState =
            serde_json::from_value(folder.clone()).map_err(|_| invalid())?;
        crate::session::validate_folder(&parsed).map_err(|_| invalid())?;
        let normalized = serde_json::to_value(&parsed).map_err(|_| invalid())?;
        if normalized != *folder {
            return Err(invalid());
        }
    } else if descriptor.path.is_none() && descriptor.source.is_none() {
        // A file position without any supported location cannot restore.
        return Err(invalid());
    }
    if let Some(title) = &descriptor.title {
        if title.chars().count() > MAX_TITLE_CHARS {
            return Err(invalid());
        }
    }
    if let Some(path) = &descriptor.path {
        if path.is_empty() || path.chars().count() > MAX_PATH_CHARS {
            return Err(invalid());
        }
        crate::validate_absolute_path(path).map_err(|_| invalid())?;
    }
    if let Some(handler) = &descriptor.handler {
        let ok = !handler.is_empty()
            && handler.len() <= 64
            && handler
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_');
        if !ok {
            return Err(invalid());
        }
    }
    for part in [&descriptor.source, &descriptor.folder, &descriptor.view]
        .into_iter()
        .flatten()
    {
        validate_json_value(part, 0)?;
    }
    if let Some(view) = &descriptor.view {
        let bytes = serde_json::to_vec(view).map_err(|_| invalid())?;
        if bytes.len() > MAX_VIEW_BYTES {
            return Err(invalid());
        }
    }
    // Virtual entries retain only the opaque container reference and
    // entry ID: no plaintext title, path or view (D8).
    let virtual_source = descriptor
        .source
        .as_ref()
        .and_then(|source| source.get("kind"))
        .and_then(|kind| kind.as_str())
        == Some("virtual");
    if virtual_source
        && (descriptor.title.is_some() || descriptor.path.is_some() || descriptor.view.is_some())
    {
        return Err(invalid());
    }
    Ok(())
}

pub fn validate_group(group: &SavedTabGroup) -> Result<(), String> {
    if uuid::Uuid::try_parse(&group.id).is_err() {
        return Err(invalid());
    }
    if validate_group_name(&group.name)? != group.name {
        return Err(invalid());
    }
    if group.tabs.is_empty() || group.tabs.len() > MAX_SAVED_TABS {
        return Err(if group.tabs.len() > MAX_SAVED_TABS {
            ERR_LIMIT.to_string()
        } else {
            invalid()
        });
    }
    if group.active_index >= group.tabs.len() {
        return Err(invalid());
    }
    if group.created_unix > MAX_SAFE_INTEGER || group.modified_unix > MAX_SAFE_INTEGER {
        return Err(invalid());
    }
    if group.version != SAVED_GROUPS_SCHEMA {
        return Err(if group.version > SAVED_GROUPS_SCHEMA {
            ERR_UNSUPPORTED.to_string()
        } else {
            invalid()
        });
    }
    let mut fingerprints = HashSet::new();
    for descriptor in &group.tabs {
        validate_descriptor(descriptor)?;
        let fingerprint = serde_json::to_string(descriptor).map_err(|_| invalid())?;
        if !fingerprints.insert(fingerprint) {
            return Err(invalid());
        }
    }
    Ok(())
}

pub fn validate_catalog(catalog: &SavedGroupCatalog) -> Result<(), String> {
    if catalog.schema_version != SAVED_GROUPS_SCHEMA {
        return Err(if catalog.schema_version > SAVED_GROUPS_SCHEMA {
            ERR_UNSUPPORTED.to_string()
        } else {
            invalid()
        });
    }
    if catalog.groups.len() > MAX_SAVED_GROUPS {
        return Err(ERR_LIMIT.to_string());
    }
    if catalog.revision == 0 || catalog.revision > MAX_SAFE_INTEGER {
        return Err(invalid());
    }
    let mut ids = HashSet::new();
    for group in &catalog.groups {
        validate_group(group)?;
        if !ids.insert(group.id.clone()) {
            return Err(invalid());
        }
    }
    let bytes = serde_json::to_vec(catalog).map_err(|_| invalid())?;
    if bytes.len() > MAX_CATALOG_BYTES {
        return Err(ERR_LIMIT.to_string());
    }
    Ok(())
}

/// Live session groups (schema 2): at most 32 groups, one membership
/// per tab. Member eligibility needs the tab list, so the session
/// writer checks kinds and pins; membership shape is checked here.
pub fn validate_live_groups(groups: &[LiveTabGroup]) -> Result<(), String> {
    if groups.len() > MAX_LIVE_GROUPS {
        return Err(ERR_LIMIT.to_string());
    }
    let mut group_ids = HashSet::new();
    let mut members = HashSet::new();
    for group in groups {
        if uuid::Uuid::try_parse(&group.id).is_err() || !group_ids.insert(group.id.clone()) {
            return Err(invalid());
        }
        validate_group_name(&group.name)?;
        if group.tab_ids.is_empty() || group.tab_ids.len() > MAX_SAVED_TABS {
            return Err(invalid());
        }
        for tab_id in &group.tab_ids {
            if !members.insert(tab_id.clone()) {
                return Err(invalid());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::saved_group_types::GroupColor;

    fn descriptor(path: &str) -> SavedTabDescriptor {
        SavedTabDescriptor {
            kind: "file".to_string(),
            title: Some("notes.txt".to_string()),
            path: Some(path.to_string()),
            handler: Some("text".to_string()),
            source: None,
            folder: None,
            view: None,
            view_version: None,
            split: None,
            content_view_id: None,
            pinned: false,
        }
    }

    fn group(id: &str, tabs: Vec<SavedTabDescriptor>) -> SavedTabGroup {
        SavedTabGroup {
            id: id.to_string(),
            name: "Work".to_string(),
            color: GroupColor::Purple,
            active_index: 0,
            created_unix: 10,
            modified_unix: 20,
            version: 1,
            tabs,
        }
    }

    const ID_A: &str = "00000000-0000-4000-8000-000000000001";
    const ID_B: &str = "00000000-0000-4000-8000-000000000002";

    #[test]
    fn refuses_duplicate_membership() {
        // The same descriptor twice in one group.
        let duplicated = group(ID_A, vec![descriptor(r"C:\a.txt"), descriptor(r"C:\a.txt")]);
        assert_eq!(validate_group(&duplicated).unwrap_err(), ERR_INVALID);
        // The same group ID twice in one catalog.
        let catalog = SavedGroupCatalog {
            schema_version: 1,
            groups: vec![
                group(ID_A, vec![descriptor(r"C:\a.txt")]),
                group(ID_A, vec![descriptor(r"C:\b.txt")]),
            ],
            revision: 1,
        };
        assert_eq!(validate_catalog(&catalog).unwrap_err(), ERR_INVALID);
        // One live tab in two groups.
        let live = vec![
            LiveTabGroup {
                id: ID_A.to_string(),
                name: "One".to_string(),
                color: GroupColor::Blue,
                collapsed: false,
                tab_ids: vec!["file-1".to_string()],
            },
            LiveTabGroup {
                id: ID_B.to_string(),
                name: "Two".to_string(),
                color: GroupColor::Red,
                collapsed: false,
                tab_ids: vec!["file-1".to_string()],
            },
        ];
        assert_eq!(validate_live_groups(&live).unwrap_err(), ERR_INVALID);
    }

    #[test]
    fn refuses_newer_catalog() {
        let catalog = SavedGroupCatalog {
            schema_version: 2,
            groups: vec![],
            revision: 1,
        };
        assert_eq!(validate_catalog(&catalog).unwrap_err(), ERR_UNSUPPORTED);
    }
}
