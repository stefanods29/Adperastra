//! Native mirror of the split-view descriptors (Step 09i, split-view-1).
//!
//! The canonical TypeScript types live in `src/services/splitViews.ts`; this
//! module is what `get_session` / `save_session` and saved-group import use
//! to validate a stored split before it may become live state. It defines no
//! second document, folder or session type: sources and folder state are the
//! Step 09a session types (`SessionDocumentRef`, `FolderTabState`).
//!
//! Invariants (Decisions 1-7):
//! - a split has exactly two sides, so a split leaf can never contain
//!   another split (unknown leaf fields are refused, not ignored);
//! - the ratio is finite and inside 0.2-0.8, never NaN or Infinity;
//! - a locked (virtual) leaf never carries a plain title or view state;
//! - view state is at most 64 KiB per leaf and the whole session stays
//!   under 4 MiB (the session validator owns the total).
//!
//! Errors are stable codes; Rust never returns display text.
#![allow(dead_code)]


use serde::{Deserialize, Serialize};

use crate::session::{
    validate_folder, validate_session_document_ref, FolderTabState, SessionDocumentRef,
};

/// A split always has two sides; this is the nest guard.
pub const MAX_SPLIT_LEAVES: usize = 2;
pub const MAX_SPLIT_VIEW_ID_CHARS: usize = 128;
pub const MAX_SPLIT_TITLE_CHARS: usize = 512;
pub const MAX_SPLIT_HANDLER_CHARS: usize = 64;
pub const MAX_SPLIT_VIEW_BYTES: usize = 64 * 1024;
/// The same structural bounds `viewState.ts` applies to a serialized view.
pub const MAX_SPLIT_VIEW_DEPTH: usize = 8;
pub const MAX_SPLIT_VIEW_KEYS: usize = 64;
pub const MAX_SPLIT_VIEW_STRING_UNITS: usize = 8192;
pub const SPLIT_RATIO_MIN: f64 = 0.2;
pub const SPLIT_RATIO_MAX: f64 = 0.8;
/// Whole-session cap, shared with the Step 09a session validator.
pub const MAX_SESSION_BYTES: usize = crate::session::MAX_SESSION_BYTES;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SplitSide {
    First,
    Second,
}

/// `vertical` puts the divider left/right (side by side); `horizontal`
/// puts it top/bottom (above and below).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SplitDirection {
    Vertical,
    Horizontal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SplitLeafMissing {
    /// `not_found`, `handler_missing` or `locked`.
    pub reason: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_path: Option<String>,
}

/// One side of a split. No 09i message contains a nested `split`, group,
/// pinned or children field, and `deny_unknown_fields` turns such a field
/// into a validation error instead of silently dropping it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SplitLeaf {
    pub view_id: String,
    /// `file` or `folder`.
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<SessionDocumentRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handler: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder: Option<FolderTabState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view_version: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub missing: Option<SplitLeafMissing>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SplitState {
    pub first: SplitLeaf,
    pub second: SplitLeaf,
    pub direction: SplitDirection,
    /// Fraction of the space given to the first leaf, 0.2-0.8.
    pub ratio: f64,
    pub active_side: SplitSide,
    #[serde(default)]
    pub sync_scroll: bool,
}

/// Why a stored split is not usable. The codes map to the UI keys
/// `errors.splits.{invalid,unsupported,limit}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SplitError {
    Invalid,
    Unsupported,
    Limit,
}

impl SplitError {
    pub fn code(&self) -> &'static str {
        match self {
            SplitError::Invalid => "splits.invalid",
            SplitError::Unsupported => "splits.unsupported",
            SplitError::Limit => "splits.limit",
        }
    }
}

impl From<SplitError> for String {
    fn from(error: SplitError) -> String {
        error.code().to_string()
    }
}

fn valid_view_id(view_id: &str) -> bool {
    !view_id.is_empty()
        && view_id.chars().count() <= MAX_SPLIT_VIEW_ID_CHARS
        && !view_id.chars().any(|character| character.is_whitespace() || character.is_control())
}

