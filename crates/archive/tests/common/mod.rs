//! Sample archives for the Step 06d tests, written into a folder and
//! returned by path. Every format holds the same tricky content: a safe
//! file, a folder, a file inside it, a name that escapes the folder and a
//! name Windows refuses.
#![allow(dead_code)]

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

pub fn sample_zip(dir: &Path) -> PathBuf {
    let path = dir.join("sample.zip");
    let file = File::create(&path).unwrap();
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    writer.start_file("README.txt", options).unwrap();
    writer.write_all(b"hello").unwrap();
    writer.add_directory("docs/", options).unwrap();
    writer.start_file("docs/plan.md", options).unwrap();
    writer.write_all(b"# Plan\n").unwrap();
    writer
        .start_file(
            "images/logo.png",
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored),
        )
        .unwrap();
    writer.write_all(&[0u8; 100]).unwrap();
    writer.start_file("../evil.txt", options).unwrap();
    writer.write_all(b"x").unwrap();
    writer.start_file("CON.txt", options).unwrap();
    writer.write_all(b"c").unwrap();
    writer.finish().unwrap();
    path
}

pub fn sample_7z(dir: &Path) -> PathBuf {
    let path = dir.join("sample.7z");
    let mut writer = sevenz_rust2::ArchiveWriter::create(&path).unwrap();
    writer
        .push_archive_entry::<&[u8]>(sevenz_rust2::ArchiveEntry::new_directory("docs"), None)
        .unwrap();
    writer
        .push_archive_entry(
            sevenz_rust2::ArchiveEntry::new_file("docs/plan.md"),
            Some(&b"# Plan\n"[..]),
        )
        .unwrap();
    writer
        .push_archive_entry(
            sevenz_rust2::ArchiveEntry::new_file("README.txt"),
            Some(&b"hello"[..]),
        )
        .unwrap();
    writer.finish().unwrap();
    path
}

/// The tar content of every tar sample: a file, a folder, a file inside it,
/// a symbolic link and a name that tries to escape the folder.
pub fn sample_tar_bytes() -> Vec<u8> {
    let mut builder = tar::Builder::new(Vec::new());
    let mut header = tar::Header::new_gnu();
    header.set_size(5);
    header.set_mode(0o644);
    header.set_mtime(1_600_000_000);
    header.set_cksum();
    builder
        .append_data(&mut header, "README.txt", &b"hello"[..])
        .unwrap();

    let mut folder = tar::Header::new_gnu();
    folder.set_size(0);
    folder.set_mode(0o755);
    folder.set_entry_type(tar::EntryType::dir());
    folder.set_cksum();
    builder
        .append_data(&mut folder, "docs/", std::io::empty())
        .unwrap();

    let mut plan = tar::Header::new_gnu();
    plan.set_size(7);
    plan.set_mode(0o644);
    plan.set_mtime(1_600_000_001);
    plan.set_cksum();
    builder
        .append_data(&mut plan, "docs/plan.md", &b"# Plan\n"[..])
        .unwrap();

    let mut link = tar::Header::new_gnu();
    link.set_size(0);
    link.set_mode(0o777);
    link.set_entry_type(tar::EntryType::symlink());
    link.set_path("link").unwrap();
    link.set_link_name("README.txt").unwrap();
    link.set_cksum();
    builder.append(&link, std::io::empty()).unwrap();

    // The builder refuses a `..` path, so the name bytes go straight into
    // the header, exactly like a hostile archive would.
    let mut evil = tar::Header::new_gnu();
    evil.set_size(1);
    evil.set_mode(0o644);
    let name = b"../evil.txt";
    evil.as_old_mut().name[..name.len()].copy_from_slice(name);
    evil.set_cksum();
    builder.append(&evil, &b"x"[..]).unwrap();

    builder.into_inner().unwrap()
}

pub fn sample_tar(dir: &Path) -> PathBuf {
    let path = dir.join("sample.tar");
    fs::write(&path, sample_tar_bytes()).unwrap();
    path
}

pub fn sample_tar_gz(dir: &Path) -> PathBuf {
    let path = dir.join("sample.tar.gz");
    let mut encoder =
        flate2::write::GzEncoder::new(File::create(&path).unwrap(), flate2::Compression::default());
    encoder.write_all(&sample_tar_bytes()).unwrap();
    encoder.finish().unwrap();
    path
}

pub fn sample_tar_xz(dir: &Path) -> PathBuf {
    let path = dir.join("sample.tar.xz");
    let options = lzma_rust2::XzOptions::default();
    let mut encoder = lzma_rust2::XzWriter::new(File::create(&path).unwrap(), options).unwrap();
    encoder.write_all(&sample_tar_bytes()).unwrap();
    encoder.finish().unwrap();
    path
}

pub fn sample_gz(dir: &Path) -> PathBuf {
    let path = dir.join("notes.txt.gz");
    let mut encoder =
        flate2::write::GzEncoder::new(File::create(&path).unwrap(), flate2::Compression::default());
    encoder.write_all(&[b'a'; 1_000]).unwrap();
    encoder.finish().unwrap();
    path
}

pub fn sample_xz(dir: &Path) -> PathBuf {
    let path = dir.join("notes.txt.xz");
    let options = lzma_rust2::XzOptions::default();
    let mut encoder = lzma_rust2::XzWriter::new(File::create(&path).unwrap(), options).unwrap();
    encoder.write_all(&[b'a'; 1_000]).unwrap();
    encoder.finish().unwrap();
    path
}
