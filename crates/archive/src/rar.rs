//! The read-only RAR adapter (Step 06e T7). 7-Zip only lists and streams;
//! Rust alone creates every output file, through owned staging. Printed names
//! are candidates, never identities: each is selected again literally before
//! one byte is written.

use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::Ordering;

use fs_service::owned_io::{PinnedSource, SourceIdentity};
use fs_service::CancellationToken;
use serde::{Deserialize, Serialize};

use crate::entry::{ArchiveFormat, EntryKind, Listing};
use crate::error::ArchiveError;
use crate::limits::Limits;
use crate::path::{name_of, normalize_inner_path};
use crate::rar_listing::MAX_RAR_LIST_BYTES;
pub use crate::rar_listing::{parse_listing, RarListing, RarRecord};
use crate::rar_process::{Captured, InstalledSevenZip, SevenZipRunner};
use crate::read_options::ArchiveReadOptions;

/// What the app may say about the installed tool. Never its raw path.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RarToolStatus {
    pub available: bool,
    pub version: Option<String>,
}

/// Ask the installed tool for its version through a bounded hidden child.
pub fn rar_status(runner: &dyn SevenZipRunner) -> RarToolStatus {
    match runner.probe() {
        Ok(version) => RarToolStatus {
            available: true,
            version: Some(version),
        },
        Err(_) => RarToolStatus::default(),
    }
}

/// The runner the app uses: a separately installed 7-Zip only.
pub fn runner(options: &ArchiveReadOptions) -> Result<InstalledSevenZip, ArchiveError> {
    match &options.seven_zip {
        Some(path) => Ok(InstalledSevenZip::at(path)),
        None => InstalledSevenZip::discover(),
    }
}

/// List a RAR archive and keep the printed records that back every entry.
pub fn list_rar(
    path: &Path,
    limits: &Limits,
    token: &CancellationToken,
    options: &ArchiveReadOptions,
    runner: &dyn SevenZipRunner,
) -> Result<Listing, ArchiveError> {
    Ok(rar_records(path, limits, token, options, runner)?.0)
}

pub(crate) fn rar_records(
    path: &Path,
    limits: &Limits,
    token: &CancellationToken,
    options: &ArchiveReadOptions,
    runner: &dyn SevenZipRunner,
) -> Result<(Listing, Vec<RarRecord>), ArchiveError> {
    require_tool(runner)?;
    let guard = guard_archive(path)?;
    let args = list_args(path);
    let captured = runner.capture(
        &args,
        options.password.as_deref().map(str::as_bytes),
        MAX_RAR_LIST_BYTES.saturating_add(1),
    )?;
    if captured.timed_out {
        return Err(ArchiveError::SevenZipUnsupported);
    }
    if !captured.success {
        return Err(map_diagnostic(&captured.stderr));
    }
    if captured.stdout.len() > MAX_RAR_LIST_BYTES {
        return Err(ArchiveError::AmbiguousRar);
    }
    let parsed = parse_listing(&captured.stdout)?;
    if parsed.multi_volume {
        return Err(ArchiveError::MultiVolume);
    }
    // Every name must be a normal Windows path; nothing is repaired.
    let mut seen: HashSet<String> = HashSet::new();
    let mut records = Vec::with_capacity(parsed.records.len());
    let mut collector = crate::list::Collector::new(limits);
    for (index, record) in parsed.records.iter().enumerate() {
        if token.load(Ordering::Relaxed) {
            return Err(ArchiveError::Cancelled);
        }
        if record.is_link || record.is_stream {
            return Err(ArchiveError::AmbiguousRar);
        }
        let Ok(normalized) = normalize_inner_path(&record.path, limits) else {
            return Err(ArchiveError::AmbiguousRar);
        };
        if !seen.insert(normalized.to_lowercase()) {
            return Err(ArchiveError::AmbiguousRar);
        }
        let kind = if record.is_folder {
            EntryKind::Folder
        } else {
            EntryKind::File
        };
        collector.add(
            index as u32,
            &record.path,
            kind,
            record.size,
            record.packed_size,
            record.modified_unix,
            record.encrypted,
        )?;
        records.push(record.clone());
    }
    guard
        .verify_after_read()
        .map_err(|_| ArchiveError::SourceChanged)?;
    Ok((collector.finish(ArchiveFormat::Rar, false), records))
}

