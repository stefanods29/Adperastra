//! Guarded ZIP/7z conversion (Step 08b D7, T5).
//!
//! The Step 06e archive service is the only reader/writer: validated listing,
//! safe extraction through owned writers, then creation from the extracted
//! tree. This adapter owns one random intermediate folder under the app's
//! data folder and removes only that folder. It never unpacks a source path
//! directly into a destination and never removes a foreign intermediate.
//!
//! Every output is published only after all required entries were extracted
//! and written; a malformed entry, a wrong source password, an unsafe name or
//! a skipped entry aborts before `sink.begin`.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::UNIX_EPOCH;

use archive::{
    check_bomb, create_spool, extract_with_options, list_with_options, ArchiveError,
    ArchiveReadOptions, CreateEncryption, CreateFormat, CreateLimits, CreateOptions,
    CreateSpoolReport, ExtractEvents, ExtractRequest, Limits,
};
use fs_service::{CancellationToken, OpProgress};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::adapters::{adapter_specs_08b, validate_options_kind};
use crate::error::ConvertError;
use crate::types::{
    ConversionPreviewData, ConversionWarningCode, ConvertOptions, ConverterSpec, MetadataCategory,
    OutputDraft, OutputMetadata, PreparedOutput,
};

pub const ARCHIVE_CONVERTER_IDS: [&str; 2] = ["zip/seven_z", "seven_z/zip"];

/// One owned intermediate folder. Drop removes only the folder this adapter
/// created, never the root or a foreign entry inside it.
pub struct ConvertWorkDir {
    path: PathBuf,
    owned: bool,
    files: std::sync::Mutex<Vec<(PathBuf, fs_service::source_stamp::FileHandleStamp)>>,
}

