//! Password-aware ZIP and 7z reading (Step 06e T4). Fixtures are built with
//! the same writer libraries; no real secret is ever used.

use std::io::Write;
use std::path::Path;

use archive::{
    extract_with_options, list, list_with_options, ArchiveError, ArchiveFormat, ArchiveReadOptions,
    ExtractEvents, ExtractRequest, Limits,
};
use fs_service::{new_cancellation_token, OpProgress};

const SECRET: &str = "correct horse battery staple";

#[derive(Default)]
struct Events {
    created: Vec<String>,
}

impl ExtractEvents for Events {
    fn progress(&mut self, _progress: &OpProgress) {}

    fn created(&mut self, path: &Path) {
        self.created.push(path.to_string_lossy().into_owned());
    }
}

#[derive(Clone, Copy)]
enum ZipProtection {
    None,
    Aes,
    ZipCrypto,
}

fn write_zip(path: &Path, protection: ZipProtection, files: &[(&str, &[u8])]) {
    use zip::unstable::write::FileOptionsExt;
    use zip::{AesMode, CompressionMethod, ZipWriter};
    let mut writer = ZipWriter::new(std::fs::File::create(path).unwrap());
    for (name, data) in files {
        let base =
            zip::write::SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        let options = match protection {
            ZipProtection::None => base,
            ZipProtection::Aes => base.with_aes_encryption(AesMode::Aes256, SECRET),
            ZipProtection::ZipCrypto => base
                .with_deprecated_encryption(SECRET.as_bytes())
                .expect("a non-empty compatibility password"),
        };
        writer.start_file(*name, options).unwrap();
        writer.write_all(data).unwrap();
    }
    writer.finish().unwrap();
}

fn write_7z(path: &Path, encrypt_data: bool, encrypt_header: bool, files: &[(&str, &[u8])]) {
    use sevenz_rust2::encoder_options::AesEncoderOptions;
    use sevenz_rust2::{
        ArchiveEntry, ArchiveWriter, EncoderConfiguration, EncoderMethod, Password,
    };
    let mut writer = ArchiveWriter::create(path).unwrap();
    if encrypt_data {
        writer.set_content_methods(vec![
            AesEncoderOptions::new(Password::from(SECRET)).into(),
            EncoderConfiguration::new(EncoderMethod::LZMA2),
        ]);
    }
    writer.set_encrypt_header(encrypt_header);
    for (name, data) in files {
        writer
            .push_archive_entry(ArchiveEntry::new_file(name), Some(*data))
            .unwrap();
    }
    writer.finish().unwrap();
}

fn request(dest: &Path, archive: &Path) -> ExtractRequest {
    ExtractRequest {
        paths: Vec::new(),
        base: String::new(),
        dest_dir: dest.to_string_lossy().into_owned(),
        new_folder: None,
        expected_size: std::fs::metadata(archive).unwrap().len(),
        expected_modified: 0,
        single_file: false,
        zone: None,
    }
}

fn extract(
    archive: &Path,
    dest: &Path,
    password: Option<&str>,
) -> Result<archive::ExtractReport, ArchiveError> {
    let token = new_cancellation_token();
    let mut events = Events::default();
    extract_with_options(
        archive,
        &request(dest, archive),
        &Limits::default(),
        &token,
        &mut events,
        &ArchiveReadOptions::with_password(password.map(str::to_string)),
    )
}

#[test]
fn zip_aes_and_zipcrypto_require_the_exact_password() {
    let folder = tempfile::tempdir().unwrap();
    // A plain archive is untouched by the password code.
    let plain = folder.path().join("plain.zip");
    write_zip(&plain, ZipProtection::None, &[("plain.txt", b"plain")]);
    let plain_listing = list(
        &plain,
        &Limits::default(),
        &new_cancellation_token(),
        &mut |_| {},
    )
    .unwrap();
    assert!(plain_listing.entries.iter().all(|entry| !entry.encrypted));
    for (label, protection) in [
        ("aes", ZipProtection::Aes),
        ("zipcrypto", ZipProtection::ZipCrypto),
    ] {
        let archive = folder.path().join(format!("{label}.zip"));
        write_zip(&archive, protection, &[("data.txt", b"exact bytes")]);

        let token = new_cancellation_token();
        let listing = list(&archive, &Limits::default(), &token, &mut |_| {}).unwrap();
        assert_eq!(listing.format, ArchiveFormat::Zip);
        assert!(listing.entries.iter().any(|entry| entry.encrypted));

        let right = folder.path().join(format!("{label}-right"));
        std::fs::create_dir(&right).unwrap();
        let report = extract(&archive, &right, Some(SECRET)).unwrap();
        assert_eq!(report.files_written, 1);
        assert_eq!(
            std::fs::read(right.join("data.txt")).unwrap(),
            b"exact bytes"
        );

        let wrong = folder.path().join(format!("{label}-wrong"));
        std::fs::create_dir(&wrong).unwrap();
        let result = extract(&archive, &wrong, Some("not the password"));
        assert!(
            matches!(result, Err(ArchiveError::BadPassword)),
            "{result:?}"
        );
        assert!(std::fs::read_dir(&wrong).unwrap().next().is_none());

        let missing = folder.path().join(format!("{label}-missing"));
        std::fs::create_dir(&missing).unwrap();
        let result = extract(&archive, &missing, None);
        assert!(
            matches!(result, Err(ArchiveError::PasswordRequired)),
            "{result:?}"
        );
        assert!(std::fs::read_dir(&missing).unwrap().next().is_none());
    }
}

