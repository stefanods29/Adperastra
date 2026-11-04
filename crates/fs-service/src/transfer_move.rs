//! Moving without ever losing the source (Step 09f D3, R-SAFE-4).
//!
//! Inside one volume a move renames the *exact object* the user picked: the
//! handle is opened with delete access, its identity is compared with what
//! enumeration recorded, and the rename is requested on that handle with
//! `ReplaceIfExists = 0`. A name that appeared meanwhile is left alone.
//!
//! Across volumes a move copies first and removes the source only after the
//! copy is flushed and verified against that same handle. The removal keeps
//! the audited `ops::verified_remove` behaviour (re-open the path, check the
//! exact identity, compare the bytes with the published copy, then delete by
//! handle) inside this module, so no shared `ops` visibility has to change.

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::owned_io::{OwnedIoError, PinnedDirectory, PinnedSource, SourceIdentity};
use crate::transfer_copy::CopyError;
use crate::CancellationToken;

/// How a move between these two places has to work.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveMode {
    /// Same volume: one no-replace rename of the exact object.
    Rename,
    /// Different (or unknown) volume: copy, verify, then remove the source.
    CopyThenRemove,
}

/// Why a move did not finish.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveError {
    Cancelled,
    /// The object at the path is no longer the enumerated object.
    SourceChanged,
    /// The copy did not match the source; the source is untouched.
    VerifyFailed,
    /// A name appeared at the destination; nothing was replaced.
    TargetExists,
    /// Another program holds the source.
    InUse,
    /// The destination volume is full.
    NoSpace,
    Io,
}

impl MoveError {
    pub fn code(self) -> &'static str {
        match self {
            MoveError::Cancelled => "ops.cancelled",
            MoveError::SourceChanged => "ops.source_changed",
            MoveError::VerifyFailed => "ops.verify_failed",
            MoveError::TargetExists => "ops.exists",
            MoveError::InUse => "ops.in_use",
            MoveError::NoSpace => "ops.no_space",
            MoveError::Io => "ops.io",
        }
    }

    pub fn is_retryable(self) -> bool {
        matches!(
            self,
            MoveError::InUse | MoveError::Io | MoveError::NoSpace | MoveError::SourceChanged
        )
    }
}

impl From<OwnedIoError> for MoveError {
    fn from(error: OwnedIoError) -> Self {
        match error {
            OwnedIoError::SourceChanged => MoveError::SourceChanged,
            OwnedIoError::TargetExists => MoveError::TargetExists,
            OwnedIoError::Io(error) => match error.raw_os_error() {
                Some(32) | Some(33) => MoveError::InUse,
                Some(112) | Some(39) => MoveError::NoSpace,
                Some(80) | Some(183) => MoveError::TargetExists,
                _ => MoveError::Io,
            },
            _ => MoveError::Io,
        }
    }
}

impl From<CopyError> for MoveError {
    fn from(error: CopyError) -> Self {
        match error {
            CopyError::Cancelled => MoveError::Cancelled,
            CopyError::Skipped => MoveError::TargetExists,
            CopyError::SourceChanged => MoveError::SourceChanged,
            CopyError::VerifyFailed => MoveError::VerifyFailed,
            CopyError::InUse => MoveError::InUse,
            CopyError::NoSpace => MoveError::NoSpace,
            CopyError::TargetExists => MoveError::TargetExists,
            CopyError::Io | CopyError::Counters => MoveError::Io,
        }
    }
}

/// The volume serial of a folder or file, or `None` when it cannot be read.
/// An unknown volume always takes the copy-then-remove path.
#[cfg(windows)]
pub fn volume_of(path: &Path) -> Option<u32> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES,
        FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
    };
    let file = std::fs::OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES.0)
        .share_mode((FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE).0)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0 | FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(path)
        .ok()?;
    crate::owned_io::handle_identity(&file)
        .ok()
        .map(|identity| identity.volume)
}

#[cfg(not(windows))]
pub fn volume_of(_path: &Path) -> Option<u32> {
    None
}

/// The mode for this pair. Anything uncertain is a copy, never a rename.
pub fn mode_for(source: &Path, destination: &Path) -> MoveMode {
    match (volume_of(source), volume_of(destination)) {
        (Some(left), Some(right)) if left == right => MoveMode::Rename,
        _ => MoveMode::CopyThenRemove,
    }
}

