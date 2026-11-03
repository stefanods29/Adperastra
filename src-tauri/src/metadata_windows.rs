//! Read-only Windows property reads for the metadata helper (Step 07b
//! D4/D5) without ever writing a property store.
//!
//! The helper checks the source with attribute-only access first, then
//! opens the Windows property store once with `GPS_DEFAULT` (no write,
//! temporary or volatile flags), reads the fixed allowlist, and checks the
//! source revision again before reporting. A cloud placeholder and a link
//! are refused before any content is touched (R-FS-1, D7).

use std::path::Path;
use std::sync::atomic::Ordering;

use fs_service::{CancellationToken, SourceStamp};

use crate::metadata_types::{
    same_stamp, MetadataField, MetadataFieldId, MetadataInfo, MetadataValue, ALL_FIELD_IDS,
};

/// `FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_RECALL_ON_OPEN |
/// FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS`.
pub const ONLINE_ONLY_MASK: u32 = 0x0000_1000 | 0x0004_0000 | 0x0040_0000;
/// `FILE_ATTRIBUTE_REPARSE_POINT`: never followed by background reading.
pub const REPARSE_POINT: u32 = 0x0000_0400;

/// True when any cloud-placeholder flag is set. No content may be read.
pub fn is_online_only(attributes: u32) -> bool {
    attributes & ONLINE_ONLY_MASK != 0
}

/// True for links and junctions; background reads never follow them.
pub fn is_reparse_point(attributes: u32) -> bool {
    attributes & REPARSE_POINT != 0
}

/// Attribute-only access: `symlink_metadata` opens nothing for reading and
/// does not download a placeholder (R-FS-1).
#[cfg(windows)]
pub fn path_attributes(path: &Path) -> Result<u32, String> {
    use std::os::windows::fs::MetadataExt;
    std::fs::symlink_metadata(path)
        .map(|metadata| metadata.file_attributes())
        .map_err(|_| "metadata.failed".to_string())
}

#[cfg(not(windows))]
pub fn path_attributes(_path: &Path) -> Result<u32, String> {
    Err("metadata.failed".to_string())
}

/// One read-only source of allowlisted values. Tests implement this trait
/// so a failing property can be exercised without a real property handler.
pub trait PropertySource {
    /// The value of one allowlisted field, or `None` when it is absent or
    /// has a kind the table does not expect.
    fn read(&self, field: MetadataFieldId) -> Option<MetadataValue>;
    fn read_checked(&self, field: MetadataFieldId) -> crate::metadata_properties::PropertyRead {
        self.read(field)
            .map(crate::metadata_properties::PropertyRead::Value)
            .unwrap_or(crate::metadata_properties::PropertyRead::Absent)
    }
}

/// The fixed read sequence: attribute check, revision check, store read,
/// revision check. `open` is only called for a local, non-link source.
///
/// Errors: `metadata.online_only`, `metadata.failed`,
/// `metadata.changed`, `background.cancelled`.
pub fn read_metadata_with<S, F>(
    path: &Path,
    expected: &SourceStamp,
    attributes: u32,
    open: F,
    cancel: &CancellationToken,
) -> Result<MetadataInfo, String>
where
    S: PropertySource,
    F: FnOnce(&Path) -> Result<S, String>,
{
    if is_online_only(attributes) {
        return Err("metadata.online_only".to_string());
    }
    if is_reparse_point(attributes) {
        return Err("metadata.failed".to_string());
    }
    let before =
        fs_service::capture_source_stamp(path).map_err(|_| "metadata.failed".to_string())?;
    if !same_stamp(&before, expected) {
        return Err("metadata.changed".to_string());
    }
    let prepared = crate::metadata_source::PreparedMetadataSource::open(path, expected)?;
    let source = open(&prepared.source.path)?;
    let mut info = MetadataInfo::new(before);
    for field in ALL_FIELD_IDS {
        if cancel.load(Ordering::Relaxed) {
            return Err("background.cancelled".to_string());
        }
        use crate::metadata_properties::PropertyRead;
        match source.read_checked(field) {
            PropertyRead::Value(value) => info.push(MetadataField { id: field, value }),
            PropertyRead::Partial(value) => {
                info.push(MetadataField { id: field, value });
                info.missing.push(field);
                info.partial = true;
            }
            PropertyRead::Invalid => {
                info.missing.push(field);
                info.partial = true;
            }
            PropertyRead::Absent => {}
        }
    }
    let after =
        fs_service::capture_source_stamp(path).map_err(|_| "metadata.failed".to_string())?;
    if !same_stamp(&after, expected) {
        return Err("metadata.changed".to_string());
    }
    prepared.verify(expected)?;
    info.validated()
}

/// Read the fixed allowlist from one local file. COM must already be
/// initialized on this thread (`crate::explorer::ComGuard`).
#[cfg(windows)]
pub fn read_properties(
    path: &Path,
    expected: &SourceStamp,
    cancel: &CancellationToken,
) -> Result<MetadataInfo, String> {
    let attributes = path_attributes(path)?;
    read_metadata_with(
        path,
        expected,
        attributes,
        |source_path| {
            let store = crate::metadata_properties::windows::open_store(source_path)?;
            let keys = crate::metadata_properties::windows::resolve_keys();
            Ok(windows_impl::WindowsPropertySource::new(store, keys))
        },
        cancel,
    )
}

#[cfg(windows)]
mod windows_impl {
    use super::PropertySource;
    use crate::metadata_properties::windows::read_value;
    use crate::metadata_types::{MetadataFieldId, MetadataValue};
    use windows::Win32::Foundation::PROPERTYKEY;
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;

    /// A read-only property store plus the resolved allowlist keys.
    pub struct WindowsPropertySource {
        store: IPropertyStore,
        keys: Vec<(MetadataFieldId, PROPERTYKEY)>,
    }

    impl WindowsPropertySource {
        pub fn new(store: IPropertyStore, keys: Vec<(MetadataFieldId, PROPERTYKEY)>) -> Self {
            Self { store, keys }
        }
    }

    impl PropertySource for WindowsPropertySource {
        fn read(&self, field: MetadataFieldId) -> Option<MetadataValue> {
            match self.read_checked(field) {
                crate::metadata_properties::PropertyRead::Value(value)
                | crate::metadata_properties::PropertyRead::Partial(value) => Some(value),
                _ => None,
            }
        }
        fn read_checked(&self, field: MetadataFieldId) -> crate::metadata_properties::PropertyRead {
            let Some((_, key)) = self.keys.iter().find(|(candidate, _)| *candidate == field) else {
                return crate::metadata_properties::PropertyRead::Invalid;
            };
            read_value(&self.store, field, key)
        }
    }
}

#[cfg(windows)]
#[cfg(test)]
#[path = "metadata_windows_tests.rs"]
mod metadata_windows_tests;
