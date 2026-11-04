//! Clipboard-history contracts (Step 09j, `clipboard-history-1`).
//!
//! One canonical definition for the native history, its renderer mirror
//! in `src/services/clipboardHistory.ts` and the persist store. Payload
//! bytes never cross this module's wire types: an item carries a preview,
//! a size and flags only, and image bytes stay behind native memory or
//! the encrypted store.
#![allow(dead_code)]


use std::sync::Arc;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const MAX_HISTORY_ITEMS: usize = 100;
pub const MAX_PINNED_ITEMS: usize = 20;
pub const MAX_HISTORY_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_TEXT_SCALARS: usize = 1_048_576;
pub const MAX_TEXT_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_FILE_PATHS: usize = 1_000;
pub const MAX_IMAGE_PIXELS: u64 = 16_000_000;
pub const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_PAGE_ITEMS: usize = 50;
pub const MAX_SEARCH_CHARS: usize = 256;
pub const MAX_PREVIEW_CHARS: usize = 512;
pub const MAX_SOURCE_LABEL_CHARS: usize = 128;
pub const MAX_REMOVE_IDS: usize = 100;
pub const MAX_PATH_UNITS: usize = 32_768;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClipboardHistoryKind {
    Text,
    Files,
    Image,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClipboardHistorySource {
    App,
    Windows,
}

/// One row as the renderer sees it. `payload_token` is reserved for a
/// later live preview; it is never a path or a file grant, and this step
/// leaves it empty. `missing` only reports referenced files, never
/// content that was never there.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClipboardHistoryItem {
    pub id: String,
    pub kind: ClipboardHistoryKind,
    pub created_unix: u64,
    pub source: ClipboardHistorySource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_label: Option<String>,
    pub preview: String,
    pub byte_len: u64,
    pub pinned: bool,
    pub missing: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload_token: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClipboardHistoryPage {
    pub items: Vec<ClipboardHistoryItem>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    pub complete: bool,
    pub total: u32,
    pub used_bytes: u64,
    pub generation: u64,
}

/// The only payloads a clipboard item may resolve to. Image bytes are an
/// 08a snapshot identity, never raw bytes in JSON.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
#[allow(clippy::large_enum_variant)]
pub enum ClipboardHistoryPayload {
    Text {
        text: String,
    },
    Files {
        paths: Vec<String>,
    },
    Image {
        snapshot: crate::export_snapshot_types::ExportSnapshot,
        width: u32,
        height: u32,
    },
}

/// One explicit history change. `expected_generation` makes a stale
/// renderer action fail with `clipboard_history.changed` instead of
/// changing a newer history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ClipboardHistoryPatch {
    Pin {
        id: String,
        pinned: bool,
        expected_generation: u64,
    },
    Remove {
        ids: Vec<String>,
        expected_generation: u64,
    },
    Clear {
        #[serde(default)]
        include_pinned: bool,
        expected_generation: u64,
    },
}

impl ClipboardHistoryPatch {
    pub fn expected_generation(&self) -> u64 {
        match self {
            ClipboardHistoryPatch::Pin {
                expected_generation,
                ..
            }
            | ClipboardHistoryPatch::Remove {
                expected_generation,
                ..
            }
            | ClipboardHistoryPatch::Clear {
                expected_generation,
                ..
            } => *expected_generation,
        }
    }
}

/// Clipboard history settings (schema 26, Step 09j D7).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClipboardHistorySettings {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub capture_windows: bool,
    #[serde(default)]
    pub persist: bool,
    #[serde(default = "default_max_items")]
    pub max_items: u16,
    #[serde(default = "default_max_mib")]
    pub max_mib: u16,
}

fn default_true() -> bool {
    true
}

fn default_max_items() -> u16 {
    100
}

fn default_max_mib() -> u16 {
    64
}

impl Default for ClipboardHistorySettings {
    fn default() -> Self {
        ClipboardHistorySettings {
            enabled: true,
            capture_windows: false,
            persist: false,
            max_items: default_max_items(),
            max_mib: default_max_mib(),
        }
    }
}

impl ClipboardHistorySettings {
    pub fn validate(&self) -> Result<(), String> {
        if !(10..=100).contains(&self.max_items) {
            return Err("clipboard_history.invalid".to_string());
        }
        if !(8..=64).contains(&self.max_mib) {
            return Err("clipboard_history.invalid".to_string());
        }
        Ok(())
    }

    /// The effective caps can only tighten the hard global limits.
    pub fn effective_items(&self) -> usize {
        usize::from(self.max_items.min(MAX_HISTORY_ITEMS as u16))
    }

    pub fn effective_bytes(&self) -> u64 {
        u64::from(self.max_mib).min(64) * 1024 * 1024
    }
}

/// One native history entry. The payload is kept in shared memory so a
/// list or persist snapshot never copies image bytes.
#[derive(Clone)]
pub struct HistoryItem {
    pub id: Uuid,
    pub kind: ClipboardHistoryKind,
    pub created_unix: u64,
    pub source: ClipboardHistorySource,
    pub source_label: Option<String>,
    pub preview: String,
    pub byte_len: u64,
    pub pinned: bool,
    pub missing: bool,
    pub sensitive: bool,
    pub content_hash: String,
    pub payload: HistoryPayload,
}

#[derive(Clone)]
pub enum HistoryPayload {
    Text(Arc<str>),
    Files(Arc<[String]>),
    Image {
        mime: String,
        width: u32,
        height: u32,
        bytes: Arc<[u8]>,
    },
}

impl HistoryPayload {
    pub fn text(value: String) -> Self {
        HistoryPayload::Text(Arc::from(value))
    }

    pub fn files(value: Vec<String>) -> Self {
        HistoryPayload::Files(Arc::from(value))
    }

    pub fn image(mime: String, width: u32, height: u32, bytes: Vec<u8>) -> Self {
        HistoryPayload::Image {
            mime,
            width,
            height,
            bytes: Arc::from(bytes),
        }
    }
}

impl HistoryItem {
    pub fn to_wire(&self) -> ClipboardHistoryItem {
        ClipboardHistoryItem {
            id: self.id.to_string(),
            kind: self.kind,
            created_unix: self.created_unix,
            source: self.source,
            source_label: self.source_label.clone(),
            preview: self.preview.clone(),
            byte_len: self.byte_len,
            pinned: self.pinned,
            missing: self.missing,
            payload_token: None,
        }
    }
}

/// A payload captured from the Windows clipboard or from an app copy.
#[derive(Debug, Clone)]
pub enum CapturedPayload {
    Text(String),
    Files(Vec<String>),
    Image {
        mime: String,
        width: u32,
        height: u32,
        bytes: Vec<u8>,
    },
}

impl CapturedPayload {
    pub fn into_history_payload(self) -> HistoryPayload {
        match self {
            CapturedPayload::Text(text) => HistoryPayload::text(text),
            CapturedPayload::Files(paths) => HistoryPayload::files(paths),
            CapturedPayload::Image {
                mime,
                width,
                height,
                bytes,
            } => HistoryPayload::image(mime, width, height, bytes),
        }
    }
}

#[cfg(test)]
#[path = "clipboard_history_types_step09j_tests.rs"]
mod step09j_tests;
