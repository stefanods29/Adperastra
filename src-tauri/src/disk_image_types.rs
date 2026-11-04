//! Disk-image contracts (Step 09j, `disk-mount-1`).
//!
//! One canonical definition for the disk-image commands, the mount
//! lifecycle, the elevated broker and the renderer mirror in
//! `src/services/diskImages.ts`. The source identity is the canonical
//! 07a `SourceStamp` (`fs_service::SourceStamp`); this module never
//! defines a second stamp.
//!
//! Mounting is read-only by construction: a request that does not say
//! `readonly: true` is refused before any Windows call, and every mount
//! record the app owns has `readonly: true`.

use fs_service::SourceStamp;
use serde::{Deserialize, Serialize};

/// Sources one image may expose (one drive root per volume).
pub const MAX_VOLUME_ROOTS: usize = 16;
/// Mounts the app itself may have open at the same time.
pub const MAX_APP_MOUNTS: usize = 10;
/// Longest accepted image path, in UTF-16 units.
pub const MAX_DISK_PATH_UNITS: usize = 32_768;
/// How long Windows may take to publish the mounted volumes.
pub const VOLUME_WAIT_SECONDS: u64 = 10;
/// Interval between volume scans while waiting, in milliseconds.
pub const VOLUME_POLL_MS: u64 = 200;
/// Largest payload the elevated broker may send or receive.
pub const MAX_BROKER_FRAME: usize = 64 * 1024;

/// The supported image families. `.img` is only accepted after its
/// ISO 9660 signature is verified, and then reports `iso`: the extension
/// is never trusted as a conversion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiskImageKind {
    Iso,
    Vhd,
    Vhdx,
}

impl DiskImageKind {
    /// The Windows virtual-storage device id of this family.
    pub fn device_id(self) -> u32 {
        match self {
            DiskImageKind::Iso => windows_device_id::ISO,
            DiskImageKind::Vhd => windows_device_id::VHD,
            DiskImageKind::Vhdx => windows_device_id::VHDX,
        }
    }

}

/// Device ids documented for `VIRTUAL_STORAGE_TYPE` (winioctl.h). They
/// match `windows` 0.61.3 `VIRTUAL_STORAGE_TYPE_DEVICE_*`. There is no
/// invented id for an arbitrary raw image.
pub mod windows_device_id {
    pub const ISO: u32 = 1;
    pub const VHD: u32 = 2;
    pub const VHDX: u32 = 3;
}

/// What the UI asks to mount. `readonly` defaults to true so a missing
/// field can never produce a writable request; `allow_elevation` is only
/// true after the user confirmed the one-operation elevation dialog.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MountRequest {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected: Option<SourceStamp>,
    #[serde(default = "default_true")]
    pub readonly: bool,
    #[serde(default)]
    pub allow_elevation: bool,
}

fn default_true() -> bool {
    true
}

impl MountRequest {
    /// Pure validation, before any Windows API or filesystem probe.
    /// Errors are stable `disk.*` codes. Only the four supported names
    /// pass; `.img` is admitted here by name and its bytes are verified
    /// as ISO 9660 by the classifier before any attach.
    pub fn validate(&self) -> Result<(), String> {
        if !valid_image_path(&self.path) || !supported_image_extension(&self.path) {
            return Err("disk.unsupported".to_string());
        }
        if !self.readonly {
            // A writable mount is not offered at all (D2/D3).
            return Err("disk.unsupported".to_string());
        }
        if let Some(stamp) = &self.expected {
            validate_stamp(stamp)?;
        }
        Ok(())
    }
}

/// The extensions the app accepts: ISO, VHD, VHDX and IMG. `.img` is not
/// a family of its own; the classifier only reports it as ISO after the
/// ISO 9660 signature check, so a renamed raw image never mounts.
pub fn supported_image_extension(path: &str) -> bool {
    let name = path.rsplit(['\\', '/']).next().unwrap_or("");
    let Some((stem, extension)) = name.rsplit_once('.') else {
        return false;
    };
    !stem.is_empty()
        && matches!(
            extension.to_ascii_lowercase().as_str(),
            "iso" | "img" | "vhd" | "vhdx"
        )
}

