//! Core logic for the Adperastra setup window (Step 01a).
//! No UI: manifest parsing, verification, install, profile, i18n, logging.

pub mod i18n;
pub mod install;
pub mod logfile;
pub mod manifest;
pub mod profile;
pub mod signing;
pub mod verify;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum SetupError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("manifest error: {0}")]
    Manifest(String),
    #[error("hash mismatch: {0}")]
    HashMismatch(String),
    #[error("size mismatch: {0}")]
    SizeMismatch(String),
    #[error("not installable: {0}")]
    NotInstallable(String),
    #[error("download error: {0}")]
    Download(String),
}

pub type Result<T> = std::result::Result<T, SetupError>;

pub use i18n::{available_keys, keys_for, t};
pub use install::{fetch_installer, install_component, install_runtime, RuntimeProgress};
pub use logfile::append_log;
pub use manifest::{
    load_manifest, parse_manifest, AppInfo, Component, ComponentKind, Installer, Manifest, Pack,
    Signature, Source,
};
pub use profile::{
    free_disk_space, is_first_run, load_profile, profile_path, save_profile, Profile,
};
pub use signing::{
    canonical_manifest_bytes, generate_keypair, sign_manifest, signature_status, SignatureStatus,
    DEVELOPMENT_PUBLIC_KEY,
};
pub use verify::{
    expand_env, missing_required, verify_all, verify_component, ComponentReport, Status,
};