/// Rename the exact source object into the pinned destination folder.
///
/// `expected` is the identity enumeration recorded; a different object at the
/// same path is `SourceChanged`. The target must not exist; a name that
/// arrives in the meantime is `TargetExists` and stays untouched.
pub fn rename_exact(
    source: &Path,
    expected_volume: u32,
    expected_index: u64,
    directory: &PinnedDirectory,
    name: &str,
) -> Result<PathBuf, MoveError> {
    if name.is_empty() || name.contains(['/', '\\']) {
        return Err(MoveError::Io);
    }
    let target = directory.path().join(name);
    if target.symlink_metadata().is_ok() {
        return Err(MoveError::TargetExists);
    }
    let file = open_for_rename(source)?;
    let identity = crate::owned_io::handle_identity(&file).map_err(|_| MoveError::Io)?;
    if identity.volume != expected_volume || identity.index != expected_index {
        return Err(MoveError::SourceChanged);
    }
    rename_by_handle(&file, &target)?;
    Ok(target)
}

#[cfg(windows)]
fn open_for_rename(path: &Path) -> Result<File, MoveError> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows::Win32::Foundation::GENERIC_READ;
    use windows::Win32::Storage::FileSystem::{
        DELETE, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
        FILE_SHARE_WRITE,
    };
    std::fs::OpenOptions::new()
        .read(true)
        .access_mode(GENERIC_READ.0 | DELETE.0)
        // Delete sharing stays denied so nobody can rename or remove the
        // object between the identity check and the rename.
        .share_mode((FILE_SHARE_READ | FILE_SHARE_WRITE).0)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0 | FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(path)
        .map_err(|error| match error.raw_os_error() {
            Some(32) | Some(33) => MoveError::InUse,
            _ => MoveError::Io,
        })
}

#[cfg(not(windows))]
fn open_for_rename(path: &Path) -> Result<File, MoveError> {
    File::open(path).map_err(|_| MoveError::Io)
}

/// A no-replace rename of the handle we hold. `ReplaceIfExists` stays zero,
/// so an arriving target survives.
#[cfg(windows)]
fn rename_by_handle(file: &File, target: &Path) -> Result<(), MoveError> {
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        FileRenameInfo, SetFileInformationByHandle, FILE_RENAME_INFO,
    };
    let name: Vec<u16> = target.as_os_str().encode_wide().chain([0]).collect();
    let offset = std::mem::offset_of!(FILE_RENAME_INFO, FileName);
    let bytes = offset + name.len() * 2;
    let mut storage = vec![0u64; bytes.div_ceil(8)];
    let info = storage.as_mut_ptr().cast::<FILE_RENAME_INFO>();
    // SAFETY: the aligned buffer holds the header and one NUL-terminated
    // absolute name; `RootDirectory` stays null and `ReplaceIfExists` zero.
    let result = unsafe {
        (*info).FileNameLength = ((name.len() - 1) * 2) as u32;
        std::ptr::copy_nonoverlapping(
            name.as_ptr(),
            std::ptr::addr_of_mut!((*info).FileName).cast::<u16>(),
            name.len(),
        );
        SetFileInformationByHandle(
            HANDLE(file.as_raw_handle()),
            FileRenameInfo,
            info.cast(),
            bytes as u32,
        )
    };
    match result {
        Ok(()) => Ok(()),
        Err(error) => {
            let code = error.code().0 as u32 & 0xffff;
            Err(match code {
                80 | 183 => MoveError::TargetExists,
                5 => MoveError::Io,
                32 | 33 => MoveError::InUse,
                _ => MoveError::Io,
            })
        }
    }
}

#[cfg(not(windows))]
fn rename_by_handle(_file: &File, _target: &Path) -> Result<(), MoveError> {
    Err(MoveError::Io)
}

/// The source identity a cross-volume move must still match after copying.
pub struct MoveVerification {
    identity: SourceIdentity,
}

/// Remember the exact source identity before the copy starts.
pub fn snapshot_source(source: &PinnedSource) -> Result<MoveVerification, MoveError> {
    Ok(MoveVerification {
        identity: source.identity(),
    })
}

/// Remove the source only when it is still the object that was copied and
/// its bytes still equal the published destination.
pub fn remove_source_after_copy(
    verification: &MoveVerification,
    source: &Path,
    destination: &Path,
    token: &CancellationToken,
) -> Result<(), MoveError> {
    remove_verified(verification.identity, source, destination, token)
}