/// Where one mounted image is in its lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MountState {
    Mounting,
    Mounted,
    Ejecting,
    InUse,
    Error,
}

/// One mount as the renderer sees it. There is no path to a raw file
/// reader and no writable flag: `readonly` is always true.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MountedImage {
    pub mount_id: String,
    pub source: SourceStamp,
    pub kind: DiskImageKind,
    pub volume_roots: Vec<String>,
    pub physical_path: String,
    pub readonly: bool,
    pub owned: bool,
    pub state: MountState,
    pub brokered: bool,
}

/// The result of one mount request. A failed request returns no mount;
/// `requires_elevation` asks the UI for its explicit one-operation
/// confirmation before trying again with `allow_elevation: true`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MountResult {
    pub mount: Option<MountedImage>,
    pub requires_elevation: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

impl MountResult {
    pub fn failed(code: &str) -> Self {
        MountResult {
            mount: None,
            requires_elevation: false,
            error_code: Some(code.to_string()),
        }
    }

    pub fn elevation_required() -> Self {
        MountResult {
            mount: None,
            requires_elevation: true,
            error_code: Some("disk.denied".to_string()),
        }
    }

    pub fn mounted(mount: MountedImage) -> Self {
        MountResult {
            mount: Some(mount),
            requires_elevation: false,
            error_code: None,
        }
    }
}

/// What an eject request answers on success.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EjectResult {
    pub ejected: bool,
}

/// A Windows absolute file path with no traversal and no control
/// characters, at most 32,768 UTF-16 units.
pub fn valid_image_path(path: &str) -> bool {
    let units = path.encode_utf16().count();
    if units == 0 || units > MAX_DISK_PATH_UNITS || path.contains('\0') {
        return false;
    }
    if path.chars().any(char::is_control) {
        return false;
    }
    let bytes = path.as_bytes();
    let drive = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/');
    let unc = path.starts_with(r"\\");
    if !drive && !unc {
        return false;
    }
    !path.split(['\\', '/']).any(|part| part == "..")
}

/// Volume roots are exact Windows drive roots such as `F:\`; the app
/// never invents one from the next free letter.
pub fn valid_volume_root(root: &str) -> bool {
    let bytes = root.as_bytes();
    bytes.len() == 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && bytes[2] == b'\\'
}

/// Source stamps keep the 07a wire rules: an absolute path key, 8 and 16
/// lower-case hex identifiers, a decimal 100 ns tick count of at most 20
/// digits and a size that survives JSON. This mirrors
/// `fs_service::SourceStamp::validate` without requiring the caller's
/// expected stamp to be normalized (comparison is case-insensitive).
pub fn validate_stamp(stamp: &SourceStamp) -> Result<(), String> {
    if !valid_image_path(&stamp.path_key) {
        return Err("disk.changed".to_string());
    }
    if !is_lower_hex_of(&stamp.volume_id, 8) || !is_lower_hex_of(&stamp.file_id, 16) {
        return Err("disk.changed".to_string());
    }
    if stamp.modified_ticks.is_empty()
        || stamp.modified_ticks.len() > 20
        || !stamp.modified_ticks.bytes().all(|b| b.is_ascii_digit())
        || stamp.modified_ticks.parse::<u64>().is_err()
    {
        return Err("disk.changed".to_string());
    }
    if stamp.size_bytes > 9_007_199_254_740_991 {
        return Err("disk.changed".to_string());
    }
    Ok(())
}

fn is_lower_hex_of(value: &str, width: usize) -> bool {
    value.len() == width
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Full equality of two identities; a same path and size is not enough.
pub fn same_stamp(a: &SourceStamp, b: &SourceStamp) -> bool {
    a.path_key.eq_ignore_ascii_case(&b.path_key)
        && a.volume_id.eq_ignore_ascii_case(&b.volume_id)
        && a.file_id.eq_ignore_ascii_case(&b.file_id)
        && a.modified_ticks == b.modified_ticks
        && a.size_bytes == b.size_bytes
}

/// A source stamp must match every field of the expected one.
pub fn expected_matches(expected: &SourceStamp, actual: &SourceStamp) -> bool {
    same_stamp(expected, actual)
}

#[cfg(test)]
#[path = "disk_image_types_step09j_tests.rs"]
mod step09j_tests;
