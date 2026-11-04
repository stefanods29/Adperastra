//! Windows handles retained from authorization through publication/cleanup.

use std::ffi::OsString;
use std::fs::{self, File};
use std::io;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::AsRawHandle;
use std::path::{Path, PathBuf};
use windows::Win32::Foundation::{GENERIC_WRITE, HANDLE};
use windows::Win32::Storage::FileSystem::{
    FileDispositionInfo, FileRenameInfo, GetFinalPathNameByHandleW, SetFileInformationByHandle,
    DELETE, FILE_DISPOSITION_INFO, FILE_FLAG_BACKUP_SEMANTICS, FILE_NAME_NORMALIZED,
    FILE_READ_ATTRIBUTES, FILE_RENAME_INFO, FILE_SHARE_READ,
};

pub(super) struct Directory {
    pub path: PathBuf,
    _file: File,
}

impl Directory {
    pub fn open(path: &Path) -> io::Result<Self> {
        // Deny writes/deletion of the directory object while our child is
        // staged. Child creation still uses the caller's normal permissions.
        let file = fs::OpenOptions::new()
            .read(true)
            .access_mode(FILE_READ_ATTRIBUTES.0)
            .share_mode(FILE_SHARE_READ.0)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0)
            .open(path)?;
        if !file.metadata()?.is_dir() {
            return Err(io::ErrorKind::NotFound.into());
        }
        Ok(Self {
            path: final_path(&file)?,
            _file: file,
        })
    }
}

pub(super) struct Source {
    pub file: File,
    _roots: Vec<Directory>,
}

impl Source {
    pub fn open(path: &Path, roots: &[PathBuf]) -> Result<Self, String> {
        // Resolve/pin allowed roots first. Opening the actual source next
        // and checking that handle's path closes the check/use gap, including
        // a junction or symlink replaced while the command starts.
        let roots: Vec<Directory> = roots
            .iter()
            .filter_map(|root| Directory::open(root).ok())
            .collect();
        let file = fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ.0)
            .open(path)
            .map_err(|error| super::copy_error(&error))?;
        if !file
            .metadata()
            .map_err(|error| super::copy_error(&error))?
            .is_file()
        {
            return Err("templates.not_found".to_string());
        }
        let resolved = final_path(&file).map_err(|error| super::copy_error(&error))?;
        if !roots
            .iter()
            .any(|root| resolved != root.path && resolved.starts_with(&root.path))
        {
            return Err("templates.not_allowed".to_string());
        }
        // The handle excludes writes/deletes for the entire copy. Read via
        // this exact handle, never by reopening the UI's original path.
        Ok(Self {
            file,
            _roots: roots,
        })
    }
}

/// Query a resolved path from the same handle used for the operation.
fn final_path(file: &File) -> io::Result<PathBuf> {
    let mut path = vec![0u16; 512];
    loop {
        // SAFETY: the file handle stays alive; path is a writable u16 buffer.
        let written = unsafe {
            GetFinalPathNameByHandleW(
                HANDLE(file.as_raw_handle()),
                &mut path,
                FILE_NAME_NORMALIZED,
            )
        } as usize;
        if written == 0 {
            return Err(io::Error::last_os_error());
        }
        if written < path.len() {
            return Ok(PathBuf::from(OsString::from_wide(&path[..written])));
        }
        if written > fs_service::MAX_PATH_INPUT + 1 {
            return Err(io::ErrorKind::InvalidInput.into());
        }
        path.resize(written + 1, 0);
    }
}

pub(super) struct Partial {
    pub file: File,
    published: bool,
}

impl Partial {
    pub fn create(directory: &Directory, name: &str) -> io::Result<Self> {
        for attempt in 0..super::MAX_UNIQUE_ATTEMPTS {
            let leaf = if attempt == 0 {
                format!("~{name}.partial")
            } else {
                format!("~{name}.{attempt}.partial")
            };
            // CREATE_NEW never truncates or follows an existing link. Keep
            // exclusive access and DELETE rights until publish or cleanup.
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .access_mode(GENERIC_WRITE.0 | DELETE.0)
                .share_mode(0)
                .open(directory.path.join(leaf))
            {
                Ok(file) => {
                    return Ok(Self {
                        file,
                        published: false,
                    })
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error),
            }
        }
        Err(io::ErrorKind::AlreadyExists.into())
    }

    pub fn publish(&mut self, target: &Path) -> io::Result<()> {
        let name: Vec<u16> = target.as_os_str().encode_wide().chain([0]).collect();
        let offset = std::mem::offset_of!(FILE_RENAME_INFO, FileName);
        let bytes = offset + name.len() * 2;
        let mut storage = vec![0u64; bytes.div_ceil(8)];
        let info = storage.as_mut_ptr().cast::<FILE_RENAME_INFO>();
        // SAFETY: storage is aligned and holds the header plus a terminated
        // absolute name. Zeroed ReplaceIfExists forbids any replacement;
        // RootDirectory is NULL. The exclusive handle still owns our file.
        let result = unsafe {
            (*info).FileNameLength = ((name.len() - 1) * 2) as u32;
            std::ptr::copy_nonoverlapping(
                name.as_ptr(),
                std::ptr::addr_of_mut!((*info).FileName).cast::<u16>(),
                name.len(),
            );
            SetFileInformationByHandle(
                HANDLE(self.file.as_raw_handle()),
                FileRenameInfo,
                info.cast(),
                bytes as u32,
            )
        };
        result.map_err(windows_error)?;
        self.published = true;
        Ok(())
    }
}

impl Drop for Partial {
    fn drop(&mut self) {
        if self.published {
            return;
        }
        let disposition = FILE_DISPOSITION_INFO { DeleteFile: true };
        // SAFETY: mark our own still-exclusive handle for deletion on close.
        // A failure leaves our partial, never removes some other path.
        let _ = unsafe {
            SetFileInformationByHandle(
                HANDLE(self.file.as_raw_handle()),
                FileDispositionInfo,
                (&disposition as *const FILE_DISPOSITION_INFO).cast(),
                std::mem::size_of_val(&disposition) as u32,
            )
        };
    }
}

fn windows_error(error: windows::core::Error) -> io::Error {
    io::Error::from_raw_os_error((error.code().0 as u32 & 0xFFFF) as i32)
}
