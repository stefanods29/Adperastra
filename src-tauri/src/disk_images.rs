//! Windows disk-image probing and read-only attach (Step 09j T1/T2).
//!
//! Supported families are ISO, VHD and VHDX. An `.img` file is accepted
//! only when its ISO 9660 primary-volume signature is present and is then
//! reported as an ISO; there is no raw-image parser and no device id is
//! invented for one. Every attach uses `VIRTUAL_DISK_ACCESS_READ` and
//! `ATTACH_VIRTUAL_DISK_FLAG_READ_ONLY`.

use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::Arc;

use fs_service::{CancellationToken, SourceStamp};

use crate::disk_image_types::{DiskImageKind, MAX_VOLUME_ROOTS};
use crate::disk_mounts::{AttachOutcome, DiskHost};

/// The real host's source of open-document information: the 09a
/// `DocumentStore::open_documents_under` adapter wired at startup.
///
/// There is deliberately no default or empty fallback: an adapter that
/// cannot enumerate every open app document must not be supplied, because
/// an empty answer would let an eject detach a volume whose files are
/// still open. When that store is missing, the mount state stays
/// unmanaged and mount/eject fail closed.
pub trait OpenDocuments: Send + Sync {
    /// Authorized app sources under one of these volume roots.
    fn under(&self, roots: &[String]) -> Vec<String>;
}

/// Windows-facing host used by the mount registry.
pub struct WindowsDiskHost {
    documents: Arc<dyn OpenDocuments>,
}

impl WindowsDiskHost {
    pub fn new(documents: Arc<dyn OpenDocuments>) -> Self {
        WindowsDiskHost { documents }
    }
}

impl DiskHost for WindowsDiskHost {
    fn capture_stamp(&self, path: &Path) -> Result<SourceStamp, String> {
        fs_service::capture_source_stamp(path).map_err(|_| "disk.unavailable".to_string())
    }

    fn classify(&self, path: &Path) -> Result<DiskImageKind, String> {
        classify_image(path)
    }

    fn attach(
        &self,
        path: &Path,
        kind: DiskImageKind,
        _stamp: &SourceStamp,
        allow_elevation: bool,
        token: &CancellationToken,
        progress: &mut dyn FnMut(u64),
    ) -> AttachOutcome {
        if allow_elevation {
            // Only an explicit one-operation confirmation reaches this
            // branch; the elevated broker revalidates the same source.
            return match crate::disk_broker::mount_elevated(path, kind, _stamp, token, progress) {
                Ok(attached) => AttachOutcome::Attached {
                    handle: attached.handle,
                    physical_path: attached.physical_path,
                    volume_roots: attached.volume_roots,
                    brokered: true,
                },
                Err(code) => AttachOutcome::Failed(code),
            };
        }
        attach_local(path, kind, token, progress)
    }

    fn documents_under(&self, roots: &[String]) -> Vec<String> {
        self.documents.under(roots)
    }
}

/// The kind is decided by the extension, except `.img`, whose bytes must
/// carry the ISO 9660 descriptor at sector 16.
pub fn classify_image(path: &Path) -> Result<DiskImageKind, String> {
    let ext = path
        .extension()
        .map(|ext| ext.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "iso" => Ok(DiskImageKind::Iso),
        "vhd" => Ok(DiskImageKind::Vhd),
        "vhdx" => Ok(DiskImageKind::Vhdx),
        "img" => {
            if has_iso9660_signature(path)? {
                Ok(DiskImageKind::Iso)
            } else {
                Err("disk.unsupported".to_string())
            }
        }
        _ => Err("disk.unsupported".to_string()),
    }
}

/// Read exactly the 2 KiB primary volume descriptor at sector 16. A short
/// file is simply not an ISO; it is never extended or rewritten.
pub fn has_iso9660_signature(path: &Path) -> Result<bool, String> {
    let meta = std::fs::symlink_metadata(path).map_err(|_| "disk.changed".to_string())?;
    if !meta.file_type().is_file() {
        return Ok(false);
    }
    let mut file = std::fs::File::open(path).map_err(|_| "disk.unavailable".to_string())?;
    let offset = file
        .seek(SeekFrom::Start(16 * 2048))
        .map_err(|_| "disk.changed".to_string())?;
    if offset != 16 * 2048 {
        return Ok(false);
    }
    let mut descriptor = [0u8; 2048];
    match file.read_exact(&mut descriptor) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(false),
        Err(_) => return Err("disk.unavailable".to_string()),
    }
    Ok(descriptor[0] == 1 && &descriptor[1..6] == b"CD001")
}

#[cfg(windows)]
struct VhdHandle(windows::Win32::Foundation::HANDLE);

#[cfg(windows)]
// SAFETY: a Windows kernel handle may be used from any thread; this
// wrapper owns exactly one handle and closes it once in Drop.
unsafe impl Send for VhdHandle {}

