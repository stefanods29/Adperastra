//! What kind of archive a file is, decided by its first bytes (Step 06d
//! D1). A `.docx` is a zip by content too, which is why the file-type
//! handler claims names and this crate answers for the bytes.

use crate::entry::ArchiveFormat;
use crate::error::ArchiveError;
use crate::limits::Limits;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

/// How much of a file decides its type.
const HEAD_BYTES: usize = 512;

/// Where a tar header keeps its "ustar" magic.
const TAR_MAGIC_AT: usize = 257;
const TAR_MAGIC: &[u8] = b"ustar";

/// The format of `path`, or `Unsupported` for anything this step does not
/// read (RAR, bzip2, an empty file, a text file named `.zip`).
pub fn detect_format(path: &Path) -> Result<ArchiveFormat, ArchiveError> {
    let file = File::open(path)?;
    let mut head = [0u8; HEAD_BYTES];
    let read = BufReader::new(file).read(&mut head)?;
    let head = &head[..read];
    if is_zip(head) {
        return Ok(ArchiveFormat::Zip);
    }
    if head.starts_with(&[0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]) {
        return Ok(ArchiveFormat::SevenZ);
    }
    if head.starts_with(&[0x1F, 0x8B]) {
        return Ok(if compressed_start_is_tar(path, Inner::Gzip) {
            ArchiveFormat::TarGz
        } else {
            ArchiveFormat::Gz
        });
    }
    if head.starts_with(&[0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00]) {
        return Ok(if compressed_start_is_tar(path, Inner::Xz) {
            ArchiveFormat::TarXz
        } else {
            ArchiveFormat::Xz
        });
    }
    // bzip2: "BZh" and the block size digit 1 to 9.
    if head.len() >= 4 && &head[..3] == b"BZh" && (b'1'..=b'9').contains(&head[3]) {
        return Ok(if compressed_start_is_tar(path, Inner::Bzip2) {
            ArchiveFormat::TarBz2
        } else {
            ArchiveFormat::Bz2
        });
    }
    // RAR 4 and RAR 5 signatures, only at offset zero (never in a prefix).
    if head.starts_with(&[0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x00])
        || head.starts_with(&[0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x01, 0x00])
    {
        return Ok(ArchiveFormat::Rar);
    }
    if has_tar_magic(head) {
        return Ok(ArchiveFormat::Tar);
    }
    // bsdtar writes archives whose first 512 bytes hold no magic; a `.tar`
    // name and a full block are the next best evidence.
    let named_tar = path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("tar"));
    if named_tar && read >= HEAD_BYTES {
        return Ok(ArchiveFormat::Tar);
    }
    Err(ArchiveError::Unsupported)
}

fn is_zip(head: &[u8]) -> bool {
    head.len() >= 4
        && head[0] == b'P'
        && head[1] == b'K'
        && (matches!(&head[2..4], [3, 4] | [5, 6] | [7, 8]))
}

fn has_tar_magic(bytes: &[u8]) -> bool {
    bytes.len() >= TAR_MAGIC_AT + TAR_MAGIC.len()
        && &bytes[TAR_MAGIC_AT..TAR_MAGIC_AT + TAR_MAGIC.len()] == TAR_MAGIC
}

enum Inner {
    Gzip,
    Xz,
    Bzip2,
}

/// A gzip or xz stream that starts with a tar header is a tar archive.
fn compressed_start_is_tar(path: &Path, inner: Inner) -> bool {
    let Ok(file) = File::open(path) else {
        return false;
    };
    let reader: Box<dyn Read> = match inner {
        Inner::Gzip => Box::new(flate2::read::MultiGzDecoder::new(BufReader::new(file))),
        Inner::Xz => Box::new(lzma_rust2::XzReader::new_mem_limit(
            BufReader::new(file),
            true,
            Limits::default().xz_memory_kb,
        )),
        Inner::Bzip2 => Box::new(crate::read_bzip2::decoder(file)),
    };
    let mut head = [0u8; HEAD_BYTES];
    let mut taken = 0;
    let mut reader = reader;
    while taken < head.len() {
        match reader.read(&mut head[taken..]) {
            Ok(0) => break,
            Ok(count) => taken += count,
            Err(_) => return false,
        }
    }
    has_tar_magic(&head[..taken])
}
