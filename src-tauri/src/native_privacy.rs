//! Native privacy orchestration (Step 08c T5).
//!
//! The helper parses bytes; this module owns source identity, destination
//! staging, no-replace publication, report construction and the version/
//! Undo handoff. Nothing here reopens a user path for parsing.
#![allow(dead_code)]


use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use convert::{
    ConversionInput, ConversionOutput, ConversionReport, MetadataCategory, WorkItemResult,
    WorkItemStatus,
};
use fs_service::owned_io::{OwnedIoError, OwnedOutput, PinnedDirectory, PinnedSource, SourceIdentity};
use fs_service::SourceStamp;
use privacy::{
    sorted_categories, Coverage, MetadataCount, PrivacyCleanSummary, PrivacyField,
    PrivacyInspection, PrivacyResult,
};

use crate::privacy_helper::{clean_in_helper, inspect_in_helper};
use crate::privacy_sessions::StoredInspection;

pub const MAX_INPUT_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_OUTPUT_BYTES: u64 = 1024 * 1024 * 1024;
pub const FREE_SPACE_MARGIN: u64 = 64 * 1024 * 1024;
pub const MAX_NAME_ATTEMPTS: u32 = 10_000;

fn uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy()
        .trim_start_matches(r"\\?\")
        .to_string()
}

fn source_stamp(path: &Path) -> Result<Option<SourceStamp>, String> {
    match fs_service::source_stamp::capture_source_stamp(path) {
        Ok(stamp) => Ok(Some(stamp)),
        Err(_) => Err("privacy.changed".to_string()),
    }
}

/// Read one guarded regular file; the source cannot be renamed or written
/// while the bytes are read, and a change is refused.
pub fn read_guarded(path: &Path) -> Result<(Vec<u8>, Option<SourceStamp>), String> {
    let identity = SourceIdentity::capture(path).map_err(|_| "privacy.changed".to_string())?;
    if identity.size > MAX_INPUT_BYTES { return Err("privacy.too_large".into()); }
    let stamp = source_stamp(path)?;
    let mut source = PinnedSource::open(path, &identity).map_err(|_| "privacy.changed".to_string())?;
    let mut bytes = Vec::new();
    Read::by_ref(source.file_mut())
        .take(MAX_INPUT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "privacy.failed".to_string())?;
    source
        .verify_after_read()
        .map_err(|_| "privacy.changed".to_string())?;
    if bytes.len() as u64 > MAX_INPUT_BYTES {
        return Err("privacy.too_large".to_string());
    }
    Ok((bytes, stamp))
}

/// Read the bytes of one immutable export snapshot through its native lease.
pub fn read_snapshot(
    app: &tauri::AppHandle,
    snapshot_id: &str,
    document_id: &str,
    revision: u64,
) -> Result<(Vec<u8>, String, String), String> {
    use tauri::Manager;
    let snapshots = app.state::<std::sync::Arc<crate::export_snapshots::ExportSnapshots>>();
    let document_uuid = uuid::Uuid::try_parse(document_id)
        .map_err(|_| "privacy.bad_request".to_string())?;
    let authority = snapshots
        .authorities()
        .get(document_uuid)
        .map_err(|_| "privacy.changed".to_string())?;
    let lease = snapshots
        .resolve(snapshot_id, document_id, revision)
        .map_err(|_| "privacy.changed".to_string())?;
    if lease.backing.length() > MAX_INPUT_BYTES { return Err("privacy.too_large".into()); }
    let mut reader = lease.backing.reader();
    let mut bytes = Vec::new();
    Read::by_ref(&mut reader).take(MAX_INPUT_BYTES + 1).read_to_end(&mut bytes)
        .map_err(|_| "privacy.failed".to_string())?;
    if bytes.len() as u64 > MAX_INPUT_BYTES {
        return Err("privacy.too_large".to_string());
    }
    Ok((
        bytes,
        authority.authority.name.clone(),
        authority.authority.mime.clone(),
    ))
}

/// The adapter ID for one input, based on the native-detected MIME/extension.
pub fn adapter_for(path: Option<&Path>, mime: &str) -> Result<&'static str, String> {
    let extension = path
        .and_then(Path::extension)
        .map(|value| value.to_string_lossy().to_ascii_lowercase());
    match (extension.as_deref(), mime) {
        (_, "application/pdf") => Ok("pdf"),
        (Some("pdf"), _) => Ok("pdf"),
        (
            Some("jpg" | "jpeg" | "png" | "webp" | "tif" | "tiff"),
            _,
        ) => Ok("image"),
        (_, value) if value.starts_with("image/") => Ok("image"),
        _ => Err("privacy.unsupported".to_string()),
    }
}

