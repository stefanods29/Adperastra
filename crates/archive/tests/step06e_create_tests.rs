//! ZIP and 7z spool writers (Step 06e T6). Every fixture is small; the
//! output cap is injected, never the 8 GiB default.

use std::path::{Path, PathBuf};

use archive::{
    create_spool, extract_with_options, list_with_options, plan_create, ArchiveError,
    ArchiveReadOptions, CreateEncryption, CreateFormat, CreateLimits, CreateOptions, CreatePlan,
    ExtractEvents, ExtractRequest, Limits,
};
use fs_service::{new_cancellation_token, OpProgress};

const SECRET: &str = "a long synthetic passphrase";

#[derive(Default)]
struct Events;

impl ExtractEvents for Events {
    fn progress(&mut self, _progress: &OpProgress) {}

    fn created(&mut self, _path: &Path) {}
}

fn write(path: &Path, bytes: &[u8]) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(path, bytes).unwrap();
}

fn options(format: CreateFormat, encryption: CreateEncryption) -> CreateOptions {
    CreateOptions {
        format,
        encryption,
        password: match encryption {
            CreateEncryption::None => None,
            _ => Some(SECRET.to_string()),
        },
        encrypt_names: encryption != CreateEncryption::None,
        include_hidden: true,
        level: 6,
    }
}

fn plan_for(root: &Path) -> CreatePlan {
    let sources = vec![root.to_string_lossy().into_owned()];
    let token = new_cancellation_token();
    plan_create(
        &sources,
        true,
        &CreateLimits::default(),
        &token,
        &mut |_| {},
    )
    .unwrap()
}

fn create(
    plan: &CreatePlan,
    options: &CreateOptions,
    spool: &Path,
    limits: &CreateLimits,
) -> Result<archive::CreateSpoolReport, ArchiveError> {
    let token = new_cancellation_token();
    create_spool(plan, options, spool, limits, &token, &mut |_| {})
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
    let mut events = Events;
    extract_with_options(
        archive,
        &request(dest, archive),
        &Limits::default(),
        &token,
        &mut events,
        &ArchiveReadOptions::with_password(password.map(str::to_string)),
    )
}

fn tree(folder: &Path) -> PathBuf {
    let root = folder.join("photos");
    write(&root.join("a.txt"), b"first file");
    write(&root.join("sub").join("b.bin"), &[0u8, 1, 2, 3, 4]);
    std::fs::create_dir_all(root.join("empty")).unwrap();
    root
}

#[test]
fn zip_and_seven_z_round_trip_files_and_empty_folders() {
    let folder = tempfile::tempdir().unwrap();
    let root = tree(folder.path());
    let before = std::fs::read(root.join("a.txt")).unwrap();
    let modified = std::fs::metadata(root.join("a.txt"))
        .unwrap()
        .modified()
        .unwrap();
    let plan = plan_for(&root);

    for (name, format) in [
        ("zip", CreateFormat::Zip),
        ("seven_z", CreateFormat::SevenZ),
    ] {
        let spool = folder.path().join(format!("archive-{name}.spool"));
        let report = create(
            &plan,
            &options(format, CreateEncryption::None),
            &spool,
            &CreateLimits::default(),
        )
        .unwrap();
        assert_eq!(report.files_written, 2, "{name}: both files");
        assert_eq!(report.folders_written, 3, "{name}: root, sub and empty");
        assert!(report.archive_size > 0);
        assert_eq!(report.blake3.len(), 64);

        let token = new_cancellation_token();
        let listing = list_with_options(
            &spool,
            &Limits::default(),
            &token,
            &mut |_| {},
            &ArchiveReadOptions::default(),
        )
        .unwrap();
        let paths: Vec<&str> = listing
            .entries
            .iter()
            .map(|entry| entry.path.as_str())
            .collect();
        assert!(paths.contains(&"photos/a.txt"));
        assert!(paths.contains(&"photos/sub/b.bin"));
        assert!(paths.contains(&"photos/empty"));

        let dest = folder.path().join(format!("out-{name}"));
        std::fs::create_dir(&dest).unwrap();
        let report = extract(&spool, &dest, None).unwrap();
        assert_eq!(report.files_written, 2);
        assert_eq!(
            std::fs::read(dest.join("photos").join("a.txt")).unwrap(),
            b"first file"
        );
        assert_eq!(
            std::fs::read(dest.join("photos").join("sub").join("b.bin")).unwrap(),
            [0u8, 1, 2, 3, 4]
        );
        assert!(dest.join("photos").join("empty").is_dir());
    }

    assert_eq!(std::fs::read(root.join("a.txt")).unwrap(), before);
    assert_eq!(
        std::fs::metadata(root.join("a.txt"))
            .unwrap()
            .modified()
            .unwrap(),
        modified,
        "the source never changes"
    );
}

