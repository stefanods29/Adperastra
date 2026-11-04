//! Extracting an archive (Step 06d D5 to D10): plan first, refuse a bomb or
//! a full disk before writing, then write every file through
//! `write::write_entry`, so nothing is ever replaced and a cancelled run
//! leaves no partial file.

use crate::entry::ArchiveFormat;
use crate::error::ArchiveError;
use crate::limits::{check_space, free_bytes, Limits, CHUNK_BYTES, MAX_SKIPPED_REPORT};
use crate::list::{list, note_activity, ActivityReader};
use crate::plan::{
    plan_extract, top_level_names, ArchiveFacts, ExtractPlan, ExtractRequest, PlannedEntry,
    SkippedEntry,
};
use crate::write::{write_entry, WriteFailure};
use fs_service::{CancellationToken, OpProgress};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant, UNIX_EPOCH};

/// How often progress is reported at most while extracting.
const PROGRESS_EVERY: Duration = Duration::from_millis(100);

/// What one extraction did.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ExtractReport {
    /// The top-level items this run made (or the new folder), as paths.
    pub created: Vec<String>,
    pub files_written: u64,
    pub folders_created: u64,
    pub skipped: Vec<SkippedEntry>,
    /// Skips not listed because `skipped` is full.
    pub skipped_more: u64,
    pub cancelled: bool,
    /// The written file in `single_file` (open) mode.
    pub opened: Option<String>,
    /// Filled by the app when the helper failed after creating items.
    pub error: Option<String>,
}

/// Where an extraction reports progress and the items it created.
pub trait ExtractEvents {
    fn progress(&mut self, progress: &OpProgress);
    fn created(&mut self, path: &Path);
}

/// Read the archive with a plan and write what it holds into the request's
/// destination. Nothing is written before every check has passed.
pub fn extract(
    path: &Path,
    request: &ExtractRequest,
    limits: &Limits,
    token: &CancellationToken,
    events: &mut dyn ExtractEvents,
) -> Result<ExtractReport, ArchiveError> {
    let facts = facts_of(path)?;
    let listing = list(path, limits, token, &mut |_| {})?;
    let plan = plan_extract(&listing, request, facts, limits)?;
    let dest = std::fs::canonicalize(&request.dest_dir).map_err(|_| ArchiveError::DestMissing)?;
    if !dest.is_dir() {
        return Err(ArchiveError::DestMissing);
    }
    check_space(plan.bytes_total, free_bytes(&dest), limits)?;

    // What the plan left out (unsafe names, links, passwords) is reported too.
    let listed = plan.skipped.len().min(MAX_SKIPPED_REPORT);
    let mut report = ExtractReport {
        skipped: plan.skipped[..listed].to_vec(),
        skipped_more: (plan.skipped.len() - listed) as u64,
        ..ExtractReport::default()
    };
    let mut names: Vec<(String, String)> = Vec::new();
    let root = match &request.new_folder {
        Some(name) => {
            if fs_service::validate_new_name(name).is_err() {
                return Err(ArchiveError::BadRequest);
            }
            let mut target = fs_service::unique_destination(&dest, name);
            match fs::create_dir(&target) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    // Someone made the same folder in the meantime: the next
                    // free name is used instead of failing.
                    target = fs_service::unique_destination(&dest, name);
                    fs::create_dir(&target).map_err(folder_error)?;
                }
                Err(error) => return Err(folder_error(error)),
            }
            report.created.push(target.to_string_lossy().into_owned());
            events.created(&target);
            target
        }
        None => {
            names = top_level_names(&plan, &dest);
            dest.clone()
        }
    };

    let mut extractor = Extractor {
        root: root.clone(),
        names,
        report,
        events,
        token,
        zone: request.zone.clone(),
        single_file: request.single_file,
        report_top: request.new_folder.is_none(),
        items_total: plan.files.len(),
        items_done: 0,
        bytes_done: 0,
        bytes_total: plan.bytes_total,
        last_progress: Instant::now(),
    };

    for folder in &plan.folders {
        if token.load(Ordering::Relaxed) {
            extractor.cancel();
            break;
        }
        let target = extractor.map(&folder.relative);
        match fs::create_dir_all(&target) {
            Ok(()) => {
                extractor.report.folders_created += 1;
                extractor.items_done += 1;
                extractor.note_created(&target);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                extractor.skip(folder.inner.clone(), "name_taken");
            }
            Err(error) => extractor.skip(folder.inner.clone(), folder_reason(&error)),
        }
    }

    if !extractor.report.cancelled {
        let format = listing.format;
        match format {
            ArchiveFormat::Zip => extract_zip(path, &plan, &mut extractor)?,
            ArchiveFormat::SevenZ => extract_7z(path, &plan, &mut extractor, limits)?,
            ArchiveFormat::Tar | ArchiveFormat::TarGz | ArchiveFormat::TarXz => {
                extract_tar(path, format, &plan, &mut extractor, limits)?
            }
            ArchiveFormat::Gz | ArchiveFormat::Xz => {
                extract_stream(path, format, &plan, &mut extractor, limits)?
            }
            // These formats always take the owned route above.
            ArchiveFormat::Bz2 | ArchiveFormat::TarBz2 | ArchiveFormat::Rar => {
                return Err(ArchiveError::Unsupported)
            }
        }
    }
    if token.load(Ordering::Relaxed) {
        extractor.cancel();
    }
    extractor.progress(&root, true);
    Ok(extractor.finish())
}

