//! Session descriptors (Step 09a, session-2).
//!
//! The single native source for `SessionTab` / `SessionState`. The
//! coordinator moves the existing definitions out of `main.rs` into this
//! module and keeps the public re-exports and the `get_session` /
//! `save_session` functions working unchanged for older callers.
//!
//! A session stores descriptors and bounded view state only: no live
//! content, passwords, tokens or runtime handles. A session written by a
//! newer schema is refused as a whole and the original file is retained.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};

use crate::split_types::SplitState;

/// Most tabs a session may hold, permanent Explorer included.
pub const MAX_SESSION_TABS: usize = 200;
/// Most entries in the activation history.
pub const MAX_SESSION_HISTORY: usize = 200;
/// Largest serialized session, in bytes.
pub const MAX_SESSION_BYTES: usize = 4 * 1024 * 1024;
/// Schema written by this step. The legacy schema without the field
/// reads as 1.
pub const SESSION_SCHEMA_VERSION: u32 = 3;

/// A folder tab's serializable view state (mirrors the TypeScript
/// `FolderTabState` in `src/services/folderState.ts`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FolderTabState {
    pub path: String,
    pub view_mode: String,
    pub sort: SessionSortSpec,
    pub group_by: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column_root: Option<String>,
    pub scroll_top: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub focus_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionSortSpec {
    /// One of `name`, `modified`, `size`, `kind` (the existing `SortSpec`).
    pub key: String,
    /// `ascending` or `descending`.
    pub direction: String,
}

/// A document source descriptor, as stored in a session. This is the
/// canonical `document_types::DocumentRef`, not a second enum: virtual
/// entries carry only the opaque entry id and container path, with no
/// plain title, path or view state unless the provider's own encrypted
/// store holds them.
pub use crate::document_types::DocumentRef as SessionDocumentRef;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionTab {
    pub id: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handler: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<SessionDocumentRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder: Option<FolderTabState>,
    /// Split tabs (Step 09i D7): both sides, with their encoded view state
    /// and no nested split. A non-split tab never carries one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub split: Option<SplitState>,
    /// A promoted survivor's stable leaf view id (file/folder only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_view_id: Option<String>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view_version: Option<u32>,
    /// A restored tab whose source or handler was unavailable. The tab
    /// stays visible so the user can locate or close it (D5).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub missing_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionState {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub tabs: Vec<SessionTab>,
    #[serde(default)]
    pub active_tab: String,
    #[serde(default)]
    pub saved_unix: u64,
    /// Tab ids in activation order, oldest first.
    #[serde(default)]
    pub history: Vec<String>,
    /// Live groups are additive session data; legacy sessions have none.
    #[serde(default)]
    pub groups: Vec<crate::saved_group_types::LiveTabGroup>,
}

fn default_schema_version() -> u32 {
    1
}

impl Default for SessionState {
    fn default() -> Self {
        SessionState {
            schema_version: SESSION_SCHEMA_VERSION,
            tabs: Vec::new(),
            active_tab: "explorer".to_string(),
            saved_unix: 0,
            history: Vec::new(),
            groups: Vec::new(),
        }
    }
}

