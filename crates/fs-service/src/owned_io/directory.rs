//! A destination folder pinned for the whole operation (Step 06e D5).
//!
//! Every component of the resolved path is held open with delete sharing
//! denied, so the chain cannot be renamed, deleted or swapped for a junction
//! while an output is being staged below it.

use std::fs::File;
use std::path::{Component, Path, PathBuf};

use super::{
    handle_path, is_reparse, same_place, OwnedIoError, OwnedIoResult, MAX_PINNED_COMPONENTS,
};

/// The resolved destination folder and the handles that keep it in place.
pub struct PinnedDirectory {
    path: PathBuf,
    _holds: Vec<File>,
}

impl PinnedDirectory {
    /// Resolve `path` and pin every folder from the volume root down to it.
    pub fn open(path: &Path) -> OwnedIoResult<Self> {
        let resolved = std::fs::canonicalize(path)?;
        if !resolved.is_dir() {
            return Err(OwnedIoError::Io(std::io::Error::from(
                std::io::ErrorKind::NotFound,
            )));
        }
        let mut holds = Vec::new();
        #[cfg(windows)]
        {
            let mut current = PathBuf::new();
            for component in resolved.components() {
                match component {
                    Component::Prefix(prefix) => current.push(prefix.as_os_str()),
                    Component::RootDir => current.push("\\"),
                    Component::Normal(part) => current.push(part),
                    _ => continue,
                }
                if holds.len() >= MAX_PINNED_COMPONENTS {
                    return Err(OwnedIoError::Io(std::io::Error::new(
                        std::io::ErrorKind::InvalidInput,
                        "the path has too many folders",
                    )));
                }
                holds.push(open_pinned(&current)?);
            }
        }
        #[cfg(not(windows))]
        holds.push(File::open(&resolved)?);
        if holds.is_empty() {
            return Err(OwnedIoError::ReparseRefused);
        }
        Ok(Self {
            path: resolved,
            _holds: holds,
        })
    }

    /// The resolved folder every output is created in.
    pub fn path(&self) -> &Path {
        &self.path
    }
}

#[cfg(windows)]
fn open_pinned(path: &Path) -> OwnedIoResult<File> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES,
        FILE_SHARE_READ,
    };
    let file = std::fs::OpenOptions::new()
        .read(true)
        .access_mode(FILE_READ_ATTRIBUTES.0)
        .share_mode(FILE_SHARE_READ.0)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0 | FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(path)?;
    // The handle must name the folder we meant: a junction opened with
    // OPEN_REPARSE_POINT is refused, and a swapped ancestor no longer
    // resolves to the path we pinned.
    if is_reparse(&file)? {
        return Err(OwnedIoError::ReparseRefused);
    }
    if !file.metadata()?.is_dir() {
        return Err(OwnedIoError::Io(std::io::Error::from(
            std::io::ErrorKind::NotFound,
        )));
    }
    let actual = handle_path(&file)?;
    if !same_place(&actual, path) {
        return Err(OwnedIoError::Io(std::io::Error::from(
            std::io::ErrorKind::NotFound,
        )));
    }
    Ok(file)
}