/// Extract with read options (Step 06e). Bzip2, RAR and password-protected
/// work use the owned safe route; ordinary unencrypted extraction keeps the
/// old one exactly as it was (KI-079).
pub fn extract_with_options(
    path: &Path,
    request: &ExtractRequest,
    limits: &Limits,
    token: &CancellationToken,
    events: &mut dyn ExtractEvents,
    options: &crate::read_options::ArchiveReadOptions,
) -> Result<ExtractReport, ArchiveError> {
    let format = crate::format::detect_format(path)?;
    if options.password.is_none() && matches!(format, ArchiveFormat::Zip | ArchiveFormat::SevenZ) {
        let listing = crate::list::list_with_options(path, limits, token, &mut |_| {}, options)?;
        if crate::secure_extract::has_selected_encrypted(&listing, request) {
            return Err(ArchiveError::PasswordRequired);
        }
    }
    if crate::secure_extract::needs_secure_route(format, options) {
        crate::secure_extract::extract_with_options(path, request, limits, token, events, options)
    } else {
        extract(path, request, limits, token, events)
    }
}

fn facts_of(path: &Path) -> Result<ArchiveFacts, ArchiveError> {
    let metadata = std::fs::metadata(path)?;
    let modified_unix = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|age| age.as_secs())
        .unwrap_or(0);
    Ok(ArchiveFacts {
        size: metadata.len(),
        modified_unix,
    })
}

fn folder_error(error: std::io::Error) -> ArchiveError {
    if error.kind() == std::io::ErrorKind::PermissionDenied {
        ArchiveError::AccessDenied
    } else {
        ArchiveError::from(error)
    }
}

fn folder_reason(error: &std::io::Error) -> &'static str {
    if error.kind() == std::io::ErrorKind::PermissionDenied {
        "access_denied"
    } else {
        "other"
    }
}

/// The state one extraction carries from file to file.
struct Extractor<'a> {
    root: PathBuf,
    /// Top-level name as planned, and the name it really gets.
    names: Vec<(String, String)>,
    report: ExtractReport,
    events: &'a mut dyn ExtractEvents,
    token: &'a CancellationToken,
    zone: Option<String>,
    single_file: bool,
    /// True without a new folder: every top-level item is reported.
    report_top: bool,
    items_total: usize,
    items_done: usize,
    bytes_done: u64,
    bytes_total: u64,
    last_progress: Instant,
}