/// Refuse a category the chosen adapter does not implement. This is checked
/// before any inspection or cleaning work, so a saved preset for another
/// format can never be silently ignored or applied partially.
pub fn validate_categories_for_adapter(
    adapter: &str,
    categories: &[MetadataCategory],
) -> Result<(), String> {
    let registry = privacy::default_registry();
    let adapter = registry
        .get(adapter)
        .ok_or_else(|| "privacy.unsupported".to_string())?;
    for category in categories {
        if !adapter.categories().contains(category) {
            return Err("privacy.unsupported".to_string());
        }
    }
    Ok(())
}

pub fn inspect_one(
    input: ConversionInput,
    bytes: &[u8],
    source: Option<SourceStamp>,
    categories: Vec<MetadataCategory>,
    adapter: &str,
    cancel: &fs_service::CancellationToken,
) -> Result<PrivacyInspection, String> {
    let (fields, signatures_present) =
        inspect_in_helper(adapter, bytes, categories.clone(), cancel)?;
    if fields.len() > privacy::inspect::MAX_INSPECTION_FIELDS {
        return Err("privacy.too_large".to_string());
    }
    for field in &fields {
        field
            .validate()
            .map_err(|error| error.code().to_string())?;
    }
    let effective_categories = if categories.is_empty() {
        Vec::new()
    } else {
        privacy::inspect::effective_categories(&fields, &categories)
            .map_err(|error| error.code().to_string())?
    };
    Ok(PrivacyInspection {
        inspection_id: uuid(),
        input,
        source,
        fields,
        next_cursor: None,
        complete: true,
        signatures_present,
        effective_categories,
        expires_unix: 0,
    })
}

pub struct CleanOutcome {
    pub result: WorkItemResult,
    pub output: Option<ConversionOutput>,
    pub summary: Option<PrivacyCleanSummary>,
    pub path: Option<String>,
}

fn cleaned_name(source: &Path, suffix: &str, attempt: u32) -> String {
    let stem = source
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    let extension = source
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy()))
        .unwrap_or_default();
    let number = if attempt == 0 {
        String::new()
    } else {
        format!(" ({attempt})")
    };
    format!("{stem}{suffix}{number}{extension}")
}

fn valid_suffix(suffix: &str) -> bool {
    !suffix.is_empty()
        && suffix.chars().count() <= 64
        && !suffix
            .chars()
            .any(|character| character.is_control() || "\\/:*?\"<>|".contains(character))
}