fn valid_handler(handler: &str) -> bool {
    if handler.is_empty() || handler.chars().count() > MAX_SPLIT_HANDLER_CHARS {
        return false;
    }
    let mut characters = handler.chars();
    let first_ok = characters
        .next()
        .map(|character| character.is_ascii_lowercase() || character.is_ascii_digit())
        .unwrap_or(false);
    first_ok
        && characters
            .all(|character| character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_' || character == '-')
}

const FORBIDDEN_VIEW_KEYS: [&str; 3] = ["__proto__", "constructor", "prototype"];

/// Mirror `isSerializableViewState` in `viewState.ts`: JSON primitives only,
/// depth 8, 64 keys per object, 8,192 UTF-16 units per string, finite
/// numbers and no prototype-shaped keys. Arrays stay bounded by the 64 KiB
/// cap applied by the caller.
fn valid_view_state(value: &serde_json::Value, depth: usize) -> bool {
    if depth > MAX_SPLIT_VIEW_DEPTH {
        return false;
    }
    match value {
        serde_json::Value::Null | serde_json::Value::Bool(_) => true,
        serde_json::Value::String(text) => {
            text.encode_utf16().count() <= MAX_SPLIT_VIEW_STRING_UNITS
        }
        serde_json::Value::Number(number) => {
            number.as_f64().map(f64::is_finite).unwrap_or(false)
        }
        serde_json::Value::Array(items) => items
            .iter()
            .all(|item| valid_view_state(item, depth + 1)),
        serde_json::Value::Object(map) => {
            map.len() <= MAX_SPLIT_VIEW_KEYS
                && map.iter().all(|(key, item)| {
                    !FORBIDDEN_VIEW_KEYS.contains(&key.as_str())
                        && valid_view_state(item, depth + 1)
                })
        }
    }
}

fn validate_leaf(leaf: &SplitLeaf) -> Result<(), SplitError> {
    if !valid_view_id(&leaf.view_id) {
        return Err(SplitError::Invalid);
    }
    match leaf.kind.as_str() {
        "file" => {
            if leaf.folder.is_some() {
                return Err(SplitError::Invalid);
            }
            let source = leaf.source.as_ref().ok_or(SplitError::Invalid)?;
            validate_session_document_ref(source).map_err(|_| SplitError::Invalid)?;
            let handler = leaf.handler.as_deref().ok_or(SplitError::Invalid)?;
            if !valid_handler(handler) {
                return Err(SplitError::Invalid);
            }
        }
        "folder" => {
            if leaf.source.is_some() || leaf.handler.is_some() {
                return Err(SplitError::Invalid);
            }
            let folder = leaf.folder.as_ref().ok_or(SplitError::Invalid)?;
            validate_folder(folder).map_err(|_| SplitError::Invalid)?;
        }
        // A split inside a split is what the two-side limit forbids.
        "split" => return Err(SplitError::Limit),
        _ => return Err(SplitError::Unsupported),
    }
    // A folder leaf's scroll and layout live in `folder.scroll_top`, the
    // shape a folder tab restores; a top-level view would be dropped.
    if leaf.kind == "folder" && (leaf.view.is_some() || leaf.view_version.is_some()) {
        return Err(SplitError::Invalid);
    }
    if let Some(title) = &leaf.title {
        if title.chars().count() > MAX_SPLIT_TITLE_CHARS {
            return Err(SplitError::Invalid);
        }
    }
    if let Some(view) = &leaf.view {
        if !valid_view_state(view, 0) {
            return Err(SplitError::Invalid);
        }
        let bytes = serde_json::to_vec(view).map_err(|_| SplitError::Invalid)?;
        if bytes.len() > MAX_SPLIT_VIEW_BYTES {
            return Err(SplitError::Invalid);
        }
    }
    if let Some(missing) = &leaf.missing {
        match missing.reason.as_str() {
            "not_found" | "handler_missing" | "locked" => {}
            _ => return Err(SplitError::Invalid),
        }
        if let Some(path) = &missing.original_path {
            crate::validate_absolute_path(path).map_err(|_| SplitError::Invalid)?;
        }
    }
    let locked = matches!(
        leaf.source.as_ref(),
        Some(SessionDocumentRef::Virtual { .. })
    );
    let missing_locked = leaf
        .missing
        .as_ref()
        .map(|missing| missing.reason == "locked")
        .unwrap_or(false);
    if (locked || missing_locked)
        && (leaf.title.is_some() || leaf.view.is_some() || leaf.view_version.is_some())
    {
        return Err(SplitError::Invalid);
    }
    Ok(())
}

/// Validate one stored split. Both sides are required, the two view ids
/// differ (two views of one document are allowed; one view id twice is
/// not), and the direction/ratio/side values are from their sets.
pub fn validate_split(state: &SplitState) -> Result<(), SplitError> {
    if !state.ratio.is_finite() || state.ratio < SPLIT_RATIO_MIN || state.ratio > SPLIT_RATIO_MAX {
        return Err(SplitError::Invalid);
    }
    validate_leaf(&state.first)?;
    validate_leaf(&state.second)?;
    if state.first.view_id == state.second.view_id {
        return Err(SplitError::Invalid);
    }
    Ok(())
}

/// Validate the split-related fields of one session tab (or one saved-group
/// descriptor): a `split` kind needs its state, a non-split kind must not
/// carry one, and `content_view_id` (a promoted survivor) is a bounded id.
pub fn validate_split_tab(
    kind: &str,
    split: Option<&SplitState>,
    content_view_id: Option<&str>,
) -> Result<(), SplitError> {
    match split {
        Some(state) => {
            if kind != "split" {
                return Err(SplitError::Invalid);
            }
            validate_split(state)?;
        }
        None => {
            if kind == "split" {
                return Err(SplitError::Invalid);
            }
        }
    }
    if let Some(view_id) = content_view_id {
        // Only a promoted survivor (a normal file or folder tab) keeps a
        // leaf view identity; a split tab names its sides instead.
        if kind != "file" && kind != "folder" {
            return Err(SplitError::Invalid);
        }
        if !valid_view_id(view_id) {
            return Err(SplitError::Invalid);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn disk_leaf(view_id: &str, path: &str) -> SplitLeaf {
        SplitLeaf {
            view_id: view_id.to_string(),
            kind: "file".to_string(),
            source: Some(SessionDocumentRef::Disk {
                path: path.to_string(),
            }),
            handler: Some("text".to_string()),
            folder: None,
            title: Some("notes.txt".to_string()),
            view: None,
            view_version: None,
            missing: None,
        }
    }

    fn folder_leaf(view_id: &str, path: &str) -> SplitLeaf {
        SplitLeaf {
            view_id: view_id.to_string(),
            kind: "folder".to_string(),
            source: None,
            handler: None,
            folder: Some(FolderTabState {
                path: path.to_string(),
                view_mode: "details".to_string(),
                sort: crate::session::SessionSortSpec {
                    key: "name".to_string(),
                    direction: "ascending".to_string(),
                },
                group_by: "none".to_string(),
                column_root: None,
                scroll_top: 0.0,
                focus_path: None,
            }),
            title: None,
            view: None,
            view_version: None,
            missing: None,
        }
    }

    fn split(first: SplitLeaf, second: SplitLeaf) -> SplitState {
        SplitState {
            first,
            second,
            direction: SplitDirection::Vertical,
            ratio: 0.5,
            active_side: SplitSide::First,
            sync_scroll: false,
        }
    }

    #[test]
    fn two_leaf_state_round_trips() {
        let state = split(disk_leaf("a", "C:\\a.txt"), disk_leaf("b", "C:\\b.txt"));
        let json = serde_json::to_string(&state).unwrap();
        let parsed: SplitState = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, state);
        assert_eq!(MAX_SPLIT_LEAVES, 2);
        assert!(validate_split(&parsed).is_ok());
    }

    #[test]
    fn ratio_outside_bounds_is_refused() {
        for ratio in [0.19_f64, 0.81, f64::NAN, f64::INFINITY] {
            let mut state = split(disk_leaf("a", "C:\\a.txt"), disk_leaf("b", "C:\\b.txt"));
            state.ratio = ratio;
            assert_eq!(validate_split(&state), Err(SplitError::Invalid), "{ratio}");
        }
    }

    #[test]
    fn nested_split_kind_is_refused_with_the_limit_code() {
        let mut leaf = disk_leaf("a", "C:\\a.txt");
        leaf.kind = "split".to_string();
        let state = split(leaf, disk_leaf("b", "C:\\b.txt"));
        assert_eq!(validate_split(&state), Err(SplitError::Limit));
        assert_eq!(SplitError::Limit.code(), "splits.limit");
    }

    #[test]
    fn nested_split_field_is_not_ignored() {
        let json = r#"{
            "view_id": "a",
            "kind": "file",
            "source": { "kind": "disk", "path": "C:\\a.txt" },
            "handler": "text",
            "split": { "first": {} }
        }"#;
        assert!(serde_json::from_str::<SplitLeaf>(json).is_err());
    }

    #[test]
    fn locked_leaf_keeps_no_plain_title_or_view() {
        let mut leaf = disk_leaf("a", "C:\\a.txt");
        leaf.source = Some(SessionDocumentRef::Virtual {
            provider: "locked".to_string(),
            container_path: "C:\\vault.adplock".to_string(),
            entry_id: uuid::Uuid::new_v4().to_string(),
        });
        leaf.title = Some("secret.txt".to_string());
        let state = split(leaf, disk_leaf("b", "C:\\b.txt"));
        assert_eq!(validate_split(&state), Err(SplitError::Invalid));
    }

    #[test]
    fn duplicate_view_ids_are_refused() {
        let state = split(disk_leaf("same", "C:\\a.txt"), disk_leaf("same", "C:\\b.txt"));
        assert_eq!(validate_split(&state), Err(SplitError::Invalid));
    }

    #[test]
    fn unsupported_leaf_kind_is_refused() {
        let mut leaf = disk_leaf("a", "C:\\a.txt");
        leaf.kind = "help".to_string();
        let state = split(leaf, disk_leaf("b", "C:\\b.txt"));
        assert_eq!(validate_split(&state), Err(SplitError::Unsupported));
        assert_eq!(SplitError::Unsupported.code(), "splits.unsupported");
    }

    #[test]
    fn split_tab_needs_a_state_and_a_normal_tab_must_not_have_one() {
        let state = split(disk_leaf("a", "C:\\a.txt"), disk_leaf("b", "C:\\b.txt"));
        assert!(validate_split_tab("split", Some(&state), None).is_ok());
        assert_eq!(validate_split_tab("file", Some(&state), None), Err(SplitError::Invalid));
        assert_eq!(validate_split_tab("split", None, None), Err(SplitError::Invalid));
        assert!(validate_split_tab("file", None, Some("view-1")).is_ok());
        assert_eq!(validate_split_tab("file", None, Some("  ")), Err(SplitError::Invalid));
    }

    #[test]
    fn folder_leaf_keeps_scroll_in_folder_state() {
        let folder = folder_leaf("a", "C:\\Work");
        assert!(validate_split(&split(folder.clone(), disk_leaf("b", "C:\\b.txt"))).is_ok());
        let mut with_view = folder;
        with_view.view = Some(serde_json::json!({ "scroll_top": 10 }));
        assert_eq!(
            validate_split(&split(with_view, disk_leaf("b", "C:\\b.txt"))),
            Err(SplitError::Invalid)
        );
    }

    #[test]
    fn view_state_depth_and_shape_match_the_ui() {
        fn with_view(view: serde_json::Value) -> SplitState {
            let mut leaf = disk_leaf("a", "C:\\a.txt");
            leaf.view = Some(view);
            split(leaf, disk_leaf("b", "C:\\b.txt"))
        }

        let mut eight = serde_json::json!(0);
        for _ in 0..8 {
            eight = serde_json::json!([eight]);
        }
        assert!(validate_split(&with_view(eight)).is_ok());
        let mut nine = serde_json::json!(0);
        for _ in 0..9 {
            nine = serde_json::json!([nine]);
        }
        assert_eq!(validate_split(&with_view(nine)), Err(SplitError::Invalid));

        let mut keys = serde_json::Map::new();
        for index in 0..65 {
            keys.insert(format!("k{index}"), serde_json::json!(0));
        }
        assert_eq!(
            validate_split(&with_view(serde_json::Value::Object(keys))),
            Err(SplitError::Invalid)
        );
        assert_eq!(
            validate_split(&with_view(serde_json::json!({ "__proto__": 0 }))),
            Err(SplitError::Invalid)
        );
        assert_eq!(
            validate_split(&with_view(serde_json::json!("x".repeat(8193)))),
            Err(SplitError::Invalid)
        );
    }

    #[test]
    fn promoted_view_identity_belongs_to_a_normal_tab_only() {
        let state = split(disk_leaf("a", "C:\\a.txt"), disk_leaf("b", "C:\\b.txt"));
        assert_eq!(
            validate_split_tab("split", Some(&state), Some("view-1")),
            Err(SplitError::Invalid)
        );
        assert!(validate_split_tab("file", None, Some("view-1")).is_ok());
        assert!(validate_split_tab("folder", None, Some("view-1")).is_ok());
        assert_eq!(
            validate_split_tab("help", None, Some("view-1")),
            Err(SplitError::Invalid)
        );
    }

    #[test]
    fn error_codes_are_stable() {
        assert_eq!(SplitError::Invalid.code(), "splits.invalid");
        assert_eq!(SplitError::Unsupported.code(), "splits.unsupported");
        assert_eq!(SplitError::Limit.code(), "splits.limit");
    }
}