impl Extractor<'_> {
    /// Where a planned relative path lands on disk.
    fn map(&self, relative: &[String]) -> PathBuf {
        let mut path = self.root.clone();
        for (position, part) in relative.iter().enumerate() {
            if position == 0 {
                let actual = self
                    .names
                    .iter()
                    .find(|(name, _)| name.eq_ignore_ascii_case(part))
                    .map(|(_, actual)| actual.clone());
                path.push(actual.unwrap_or_else(|| part.clone()));
            } else {
                path.push(part);
            }
        }
        path
    }

    /// Report the top-level item a path belongs to, once.
    fn note_created(&mut self, target: &Path) {
        if !self.report_top {
            return;
        }
        let Ok(rest) = target.strip_prefix(&self.root) else {
            return;
        };
        let Some(first) = rest.components().next() else {
            return;
        };
        let top = self.root.join(first.as_os_str());
        let text = top.to_string_lossy().into_owned();
        if self
            .report
            .created
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(&text))
        {
            return;
        }
        self.report.created.push(text);
        self.events.created(&top);
    }

    fn skip(&mut self, path: String, reason: &str) {
        self.items_done += 1;
        if self.report.skipped.len() < MAX_SKIPPED_REPORT {
            self.report.skipped.push(SkippedEntry {
                path,
                reason: reason.to_string(),
            });
        } else {
            self.report.skipped_more += 1;
        }
    }

    fn cancel(&mut self) {
        self.report.cancelled = true;
    }

    fn progress(&mut self, current: &Path, force: bool) {
        if !force && self.last_progress.elapsed() < PROGRESS_EVERY {
            return;
        }
        self.last_progress = Instant::now();
        self.events.progress(&OpProgress {
            items_done: self.items_done,
            items_total: self.items_total,
            bytes_done: self.bytes_done,
            bytes_total: self.bytes_total,
            current: current.to_string_lossy().into_owned(),
        });
    }

    /// Write one planned file from its reader.
    fn write_file(
        &mut self,
        planned: &PlannedEntry,
        reader: &mut dyn Read,
    ) -> Result<(), ArchiveError> {
        if self.token.load(Ordering::Relaxed) {
            self.cancel();
            return Err(ArchiveError::Cancelled);
        }
        let target = self.map(&planned.relative);
        self.progress(&target, false);
        let started = self.bytes_done;
        let zone = self.zone.clone();
        let token = self.token;
        let result = write_entry(
            &target,
            reader,
            planned.size,
            planned.modified_unix,
            zone.as_deref(),
            token,
            &mut |read| {
                self.bytes_done += read;
                self.progress(&target, false);
            },
        );
        self.bytes_done = started;
        match result {
            Ok(()) => {
                self.report.files_written += 1;
                self.items_done += 1;
                self.bytes_done += planned.size;
                if self.single_file {
                    self.report.opened = Some(target.to_string_lossy().into_owned());
                }
                self.note_created(&target);
                self.progress(&target, false);
                Ok(())
            }
            Err(WriteFailure::Cancelled) => {
                self.cancel();
                Err(ArchiveError::Cancelled)
            }
            Err(WriteFailure::Skip(reason)) => {
                self.skip(planned.inner.clone(), reason);
                self.progress(&target, false);
                Ok(())
            }
        }
    }

    fn finish(mut self) -> ExtractReport {
        std::mem::take(&mut self.report)
    }
}

/// Follow one file write's result inside a format loop.
macro_rules! keep_going {
    ($result:expr) => {
        match $result {
            Ok(()) => {}
            Err(ArchiveError::Cancelled) => return Ok(()),
            Err(error) => return Err(error),
        }
    };
}

