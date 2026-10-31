//! Safety limits (Step 06d D8). Nothing is written before the planned
//! work passes these; the numbers come from plan/steps/step-06d.md.

use crate::error::ArchiveError;
use std::path::Path;

/// Bytes read or written per step while extracting.
pub const CHUNK_BYTES: usize = 65_536;

/// How many skipped entries a report lists; the rest only raise
/// `skipped_more`.
pub const MAX_SKIPPED_REPORT: usize = 1_000;

/// The limits one listing or extraction obeys. Tests build smaller ones.
#[derive(Debug, Clone)]
pub struct Limits {
    /// More entries than this is refused before anything is listed.
    pub max_entries: usize,
    /// The largest total a single extraction may produce.
    pub max_total_bytes: u64,
    /// Above `ratio_floor_bytes`, an archive may not expand more than this
    /// many times its own size.
    pub max_ratio: u64,
    /// The size above which the expansion ratio applies.
    pub ratio_floor_bytes: u64,
    /// Free space kept unused on the destination drive.
    pub space_margin_bytes: u64,
    /// The longest inner path, in characters.
    pub max_inner_path_chars: usize,
    /// The deepest inner path, in folders.
    pub max_depth: usize,
    /// Memory an xz stream may use, in KiB (512 MiB).
    pub xz_memory_kb: u32,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_entries: 200_000,
            max_total_bytes: 1_099_511_627_776,
            max_ratio: 500,
            ratio_floor_bytes: 1_073_741_824,
            space_margin_bytes: 67_108_864,
            max_inner_path_chars: 1_024,
            max_depth: 64,
            xz_memory_kb: 524_288,
        }
    }
}

/// A "zip bomb" makes files that are far larger than the archive. Refused
/// before anything is written (R-SEC-8).
pub fn check_bomb(total: u64, archive_size: u64, limits: &Limits) -> Result<(), ArchiveError> {
    if total > limits.max_total_bytes {
        return Err(ArchiveError::Bomb);
    }
    if total > limits.ratio_floor_bytes
        && total > limits.max_ratio.saturating_mul(archive_size.max(1))
    {
        return Err(ArchiveError::Bomb);
    }
    Ok(())
}

/// Refused when the output would not fit, keeping a margin free. An
/// unknown free space (`None`: a drive that cannot say) passes.
pub fn check_space(total: u64, free: Option<u64>, limits: &Limits) -> Result<(), ArchiveError> {
    let Some(free) = free else {
        return Ok(());
    };
    if total.saturating_add(limits.space_margin_bytes) > free {
        return Err(ArchiveError::NoSpace);
    }
    Ok(())
}

/// Free bytes available to the current user on the drive holding `dir`, or
/// `None` when Windows cannot say (removed drive, no permission).
pub fn free_bytes(dir: &Path) -> Option<u64> {
    #[cfg(windows)]
    {
        use windows::core::PCWSTR;
        use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        let text: Vec<u16> = dir
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let mut available = 0u64;
        // SAFETY: `text` is NUL-terminated and outlives the call; the two
        // other outputs are allowed to be ignored, and `available` is a
        // local of the type the call writes.
        unsafe { GetDiskFreeSpaceExW(PCWSTR(text.as_ptr()), Some(&mut available), None, None) }
            .ok()?;
        Some(available)
    }
    #[cfg(not(windows))]
    {
        let _ = dir;
        None
    }
}

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;