/// Validate a session before it is written. Errors are the stable code
/// `tabs.invalid_state`; display text belongs to the UI.
pub fn validate_session(state: &SessionState) -> Result<(), String> {
    if state.schema_version > SESSION_SCHEMA_VERSION {
        return Err("tabs.invalid_state".to_string());
    }
    if state.tabs.len() > MAX_SESSION_TABS || state.history.len() > MAX_SESSION_HISTORY {
        return Err("tabs.invalid_state".to_string());
    }
    crate::saved_group_validation::validate_live_groups(&state.groups)
        .map_err(|_| "tabs.invalid_state".to_string())?;
    let mut explorers = 0usize;
    let mut pinned = 0usize;
    for tab in &state.tabs {
        if tab.id.is_empty() || tab.id.chars().count() > 128 {
            return Err("tabs.invalid_state".to_string());
        }
        if tab.kind == "explorer" {
            explorers += 1;
        }
        if tab.pinned {
            pinned += 1;
            if tab.kind == "explorer" {
                return Err("tabs.invalid_state".to_string());
            }
        }
        if pinned > 20 {
            return Err("tabs.invalid_state".to_string());
        }
        if let Some(title) = &tab.title {
            if title.chars().count() > 255 {
                return Err("tabs.invalid_state".to_string());
            }
        }
        if let Some(path) = &tab.path {
            if path.is_empty() || path.chars().count() > 32768 {
                return Err("tabs.invalid_state".to_string());
            }
        }
        if tab.kind == "folder" {
            let folder = tab
                .folder
                .as_ref()
                .ok_or_else(|| "tabs.invalid_state".to_string())?;
            validate_folder(folder)?;
        }
        if let Some(source) = &tab.source {
            // The canonical document reference validates its own shape
            // (unknown providers are refused), so a session can never
            // smuggle in a provider this build does not have.
            validate_session_document_ref(source)?;
        }
        if let Some(SessionDocumentRef::Virtual {
            provider, entry_id, ..
        }) = &tab.source
        {
            if provider != "locked" || uuid::Uuid::try_parse(entry_id).is_err() {
                return Err("tabs.invalid_state".to_string());
            }
            // A serialized virtual tab never carries a plain title, a
            // plain file path or view state.
            if tab.title.is_some() || tab.path.is_some() || tab.view.is_some() {
                return Err("tabs.invalid_state".to_string());
            }
        }
        if let Some(reason) = &tab.missing_reason {
            if !matches!(reason.as_str(), "not_found" | "handler_missing" | "locked") {
                return Err("tabs.invalid_state".to_string());
            }
        }
        // Split fields (Step 09i D7): kind `split` needs its two sides, a
        // non-split tab must not carry one, and a promoted survivor is a
        // normal file/folder tab. The split validator owns the leaf bounds.
        crate::split_types::validate_split_tab(
            &tab.kind,
            tab.split.as_ref(),
            tab.content_view_id.as_deref(),
        )
        .map_err(|_| "tabs.invalid_state".to_string())?;
        if tab.kind == "split"
            && (tab.path.is_some()
                || tab.handler.is_some()
                || tab.source.is_some()
                || tab.folder.is_some()
                || tab.view.is_some()
                || tab.view_version.is_some()
                || tab.missing_reason.is_some())
        {
            // The outer split tab is a position, not content: its leaves
            // carry source, folder, view state and placeholders.
            return Err("tabs.invalid_state".to_string());
        }
    }
    if explorers != 1 {
        return Err("tabs.invalid_state".to_string());
    }
    let bytes = serde_json::to_vec(state).map_err(|_| "tabs.invalid_state".to_string())?;
    if bytes.len() > MAX_SESSION_BYTES {
        return Err("tabs.invalid_state".to_string());
    }
    Ok(())
}

/// Validate the canonical source descriptor of one session tab. The
/// document registry and the split/saved-group validators share this
/// function, so a session can never contain a second, private shape.
pub fn validate_session_document_ref(source: &SessionDocumentRef) -> Result<(), String> {
    source
        .validate()
        .map_err(|_| "tabs.invalid_state".to_string())
}

