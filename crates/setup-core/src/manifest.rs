//! Dependency manifest (`dependencies.json`) types and parsing.

use crate::{Result, SetupError};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Manifest {
    pub schema: u32,
    pub app: AppInfo,
    pub signature: Option<Signature>,
    pub components: Vec<Component>,
    #[serde(default)]
    pub optional_packs: Vec<Pack>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Signature {
    pub algorithm: String,
    pub public_key: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Component {
    pub id: String,
    pub name_key: String,
    pub version: String,
    pub kind: ComponentKind,
    pub required: bool,
    pub size: Option<u64>,
    pub sha256: Option<String>,
    pub source: Option<Source>,
    #[serde(default)]
    pub installer: Option<Installer>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ComponentKind {
    File { path: String },
    AnyPath { paths: Vec<String> },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Source {
    Local { path: String },
    Url { url: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Installer {
    pub source: Source,
    pub sha256: String,
    pub size: u64,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Pack {
    pub id: String,
    pub name_key: String,
    pub desc_key: String,
    #[serde(default)]
    pub note_key: Option<String>,
    pub download_size: u64,
    pub install_size: u64,
}

pub fn parse_manifest(text: &str) -> Result<Manifest> {
    let m: Manifest = serde_json::from_str(text.trim_start_matches('\u{FEFF}'))?;
    if m.schema == 0 {
        return Err(SetupError::Manifest("unsupported schema 0".into()));
    }
    Ok(m)
}

pub fn load_manifest(path: &Path) -> Result<Manifest> {
    let text = std::fs::read_to_string(path)?;
    parse_manifest(&text)
}