impl ConvertWorkDir {
    pub fn create(root: &Path) -> Result<Self, ConvertError> {
        std::fs::create_dir_all(root).map_err(ConvertError::Io)?;
        for _ in 0..8 {
            let path = root.join(format!("convert-{}", Uuid::new_v4()));
            match std::fs::create_dir(&path) {
                Ok(()) => {
                    return Ok(Self {
                        path,
                        owned: true,
                        files: std::sync::Mutex::new(Vec::new()),
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(_) => {
                    return Err(ConvertError::Io(std::io::Error::other(
                        "conversion output failed",
                    )))
                }
            }
        }
        Err(ConvertError::Io(std::io::Error::other(
            "conversion output failed",
        )))
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn keep(mut self) {
        self.owned = false;
    }
}

impl Drop for ConvertWorkDir {
    fn drop(&mut self) {
        if self.owned {
            if let Ok(files) = self.files.lock() {
                for (path, stamp) in files.iter().rev() {
                    cleanup_owned_file(path, stamp);
                }
            }
            // Unknown children and directories remain retained; never recurse
            // into an intermediate tree whose contents may have changed.
        }
    }
}

/// The archive conversion adapter.
pub struct ArchiveConverter {
    id: &'static str,
    spec: ConverterSpec,
    working_root: PathBuf,
}

impl ArchiveConverter {
    pub fn new(id: &'static str, working_root: PathBuf) -> Result<Self, ConvertError> {
        if !ARCHIVE_CONVERTER_IDS.contains(&id) {
            return Err(ConvertError::Unsupported);
        }
        let id_json = format!("\"{id}\"");
        let spec = adapter_specs_08b()
            .into_iter()
            .find(|spec| serde_json::to_string(&spec.id).ok().as_deref() == Some(id_json.as_str()))
            .ok_or(ConvertError::Unsupported)?;
        Ok(Self {
            id,
            spec,
            working_root,
        })
    }

    fn convert_archive(
        &self,
        inputs: &mut [ConvertSource],
        options: &ConvertOptions,
        output: &mut dyn ConvertOutputSink,
        context: &mut ConvertContext,
    ) -> Result<PreparedOutput, ConvertError> {
        validate_options_kind(self.id, options)?;
        if inputs.len() != 1 {
            return Err(ConvertError::BadRequest);
        }
        let value = option_value(options)?;
        let expected = if self.id == "zip/seven_z" {
            CreateFormat::SevenZ
        } else {
            CreateFormat::Zip
        };
        let target = target_format(&value, expected)?;
        if target != expected {
            return Err(ConvertError::BadRequest);
        }
        let level = value.get("level").and_then(Value::as_u64).unwrap_or(6);
        if level > 9 {
            return Err(ConvertError::BadRequest);
        }
        let output_password = value
            .get("password")
            .and_then(Value::as_str)
            .filter(|password| !password.is_empty())
            .map(str::to_string);
        let source_password = value
            .get("source_password")
            .and_then(Value::as_str)
            .filter(|password| !password.is_empty())
            .map(str::to_string);
        let encrypt_names = value
            .get("encrypt_names")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let preserve_timestamps = value
            .get("preserve_timestamps")
            .and_then(Value::as_bool)
            .unwrap_or(true);

        let work = ConvertWorkDir::create(&self.working_root)?;
        let source_path = work.path().join("source.bin");
        let source_facts = copy_source(
            &mut inputs[0],
            &source_path,
            self.spec.max_input_bytes,
            &context.cancel,
            &work,
        )?;

        let read_options = ArchiveReadOptions {
            password: source_password.clone(),
            seven_zip: None,
        };
        let limits = Limits::default();
        let listing = list_with_options(
            &source_path,
            &limits,
            &context.cancel,
            &mut |_| {},
            &read_options,
        )
        .map_err(map_archive_error)?;
        if listing.partial {
            return Err(ConvertError::Unsupported);
        }
        let mut files = 0usize;
        for entry in &listing.entries {
            if entry.problem.is_some() {
                return Err(ConvertError::Unsupported);
            }
            match entry.kind {
                archive::EntryKind::Link => return Err(ConvertError::Unsupported),
                archive::EntryKind::File if entry.encrypted && source_password.is_none() => {
                    return Err(ConvertError::BadRequest);
                }
                archive::EntryKind::File => files += 1,
                archive::EntryKind::Folder => {}
            }
        }

        let extracted = work.path().join("extracted");
        std::fs::create_dir(&extracted).map_err(ConvertError::Io)?;
        let request = ExtractRequest {
            paths: Vec::new(),
            base: String::new(),
            dest_dir: extracted.to_string_lossy().into_owned(),
            new_folder: None,
            expected_size: source_facts.size,
            expected_modified: source_facts.modified_unix,
            single_file: false,
            zone: None,
        };
        let mut events = OwnedEvents(&work);
        let report = extract_with_options(
            &source_path,
            &request,
            &limits,
            &context.cancel,
            &mut events,
            &read_options,
        )
        .map_err(map_archive_error)?;
        if report.cancelled || context.cancel.load(Ordering::Relaxed) {
            return Err(ConvertError::Cancelled);
        }
        if report.error.is_some() {
            return Err(ConvertError::Io(std::io::Error::other(
                "conversion output failed",
            )));
        }
        if !report.skipped.is_empty() || report.files_written as usize != files {
            return Err(ConvertError::Unsupported);
        }

        let sources = top_level_sources(&extracted)?;
        let mut create_plan = archive::plan_create(
            &sources,
            true,
            &CreateLimits::default(),
            &context.cancel,
            &mut |_| {},
        )
        .map_err(map_archive_error)?;
        if !preserve_timestamps {
            for entry in &mut create_plan.entries {
                entry.modified_unix = 0;
            }
        }
        check_bomb(create_plan.total_bytes, source_facts.size, &limits)
            .map_err(map_archive_error)?;
        let create_options = CreateOptions {
            format: target,
            encryption: if output_password.is_some() {
                CreateEncryption::Aes256
            } else {
                CreateEncryption::None
            },
            password: output_password,
            encrypt_names,
            include_hidden: true,
            // Additive 06e extension proposed by this step: a selected
            // compression level; the 06e writer keeps 6 when absent.
            level: level as u8,
        };
        create_options.validate().map_err(map_archive_error)?;
        let spool_path = work.path().join("output.bin");
        let limits = CreateLimits {
            max_output_bytes: context.max_output_bytes,
            ..CreateLimits::default()
        };
        let progress = &mut *context.progress;
        let token = &context.cancel;
        let spool_report: CreateSpoolReport = create_spool(
            &create_plan,
            &create_options,
            &spool_path,
            &limits,
            token,
            &mut |update: &OpProgress| {
                let _ = progress(update.clone());
            },
        )
        .map_err(map_archive_error)?;
        if context.cancel.load(Ordering::Relaxed) {
            return Err(ConvertError::Cancelled);
        }
        let spool_file = std::fs::File::open(&spool_path).map_err(ConvertError::Io)?;
        work.record(&spool_path, &spool_file);
        drop(spool_file);
        let bytes = std::fs::read(&spool_path).map_err(ConvertError::Io)?;
        if bytes.len() as u64 != spool_report.size || bytes.len() as u64 > context.max_output_bytes
        {
            return Err(ConvertError::Changed);
        }
        let hash = sha256_hex(&bytes);
        let draft = OutputDraft {
            name_hint: inputs[0].name.clone(),
            name_part: name_part_none()?,
            mime: if target == CreateFormat::Zip {
                "application/zip".to_string()
            } else {
                "application/x-7z-compressed".to_string()
            },
            input_indices: vec![0],
        };
        let index = output.begin(draft)?;
        let result = (|| {
            for chunk in bytes.chunks(1024 * 1024) {
                if context.cancel.load(Ordering::Relaxed) {
                    return Err(ConvertError::Cancelled);
                }
                output.write(index, chunk)?;
            }
            output.finish(
                index,
                OutputMetadata {
                    byte_len: bytes.len() as u64,
                    width: None,
                    height: None,
                    metadata_lost: vec![metadata("comments")?],
                    warnings: Vec::<ConversionWarningCode>::new(),
                    hash_sha256: hash,
                },
            )
        })();
        if result.is_err() {
            let _ = output.abort(index);
        }
        result?;
        Ok(PreparedOutput {
            outputs_count: 1,
            metadata_lost: vec![metadata("comments")?],
            warnings: Vec::new(),
        })
    }
}

impl Converter for ArchiveConverter {
    fn spec(&self) -> ConverterSpec {
        self.spec.clone()
    }

    fn preview(
        &self,
        _inputs: &mut [ConvertSource],
        _options: &ConvertOptions,
        _context: &mut ConvertContext,
    ) -> Result<ConversionPreviewData, ConvertError> {
        Err(ConvertError::Unsupported)
    }

    fn convert(
        &self,
        inputs: &mut [ConvertSource],
        options: &ConvertOptions,
        output: &mut dyn ConvertOutputSink,
        context: &mut ConvertContext,
    ) -> Result<PreparedOutput, ConvertError> {
        self.convert_archive(inputs, options, output, context)
    }
}

struct SourceFacts {
    size: u64,
    modified_unix: u64,
}

fn copy_source(
    source: &mut ConvertSource,
    target: &Path,
    max_bytes: u64,
    token: &CancellationToken,
    work: &ConvertWorkDir,
) -> Result<SourceFacts, ConvertError> {
    if source.byte_len > max_bytes {
        return Err(ConvertError::TooLarge);
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)
        .map_err(ConvertError::Io)?;
    work.record(target, &file);
    use std::io::Seek;
    source
        .reader
        .seek(std::io::SeekFrom::Start(0))
        .map_err(ConvertError::Io)?;
    let reader = &mut *source.reader;
    let mut buffer = [0u8; 64 * 1024];
    let mut total = 0u64;
    loop {
        if token.load(Ordering::Relaxed) {
            return Err(ConvertError::Cancelled);
        }
        let read = reader.read(&mut buffer).map_err(ConvertError::Io)?;
        if read == 0 {
            break;
        }
        total += read as u64;
        if total > max_bytes {
            return Err(ConvertError::TooLarge);
        }
        std::io::Write::write_all(&mut file, &buffer[..read]).map_err(ConvertError::Io)?;
    }
    if total != source.byte_len {
        return Err(ConvertError::Changed);
    }
    file.sync_all().map_err(ConvertError::Io)?;
    work.record(target, &file);
    let metadata = std::fs::metadata(target).map_err(ConvertError::Io)?;
    let modified_unix = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|age| age.as_secs())
        .unwrap_or(0);
    Ok(SourceFacts {
        size: metadata.len(),
        modified_unix,
    })
}

fn top_level_sources(root: &Path) -> Result<Vec<String>, ConvertError> {
    let mut values = Vec::new();
    for entry in std::fs::read_dir(root).map_err(ConvertError::Io)? {
        let entry = entry.map_err(ConvertError::Io)?;
        values.push(entry.path().to_string_lossy().into_owned());
    }
    values.sort_by_key(|left| left.to_lowercase());
    Ok(values)
}

fn target_format(value: &Value, default: CreateFormat) -> Result<CreateFormat, ConvertError> {
    match value.get("format").and_then(Value::as_str) {
        Some("zip") => Ok(CreateFormat::Zip),
        Some("seven_z") => Ok(CreateFormat::SevenZ),
        None => Ok(default),
        _ => Err(ConvertError::BadRequest),
    }
}

fn option_value(options: &ConvertOptions) -> Result<Value, ConvertError> {
    let value = serde_json::to_value(options).map_err(|_| ConvertError::BadRequest)?;
    if value.get("kind").and_then(Value::as_str) != Some("archive") {
        return Err(ConvertError::BadRequest);
    }
    Ok(value.get("value").cloned().unwrap_or(Value::Null))
}

fn metadata(category: &str) -> Result<MetadataCategory, ConvertError> {
    serde_json::from_value(json!(category)).map_err(|_| ConvertError::BadRequest)
}

fn name_part_none() -> Result<crate::types::OutputNamePart, ConvertError> {
    serde_json::from_value(json!({"kind":"none"})).map_err(|_| ConvertError::BadRequest)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn map_archive_error(error: ArchiveError) -> ConvertError {
    match error {
        ArchiveError::Cancelled => ConvertError::Cancelled,
        ArchiveError::PasswordRequired
        | ArchiveError::BadPassword
        | ArchiveError::InvalidPassword
        | ArchiveError::PasswordMismatch => ConvertError::BadRequest,
        ArchiveError::Changed | ArchiveError::SourceChanged | ArchiveError::OutputChanged => {
            ConvertError::Changed
        }
        ArchiveError::NoSpace => ConvertError::NoSpace,
        ArchiveError::TooManySources
        | ArchiveError::TooManyEntries
        | ArchiveError::Bomb
        | ArchiveError::CreateTooLarge => ConvertError::TooLarge,
        ArchiveError::Unsupported => ConvertError::Unsupported,
        _ => ConvertError::Io(std::io::Error::other("archive conversion failed")),
    }
}

/// Record every file the extraction created, so Drop can remove exactly those
/// files after identity checks. Directories stay retained, exactly like an
/// intermediate tree that may have gained a foreign child.
struct OwnedEvents<'a>(&'a ConvertWorkDir);

impl ExtractEvents for OwnedEvents<'_> {
    fn progress(&mut self, _progress: &OpProgress) {}
    fn created(&mut self, path: &Path) {
        if let Ok(file) = std::fs::File::open(path) {
            self.0.record(path, &file);
        }
    }
}

/// The archive warning set: comments are not represented by the 06d/06e
/// entry model, so they are reported as lost rather than silently claimed.
pub fn archive_metadata_loss() -> Vec<MetadataCategory> {
    metadata("comments").into_iter().collect()
}

use crate::registry::{ConvertContext, ConvertOutputSink, ConvertSource, Converter};

impl ConvertWorkDir {
    fn record(&self, path: &Path, file: &std::fs::File) {
        if let Ok(stamp) = fs_service::source_stamp::stamp_for_open_file(file) {
            if let Ok(mut files) = self.files.lock() {
                files.push((path.to_path_buf(), stamp));
            }
        }
    }
}
#[cfg(windows)]
fn cleanup_owned_file(path: &Path, expected: &fs_service::source_stamp::FileHandleStamp) {
    use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
    use windows::Win32::{
        Foundation::HANDLE,
        Storage::FileSystem::{
            FileDispositionInfo, SetFileInformationByHandle, DELETE, FILE_DISPOSITION_INFO,
            FILE_FLAG_OPEN_NO_RECALL, FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES,
        },
    };
    let Ok(file) = std::fs::OpenOptions::new()
        .access_mode(DELETE.0 | FILE_READ_ATTRIBUTES.0)
        .share_mode(0)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0 | FILE_FLAG_OPEN_NO_RECALL.0)
        .open(path)
    else {
        return;
    };
    let Ok(actual) = fs_service::source_stamp::stamp_for_open_file(&file) else {
        return;
    };
    if actual.volume_id != expected.volume_id || actual.file_id != expected.file_id {
        return;
    }
    let info = FILE_DISPOSITION_INFO { DeleteFile: true };
    // SAFETY: exclusively opened handle is matched to the native identity
    // recorded while our publisher still owned its output; deletion acts
    // on that same handle and cannot follow a substituted path.
    let _ = unsafe {
        SetFileInformationByHandle(
            HANDLE(file.as_raw_handle()),
            FileDispositionInfo,
            (&info as *const FILE_DISPOSITION_INFO).cast(),
            std::mem::size_of_val(&info) as u32,
        )
    };
}
#[cfg(not(windows))]
fn cleanup_owned_file(_: &Path, _: &fs_service::source_stamp::FileHandleStamp) {}
