//! Source stamps and identities for the cache service (Step 07a, E9).
//!
//! Every capture uses an attribute-only, no-recall handle: a stamp can be
//! read for an online-only file without downloading it, and a reparse point
//! is refused instead of followed.

use std::path::Path;

use fs_service::owned_io::SourceIdentity;
use fs_service::source_stamp::{
    attributes_are_online_only, capture_file_identity, capture_source_stamp, FileIdentityKey,
    SourceStamp,
};
use tauri::WebviewWindow;

use crate::ensure_main;
use crate::validate_absolute_path;

/// Capture a precise stamp, mapped to the cache area's codes.
pub fn capture(path: &Path) -> Result<SourceStamp, String> {
    capture_source_stamp(path).map_err(|error| stamp_error(&error))
}

/// Capture the stable identity, mapped to the cache area's codes.
pub fn identity(path: &Path) -> Result<FileIdentityKey, String> {
    capture_file_identity(path).map_err(|error| stamp_error(&error))
}

/// True for a cloud placeholder. Uses attributes only, never content.
pub fn online_only(path: &Path) -> Result<bool, String> {
    let identity = SourceIdentity::capture(path).map_err(|error| stamp_error(&error))?;
    Ok(attributes_are_online_only(identity.attributes))
}

fn stamp_error(error: &fs_service::owned_io::OwnedIoError) -> String {
    use fs_service::owned_io::OwnedIoError;
    match error {
        OwnedIoError::SourceChanged => "cache.changed".to_string(),
        OwnedIoError::ReparseRefused => "cache.bad_request".to_string(),
        OwnedIoError::Io(io) if io.kind() == std::io::ErrorKind::NotFound => {
            "cache.bad_request".to_string()
        }
        _ => "cache.unavailable".to_string(),
    }
}

/// The stable file identity for later steps (10d/11a/11b). Metadata only:
/// no content is read and an online-only file is never hydrated.
#[tauri::command]
pub async fn file_identity(window: WebviewWindow, path: String) -> Result<FileIdentityKey, String> {
    ensure_main(window.label())?;
    validate_absolute_path(&path).map_err(|_| "cache.bad_request".to_string())?;
    tauri::async_runtime::spawn_blocking(move || identity(Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
}
