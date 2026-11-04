//! Probe tests for `disk_images` (Step 09j T1).

use super::{classify_image, has_iso9660_signature, OpenDocuments, WindowsDiskHost};
use crate::disk_image_types::DiskImageKind;
use crate::disk_mounts::DiskHost;
use std::io::{Seek, SeekFrom, Write};
use std::sync::Arc;

fn fixture(ext: &str, iso: bool) -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(format!("image.{ext}"));
    let mut file = std::fs::File::create(&path).unwrap();
    file.write_all(&[0u8; 40 * 1024]).unwrap();
    if iso {
        file.seek(SeekFrom::Start(16 * 2048)).unwrap();
        let mut descriptor = [0u8; 2048];
        descriptor[0] = 1;
        descriptor[1..6].copy_from_slice(b"CD001");
        file.write_all(&descriptor).unwrap();
    }
    file.flush().unwrap();
    (dir, path)
}

struct Docs;

impl OpenDocuments for Docs {
    fn under(&self, roots: &[String]) -> Vec<String> {
        roots.iter().map(|root| format!(r"{root}notes.txt")).collect()
    }
}

#[test]
fn the_host_delegates_open_documents_exactly() {
    let host = WindowsDiskHost::new(Arc::new(Docs));
    assert_eq!(
        host.documents_under(&[r"F:\".to_string()]),
        [r"F:\notes.txt".to_string()]
    );
}

#[test]
fn extensions_map_to_their_families() {
    let (_iso, iso) = fixture("iso", false);
    assert_eq!(classify_image(&iso), Ok(DiskImageKind::Iso));
    let (_vhd, vhd) = fixture("vhd", false);
    assert_eq!(classify_image(&vhd), Ok(DiskImageKind::Vhd));
    let (_vhdx, vhdx) = fixture("vhdx", false);
    assert_eq!(classify_image(&vhdx), Ok(DiskImageKind::Vhdx));
}

#[test]
fn a_raw_img_is_not_supported() {
    let (_dir, img) = fixture("img", false);
    assert_eq!(
        classify_image(&img),
        Err("disk.unsupported".to_string())
    );
    assert!(!has_iso9660_signature(&img).unwrap());
}

#[test]
fn a_verified_iso_img_is_normalized_to_iso() {
    let (_dir, img) = fixture("img", true);
    assert!(has_iso9660_signature(&img).unwrap());
    assert_eq!(classify_image(&img), Ok(DiskImageKind::Iso));
}

#[test]
fn a_short_img_is_not_an_iso() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("short.img");
    std::fs::write(&path, [0u8; 1024]).unwrap();
    assert!(!has_iso9660_signature(&path).unwrap());
    assert_eq!(
        classify_image(&path),
        Err("disk.unsupported".to_string())
    );
}

#[test]
fn unknown_extensions_and_directories_are_refused() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("image.zip");
    std::fs::write(&path, [0u8; 16]).unwrap();
    assert_eq!(
        classify_image(&path),
        Err("disk.unsupported".to_string())
    );
    assert_eq!(
        classify_image(dir.path()),
        Err("disk.unsupported".to_string())
    );
}