#[test]
fn zip_aes_and_compatibility_are_explicit_choices() {
    let folder = tempfile::tempdir().unwrap();
    let root = tree(folder.path());
    let plan = plan_for(&root);

    for (name, encryption) in [
        ("aes", CreateEncryption::Aes256),
        ("zipcrypto", CreateEncryption::ZipCrypto),
    ] {
        let spool = folder.path().join(format!("{name}.spool"));
        let options = CreateOptions {
            format: CreateFormat::Zip,
            encryption,
            password: Some(SECRET.to_string()),
            encrypt_names: false,
            include_hidden: true,
            level: 6,
        };
        create(&plan, &options, &spool, &CreateLimits::default()).unwrap();

        let token = new_cancellation_token();
        let listing = list_with_options(
            &spool,
            &Limits::default(),
            &token,
            &mut |_| {},
            &ArchiveReadOptions::with_password(Some(SECRET.to_string())),
        )
        .unwrap();
        assert!(
            listing
                .entries
                .iter()
                .filter(|entry| entry.kind == archive::EntryKind::File)
                .all(|entry| entry.encrypted),
            "{name}: files are encrypted"
        );

        let dest = folder.path().join(format!("out-{name}"));
        std::fs::create_dir(&dest).unwrap();
        let report = extract(&spool, &dest, Some(SECRET)).unwrap();
        assert_eq!(report.files_written, 2);

        let wrong = folder.path().join(format!("wrong-{name}"));
        std::fs::create_dir(&wrong).unwrap();
        let result = extract(&spool, &wrong, Some("wrong password"));
        assert!(
            matches!(result, Err(ArchiveError::BadPassword)),
            "{name}: {result:?}"
        );
        assert!(std::fs::read_dir(&wrong).unwrap().next().is_none());
    }

    let plain = folder.path().join("plain.spool");
    create(
        &plan,
        &options(CreateFormat::Zip, CreateEncryption::None),
        &plain,
        &CreateLimits::default(),
    )
    .unwrap();
    let token = new_cancellation_token();
    let listing = list_with_options(
        &plain,
        &Limits::default(),
        &token,
        &mut |_| {},
        &ArchiveReadOptions::default(),
    )
    .unwrap();
    assert!(listing.entries.iter().all(|entry| !entry.encrypted));
}

#[test]
fn seven_z_encrypts_names_only_when_requested() {
    let folder = tempfile::tempdir().unwrap();
    let root = tree(folder.path());
    let plan = plan_for(&root);
    let token = new_cancellation_token();

    let hidden = folder.path().join("hidden.spool");
    let hidden_options = CreateOptions {
        format: CreateFormat::SevenZ,
        encryption: CreateEncryption::Aes256,
        password: Some(SECRET.to_string()),
        encrypt_names: true,
        include_hidden: true,
        level: 6,
    };
    create(&plan, &hidden_options, &hidden, &CreateLimits::default()).unwrap();
    let result = list_with_options(
        &hidden,
        &Limits::default(),
        &token,
        &mut |_| {},
        &ArchiveReadOptions::default(),
    );
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
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.path == "photos/a.txt"));

    let visible = folder.path().join("visible.spool");
    let visible_options = CreateOptions {
        encrypt_names: false,
        ..hidden_options
    };
    create(&plan, &visible_options, &visible, &CreateLimits::default()).unwrap();
    let listing = list_with_options(
        &visible,
        &Limits::default(),
        &token,
        &mut |_| {},
        &ArchiveReadOptions::default(),
    )
    .unwrap();
    assert!(listing
        .entries
        .iter()
        .filter(|entry| entry.kind == archive::EntryKind::File)
        .all(|entry| entry.encrypted));
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.path == "photos/a.txt"));
}