#[test]
fn seven_z_reports_data_and_header_encryption() {
    let folder = tempfile::tempdir().unwrap();
    let token = new_cancellation_token();

    // Plain header, encrypted data: names are readable, data is not.
    let data_only = folder.path().join("data-only.7z");
    write_7z(
        &data_only,
        true,
        false,
        &[("a.txt", b"alpha"), ("b.txt", b"beta")],
    );
    let listing = list(&data_only, &Limits::default(), &token, &mut |_| {}).unwrap();
    assert_eq!(listing.entries.len(), 2);
    assert!(listing.entries.iter().all(|entry| entry.encrypted));

    // Encrypted header: no names until the password is supplied.
    let hidden = folder.path().join("hidden.7z");
    write_7z(&hidden, true, true, &[("secret-name.txt", b"hidden")]);
    let result = list(&hidden, &Limits::default(), &token, &mut |_| {});
    assert!(
        matches!(result, Err(ArchiveError::PasswordRequired)),
        "{result:?}"
    );
    let listing = list_with_options(
        &hidden,
        &Limits::default(),
        &token,
        &mut |_| {},
        &ArchiveReadOptions::with_password(Some(SECRET.to_string())),
    )
    .unwrap();
    assert_eq!(listing.entries[0].name, "secret-name.txt");
    assert!(listing.entries[0].encrypted);

    // Plain archive: nothing encrypted.
    let plain = folder.path().join("plain.7z");
    write_7z(&plain, false, false, &[("open.txt", b"open")]);
    let listing = list(&plain, &Limits::default(), &token, &mut |_| {}).unwrap();
    assert!(listing.entries.iter().all(|entry| !entry.encrypted));
}

#[test]
fn wrong_password_does_not_publish_a_zero_length_file() {
    let folder = tempfile::tempdir().unwrap();
    let archive = folder.path().join("empty-and-full.zip");
    write_zip(
        &archive,
        ZipProtection::Aes,
        &[("empty.txt", b""), ("full.txt", b"content")],
    );
    let dest = folder.path().join("out");
    std::fs::create_dir(&dest).unwrap();

    let result = extract(&archive, &dest, Some("wrong"));
    assert!(matches!(result, Err(ArchiveError::BadPassword)));
    assert!(std::fs::read_dir(&dest).unwrap().next().is_none());
    assert!(!dest.join("empty.txt").exists());
}

#[test]
fn authenticated_selection_uses_owned_output() {
    let folder = tempfile::tempdir().unwrap();
    let archive = folder.path().join("data.zip");
    write_zip(
        &archive,
        ZipProtection::Aes,
        &[("data.txt", b"new content")],
    );
    let dest = folder.path().join("out");
    std::fs::create_dir(&dest).unwrap();
    let foreign_partial = dest.join("~data.partial");
    std::fs::write(&foreign_partial, "foreign").unwrap();
    let existing = dest.join("data.txt");
    std::fs::write(&existing, "sentinel").unwrap();

    let report = extract(&archive, &dest, Some(SECRET)).unwrap();
    assert_eq!(report.files_written, 1);
    assert_eq!(std::fs::read_to_string(&existing).unwrap(), "sentinel");
    assert_eq!(
        std::fs::read_to_string(&foreign_partial).unwrap(),
        "foreign"
    );
    assert_eq!(
        std::fs::read_to_string(dest.join("data (1).txt")).unwrap(),
        "new content"
    );
}

#[test]
fn partial_password_failure_reports_every_effect() {
    let folder = tempfile::tempdir().unwrap();
    let archive = folder.path().join("mixed.zip");
    {
        use zip::{AesMode, CompressionMethod, ZipWriter};
        let mut writer = ZipWriter::new(std::fs::File::create(&archive).unwrap());
        writer
            .start_file(
                "first.txt",
                zip::write::SimpleFileOptions::default()
                    .compression_method(CompressionMethod::Stored),
            )
            .unwrap();
        writer.write_all(b"plain first").unwrap();
        // The writer needs a fresh options value for each entry.
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(CompressionMethod::Stored)
            .with_aes_encryption(AesMode::Aes256, SECRET);
        writer.start_file("second.txt", options).unwrap();
        writer.write_all(b"encrypted second").unwrap();
        writer.finish().unwrap();
    }
    let dest = folder.path().join("out");
    std::fs::create_dir(&dest).unwrap();

    let report = extract(&archive, &dest, Some("wrong password")).unwrap();
    assert_eq!(report.files_written, 1);
    assert_eq!(
        std::fs::read_to_string(dest.join("first.txt")).unwrap(),
        "plain first"
    );
    assert!(report
        .created
        .iter()
        .any(|path| path.ends_with("first.txt")));
    assert!(!dest.join("second.txt").exists());
    assert_eq!(report.error.as_deref(), Some("archive.bad_password"));
    assert!(report
        .skipped
        .iter()
        .any(|skip| skip.reason == "bad_password"));
}
