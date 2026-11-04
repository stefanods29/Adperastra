//! Portable data location (Step 08d T3/E5).
//!
//! Precedence: an explicit `ADPERASTRA_DATA_DIR`, then an active
//! `portable-mode.marker` next to the app (data in `AdperastraData`), then
//! the installed data folder. A portable folder that cannot be written is
//! never used silently: the caller offers Choose data folder or Cancel, and
//! this module performs no settings copy or directory creation by itself.
#![allow(dead_code)]


use serde::Deserialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Marker file in the portable ZIP's root.
pub const MARKER_FILE: &str = "portable-mode.marker";
/// Data folder beside the portable app.
pub const DATA_DIR_NAME: &str = "AdperastraData";
/// Marker schema understood by this release.
pub const MARKER_SCHEMA: u32 = 1;
/// A marker is tiny; anything larger is not our file.
pub const MAX_MARKER_BYTES: u64 = 512;
/// Explicit data-location environment variable (existing behavior).
pub const ENV_DATA_DIR: &str = "ADPERASTRA_DATA_DIR";
/// Packaging helper flag handled in `main()` before Tauri starts.
pub const MARKER_HELPER_FLAG: &str = "--write-portable-marker";

/// The app's own location and the effective data location (E5).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PortableLocation {
    pub app_dir: PathBuf,
    pub data_dir: PathBuf,
    pub portable: bool,
    pub writable: bool,
}

/// The user's answer when a portable folder cannot store data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PortableChoice {
    /// Use the data folder beside the app (only when it is writable).
    Adjacent,
    /// Use a folder the user chose.
    Choose(PathBuf),
    /// Keep the previous installed data location.
    Cancel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct PortableMarker {
    enabled: bool,
    version: u32,
}

/// Exact marker bytes. It contains no path and no personal data.
pub fn marker_contents() -> &'static str {
    "{\"enabled\":true,\"version\":1}"
}

/// Writes the marker into a fresh portable folder. An existing identical
/// marker is left alone; any other existing file is never overwritten.
pub fn write_marker(app_dir: &Path) -> Result<(), String> {
    let path = app_dir.join(MARKER_FILE);
    let contents = marker_contents();
    match OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(mut file) => {
            file.write_all(contents.as_bytes())
                .map_err(|_| "portable.marker_failed".to_string())?;
            file.sync_all()
                .map_err(|_| "portable.marker_failed".to_string())
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let existing =
                fs::read_to_string(&path).map_err(|_| "portable.marker_invalid".to_string())?;
            if existing == contents {
                Ok(())
            } else {
                Err("portable.marker_exists".to_string())
            }
        }
        Err(_) => Err("portable.marker_failed".to_string()),
    }
}

/// `--write-portable-marker <app-dir>` used by the portable ZIP packaging.
pub fn run_marker_helper() -> i32 {
    let args: Vec<String> = std::env::args().skip(2).collect();
    if args.len() != 1 {
        return 2;
    }
    match write_marker(Path::new(&args[0])) {
        Ok(()) => 0,
        Err(code) => {
            eprintln!("{code}");
            2
        }
    }
}

fn read_marker(app_dir: &Path) -> Result<Option<PortableMarker>, String> {
    let path = app_dir.join(MARKER_FILE);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("portable.marker_invalid".to_string()),
    };
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err("portable.marker_invalid".to_string());
        }
    }
    if !metadata.is_file() || metadata.len() > MAX_MARKER_BYTES {
        return Err("portable.marker_invalid".to_string());
    }
    let text = fs::read_to_string(&path).map_err(|_| "portable.marker_invalid".to_string())?;
    let marker: PortableMarker =
        serde_json::from_str(&text).map_err(|_| "portable.marker_invalid".to_string())?;
    if marker.version != MARKER_SCHEMA {
        return Err("portable.marker_invalid".to_string());
    }
    Ok(Some(marker))
}

/// Locates the data folder using the environment and the real filesystem.
pub fn locate(
    app_dir: &Path,
    installed_data_dir: &Path,
) -> Result<PortableLocation, String> {
    let explicit = std::env::var(ENV_DATA_DIR)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    locate_with(
        app_dir,
        installed_data_dir,
        explicit.as_deref(),
        &writable_preflight,
    )
}