/// Publish a cleaned copy with the numbered collision policy, without ever
/// replacing an arriving file. The caller supplies only proof of its own
/// inspection and current source identity.
pub fn clean_one(
    app: &tauri::AppHandle,
    stored: &StoredInspection,
    categories: &[MetadataCategory],
    dest_dir: &str,
    suffix: &str,
    cancel: &fs_service::CancellationToken,
) -> CleanOutcome {
    let fail = |reason: &str, bytes_written: u64| CleanOutcome {
        result: WorkItemResult {
            input_index: stored.input_index,
            source_path: stored.inspection.source.as_ref().map(|stamp| stamp.path_key.clone()),
            output_count: 0,
            status: WorkItemStatus::Failed,
            reason: Some(reason.to_string()),
            metadata_lost: Vec::new(),
            bytes_written,
        },
        output: None,
        summary: None,
        path: None,
    };
    if !valid_suffix(suffix) {
        return fail("privacy.bad_request", 0);
    }
    let (source_path, source_name, bytes, current_stamp) = match &stored.inspection.input {
        ConversionInput::File { path, .. } => {
            let path = PathBuf::from(path);
            let (bytes, stamp) = match read_guarded(&path) {
                Ok(value) => value,
                Err(error) => return fail(&error, 0),
            };
            let name = path
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| "file".to_string());
            (Some(path), name, bytes, stamp)
        }
        ConversionInput::Snapshot {
            snapshot_id,
            document_id,
            revision,
        } => {
            let (bytes, name, _mime) =
                match read_snapshot(app, snapshot_id, document_id, *revision) {
                    Ok(value) => value,
                    Err(error) => return fail(&error, 0),
                };
            (None, name, bytes, None)
        }
    };
    // Bind cleaning to the exact inspected bytes, not only to a source stamp
    // that a same-size/re-timestamped change could preserve.
    if blake3::hash(&bytes).as_bytes() != &stored.content_hash {
        return fail("privacy.changed", 0);
    }
    if source_path.is_some() {
        if let (Some(previous), Some(current)) = (&stored.source, &current_stamp) {
            if previous != current {
                return fail("privacy.changed", 0);
            }
        } else if stored.source.is_some() != current_stamp.is_some() {
            return fail("privacy.changed", 0);
        }
    }
    // The adapter expands the same closure the native command disclosed.
    // Pass the requested (supported) categories, not the expanded closure:
    // a PDF's whole-XMP removal legitimately discloses nested GPS/date
    // categories that are not themselves selectable PDF adapter categories.
    let effective = match privacy::inspect::effective_categories(&stored.fields, categories) {
        Ok(value) => value,
        Err(error) => return fail(error.code(), 0),
    };
    let (cleaned, summary) = match clean_in_helper(
        &stored.adapter,
        &bytes,
        categories.to_vec(),
        MAX_OUTPUT_BYTES,
        cancel,
    ) {
        Ok(value) => value,
        Err(error) => return fail(&error, 0),
    };
    if summary.coverage != Coverage::Complete
        || summary.output_bytes != cleaned.len() as u64
    {
        return fail("privacy.unverified", 0);
    }
    // D7/D8: reopen the fresh output through a second helper process and
    // rerun selected-category inspection before anything is published.
    let (after_fields, _) = match inspect_in_helper(&stored.adapter, &cleaned, Vec::new(), cancel) {
        Ok(value) => value,
        Err(error) if error == "privacy.cancelled" => return fail("privacy.cancelled", 0),
        Err(_) => return fail("privacy.unverified", 0),
    };
    if after_fields.iter().any(|field| {
        effective.contains(&field.category)
            && !(field.category == MetadataCategory::Exif && field.field_id.starts_with("exif.unk"))
    }) {
        return fail("privacy.unverified", 0);
    }
    if let Some(path) = &source_path {
        let source_hash = blake3::hash(&bytes);
        let after = match read_guarded(path) {
            Ok((after_bytes, after_stamp)) => {
                if blake3::hash(&after_bytes) != source_hash || current_stamp != after_stamp {
                    return fail("privacy.changed", 0);
                }
                after_bytes.len() as u64
            }
            Err(error) => return fail(&error, 0),
        };
        if after != bytes.len() as u64 {
            return fail("privacy.changed", 0);
        }
    }
    let directory = match PinnedDirectory::open(Path::new(dest_dir)) {
        Ok(value) => value,
        Err(_) => return fail("privacy.failed", 0),
    };
    if free_space(Path::new(dest_dir)).is_none_or(|free| free < cleaned.len() as u64 + FREE_SPACE_MARGIN) {
        return fail("privacy.no_space", 0);
    }
    let naming_path = source_path
        .as_deref()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from(&source_name));
    let mut output = match OwnedOutput::create(&directory, &cleaned_name(&naming_path, suffix, 0)) {
        Ok(value) => value,
        Err(_) => return fail("privacy.failed", 0),
    };
    if output.file_mut().write_all(&cleaned).is_err()
        || output.flush_sync().is_err()
    {
        return fail("privacy.failed", 0);
    }
    if cancel.load(std::sync::atomic::Ordering::Relaxed) { return fail("privacy.cancelled", 0); }
    let mut published = None;
    for attempt in 1..=MAX_NAME_ATTEMPTS {
        match output.publish_name(&cleaned_name(&naming_path, suffix, attempt - 1)) {
            Ok(path) => {
                published = Some(path);
                break;
            }
            Err(OwnedIoError::TargetExists) => continue,
            Err(_) => break,
        }
    }
    let Some(path) = published else {
        return fail("privacy.failed", 0);
    };
    let _ = app;
    let output_path = display_path(&path);
    CleanOutcome {
        result: WorkItemResult {
            input_index: stored.input_index,
            source_path: source_path
                .as_deref()
                .map(display_path)
                .or_else(|| Some(source_name.clone())),
            output_count: 1,
            status: WorkItemStatus::Done,
            reason: None,
            metadata_lost: Vec::new(),
            bytes_written: cleaned.len() as u64,
        },
        output: Some(ConversionOutput {
            output_id: uuid(),
            input_indices: vec![stored.input_index],
            output_index: 0,
            path: output_path.clone(),
            byte_len: cleaned.len() as u64,
        }),
        summary: Some(summary),
        path: Some(output_path),
    }
}