fn extract_zip(
    path: &Path,
    plan: &ExtractPlan,
    extractor: &mut Extractor<'_>,
) -> Result<(), ArchiveError> {
    let file = fs::File::open(path)?;
    let mut archive =
        zip::ZipArchive::new(BufReader::new(file)).map_err(|_| ArchiveError::Corrupt)?;
    for planned in &plan.files {
        if extractor.token.load(Ordering::Relaxed) {
            extractor.cancel();
            return Ok(());
        }
        let encrypted = archive
            .by_index_raw(planned.index as usize)
            .map(|entry| entry.encrypted())
            .unwrap_or(false);
        if encrypted {
            extractor.skip(planned.inner.clone(), "password_required");
            continue;
        }
        let mut entry = match archive.by_index(planned.index as usize) {
            Ok(entry) => entry,
            Err(zip::result::ZipError::UnsupportedArchive(reason))
                if reason == zip::result::ZipError::PASSWORD_REQUIRED =>
            {
                extractor.skip(planned.inner.clone(), "password_required");
                continue;
            }
            Err(zip::result::ZipError::InvalidPassword) => {
                extractor.skip(planned.inner.clone(), "password_required");
                continue;
            }
            Err(zip::result::ZipError::UnsupportedArchive(_))
            | Err(zip::result::ZipError::CompressionMethodNotSupported(_)) => {
                extractor.skip(planned.inner.clone(), "unsupported_method");
                continue;
            }
            Err(_) => {
                extractor.skip(planned.inner.clone(), "damaged");
                continue;
            }
        };
        keep_going!(extractor.write_file(planned, &mut entry));
    }
    Ok(())
}

fn extract_7z(
    path: &Path,
    plan: &ExtractPlan,
    extractor: &mut Extractor<'_>,
    limits: &Limits,
) -> Result<(), ArchiveError> {
    let file = fs::File::open(path)?;
    let mut reader =
        sevenz_rust2::ArchiveReader::new(BufReader::new(file), sevenz_rust2::Password::empty())
            .map_err(map_7z_error)?;
    let mut pending: HashMap<String, VecDeque<usize>> = HashMap::new();
    for (position, planned) in plan.files.iter().enumerate() {
        pending
            .entry(planned.inner.clone())
            .or_default()
            .push_back(position);
    }
    let mut seen = vec![false; plan.files.len()];
    let mut failure: Option<ArchiveError> = None;
    let run = {
        let token = extractor.token;
        let mut closure = |entry: &sevenz_rust2::ArchiveEntry, data: &mut dyn Read| {
            if token.load(Ordering::Relaxed) {
                extractor.cancel();
                return Ok(false);
            }
            // Every entry's data is read, even the ones not planned: a solid
            // archive cannot skip ahead (plan/pitfalls.md, Step 06d traps).
            let wanted = crate::path::normalize_inner_path(entry.name(), limits)
                .ok()
                .and_then(|path| pending.get_mut(&path).and_then(|queue| queue.pop_front()));
            let Some(position) = wanted else {
                return drain(data, token);
            };
            seen[position] = true;
            match extractor.write_file(&plan.files[position], data) {
                Ok(()) => Ok(true),
                Err(ArchiveError::Cancelled) => {
                    extractor.cancel();
                    Ok(false)
                }
                Err(error) => {
                    failure = Some(error);
                    Ok(false)
                }
            }
        };
        reader.for_each_entries(&mut closure)
    };
    if let Some(error) = failure {
        return Err(error);
    }
    if let Err(error) = run {
        let reason = match error {
            sevenz_rust2::Error::PasswordRequired | sevenz_rust2::Error::MaybeBadPassword(_) => {
                "password_required"
            }
            sevenz_rust2::Error::UnsupportedCompressionMethod(_)
            | sevenz_rust2::Error::Unsupported(_)
            | sevenz_rust2::Error::ExternalUnsupported => "unsupported_method",
            _ => "damaged",
        };
        skip_unseen(plan, extractor, &seen, reason);
        return Ok(());
    }
    skip_unseen(plan, extractor, &seen, "damaged");
    Ok(())
}

fn skip_unseen(plan: &ExtractPlan, extractor: &mut Extractor<'_>, seen: &[bool], reason: &str) {
    if extractor.report.cancelled {
        return;
    }
    for (position, planned) in plan.files.iter().enumerate() {
        if !seen[position] {
            extractor.skip(planned.inner.clone(), reason);
        }
    }
}

