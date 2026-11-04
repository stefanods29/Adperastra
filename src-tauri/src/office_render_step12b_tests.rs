//! Step 12b T5: Office preflight, the finalized profile and output checks.
//!
//! These tests build their own synthetic containers; they never touch a user
//! document, and nothing here launches LibreOffice.

use std::io::{Cursor, Write};

use crate::engine_types::{EngineError, OfficeFormat, OfficeRenderTarget};

/// Build a minimal OOXML container with the given extra parts.
fn docx(parts: &[(&str, &[u8])]) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let stored =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    if !parts.iter().any(|(name, _)| *name == "[Content_Types].xml") {
        writer.start_file("[Content_Types].xml", stored).unwrap();
        writer
            .write_all(br#"<?xml version="1.0"?><Types></Types>"#)
            .unwrap();
    }
    for (name, bytes) in parts {
        writer.start_file(*name, stored).unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

fn write_temp(name: &str, bytes: &[u8]) -> (tempfile::TempDir, std::path::PathBuf) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join(name);
    std::fs::write(&path, bytes).unwrap();
    (directory, path)
}

/// `macros_never_execute`: a container with a macro project is refused before
/// the engine opens it, and the profile disables macro execution anyway.
#[test]
fn macros_never_execute() {
    let (directory, path) = write_temp("macro.docx", &docx(&[("word/vbaProject.bin", b"macro")]));
    assert_eq!(
        crate::office_preflight::preflight(&path, OfficeFormat::Docx).err(),
        Some(EngineError::Unsupported.message())
    );
    // A macro-enabled content type is refused even without the binary part.
    let (directory2, path2) = write_temp(
        "macro2.docx",
        &docx(&[(
            "[Content_Types].xml",
            br#"<Types><Override ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>"#,
        )]),
    );
    assert!(crate::office_preflight::preflight(&path2, OfficeFormat::Docx).is_err());
    // The profile itself never enables macros.
    let profile = crate::office_profile::profile_xml();
    assert!(crate::office_profile::profile_disables_macros(&profile));
    assert!(profile.contains("DisableMacrosExecution"));
    drop((directory, directory2));
}

/// `external_relationship_refused`: an external relationship in any `.rels`
/// part stops the conversion.
#[test]
fn external_relationship_refused() {
    let rels = br#"<?xml version="1.0"?><Relationships>
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"
        Target="https://example.com/remote" TargetMode="External"/></Relationships>"#;
    let (directory, path) = write_temp(
        "external.docx",
        &docx(&[("word/_rels/document.xml.rels", rels)]),
    );
    assert_eq!(
        crate::office_preflight::preflight(&path, OfficeFormat::Docx).err(),
        Some(EngineError::Unsupported.message())
    );
    // A clean container passes.
    let (clean_dir, clean_path) =
        write_temp("clean.docx", &docx(&[("word/document.xml", b"<w:body/>")]));
    assert!(crate::office_preflight::preflight(&clean_path, OfficeFormat::Docx).is_ok());
    drop((directory, clean_dir));
}

/// `source_hash_unchanged`: preflight only reads; the source bytes and their
/// hash stay identical.
#[test]
fn source_hash_unchanged() {
    let bytes = docx(&[("word/document.xml", b"<w:body><w:p/></w:body>")]);
    let (_directory, path) = write_temp("readonly.docx", &bytes);
    let before = blake3::hash(&std::fs::read(&path).unwrap());
    let _ = crate::office_preflight::preflight(&path, OfficeFormat::Docx);
    let after = blake3::hash(&std::fs::read(&path).unwrap());
    assert_eq!(before, after, "preflight must not write the source");
}

#[test]
fn edited_snapshot_spools_its_own_length_instead_of_original_disk_length() {
    use crate::engine_types::{EngineInput, EngineSource};
    use crate::export_snapshot_types::SnapshotBeginRequest;
    let root = tempfile::tempdir().unwrap();
    let snapshots =
        crate::export_snapshots::ExportSnapshots::new(root.path().join("snapshots")).unwrap();
    let document = uuid::Uuid::new_v4();
    let mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    let stamp = fs_service::SourceStamp {
        path_key: r"c:\docs\original.docx".into(),
        volume_id: "0a1b2c3d".into(),
        file_id: "0123456789abcdef".into(),
        modified_ticks: "133000000000000000".into(),
        size_bytes: 1234,
    };
    snapshots
        .authorities()
        .register_native(document, "original.docx", mime, Some(stamp.clone()), false)
        .unwrap();
    let bytes = docx(&[(
        "word/document.xml",
        b"<w:body><w:p>edited text</w:p></w:body>",
    )]);
    assert_ne!(bytes.len() as u64, stamp.size_bytes);
    let begin = snapshots
        .begin(SnapshotBeginRequest {
            document_id: document,
            revision: 2,
            content_id: uuid::Uuid::new_v4(),
            mime: mime.into(),
            byte_len: bytes.len() as u64,
            source: None,
        })
        .unwrap();
    snapshots
        .append(&begin.snapshot_id, &begin.upload_token, 0, &bytes)
        .unwrap();
    let snapshot = snapshots.finish(&begin.snapshot_id).unwrap();
    let lease = snapshots
        .resolve(&snapshot.snapshot_id, &document.to_string(), 2)
        .unwrap();
    let input = EngineInput {
        input_index: 0,
        original: convert::ConversionInput::Snapshot {
            snapshot_id: snapshot.snapshot_id,
            document_id: document.to_string(),
            revision: 2,
        },
        stamp: Some(stamp),
        source: EngineSource::Snapshot(lease),
        sensitive: false,
    };
    let directory = fs_service::owned_io::PinnedDirectory::open(root.path()).unwrap();
    let spooled = crate::engine_process::spool_input(&input, &directory, 1024 * 1024).unwrap();
    assert_eq!(std::fs::read(&spooled.path).unwrap(), bytes);
    assert_eq!(input.source_revision(), 2);
}

/// `exit0_without_pdf_fails`: a successful exit with an HTML payload named as
/// a PDF is a failure, and no artifact is handed out.
#[test]
fn exit0_without_pdf_fails() {
    let directory = tempfile::tempdir().unwrap();
    let pinned = fs_service::owned_io::PinnedDirectory::open(directory.path()).unwrap();
    let mut owned = fs_service::owned_io::OwnedOutput::create(&pinned, "rendered.pdf").unwrap();
    owned
        .file_mut()
        .write_all(b"<html>not a pdf</html>")
        .unwrap();
    owned.flush_sync().unwrap();
    let output = crate::engine_types::EngineOutput {
        output_id: uuid::Uuid::new_v4(),
        relative_name: "rendered.pdf".to_string(),
        mime: "application/pdf".to_string(),
        byte_len: 22,
        content_hash_sha256: "a".repeat(64),
        owned_output: owned,
    };
    let request = crate::engine_types::OfficeRenderRequest {
        input: convert::ConversionInput::File {
            path: "C:\\docs\\report.docx".to_string(),
            expected: None,
        },
        target: OfficeRenderTarget::Pdf,
        format: OfficeFormat::Docx,
        include_comments: true,
        include_notes: false,
        ranges: Vec::new(),
    };
    let result = crate::engine_types::EngineResult {
        exit_code: 0,
        outputs: vec![output],
        bytes_written: 22,
        metadata_lost: Vec::new(),
        stderr_codes: Vec::new(),
    };
    assert_eq!(
        crate::office_render::validate_one_shot_result(&request, result, "26.8.2".to_string(), 1)
            .err(),
        Some(EngineError::Failed.message())
    );
}

/// `sensitive_snapshot_never_spooled`: a sensitive input is refused before any
/// copy exists in the private folder.
#[test]
fn sensitive_snapshot_never_spooled() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("locked.docx");
    std::fs::write(&source, b"PK\x03\x04locked").unwrap();
    let identity = fs_service::owned_io::SourceIdentity::capture(&source).unwrap();
    let pinned = fs_service::owned_io::PinnedSource::open(&source, &identity).unwrap();
    let input = crate::engine_types::EngineInput {
        input_index: 0,
        original: convert::ConversionInput::File {
            path: source.to_string_lossy().into_owned(),
            expected: None,
        },
        stamp: None,
        source: crate::engine_types::EngineSource::Disk(pinned),
        sensitive: true,
    };
    assert_eq!(
        input.refuse_sensitive().err(),
        Some(EngineError::SensitiveUnsupported)
    );
    // The request validation refuses it before a private folder is created.
    let action = crate::engine_types::EngineAction::RenderOffice {
        inputs: vec![input],
        options: crate::engine_types::OfficeRenderRequest {
            input: convert::ConversionInput::File {
                path: source.to_string_lossy().into_owned(),
                expected: None,
            },
            target: OfficeRenderTarget::Pdf,
            format: OfficeFormat::Docx,
            include_comments: true,
            include_notes: false,
            ranges: Vec::new(),
        },
    };
    assert_eq!(action.validate(), Err(EngineError::SensitiveUnsupported));
    // Nothing was written next to the source.
    let mut entries = std::fs::read_dir(directory.path()).unwrap();
    assert_eq!(entries.by_ref().count(), 1);
    let text = std::fs::read(&source).unwrap();
    assert_eq!(text, b"PK\x03\x04locked");
}
