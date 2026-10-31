//! Storage accounting never follows a link or junction outside the store.

use std::path::Path;

use crate::StoreError;

pub(crate) fn disk_usage(dir: &Path) -> Result<u64, StoreError> {
    let mut size = 0u64;
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        let metadata = std::fs::symlink_metadata(&path)?;
        if reparse(&metadata) {
            continue;
        }
        size = size.saturating_add(if metadata.is_dir() {
            disk_usage(&path)?
        } else {
            metadata.len()
        });
    }
    Ok(size)
}

pub(crate) fn reparse(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    metadata.file_type().is_symlink()
}
