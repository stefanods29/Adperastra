//! The new extraction route (Step 06e D5, D11, D12): bzip2, password-protected
//! archives and RAR write only through owned staging below a pinned root.
//! Ordinary unencrypted extraction keeps its old route untouched (KI-079).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::UNIX_EPOCH;

use fs_service::owned_io::PinnedDirectory;
use fs_service::{CancellationToken, OpProgress};

use crate::entry::ArchiveFormat;
use crate::error::ArchiveError;
use crate::extract::{ExtractEvents, ExtractReport};
use crate::limits::{check_space, free_bytes, Limits};
use crate::list::list_with_options;
use crate::plan::{plan_extract_with_options, ArchiveFacts, ExtractRequest};
use crate::read_options::ArchiveReadOptions;
use crate::secure_extract_paths::{create_new_folder, SecureTree};
use crate::secure_extract_readers::{extract_files, SecureWriter};

/// How the internet mark reaches a new file. A test can supply one that
/// fails, which must stop publication instead of dropping the mark.
pub trait ZoneWriter {
    fn write(&self, target: &Path, zone: &str) -> std::io::Result<()>;
}

/// Writes the `Zone.Identifier` alternate stream and checks it back.
pub struct FileZoneWriter;

impl ZoneWriter for FileZoneWriter {
    fn write(&self, target: &Path, zone: &str) -> std::io::Result<()> {
        let mut stream = target.as_os_str().to_os_string();
        stream.push(":Zone.Identifier");
        let stream = PathBuf::from(stream);
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&stream)?;
        file.write_all(zone.as_bytes())?;
        file.flush()?;
        let written = fs::read(&stream)?;
        if written != zone.as_bytes() {
            return Err(std::io::Error::other("the internet mark did not survive"));
        }
        Ok(())
    }
}

/// Extract through the new safe route. Used for bzip2 now; password reads
/// and RAR join the same entry point.
pub fn extract_with_options(
    path: &Path,
    request: &ExtractRequest,
    limits: &Limits,
    token: &CancellationToken,
    events: &mut dyn ExtractEvents,
    options: &ArchiveReadOptions,
) -> Result<ExtractReport, ArchiveError> {
    extract_with_zone(
        path,
        request,
        limits,
        token,
        events,
        options,
        &FileZoneWriter,
    )
}

/// The same with the internet-mark writer supplied (tests use a failing one).
pub fn extract_with_zone(
    path: &Path,
    request: &ExtractRequest,
    limits: &Limits,
    token: &CancellationToken,
    events: &mut dyn ExtractEvents,
    options: &ArchiveReadOptions,
    zone_writer: &dyn ZoneWriter,
) -> Result<ExtractReport, ArchiveError> {
    let facts = facts_of(path)?;
    let listing = list_with_options(path, limits, token, &mut |_| {}, options)?;
    let allow_encrypted = options.password.is_some();
    let plan = plan_extract_with_options(&listing, request, facts, limits, allow_encrypted)?;
    let dest = fs::canonicalize(&request.dest_dir).map_err(|_| ArchiveError::DestMissing)?;
    if !dest.is_dir() {
        return Err(ArchiveError::DestMissing);
    }
    check_space(plan.bytes_total, free_bytes(&dest), limits)?;

    let (root_pin, new_folder) = match &request.new_folder {
        Some(name) => {
            if fs_service::validate_new_name(name).is_err() {
                return Err(ArchiveError::BadRequest);
            }
            let created = create_new_folder(&dest, name)?;
            let pin = PinnedDirectory::open(&created).map_err(|_| ArchiveError::DestMissing)?;
            (pin, Some(created))
        }
        None => {
            let pin = PinnedDirectory::open(&dest).map_err(|_| ArchiveError::DestMissing)?;
            (pin, None)
        }
    };

    let tree = SecureTree::prepare(root_pin, &plan)?;
    let mut writer = SecureWriter::new(
        tree,
        &plan,
        events,
        token,
        request.zone.clone(),
        zone_writer,
        request.single_file,
    );
    if let Some(folder) = new_folder {
        writer.note_created(&folder);
    }
    for folder in &plan.folders {
        if token.load(Ordering::Relaxed) {
            writer.cancel();
            break;
        }
        writer.create_folder(folder);
    }
    if !writer.cancelled() {
        extract_files(listing.format, path, &plan, &mut writer, limits)?;
    }
    if token.load(Ordering::Relaxed) {
        writer.cancel();
    }
    Ok(writer.finish())
}

/// True when this extraction must use the new route instead of the old one.
pub fn needs_secure_route(format: ArchiveFormat, options: &ArchiveReadOptions) -> bool {
    options.password.is_some()
        || matches!(
            format,
            ArchiveFormat::Bz2 | ArchiveFormat::TarBz2 | ArchiveFormat::Rar
        )
}

fn facts_of(path: &Path) -> Result<ArchiveFacts, ArchiveError> {
    let metadata = fs::metadata(path)?;
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

/// The progress a new extraction reports (same shape as the old one).
pub(crate) fn progress_of(
    items_done: usize,
    items_total: usize,
    bytes_done: u64,
    bytes_total: u64,
    current: &Path,
) -> OpProgress {
    OpProgress {
        items_done,
        items_total,
        bytes_done,
        bytes_total,
        current: current.to_string_lossy().into_owned(),
    }
}