/// Re-open the source with delete access, verify the exact object, compare
/// the bytes with the published copy and delete through that same handle.
/// A source that changed, or bytes that differ, leaves the source alone.
#[cfg(windows)]
fn remove_verified(
    expected: SourceIdentity,
    source_path: &Path,
    destination_path: &Path,
    token: &CancellationToken,
) -> Result<(), MoveError> {
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    use std::sync::atomic::Ordering;
    use std::time::UNIX_EPOCH;
    use windows::Win32::Foundation::{GENERIC_READ, HANDLE};
    use windows::Win32::Storage::FileSystem::{
        FileDispositionInfoEx, SetFileInformationByHandle, DELETE, FILE_ATTRIBUTE_REPARSE_POINT,
        FILE_DISPOSITION_FLAG_DELETE, FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE,
        FILE_DISPOSITION_INFO_EX, FILE_DISPOSITION_INFO_EX_FLAGS, FILE_FLAG_OPEN_REPARSE_POINT,
        FILE_SHARE_READ,
    };

    // Delete sharing stays denied on the source and the destination, so
    // nobody can swap either object between the comparison and the delete.
    let mut source = std::fs::OpenOptions::new()
        .read(true)
        .access_mode(GENERIC_READ.0 | DELETE.0)
        .share_mode(FILE_SHARE_READ.0)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(source_path)
        .map_err(|error| match error.raw_os_error() {
            Some(32) | Some(33) => MoveError::InUse,
            _ => MoveError::Io,
        })?;
    let mut destination = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ.0)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(destination_path)
        .map_err(|_| MoveError::VerifyFailed)?;

    let attributes = crate::owned_io::handle_attributes(&source).map_err(|_| MoveError::Io)?;
    if attributes & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 {
        return Err(MoveError::SourceChanged);
    }
    let identity = crate::owned_io::handle_identity(&source).map_err(|_| MoveError::Io)?;
    let metadata = source.metadata().map_err(|_| MoveError::Io)?;
    let modified_unix = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|age| age.as_secs())
        .unwrap_or(0);
    let modified_ticks = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|age| u64::try_from(age.as_nanos() / 100).unwrap_or(u64::MAX))
        .unwrap_or(0);
    let current = SourceIdentity {
        volume: identity.volume,
        index: identity.index,
        size: metadata.len(),
        modified_unix,
        modified_ticks,
        attributes,
    };
    if current != expected {
        return Err(MoveError::SourceChanged);
    }
    let destination_len = destination
        .metadata()
        .map_err(|_| MoveError::VerifyFailed)?
        .len();
    if metadata.len() != destination_len {
        return Err(MoveError::VerifyFailed);
    }

    let mut left = vec![0u8; crate::transfer_verify::VERIFY_CHUNK];
    let mut right = vec![0u8; crate::transfer_verify::VERIFY_CHUNK];
    loop {
        if token.load(Ordering::Relaxed) {
            return Err(MoveError::Cancelled);
        }
        let read = source.read(&mut left).map_err(|_| MoveError::Io)?;
        if read == 0 {
            break;
        }
        destination
            .read_exact(&mut right[..read])
            .map_err(|_| MoveError::VerifyFailed)?;
        if left[..read] != right[..read] {
            return Err(MoveError::VerifyFailed);
        }
    }

    let disposition = FILE_DISPOSITION_INFO_EX {
        Flags: FILE_DISPOSITION_INFO_EX_FLAGS(
            FILE_DISPOSITION_FLAG_DELETE.0 | FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE.0,
        ),
    };
    unsafe {
        SetFileInformationByHandle(
            HANDLE(source.as_raw_handle()),
            FileDispositionInfoEx,
            (&disposition as *const FILE_DISPOSITION_INFO_EX).cast(),
            std::mem::size_of::<FILE_DISPOSITION_INFO_EX>() as u32,
        )
    }
    .map_err(|error| match error.code().0 as u32 & 0xffff {
        32 | 33 => MoveError::InUse,
        _ => MoveError::Io,
    })
}

#[cfg(not(windows))]
fn remove_verified(
    _expected: SourceIdentity,
    _source_path: &Path,
    _destination_path: &Path,
    _token: &CancellationToken,
) -> Result<(), MoveError> {
    // No portable delete-by-handle exists. Keeping the source is the safe
    // result; the report tells the user the object stayed.
    Err(MoveError::VerifyFailed)
}

/// Remove a folder the move emptied. `false` means something is still inside
/// (another program's file, or a folder we never owned): it stays.
pub fn remove_emptied_dir(path: &Path) -> Result<bool, MoveError> {
    match std::fs::remove_dir(path) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(true),
        Err(_) => Ok(false),
    }
}
