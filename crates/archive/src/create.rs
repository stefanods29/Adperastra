//! Creating one archive in the app-owned spool (Step 06e T6). Nothing here
//! publishes a user-visible file: the spool is written, flushed, synced and
//! hashed, and the parent decides whether it is safe to publish.

use std::cell::Cell;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::rc::Rc;

use fs_service::owned_io::{OwnedIoError, OwnedOutput, PinnedDirectory};
use fs_service::{CancellationToken, OpProgress};

use crate::create_plan::CreatePlan;
use crate::create_stream::{BuildProgress, CountingWriter};
use crate::create_types::{CreateLimits, CreateOptions, CreateSpoolReport};
use crate::error::ArchiveError;

/// How many bytes are hashed at a time.
const HASH_CHUNK: usize = 65_536;

/// Write `plan` into the exact app-owned spool path. On success the spool
/// remains (the app's own file); on any failure or cancellation only this
/// owned staging file is disposed of.
pub fn create_spool(
    plan: &CreatePlan,
    options: &CreateOptions,
    spool: &Path,
    limits: &CreateLimits,
    token: &CancellationToken,
    progress: &mut dyn FnMut(&OpProgress),
) -> Result<CreateSpoolReport, ArchiveError> {
    options.validate()?;
    let parent = spool.parent().ok_or(ArchiveError::BadRequest)?;
    let name = spool
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(ArchiveError::BadRequest)?;
    let pinned = PinnedDirectory::open(parent).map_err(|error| match error {
        OwnedIoError::Io(io) => ArchiveError::from(io),
        _ => ArchiveError::OutputChanged,
    })?;
    let mut output = OwnedOutput::create_named(&pinned, name).map_err(|error| match error {
        OwnedIoError::Io(io) => ArchiveError::from(io),
        OwnedIoError::StagingTaken => ArchiveError::CreateBusy,
        _ => ArchiveError::OutputChanged,
    })?;

    let written = Rc::new(Cell::new(0u64));
    let oversize = Rc::new(Cell::new(false));
    let result = {
        let mut counting = CountingWriter::new(
            output.file_mut(),
            limits.max_output_bytes,
            Rc::clone(&written),
            Rc::clone(&oversize),
        );
        let mut build = BuildProgress::new(plan.entries.len(), plan.total_bytes, progress);
        match options.format {
            crate::create_types::CreateFormat::Zip => crate::create_zip::write_zip(
                &mut counting,
                plan,
                options,
                token,
                &mut build,
                limits,
            ),
            crate::create_types::CreateFormat::SevenZ => {
                crate::create_7z::write_7z(&mut counting, plan, options, token, &mut build, limits)
            }
        }
    };
    if oversize.get() {
        return Err(ArchiveError::CreateTooLarge);
    }
    let outcome = result?;
    output
        .flush_sync()
        .map_err(|_| ArchiveError::OutputChanged)?;
    let size = output
        .file_mut()
        .metadata()
        .map_err(|_| ArchiveError::OutputChanged)?
        .len();
    let hash = hash_spool(output.file_mut())?;
    output.keep();
    Ok(CreateSpoolReport {
        files_written: outcome.files,
        folders_written: outcome.folders,
        source_bytes: plan.total_bytes,
        archive_size: size,
        skipped: outcome.skipped,
        skipped_more: outcome.skipped_more,
        cancelled: false,
        size,
        blake3: hash,
    })
}

/// BLAKE3 over the spool through its own open handle, in bounded chunks.
fn hash_spool(file: &mut std::fs::File) -> Result<String, ArchiveError> {
    file.seek(SeekFrom::Start(0))
        .map_err(|_| ArchiveError::OutputChanged)?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = vec![0u8; HASH_CHUNK];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| ArchiveError::OutputChanged)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}