/// Read an entry nobody wants to the end, checking the token per piece.
fn drain(data: &mut dyn Read, token: &CancellationToken) -> Result<bool, sevenz_rust2::Error> {
    let mut sink = vec![0u8; CHUNK_BYTES];
    loop {
        if token.load(Ordering::Relaxed) {
            return Ok(false);
        }
        match data.read(&mut sink) {
            Ok(0) => return Ok(true),
            Ok(read) => note_activity(read),
            Err(error) => return Err(sevenz_rust2::Error::from(error)),
        }
    }
}

fn extract_tar(
    path: &Path,
    format: ArchiveFormat,
    plan: &ExtractPlan,
    extractor: &mut Extractor<'_>,
    limits: &Limits,
) -> Result<(), ArchiveError> {
    let file = fs::File::open(path)?;
    let reader: Box<dyn Read> = match format {
        ArchiveFormat::TarGz => Box::new(flate2::read::MultiGzDecoder::new(BufReader::new(file))),
        ArchiveFormat::TarXz => Box::new(lzma_rust2::XzReader::new_mem_limit(
            BufReader::new(file),
            true,
            limits.xz_memory_kb,
        )),
        _ => Box::new(file),
    };
    // Moving past an entry nobody wants reads it too.
    let mut archive = tar::Archive::new(ActivityReader(reader));
    let planned_by_index: HashMap<u32, usize> = plan
        .files
        .iter()
        .enumerate()
        .map(|(position, planned)| (planned.index, position))
        .collect();
    let mut seen = vec![false; plan.files.len()];
    let mut entries = match archive.entries() {
        Ok(entries) => entries,
        Err(_) => {
            skip_unseen(plan, extractor, &seen, "damaged");
            return Ok(());
        }
    };
    let mut position = 0u32;
    loop {
        if extractor.token.load(Ordering::Relaxed) {
            extractor.cancel();
            return Ok(());
        }
        let mut entry = match entries.next() {
            None => break,
            Some(Ok(entry)) => entry,
            Some(Err(_)) => {
                skip_unseen(plan, extractor, &seen, "damaged");
                return Ok(());
            }
        };
        if let Some(&planned) = planned_by_index.get(&position) {
            seen[planned] = true;
            // Never the tar crate's own unpack: every file goes through the
            // safe writer.
            keep_going!(extractor.write_file(&plan.files[planned], &mut entry));
        }
        position = position.wrapping_add(1);
    }
    skip_unseen(plan, extractor, &seen, "damaged");
    Ok(())
}

fn extract_stream(
    path: &Path,
    format: ArchiveFormat,
    plan: &ExtractPlan,
    extractor: &mut Extractor<'_>,
    limits: &Limits,
) -> Result<(), ArchiveError> {
    let Some(planned) = plan.files.first() else {
        return Ok(());
    };
    let file = fs::File::open(path)?;
    let mut decoder: Box<dyn Read> = match format {
        ArchiveFormat::Gz => Box::new(flate2::read::MultiGzDecoder::new(BufReader::new(file))),
        _ => Box::new(lzma_rust2::XzReader::new_mem_limit(
            BufReader::new(file),
            true,
            limits.xz_memory_kb,
        )),
    };
    keep_going!(extractor.write_file(planned, &mut decoder));
    Ok(())
}

fn map_7z_error(error: sevenz_rust2::Error) -> ArchiveError {
    match error {
        sevenz_rust2::Error::PasswordRequired | sevenz_rust2::Error::MaybeBadPassword(_) => {
            ArchiveError::PasswordRequired
        }
        sevenz_rust2::Error::Unsupported(_)
        | sevenz_rust2::Error::UnsupportedCompressionMethod(_)
        | sevenz_rust2::Error::UnsupportedVersion { .. }
        | sevenz_rust2::Error::ExternalUnsupported => ArchiveError::Unsupported,
        _ => ArchiveError::Corrupt,
    }
}