/// The exact literal selection that proves one candidate still names the
/// same single regular entry before any output exists.
pub fn verify_candidate(
    path: &Path,
    record: &RarRecord,
    options: &ArchiveReadOptions,
    runner: &dyn SevenZipRunner,
) -> Result<(), ArchiveError> {
    let guard = guard_archive(path)?;
    let args = vector_args(path, record, true);
    let captured = runner.capture(
        &args,
        options.password.as_deref().map(str::as_bytes),
        MAX_RAR_LIST_BYTES.saturating_add(1),
    )?;
    if captured.timed_out || !captured.success {
        return Err(map_diagnostic(&captured.stderr));
    }
    let parsed = parse_listing(&captured.stdout)?;
    if parsed.multi_volume || parsed.records.len() != 1 {
        return Err(ArchiveError::AmbiguousRar);
    }
    let found = &parsed.records[0];
    let same = found.path == record.path
        && found.size == record.size
        && found.encrypted == record.encrypted
        && found.is_folder == record.is_folder
        && !found.is_link
        && !found.is_stream;
    if !same {
        return Err(ArchiveError::AmbiguousRar);
    }
    guard
        .verify_after_read()
        .map_err(|_| ArchiveError::SourceChanged)?;
    Ok(())
}

/// Stream exactly the verified file into `out`, counting every stdout byte
/// against the declared size. Nothing is published by this function.
pub fn extract_rar_file(
    path: &Path,
    record: &RarRecord,
    options: &ArchiveReadOptions,
    runner: &dyn SevenZipRunner,
    token: &CancellationToken,
    out: &mut dyn std::io::Write,
) -> Result<u64, ArchiveError> {
    verify_candidate(path, record, options, runner)?;
    let guard = guard_archive(path)?;
    let args = extract_args(path, record);
    let mut sink_error: Option<ArchiveError> = None;
    let streamed = runner.stream(
        &args,
        options.password.as_deref().map(str::as_bytes),
        record.size.saturating_add(1),
        &mut |chunk| {
            if token.load(Ordering::Relaxed) {
                sink_error = Some(ArchiveError::Cancelled);
                return Err(ArchiveError::Cancelled);
            }
            out.write_all(chunk)
                .map_err(|_| ArchiveError::OutputChanged)?;
            Ok(())
        },
    )?;
    if let Some(error) = sink_error {
        return Err(error);
    }
    if streamed.timed_out {
        return Err(ArchiveError::SevenZipUnsupported);
    }
    if !streamed.success {
        return Err(ArchiveError::Corrupt);
    }
    if streamed.written != record.size {
        return Err(ArchiveError::OutputChanged);
    }
    guard
        .verify_after_read()
        .map_err(|_| ArchiveError::SourceChanged)?;
    Ok(streamed.written)
}

fn require_tool(runner: &dyn SevenZipRunner) -> Result<String, ArchiveError> {
    match runner.probe() {
        Ok(version) => Ok(version),
        Err(ArchiveError::SevenZipMissing) => Err(ArchiveError::SevenZipMissing),
        Err(_) => Err(ArchiveError::SevenZipUnsupported),
    }
}

fn guard_archive(path: &Path) -> Result<PinnedSource, ArchiveError> {
    let identity = SourceIdentity::capture(path).map_err(|_| ArchiveError::NotFound)?;
    PinnedSource::open(path, &identity).map_err(|_| ArchiveError::Changed)
}

fn list_args(path: &Path) -> Vec<String> {
    vec![
        "l".to_string(),
        "-slt".to_string(),
        "-sccUTF-8".to_string(),
        "-bd".to_string(),
        "--".to_string(),
        path.to_string_lossy().into_owned(),
    ]
}

/// The literal second listing and the streamed extraction share these flags.
fn literal_args() -> Vec<&'static str> {
    vec!["-sccUTF-8", "-bd", "-spd", "-ssc", "-r-"]
}

fn vector_args(path: &Path, record: &RarRecord, listing: bool) -> Vec<String> {
    let mut args = vec![if listing { "l" } else { "e" }.to_string()];
    if listing {
        args.push("-slt".to_string());
    } else {
        args.push("-so".to_string());
    }
    args.extend(literal_args().iter().map(|arg| arg.to_string()));
    args.push("--".to_string());
    args.push(path.to_string_lossy().into_owned());
    args.push(record.path.clone());
    args
}

fn extract_args(path: &Path, record: &RarRecord) -> Vec<String> {
    vector_args(path, record, false)
}

/// Diagnostics are only used to choose a code; their text is never returned.
fn map_diagnostic(stderr: &[u8]) -> ArchiveError {
    let text = String::from_utf8_lossy(stderr).to_lowercase();
    if text.contains("wrong password") || text.contains("password") {
        ArchiveError::BadPassword
    } else if text.contains("volume") {
        ArchiveError::MultiVolume
    } else if text.contains("data error") || text.contains("crc") {
        ArchiveError::Corrupt
    } else {
        ArchiveError::SevenZipUnsupported
    }
}

/// The newest printed name of an entry, for a message without its path.
pub fn display_name(record: &RarRecord) -> String {
    let slashed = record.path.replace('\\', "/");
    name_of(&slashed).to_string()
}

/// The captured output shape, re-exported for the command layer's tests.
pub type RarCaptured = Captured;