#[cfg(windows)]
impl Drop for VhdHandle {
    fn drop(&mut self) {
        // SAFETY: the handle came from OpenVirtualDisk and is closed once.
        let _ = unsafe { windows::Win32::Foundation::CloseHandle(self.0) };
    }
}

#[cfg(windows)]
struct LocalMount {
    handle: VhdHandle,
}

#[cfg(windows)]
fn detach_vhd(handle: windows::Win32::Foundation::HANDLE) -> Result<(), String> {
    use windows::Win32::Storage::Vhd::{
        DetachVirtualDisk, DETACH_VIRTUAL_DISK_FLAG_NONE,
    };
    // SAFETY: the handle is live and owned by the caller's wrapper.
    let result = unsafe { DetachVirtualDisk(handle, DETACH_VIRTUAL_DISK_FLAG_NONE, 0) };
    if result.0 == 0 {
        Ok(())
    } else if result == windows::Win32::Foundation::ERROR_ACCESS_DENIED
        || result == windows::Win32::Foundation::ERROR_SHARING_VIOLATION
    {
        Err("disk.in_use".to_string())
    } else {
        Err("disk.unavailable".to_string())
    }
}

#[cfg(windows)]
impl crate::disk_mounts::MountHandle for LocalMount {
    fn detach(&mut self) -> Result<(), String> {
        detach_vhd(self.handle.0)
    }
}

#[cfg(windows)]
enum AttachError {
    NeedsElevation,
    External(String),
    Code(String),
}

#[cfg(windows)]
fn attach_local(
    path: &Path,
    kind: DiskImageKind,
    token: &CancellationToken,
    progress: &mut dyn FnMut(u64),
) -> AttachOutcome {
    let opened = match open_and_attach(path, kind) {
        Ok(opened) => opened,
        Err(AttachError::NeedsElevation) => return AttachOutcome::NeedsElevation,
        Err(AttachError::External(physical_path)) => {
            let roots = crate::disk_volumes::resolve_roots_for_device(
                &physical_path,
                token,
                progress,
            );
            return match roots {
                Ok(roots) if !roots.is_empty() => AttachOutcome::External {
                    physical_path,
                    volume_roots: roots,
                },
                _ => AttachOutcome::Failed("disk.unavailable".to_string()),
            };
        }
        Err(AttachError::Code(code)) => return AttachOutcome::Failed(code),
    };
    let roots = crate::disk_volumes::resolve_roots_for_device(
        &opened.physical_path,
        token,
        progress,
    );
    match roots {
        Ok(roots) if !roots.is_empty() && roots.len() <= MAX_VOLUME_ROOTS => {
            AttachOutcome::Attached {
                handle: Box::new(LocalMount {
                    handle: opened.handle,
                }),
                physical_path: opened.physical_path,
                volume_roots: roots,
                brokered: false,
            }
        }
        Ok(_) => {
            // Dropping LocalMount would close the handle without asking
            // Windows to detach; detach explicitly first.
            let mut mount = LocalMount {
                handle: opened.handle,
            };
            let _ = crate::disk_mounts::MountHandle::detach(&mut mount);
            AttachOutcome::Failed("disk.timeout".to_string())
        }
        Err(code) => {
            let mut mount = LocalMount {
                handle: opened.handle,
            };
            let _ = crate::disk_mounts::MountHandle::detach(&mut mount);
            AttachOutcome::Failed(code)
        }
    }
}

#[cfg(not(windows))]
fn attach_local(
    _path: &Path,
    _kind: DiskImageKind,
    _token: &CancellationToken,
    _progress: &mut dyn FnMut(u64),
) -> AttachOutcome {
    AttachOutcome::Failed("disk.unavailable".to_string())
}

#[cfg(windows)]
struct OpenedDisk {
    handle: VhdHandle,
    physical_path: String,
}

