//! Native custom-theme wire types (Step 10a, custom-theme-1).
//!
//! The canonical data and validation live in `fs-service::theme_data`; this
//! module reexports them so the Tauri layer has one native definition and no
//! second copy can drift. Only transport-only results are added here.

pub use fs_service::theme_data::*;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThemeExportResult {
    pub path: String,
    pub bytes: u64,
}

/// An owned PNG asset and its one live `adpfile` grant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThemeBackgroundAsset {
    pub asset_id: String,
    pub token: String,
    pub name: String,
    pub mime: String,
    pub byte_len: u64,
    pub width: u32,
    pub height: u32,
}

/// Requested and actually applied window material.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MaterialResult {
    pub requested: String,
    pub applied: String,
    pub fallback: bool,
}