#[test]
fn seven_z_uses_configured_kdf_and_dictionary() {
    let folder = tempfile::tempdir().unwrap();
    let root = tree(folder.path());
    let plan = plan_for(&root);
    let spool = folder.path().join("kdf.spool");
    let options = CreateOptions {
        format: CreateFormat::SevenZ,
        encryption: CreateEncryption::Aes256,
        password: Some(SECRET.to_string()),
        encrypt_names: false,
        include_hidden: true,
        level: 6,
    };
    create(&plan, &options, &spool, &CreateLimits::default()).unwrap();

    let file = std::fs::File::open(&spool).unwrap();
    let mut reader = std::io::BufReader::new(file);
    let archive =
        sevenz_rust2::Archive::read(&mut reader, &sevenz_rust2::Password::from(SECRET)).unwrap();
    let mut saw_aes = false;
    let mut saw_lzma2 = false;
    for coder in &archive.blocks[0].coders {
        if coder.encoder_method_id() == sevenz_rust2::EncoderMethod::ID_AES256_SHA256 {
            saw_aes = true;
            let properties = coder.properties();
            assert_eq!(properties[0] & 0x3f, 19, "the KDF cycle power is 19");
        }
        if coder.encoder_method_id() == sevenz_rust2::EncoderMethod::ID_LZMA2 {
            saw_lzma2 = true;
            let property = coder.properties()[0];
            let dictionary = (2 | u64::from(property & 1)) << (property / 2 + 11);
            assert_eq!(dictionary, 8 * 1024 * 1024, "the dictionary is 8 MiB");
        }
    }
    assert!(saw_aes, "aes coder present");
    assert!(saw_lzma2, "lzma2 coder present");
}

#[test]
fn output_cap_uses_small_injected_limit() {
    let folder = tempfile::tempdir().unwrap();
    let root = folder.path().join("data");
    // Pseudo-random bytes: they do not compress away.
    let mut bytes = Vec::with_capacity(8_192);
    let mut state = 0x1234_5678u32;
    for _ in 0..8_192 {
        state = state.wrapping_mul(1_103_515_245).wrapping_add(12_345);
        bytes.push((state >> 16) as u8);
    }
    write(&root.join("noise.bin"), &bytes);
    let plan = plan_for(&root);
    let limits = CreateLimits {
        max_output_bytes: 512,
        ..CreateLimits::default()
    };
    let spool = folder.path().join("capped.spool");
    let result = create(
        &plan,
        &options(CreateFormat::Zip, CreateEncryption::None),
        &spool,
        &limits,
    );
    assert!(
        matches!(result, Err(ArchiveError::CreateTooLarge)),
        "{result:?}"
    );
    assert!(!spool.exists(), "no partial spool is left");
    assert_eq!(std::fs::read(root.join("noise.bin")).unwrap(), bytes);
}

#[test]
fn cancel_and_finish_failure_preserve_sources() {
    let folder = tempfile::tempdir().unwrap();
    let root = tree(folder.path());
    let plan = plan_for(&root);
    let before = std::fs::read(root.join("a.txt")).unwrap();
    let spool = folder.path().join("cancelled.spool");

    let token = new_cancellation_token();
    token.store(true, std::sync::atomic::Ordering::Relaxed);
    let result = create_spool(
        &plan,
        &options(CreateFormat::Zip, CreateEncryption::None),
        &spool,
        &CreateLimits::default(),
        &token,
        &mut |_| {},
    );
    assert!(matches!(result, Err(ArchiveError::Cancelled)));
    assert!(!spool.exists(), "a cancelled creation leaves no spool");
    assert_eq!(std::fs::read(root.join("a.txt")).unwrap(), before);

    // A source changed after the walk is skipped and reported, never read.
    std::fs::write(root.join("a.txt"), b"a different content entirely").unwrap();
    let spool = folder.path().join("changed.spool");
    let report = create(
        &plan,
        &options(CreateFormat::Zip, CreateEncryption::None),
        &spool,
        &CreateLimits::default(),
    )
    .unwrap();
    assert!(report
        .skipped
        .iter()
        .any(|skip| skip.reason == "source_changed"));
    assert_eq!(report.files_written, 1, "the other file is still written");
    assert_eq!(
        std::fs::read(root.join("a.txt")).unwrap(),
        b"a different content entirely",
        "the changed source is never modified"
    );
}

#[test]
fn spool_writer_is_reachable_without_a_password() {
    // A guard against a future change that always encrypts: a None-password
    // creation must never need a credential.
    let folder = tempfile::tempdir().unwrap();
    let root = tree(folder.path());
    let plan = plan_for(&root);
    let spool = folder.path().join("plain7.spool");
    let options = CreateOptions {
        format: CreateFormat::SevenZ,
        encryption: CreateEncryption::None,
        password: None,
        encrypt_names: false,
        include_hidden: true,
        level: 6,
    };
    let report = create(&plan, &options, &spool, &CreateLimits::default()).unwrap();
    assert!(report.files_written > 0);
    let mut file = std::fs::File::open(&spool).unwrap();
    let mut header = [0u8; 6];
    use std::io::Read;
    file.read_exact(&mut header).unwrap();
    assert_eq!(header, [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]);
    let mut sink = Vec::new();
    file.read_to_end(&mut sink).unwrap();
    assert!(!sink.is_empty());
}