#[cfg(windows)]
fn open_and_attach(path: &Path, kind: DiskImageKind) -> Result<OpenedDisk, AttachError> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{
        ERROR_ACCESS_DENIED, ERROR_ALREADY_ASSIGNED, ERROR_LOCK_VIOLATION, ERROR_SHARING_VIOLATION,
    };
    use windows::Win32::Storage::Vhd::{
        AttachVirtualDisk, OpenVirtualDisk, ATTACH_VIRTUAL_DISK_FLAG_READ_ONLY,
        OPEN_VIRTUAL_DISK_FLAG_NONE, VIRTUAL_DISK_ACCESS_READ, VIRTUAL_STORAGE_TYPE,
        VIRTUAL_STORAGE_TYPE_VENDOR_MICROSOFT,
    };

    let storage = VIRTUAL_STORAGE_TYPE {
        DeviceId: kind.device_id(),
        VendorId: VIRTUAL_STORAGE_TYPE_VENDOR_MICROSOFT,
    };
    let display = path.to_string_lossy();
    let display = display.strip_prefix(r"\\?\").unwrap_or(&display);
    let wide = crate::explorer::wide_null(display);
    let mut handle = windows::Win32::Foundation::HANDLE::default();
    // SAFETY: `wide` is NUL-terminated and outlives the call; the storage
    // type is a plain value; `handle` receives the owned handle.
    let opened = unsafe {
        OpenVirtualDisk(
            &storage,
            PCWSTR(wide.as_ptr()),
            VIRTUAL_DISK_ACCESS_READ,
            OPEN_VIRTUAL_DISK_FLAG_NONE,
            None,
            &mut handle,
        )
    };
    if opened.0 != 0 {
        return Err(map_attach_error(opened.0));
    }
    let owned = VhdHandle(handle);
    // SAFETY: the virtual-disk handle is live; read-only is the only mode
    // this app ever requests, and no security descriptor is needed.
    let attached = unsafe {
        AttachVirtualDisk(
            owned.0,
            None,
            ATTACH_VIRTUAL_DISK_FLAG_READ_ONLY,
            0,
            None,
            None,
        )
    };
    if attached.0 != 0 {
        if attached == ERROR_ACCESS_DENIED {
            return Err(AttachError::NeedsElevation);
        }
        if attached == ERROR_ALREADY_ASSIGNED {
            // Some other program already mounted it. Query the physical
            // path from our read handle, then report it as external.
            if let Ok(physical) = physical_path(owned.0) {
                return Err(AttachError::External(physical));
            }
        }
        if attached == ERROR_SHARING_VIOLATION || attached == ERROR_LOCK_VIOLATION {
            return Err(AttachError::Code("disk.in_use".to_string()));
        }
        return Err(map_attach_error(attached.0));
    }
    let physical = physical_path(owned.0).map_err(AttachError::Code)?;
    Ok(OpenedDisk {
        handle: owned,
        physical_path: physical,
    })
}

#[cfg(windows)]
fn map_attach_error(code: u32) -> AttachError {
    use windows::Win32::Foundation::{
        ERROR_ACCESS_DENIED, ERROR_FILE_NOT_FOUND, ERROR_INVALID_PARAMETER, ERROR_NOT_SUPPORTED,
        ERROR_PATH_NOT_FOUND,
    };
    match code {
        value if value == ERROR_ACCESS_DENIED.0 => AttachError::NeedsElevation,
        value if value == ERROR_FILE_NOT_FOUND.0 || value == ERROR_PATH_NOT_FOUND.0 => {
            AttachError::Code("disk.changed".to_string())
        }
        value if value == ERROR_NOT_SUPPORTED.0 || value == ERROR_INVALID_PARAMETER.0 => {
            AttachError::Code("disk.unsupported".to_string())
        }
        _ => AttachError::Code("disk.unavailable".to_string()),
    }
}

#[cfg(windows)]
fn physical_path(handle: windows::Win32::Foundation::HANDLE) -> Result<String, String> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::ERROR_INSUFFICIENT_BUFFER;
    use windows::Win32::Storage::Vhd::GetVirtualDiskPhysicalPath;

    let mut buffer = vec![0u16; 32_768];
    let mut size_bytes = (buffer.len() * 2) as u32;
    // SAFETY: `buffer` is writable for `size_bytes` bytes and the handle
    // is live and owned by the caller.
    let mut result = unsafe {
        GetVirtualDiskPhysicalPath(handle, &mut size_bytes, PWSTR(buffer.as_mut_ptr()))
    };
    if result == ERROR_INSUFFICIENT_BUFFER
        && size_bytes as usize > buffer.len() * 2
        && (size_bytes as usize) <= 65_536
    {
        buffer = vec![0u16; size_bytes as usize / 2 + 1];
        // SAFETY: the buffer now matches the requested byte count.
        result = unsafe {
            GetVirtualDiskPhysicalPath(handle, &mut size_bytes, PWSTR(buffer.as_mut_ptr()))
        };
    }
    if result.0 != 0 {
        return Err("disk.unavailable".to_string());
    }
    let length = buffer
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(buffer.len());
    let path = String::from_utf16_lossy(&buffer[..length]);
    if path.is_empty() || path.encode_utf16().count() > 32_768 {
        return Err("disk.unavailable".to_string());
    }
    Ok(path)
}

/// A local attachment held by the elevated broker process.
#[cfg(windows)]
pub(crate) struct BrokerMount {
    handle: VhdHandle,
}

#[cfg(windows)]
impl crate::disk_mounts::MountHandle for BrokerMount {
    fn detach(&mut self) -> Result<(), String> {
        detach_vhd(self.handle.0)
    }
}

/// Open and attach one image from the elevated broker. The broker never
/// adopts an external mount and never asks for more privilege.
#[cfg(windows)]
pub(crate) fn broker_open_readonly(
    path: &Path,
    kind: DiskImageKind,
) -> Result<(BrokerMount, String), String> {
    match open_and_attach(path, kind) {
        Ok(opened) => Ok((
            BrokerMount {
                handle: opened.handle,
            },
            opened.physical_path,
        )),
        Err(_) => Err("disk.denied".to_string()),
    }
}

#[cfg(test)]
#[path = "disk_images_step09j_tests.rs"]
mod step09j_tests;