/// Pure location decision with an injected writable check (tests use this).
pub fn locate_with(
    app_dir: &Path,
    installed_data_dir: &Path,
    explicit: Option<&Path>,
    writable: &dyn Fn(&Path) -> bool,
) -> Result<PortableLocation, String> {
    if let Some(explicit) = explicit {
        validate_absolute_dir(explicit)?;
        return Ok(PortableLocation {
            app_dir: app_dir.to_path_buf(),
            data_dir: explicit.to_path_buf(),
            portable: false,
            writable: writable(explicit),
        });
    }
    let marker = read_marker(app_dir)?;
    if marker.is_some_and(|marker| marker.enabled) {
        let data_dir = app_dir.join(DATA_DIR_NAME);
        let can_write = writable(if data_dir.exists() { &data_dir } else { app_dir });
        return Ok(PortableLocation {
            app_dir: app_dir.to_path_buf(),
            data_dir,
            portable: true,
            writable: can_write,
        });
    }
    Ok(PortableLocation {
        app_dir: app_dir.to_path_buf(),
        data_dir: installed_data_dir.to_path_buf(),
        portable: false,
        writable: writable(installed_data_dir),
    })
}

/// True when the caller must show Choose data folder / Cancel.
pub fn requires_data_choice(location: &PortableLocation) -> bool {
    location.portable && !location.writable
}

/// Applies the user's answer without copying or deleting any settings.
pub fn apply_choice(
    location: PortableLocation,
    installed_data_dir: &Path,
    choice: PortableChoice,
) -> Result<PortableLocation, String> {
    apply_choice_with(
        location,
        installed_data_dir,
        choice,
        &writable_preflight,
    )
}

/// Pure choice decision with an injected writable check.
pub fn apply_choice_with(
    location: PortableLocation,
    installed_data_dir: &Path,
    choice: PortableChoice,
    writable: &dyn Fn(&Path) -> bool,
) -> Result<PortableLocation, String> {
    match choice {
        PortableChoice::Adjacent => {
            if location.portable && location.writable {
                Ok(location)
            } else {
                Err("portable.not_writable".to_string())
            }
        }
        PortableChoice::Choose(directory) => {
            validate_absolute_dir(&directory)?;
            if !writable(&directory) {
                return Err("portable.not_writable".to_string());
            }
            Ok(PortableLocation {
                app_dir: location.app_dir,
                data_dir: directory,
                portable: true,
                writable: true,
            })
        }
        PortableChoice::Cancel => Ok(PortableLocation {
            app_dir: location.app_dir,
            data_dir: installed_data_dir.to_path_buf(),
            portable: false,
            writable: writable(installed_data_dir),
        }),
    }
}

/// Creates and removes one uniquely named probe file. No other file is
/// touched, so a read-only folder stays unchanged apart from the failed
/// create attempt.
pub fn writable_preflight(directory: &Path) -> bool {
    if directory.exists() && !directory.is_dir() {
        return false;
    }
    let target = if directory.is_dir() {
        directory
    } else if let Some(parent) = directory.parent() {
        parent
    } else {
        return false;
    };
    if !target.is_dir() {
        return false;
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    for attempt in 0..3u32 {
        let path = target.join(format!(
            "~adp-write-{}-{stamp}-{attempt}.tmp",
            std::process::id()
        ));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                let written = file.write_all(b"1").is_ok();
                let synced = file.sync_all().is_ok();
                drop(file);
                let _ = fs::remove_file(&path);
                return written && synced;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return false,
        }
    }
    false
}

fn validate_absolute_dir(path: &Path) -> Result<(), String> {
    if !path.is_absolute()
        || path.parent().is_none()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("portable.bad_path".to_string());
    }
    if path.exists() && !path.is_dir() {
        return Err("portable.bad_path".to_string());
    }
    Ok(())
}

#[cfg(test)]
#[path = "portable_tests.rs"]
mod tests;