/// Validate one folder tab's stored view state. Paths are absolute, the
/// view mode and grouping are existing ids, and scroll stays finite.
pub fn validate_folder(folder: &FolderTabState) -> Result<(), String> {
    if folder.path != "home" {
        crate::validate_absolute_path(&folder.path)
            .map_err(|_| "tabs.invalid_state".to_string())?;
    }
    if !matches!(
        folder.view_mode.as_str(),
        "extraLargeIcons"
            | "largeIcons"
            | "mediumIcons"
            | "smallIcons"
            | "list"
            | "details"
            | "tiles"
            | "content"
            | "columns"
    ) {
        return Err("tabs.invalid_state".to_string());
    }
    if !matches!(
        folder.sort.key.as_str(),
        "name" | "modified" | "size" | "kind"
    ) || !matches!(folder.sort.direction.as_str(), "ascending" | "descending")
    {
        return Err("tabs.invalid_state".to_string());
    }
    if !matches!(
        folder.group_by.as_str(),
        "none" | "name" | "modified" | "type" | "size"
    ) {
        return Err("tabs.invalid_state".to_string());
    }
    if let Some(column_root) = &folder.column_root {
        crate::validate_absolute_path(column_root).map_err(|_| "tabs.invalid_state".to_string())?;
    }
    if let Some(focus_path) = &folder.focus_path {
        crate::validate_absolute_path(focus_path).map_err(|_| "tabs.invalid_state".to_string())?;
    }
    if !folder.scroll_top.is_finite() || !(0.0..=1e9).contains(&folder.scroll_top) {
        return Err("tabs.invalid_state".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn explorer() -> SessionTab {
        SessionTab {
            id: "explorer".to_string(),
            kind: "explorer".to_string(),
            title: None,
            path: None,
            handler: None,
            source: None,
            folder: None,
            split: None,
            content_view_id: None,
            pinned: false,
            view: None,
            view_version: None,
            missing_reason: None,
            group_id: None,
        }
    }

    #[test]
    fn legacy_session_without_schema_reads_as_version_1() {
        let state: SessionState =
            serde_json::from_str(r#"{"tabs":[],"active_tab":"explorer","saved_unix":1}"#).unwrap();
        assert_eq!(state.schema_version, 1);
    }

    #[test]
    #[allow(clippy::field_reassign_with_default)]
    fn newer_schema_is_refused_not_downgraded() {
        let mut state = SessionState::default();
        state.schema_version = SESSION_SCHEMA_VERSION + 1;
        state.tabs.push(explorer());
        assert_eq!(
            validate_session(&state),
            Err("tabs.invalid_state".to_string())
        );
    }

    #[test]
    fn second_permanent_explorer_is_refused() {
        let mut state = SessionState::default();
        state.tabs.push(explorer());
        state.tabs.push(explorer());
        assert!(validate_session(&state).is_err());
    }

    #[test]
    fn tab_201_is_refused() {
        let mut state = SessionState::default();
        state.tabs.push(explorer());
        for index in 0..200 {
            let mut tab = explorer();
            tab.id = format!("file-{index}");
            tab.kind = "file".to_string();
            state.tabs.push(tab);
        }
        assert!(validate_session(&state).is_err());
    }

    #[test]
    fn virtual_tab_must_not_carry_plain_title_or_path() {
        let mut state = SessionState::default();
        state.tabs.push(explorer());
        let mut tab = explorer();
        tab.id = "locked-1".to_string();
        tab.kind = "file".to_string();
        tab.source = Some(SessionDocumentRef::Virtual {
            provider: "locked".to_string(),
            container_path: "C:\\vault.adplock".to_string(),
            entry_id: uuid::Uuid::new_v4().to_string(),
        });
        tab.title = Some("secret.txt".to_string());
        state.tabs.push(tab);
        assert!(validate_session(&state).is_err());
    }

    #[test]
    fn session_document_ref_requires_an_absolute_disk_path() {
        assert!(validate_session_document_ref(&SessionDocumentRef::Disk {
            path: "C:\\docs\\note.txt".to_string(),
        })
        .is_ok());
        assert_eq!(
            validate_session_document_ref(&SessionDocumentRef::Disk {
                path: "docs\\note.txt".to_string(),
            }),
            Err("tabs.invalid_state".to_string())
        );
        assert_eq!(
            validate_session_document_ref(&SessionDocumentRef::Virtual {
                provider: "other".to_string(),
                container_path: "C:\\vault.adplock".to_string(),
                entry_id: uuid::Uuid::new_v4().to_string(),
            }),
            Err("tabs.invalid_state".to_string())
        );
    }

    #[test]
    fn folder_view_mode_and_group_by_are_validated() {
        let mut folder = FolderTabState {
            path: "C:\\docs".to_string(),
            view_mode: "details".to_string(),
            sort: SessionSortSpec {
                key: "name".to_string(),
                direction: "ascending".to_string(),
            },
            group_by: "none".to_string(),
            column_root: None,
            scroll_top: 0.0,
            focus_path: None,
        };
        assert!(validate_folder(&folder).is_ok());
        folder.path = "home".to_string();
        assert!(validate_folder(&folder).is_ok());
        folder.path = "relative".to_string();
        assert!(validate_folder(&folder).is_err());
        folder.path = "C:\\docs".to_string();
        folder.view_mode = "invented".to_string();
        assert!(validate_folder(&folder).is_err());
        folder.view_mode = "details".to_string();
        folder.group_by = "invented".to_string();
        assert!(validate_folder(&folder).is_err());
        folder.group_by = "none".to_string();
        folder.column_root = Some("relative".to_string());
        assert!(validate_folder(&folder).is_err());
    }

    #[test]
    fn missing_reason_must_be_a_known_placeholder() {
        let mut state = SessionState::default();
        state.tabs.push(explorer());
        let mut tab = explorer();
        tab.id = "file-1".to_string();
        tab.kind = "file".to_string();
        tab.source = Some(SessionDocumentRef::Disk {
            path: "C:\\docs\\note.txt".to_string(),
        });
        tab.handler = Some("text".to_string());
        tab.missing_reason = Some("not_found".to_string());
        state.tabs.push(tab.clone());
        assert!(validate_session(&state).is_ok());
        state.tabs.pop();
        tab.missing_reason = Some("invented".to_string());
        state.tabs.push(tab);
        assert!(validate_session(&state).is_err());
    }
}
