//! A destination folder pinned for the whole operation (Step 06e D5).
//!
//! Every component of the resolved path is held open with delete sharing
//! denied, so the chain cannot be renamed, deleted or swapped for a junction
//! while an output is being staged below it.

use std::fs::File;
use std::path::{Component, Path, PathBuf};

use super::{handle_path, same_place, OwnedIoError, OwnedIoResult, MAX_PINNED_COMPONENTS};

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
                    // The bare prefix (`\\?\C:`) names the volume device, not
                    // a folder: pinning starts at its root.
                    Component::Prefix(prefix) => {
                        current.push(prefix.as_os_str());
                        continue;
                    }
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
        FILE_SHARE_READ, FILE_SHARE_WRITE,
    };
    let file = std::fs::OpenOptions::new()
        .read(true)
        .access_mode(FILE_READ_ATTRIBUTES.0)
        // Only delete sharing is denied: that is what stops a rename or a
        // removal, and another program holding the folder open for writing
        // must not stop a save.
        .share_mode((FILE_SHARE_READ | FILE_SHARE_WRITE).0)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0 | FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(path)?;
    // The handle must name the folder we meant: a junction opened with
    // OPEN_REPARSE_POINT is refused, and a swapped ancestor no longer
    // resolves to the path we pinned.
    if is_redirecting(&file)? {
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

/// True for a folder that sends a path somewhere else (a junction, a link, a
/// mounted volume). A cloud-synced folder (OneDrive) also carries a reparse
/// tag, but it is an ordinary folder that must keep working.
#[cfg(windows)]
fn is_redirecting(file: &File) -> OwnedIoResult<bool> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        FileAttributeTagInfo, GetFileInformationByHandleEx, FILE_ATTRIBUTE_REPARSE_POINT,
        FILE_ATTRIBUTE_TAG_INFO,
    };
    let mut info = FILE_ATTRIBUTE_TAG_INFO::default();
    // SAFETY: the handle is open and `info` is writable, with the right size.
    unsafe {
        GetFileInformationByHandleEx(
            HANDLE(file.as_raw_handle()),
            FileAttributeTagInfo,
            (&mut info as *mut FILE_ATTRIBUTE_TAG_INFO).cast(),
            std::mem::size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32,
        )
    }
    .map_err(|error| std::io::Error::from_raw_os_error((error.code().0 as u32 & 0xffff) as i32))?;
    Ok(info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 && tag_redirects(info.ReparseTag))
}

/// Windows marks the reparse tags that stand in for another name with this
/// bit ("name surrogate").
#[cfg(windows)]
fn tag_redirects(tag: u32) -> bool {
    tag & 0x2000_0000 != 0
}

#[cfg(all(test, windows))]
mod tests {
    use super::tag_redirects;

    #[test]
    fn links_redirect_and_cloud_folders_do_not() {
        assert!(tag_redirects(0xA000_0003), "junction or mounted volume");
        assert!(tag_redirects(0xA000_000C), "symbolic link");
        assert!(!tag_redirects(0x9000_001A), "OneDrive placeholder");
        assert!(!tag_redirects(0x9000_A01A), "OneDrive folder");
    }
}