pub fn counts_before(fields: &[PrivacyField], categories: &[MetadataCategory]) -> Vec<MetadataCount> {
    privacy::inspect::counts_for(fields, categories)
}

pub fn report(
    mut items: Vec<WorkItemResult>,
    mut outputs: Vec<ConversionOutput>,
    cancelled: bool,
) -> ConversionReport {
    let input_total = items.len() as u32;
    let done_count = items
        .iter()
        .filter(|item| item.status == WorkItemStatus::Done)
        .count() as u32;
    let failed_count = items
        .iter()
        .filter(|item| item.status == WorkItemStatus::Failed)
        .count() as u32;
    let skipped_count = items
        .iter()
        .filter(|item| item.status == WorkItemStatus::Skipped)
        .count() as u32;
    let cancelled_count = items
        .iter()
        .filter(|item| item.status == WorkItemStatus::Cancelled)
        .count() as u32;
    let outputs_created = outputs.len() as u32;
    let complete = items.len() <= 256 && outputs.len() <= 256;
    // The shared report wire is bounded to 256 rows. The counts above still
    // describe the whole batch; a later report cursor can page the remainder.
    items.truncate(256);
    outputs.truncate(256);
    let created_paths = outputs.iter().map(|output| output.path.clone()).collect();
    ConversionReport {
        report_id: uuid(),
        items,
        outputs,
        next_cursor: None,
        created_paths,
        history_id: None,
        input_total,
        done_count,
        failed_count,
        skipped_count,
        cancelled_count,
        outputs_created,
        cancelled,
        job_finished: true,
        complete,
    }
}

pub fn result(
    before: Vec<MetadataCount>,
    after: Vec<MetadataCount>,
    report: ConversionReport,
) -> PrivacyResult {
    PrivacyResult {
        report,
        inspections_before: before,
        inspections_after: after,
    }
}

/// Keep the category order stable for comparisons and tests.
pub fn categories_in_order(categories: &[MetadataCategory]) -> Vec<MetadataCategory> {
    sorted_categories(categories)
}

/// Re-check that every selected category is supported by the stored adapter.
/// A category can be absent from one file in a batch without invalidating the
/// selection; the native command discloses one global closure across all
/// inspections, and after-counts report only categories actually present.
pub fn validate_selection(
    stored: &StoredInspection,
    categories: &[MetadataCategory],
) -> Result<(), String> {
    if categories.is_empty() {
        return Err("privacy.bad_request".to_string());
    }
    validate_categories_for_adapter(&stored.adapter, categories)
}

#[cfg(test)]
mod tests {
    use super::{cleaned_name, valid_suffix};
    use std::path::Path;

    #[test]
    fn numbered_cleaned_names_keep_both_items() {
        let source = Path::new(r"C:\Pictures\report.pdf");
        assert_eq!(cleaned_name(source, " - Cleaned", 0), "report - Cleaned.pdf");
        assert_eq!(cleaned_name(source, " - Cleaned", 1), "report - Cleaned (1).pdf");
        assert_ne!(
            cleaned_name(source, " - Limpio", 1),
            cleaned_name(source, " - Cleaned", 1)
        );
    }

    #[test]
    fn unsafe_suffixes_are_refused() {
        assert!(valid_suffix(" - Cleaned"));
        assert!(!valid_suffix(""));
        assert!(!valid_suffix(r" - bad\name"));
        assert!(!valid_suffix(" - bad:name"));
    }

    #[test]
    fn source_change_after_inspect_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("photo.jpg");
        std::fs::write(&path, b"first").unwrap();
        let identity = fs_service::owned_io::SourceIdentity::capture(&path).unwrap();
        std::fs::write(&path, b"second version").unwrap();
        assert!(fs_service::owned_io::PinnedSource::open(&path, &identity).is_err());
    }
}

#[allow(clippy::items_after_test_module)]
fn free_space(directory: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{core::PCWSTR, Win32::Storage::FileSystem::GetDiskFreeSpaceExW};
    let path: Vec<u16> = directory.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut available = 0u64;
    // SAFETY: the NUL-terminated directory and output storage live through the call.
    unsafe { GetDiskFreeSpaceExW(PCWSTR(path.as_ptr()), Some(&mut available), None, None) }.ok()?;
    Some(available)
}
