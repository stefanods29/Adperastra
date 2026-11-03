//! Background-safe source guards and bounded image signature checks.
use std::io::Read;
use std::path::Path;

use fs_service::owned_io::{PinnedDirectory, PinnedSource, SourceIdentity};
use fs_service::source_stamp::{capture_file_identity, stamp_for_open_file};
use fs_service::Item;

pub fn guard_directory(path: &Path) -> Result<PinnedDirectory, String> {
    // Attribute-only no-recall opens reject a link before canonicalization.
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Attribute reads do not recall contents; no directory listing occurs
        // for a root marked offline/recall/reparse.
        let attributes = std::fs::symlink_metadata(path)
            .map_err(|_| "gallery.unavailable")?
            .file_attributes();
        if attributes & (0x400 | 0x1000 | 0x40000 | 0x400000) != 0 {
            return Err("gallery.unavailable".into());
        }
    }
    let identity = capture_file_identity(path).map_err(|_| "gallery.unavailable")?;
    let directory = PinnedDirectory::open(path).map_err(|_| "gallery.unavailable")?;
    let actual = capture_file_identity(directory.path()).map_err(|_| "gallery.unavailable")?;
    if identity != actual {
        return Err("gallery.changed".into());
    }
    Ok(directory)
}

pub fn accepts_picture(item: &Item) -> Result<bool, String> {
    if item.attrs.online_only {
        return Ok(true);
    }
    let expected = SourceIdentity::capture(&item.path).map_err(|_| "gallery.unavailable")?;
    if expected.size != item.size
        || expected.modified_unix != item.modified_unix
        || (item.attrs.file_id_stable && item.attrs.file_id.is_some_and(|id| id != expected.index))
    {
        return Err("gallery.changed".into());
    }
    let mut source =
        PinnedSource::open_background(&item.path, &expected).map_err(|_| "gallery.unavailable")?;
    let before = stamp_for_open_file(source.file()).map_err(|_| "gallery.changed")?;
    let mut header = [0u8; 8192];
    let size = source
        .file_mut()
        .read(&mut header)
        .map_err(|_| "gallery.unavailable")?;
    let accepted = infer::get(&header[..size]).is_some_and(|kind| {
        matches!(
            kind.mime_type(),
            "image/png"
                | "image/jpeg"
                | "image/gif"
                | "image/bmp"
                | "image/x-icon"
                | "image/vnd.microsoft.icon"
                | "image/webp"
                | "image/tiff"
        )
    });
    if before != stamp_for_open_file(source.file()).map_err(|_| "gallery.changed")? {
        return Err("gallery.changed".into());
    }
    source.verify_after_read().map_err(|_| "gallery.changed")?;
    Ok(accepted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use fs_service::{BackingKind, ItemAttrs, ItemKind};
    fn item(path: &Path, online_only: bool) -> Item {
        let identity = SourceIdentity::capture(path).ok();
        Item {
            path: path.to_path_buf(),
            name: "picture.png".into(),
            kind: ItemKind::File,
            backing: BackingKind::Real,
            size: identity.map(|value| value.size).unwrap_or(0),
            modified_unix: identity.map(|value| value.modified_unix).unwrap_or(0),
            attrs: ItemAttrs {
                online_only,
                ..ItemAttrs::default()
            },
        }
    }
    #[test]
    fn damaged_image_extension_does_not_pass_signature_detection() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("bad.png");
        std::fs::write(&path, b"not a picture").unwrap();
        assert!(!accepts_picture(&item(&path, false)).unwrap());
        assert_eq!(std::fs::read(path).unwrap(), b"not a picture");
    }
    #[test]
    fn cloud_candidate_does_not_open_even_a_nonexistent_source() {
        let directory = tempfile::tempdir().unwrap();
        assert!(accepts_picture(&item(&directory.path().join("missing.png"), true)).unwrap());
    }
}
