//! A source file guarded while it is read (Step 06e D8).
//!
//! The guard opens the actual regular file with read sharing only, so no
//! other program can write, rename or delete it while the archive is built.
//! It never asks for delete or write access over a user's file.

use std::fs::File;
use std::io;
use std::path::Path;
use std::time::UNIX_EPOCH;

use super::{handle_identity, is_reparse, OwnedIoError, OwnedIoResult};

/// What enumeration recorded about a source: enough to notice any change
/// before and after it is read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SourceIdentity {
    pub volume: u32,
    pub index: u64,
    pub size: u64,
    pub modified_unix: u64,
    /// 100 ns ticks since the Unix epoch; detects rewrites inside one second.
    pub modified_ticks: u64,
    pub attributes: u32,
}

impl SourceIdentity {
    /// Read the identity of a regular file without hydrating an online-only
    /// one and without holding it afterwards.
    pub fn capture(path: &Path) -> OwnedIoResult<Self> {
        let file = open_capture(path)?;
        if is_reparse(&file)? || !file.metadata()?.is_file() {
            return Err(OwnedIoError::ReparseRefused);
        }
        Self::of(&file)
    }

    fn of(file: &File) -> OwnedIoResult<Self> {
        let metadata = file.metadata()?;
        if !metadata.is_file() {
            return Err(OwnedIoError::Io(io::Error::from(
                io::ErrorKind::InvalidInput,
            )));
        }
        let identity = handle_identity(file)?;
        Ok(Self {
            volume: identity.volume,
            index: identity.index,
            size: metadata.len(),
            modified_unix: metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|age| age.as_secs())
                .unwrap_or(0),
            modified_ticks: metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|age| u64::try_from(age.as_nanos() / 100).unwrap_or(u64::MAX))
                .unwrap_or(0),
            attributes: super::handle_attributes(file)?,
        })
    }
}

/// A source file held for reading, with the identity it must keep.
pub struct PinnedSource {
    file: File,
    identity: SourceIdentity,
}

impl PinnedSource {
    /// Retain an exclusively owned app-created file without reopening its path.
    /// The owner must cease writes before constructing the immutable backing.
    pub fn from_owned_file(file: File) -> OwnedIoResult<Self> {
        if is_reparse(&file)? {
            return Err(OwnedIoError::ReparseRefused);
        }
        let identity = SourceIdentity::of(&file)?;
        Ok(Self { file, identity })
    }

    /// Open the exact file that was enumerated. A different file at the
    /// same path is refused as `source_changed`.
    pub fn open(path: &Path, expected: &SourceIdentity) -> OwnedIoResult<Self> {
        Self::open_with_policy(path, expected, false)
    }

    /// Background readers never recall content and inspect the same opened
    /// handle before reading. Foreground readers retain their existing policy.
    pub fn open_background(path: &Path, expected: &SourceIdentity) -> OwnedIoResult<Self> {
        Self::open_with_policy(path, expected, true)
    }

    fn open_with_policy(
        path: &Path,
        expected: &SourceIdentity,
        background: bool,
    ) -> OwnedIoResult<Self> {
        let file = open_guarded(path, background)?;
        if is_reparse(&file)? {
            return Err(OwnedIoError::ReparseRefused);
        }
        if background {
            reject_online_only(super::handle_attributes(&file)?)?;
        }
        let identity = SourceIdentity::of(&file)?;
        if identity != *expected {
            return Err(OwnedIoError::SourceChanged);
        }
        Ok(Self { file, identity })
    }

    pub fn file_mut(&mut self) -> &mut File {
        &mut self.file
    }

    pub fn file(&self) -> &File {
        &self.file
    }

    /// Check again after the last byte: the file must not have changed.
    pub fn verify_after_read(&self) -> OwnedIoResult<()> {
        if SourceIdentity::of(&self.file)? != self.identity {
            return Err(OwnedIoError::SourceChanged);
        }
        Ok(())
    }

    pub fn identity(&self) -> SourceIdentity {
        self.identity
    }
}

/// Enumeration: read attributes and identity, share everything, and never
/// recall an online-only placeholder.
#[cfg(windows)]
fn open_capture(path: &Path) -> io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows::Win32::Storage::FileSystem::{
        FILE_FLAG_OPEN_NO_RECALL, FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES,
        FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
    };
    std::fs::OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES.0)
        .share_mode((FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE).0)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0 | FILE_FLAG_OPEN_NO_RECALL.0)
        .open(path)
}

#[cfg(not(windows))]
fn open_capture(path: &Path) -> io::Result<File> {
    File::open(path)
}

/// Reading: read sharing only, so writes, renames and deletion are refused
/// for the whole read. No delete or write authority is ever requested.
#[cfg(windows)]
fn open_guarded(path: &Path, background: bool) -> io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows::Win32::Storage::FileSystem::{
        FILE_FLAG_OPEN_NO_RECALL, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
    };
    let flags = FILE_FLAG_OPEN_REPARSE_POINT.0
        | if background {
            FILE_FLAG_OPEN_NO_RECALL.0
        } else {
            0
        };
    std::fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ.0)
        .custom_flags(flags)
        .open(path)
}

#[cfg(not(windows))]
fn open_guarded(path: &Path, _background: bool) -> io::Result<File> {
    File::open(path)
}

fn reject_online_only(attributes: u32) -> OwnedIoResult<()> {
    if crate::source_stamp::attributes_are_online_only(attributes) {
        return Err(OwnedIoError::SourceChanged);
    }
    Ok(())
}

#[cfg(test)]
mod guard_tests {
    use super::reject_online_only;
    #[test]
    fn placeholder_attributes_are_refused_before_content_access() {
        for flag in [0x1000, 0x40000, 0x400000] {
            assert!(reject_online_only(flag).is_err());
        }
        assert!(reject_online_only(0x20).is_ok());
    }
}
