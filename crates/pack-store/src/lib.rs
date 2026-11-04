//! Optional pack catalog, download, activation and lease logic (Step 12a).
//!
//! This crate is pure Rust with no Tauri types. The native `packs.rs`
//! adapter validates IPC arguments, runs these calls on blocking threads and
//! maps [`PackError`] codes to the UI. Pack directories live under the shared
//! `ProfileRoot::shared_packs_dir` injected by Step 10c.
//!
//! H04: [`install::install_and_activate`] and [`install::extract_archive`]
//! are workers for the bounded `--pack-helper` process. The app parent checks
//! the staged tree with [`install::verify_staging`] and activates only the
//! resulting token with [`install::activate_verified`]. Install stays
//! unavailable until the signed catalog, completed download and probe
//! contracts are configured.

pub mod catalog;
pub mod download;
pub mod download_http;
pub mod download_state;
pub mod error;
pub mod install;
pub mod install_state;
pub mod inventory;
pub mod leases;
pub mod types;
pub mod url_policy;
pub mod validation;

pub use error::{PackError, PackResult};
pub use leases::{PackLease, PackLeases, RemoveOutcome};
pub use types::*;

/// The interface revision this crate implements.
pub const INTERFACE_REVISION: &str = "packs-1";
