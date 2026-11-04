//! Volume discovery for a freshly attached image (Step 09j T2).
//!
//! Windows decides which drive letters the new volumes get. The app asks
//! each logical volume which physical disk it belongs to and keeps the
//! roots that really point at the attached disk; it never invents the
//! "next free letter". The wait is bounded to ten seconds and can be
//! cancelled, so a slow driver never freezes the UI.

use std::time::{Duration, Instant};

use fs_service::CancellationToken;

use crate::disk_image_types::{MAX_VOLUME_ROOTS, VOLUME_POLL_MS, VOLUME_WAIT_SECONDS};

/// Parse `\\.\PhysicalDrive7` (or `\\?\PhysicalDrive7`).
pub fn physical_drive_number(physical_path: &str) -> Option<u32> {
    let trimmed = physical_path
        .strip_prefix(r"\\?\")
        .or_else(|| physical_path.strip_prefix(r"\\.\"))
        .unwrap_or(physical_path);
    let lower = trimmed.to_ascii_lowercase();
    let digits = lower.strip_prefix("physicaldrive")?;
    if digits.is_empty() || digits.len() > 10 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse::<u32>().ok()
}

/// Parse `\\.\CdRom3` (or `\\?\CdRom3`), the device path an attached ISO
/// may report. The kernel device name is what Windows really published;
/// no drive letter is guessed from it.
pub fn optical_device_number(physical_path: &str) -> Option<u32> {
    let trimmed = physical_path
        .strip_prefix(r"\\?\")
        .or_else(|| physical_path.strip_prefix(r"\\.\"))
        .unwrap_or(physical_path);
    let lower = trimmed.to_ascii_lowercase();
    let digits = lower.strip_prefix("cdrom")?;
    if digits.is_empty() || digits.len() > 10 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse::<u32>().ok()
}

/// Wait until `probe` reports at least one root, the deadline passes, or
/// the caller cancels. `sleep` and `progress` are injectable for tests.
pub fn wait_for_volumes<F, S, P>(
    mut probe: F,
    token: &CancellationToken,
    deadline: Instant,
    tick: Duration,
    mut sleep: S,
    mut progress: P,
) -> Result<Vec<String>, String>
where
    F: FnMut() -> Vec<String>,
    S: FnMut(Duration),
    P: FnMut(u64),
{
    let started = Instant::now();
    loop {
        if token.load(std::sync::atomic::Ordering::Relaxed) {
            return Err("disk.cancelled".to_string());
        }
        let roots = probe();
        if !roots.is_empty() {
            let mut roots = roots;
            roots.sort();
            roots.dedup();
            roots.truncate(MAX_VOLUME_ROOTS);
            return Ok(roots);
        }
        if Instant::now() >= deadline {
            return Err("disk.timeout".to_string());
        }
        progress(started.elapsed().as_secs().min(VOLUME_WAIT_SECONDS));
        sleep(tick);
    }
}

/// The production wait: ten seconds, one scan every 200 ms.
#[cfg(windows)]
pub fn resolve_volume_roots(
    disk_number: u32,
    token: &CancellationToken,
    progress: &mut dyn FnMut(u64),
) -> Result<Vec<String>, String> {
    let deadline = Instant::now() + Duration::from_secs(VOLUME_WAIT_SECONDS);
    wait_for_volumes(
        || probe_volumes(disk_number),
        token,
        deadline,
        Duration::from_millis(VOLUME_POLL_MS),
        std::thread::sleep,
        progress,
    )
}

#[cfg(windows)]
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct DiskExtent {
    disk_number: u32,
    _padding: u32,
    starting_offset: i64,
    extent_length: i64,
}

/// `VOLUME_DISK_EXTENTS` with room for sixteen extents. The layout is
/// the documented winioctl.h structure; `windows` 0.61.3 exposes the same
/// `DISK_EXTENT` fields but only behind the Ioctl feature, and this file
/// needs just this one query.
#[cfg(windows)]
#[repr(C)]
struct VolumeDiskExtents {
    number_of_disk_extents: u32,
    _padding: u32,
    extents: [DiskExtent; MAX_VOLUME_ROOTS],
}

#[cfg(windows)]
impl Default for VolumeDiskExtents {
    fn default() -> Self {
        // SAFETY: every field is a plain integer array.
        unsafe { std::mem::zeroed() }
    }
}

#[cfg(windows)]
fn probe_volumes(disk_number: u32) -> Vec<String> {
    use windows::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives};

    // SAFETY: GetLogicalDrives reads the process's logical-drive table.
    let mask = unsafe { GetLogicalDrives() };
    if mask == 0 {
        return Vec::new();
    }
    let mut roots = Vec::new();
    for letter in 0..26u8 {
        if mask & (1u32 << letter) == 0 {
            continue;
        }
        let root = format!("{}:\\", (b'A' + letter) as char);
        let wide = crate::explorer::wide_null(&root);
        // SAFETY: `wide` is a NUL-terminated drive root.
        let kind = unsafe { GetDriveTypeW(windows::core::PCWSTR(wide.as_ptr())) };
        if kind <= 1 {
            // DRIVE_UNKNOWN or DRIVE_NO_ROOT_DIR: not a ready volume.
            continue;
        }
        if volume_disk_number(letter) == Some(disk_number) {
            roots.push(root);
            if roots.len() >= MAX_VOLUME_ROOTS {
                break;
            }
        }
    }
    roots
}

#[cfg(windows)]
fn volume_disk_number(letter: u8) -> Option<u32> {
    use std::ffi::c_void;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    // CreateFileW takes the desired access as a plain u32 in windows 0.61.
    const NO_ACCESS: u32 = 0;
    use windows::Win32::System::IO::DeviceIoControl;

    const IOCTL_VOLUME_GET_VOLUME_DISK_EXTENTS: u32 = 0x0056_0000;
    let device = format!(r"\\.\{}:", (b'A' + letter) as char);
    let wide = crate::explorer::wide_null(&device);
    // SAFETY: `wide` is NUL-terminated; the handle is closed below.
    let handle = unsafe {
        CreateFileW(
            windows::core::PCWSTR(wide.as_ptr()),
            NO_ACCESS,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            None,
        )
    }
    .ok()?;
    let mut extents = VolumeDiskExtents::default();
    let mut returned = 0u32;
    // SAFETY: the output buffer is exactly one VOLUME_DISK_EXTENTS, is
    // writable for its whole size, and `returned` receives the byte count.
    let result = unsafe {
        DeviceIoControl(
            handle,
            IOCTL_VOLUME_GET_VOLUME_DISK_EXTENTS,
            None,
            0,
            Some(&mut extents as *mut VolumeDiskExtents as *mut c_void),
            std::mem::size_of::<VolumeDiskExtents>() as u32,
            Some(&mut returned),
            None,
        )
    };
    // SAFETY: the handle came from CreateFileW and is closed once.
    let _ = unsafe { CloseHandle(handle) };
    result.ok()?;
    if returned < 8 || extents.number_of_disk_extents == 0 {
        return None;
    }
    // The first extent identifies the disk this volume starts on; a
    // spanned volume cannot belong to two image disks in this step.
    Some(extents.extents[0].disk_number)
}

/// Resolve the roots of an attached image from the physical path Windows
/// reports. VHD/VHDX use `\\.\PhysicalDriveN`; an ISO may expose the
/// optical device `\\.\CdRomN`, whose DOS-device target names the real
/// drive letter. Anything else stays unavailable instead of guessing.
#[cfg(windows)]
pub fn resolve_roots_for_device(
    physical_path: &str,
    token: &CancellationToken,
    progress: &mut dyn FnMut(u64),
) -> Result<Vec<String>, String> {
    if let Some(disk_number) = physical_drive_number(physical_path) {
        return resolve_volume_roots(disk_number, token, progress);
    }
    let Some(device_number) = optical_device_number(physical_path) else {
        return Err("disk.unavailable".to_string());
    };
    let deadline = Instant::now() + Duration::from_secs(VOLUME_WAIT_SECONDS);
    wait_for_volumes(
        || probe_optical_volumes(device_number),
        token,
        deadline,
        Duration::from_millis(VOLUME_POLL_MS),
        std::thread::sleep,
        progress,
    )
}

#[cfg(not(windows))]
pub fn resolve_roots_for_device(
    _physical_path: &str,
    _token: &CancellationToken,
    _progress: &mut dyn FnMut(u64),
) -> Result<Vec<String>, String> {
    Err("disk.unavailable".to_string())
}

#[cfg(windows)]
fn probe_optical_volumes(device_number: u32) -> Vec<String> {
    use windows::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives};

    let wanted = format!("CdRom{device_number}");
    // SAFETY: GetLogicalDrives reads the process's logical-drive table.
    let mask = unsafe { GetLogicalDrives() };
    if mask == 0 {
        return Vec::new();
    }
    let mut roots = Vec::new();
    for letter in 0..26u8 {
        if mask & (1u32 << letter) == 0 {
            continue;
        }
        let root = format!("{}:\\", (b'A' + letter) as char);
        let wide = crate::explorer::wide_null(&root);
        // SAFETY: `wide` is a NUL-terminated drive root.
        let kind = unsafe { GetDriveTypeW(windows::core::PCWSTR(wide.as_ptr())) };
        if kind <= 1 {
            continue;
        }
        let matches = dos_device_leaf(letter)
            .is_some_and(|leaf| leaf.eq_ignore_ascii_case(&wanted));
        if matches {
            roots.push(root);
            if roots.len() >= MAX_VOLUME_ROOTS {
                break;
            }
        }
    }
    roots
}

#[cfg(windows)]
fn dos_device_leaf(letter: u8) -> Option<String> {
    use windows::Win32::Storage::FileSystem::QueryDosDeviceW;

    let name = format!("{}:", (b'A' + letter) as char);
    let wide = crate::explorer::wide_null(&name);
    let mut buffer = vec![0u16; 512];
    // SAFETY: the device name is NUL-terminated and the buffer is
    // writable for its whole length.
    let length = unsafe {
        QueryDosDeviceW(windows::core::PCWSTR(wide.as_ptr()), Some(&mut buffer))
    };
    if length == 0 || length as usize > buffer.len() {
        return None;
    }
    let end = buffer[..length as usize]
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(length as usize);
    let target = String::from_utf16_lossy(&buffer[..end]);
    target.rsplit('\\').next().map(|leaf| leaf.to_string())
}

#[cfg(not(windows))]
pub fn resolve_volume_roots(
    _disk_number: u32,
    _token: &CancellationToken,
    _progress: &mut dyn FnMut(u64),
) -> Result<Vec<String>, String> {
    Err("disk.unavailable".to_string())
}

#[cfg(test)]
#[path = "disk_volumes_step09j_tests.rs"]
mod step09j_tests;
