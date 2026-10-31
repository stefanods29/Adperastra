//! Listing an archive (Step 06d T3): format detection, then one reader per
//! format. Every reader follows the same rules: the cancel token is checked
//! often, the entry limit is obeyed, and every raw name goes through
//! `is_root_entry` and `normalize_inner_path` before it is listed.

use crate::entry::{ArchiveEntry, ArchiveFormat, EntryKind, Listing};
use crate::error::ArchiveError;
use crate::limits::Limits;
use crate::path::{is_root_entry, name_of, normalize_inner_path};
use crate::read_7z::list_7z;
use crate::read_stream::list_stream;
use crate::read_tar::list_tar;
use crate::read_zip::list_zip;
use fs_service::{CancellationToken, OpProgress};
use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// How often progress is reported at most.
pub(crate) const PROGRESS_EVERY: Duration = Duration::from_millis(100);
/// How many entries pass between two cancel checks.
pub(crate) const CANCEL_CHECK_EVERY: u32 = 256;

/// Read everything the format says about an archive. `progress` is called
/// with the compressed bytes read so far, at most every 100 ms.
pub fn list(
    path: &Path,
    limits: &Limits,
    token: &CancellationToken,
    progress: &mut dyn FnMut(&OpProgress),
) -> Result<Listing, ArchiveError> {
    let format = crate::format::detect_format(path)?;
    let size = std::fs::metadata(path)?.len();
    let mut meter = ProgressMeter::new(size, progress);
    let (listing, done) = match format {
        ArchiveFormat::Zip => (list_zip(path, limits, token)?, size),
        ArchiveFormat::SevenZ => (list_7z(path, limits, token)?, size),
        ArchiveFormat::Tar | ArchiveFormat::TarGz | ArchiveFormat::TarXz => {
            let counter = Arc::new(AtomicU64::new(0));
            let file = File::open(path)?;
            let listing = match format {
                ArchiveFormat::Tar => list_tar(
                    file,
                    format,
                    true,
                    limits,
                    token,
                    Arc::clone(&counter),
                    &mut meter,
                )?,
                ArchiveFormat::TarGz => list_tar(
                    flate2::read::MultiGzDecoder::new(BufReader::new(file)),
                    format,
                    false,
                    limits,
                    token,
                    Arc::clone(&counter),
                    &mut meter,
                )?,
                _ => list_tar(
                    lzma_rust2::XzReader::new_mem_limit(
                        BufReader::new(file),
                        true,
                        limits.xz_memory_kb,
                    ),
                    format,
                    false,
                    limits,
                    token,
                    Arc::clone(&counter),
                    &mut meter,
                )?,
            };
            (listing, counter.load(Ordering::Relaxed))
        }
        ArchiveFormat::Gz | ArchiveFormat::Xz => (list_stream(path, format, limits, token)?, size),
    };
    meter.force(done);
    Ok(listing)
}

/// Reports progress for one listing, at most every 100 ms.
pub(crate) struct ProgressMeter<'a> {
    total: u64,
    last: Instant,
    sink: &'a mut dyn FnMut(&OpProgress),
}

impl<'a> ProgressMeter<'a> {
    pub(crate) fn new(total: u64, sink: &'a mut dyn FnMut(&OpProgress)) -> Self {
        Self {
            total,
            last: Instant::now(),
            sink,
        }
    }

    /// Report when the last report is old enough.
    pub(crate) fn maybe(&mut self, done: u64) {
        if self.last.elapsed() >= PROGRESS_EVERY {
            self.force(done);
        }
    }

    /// Report now.
    pub(crate) fn force(&mut self, done: u64) {
        self.last = Instant::now();
        (self.sink)(&OpProgress {
            items_done: 0,
            items_total: 0,
            bytes_done: done,
            bytes_total: self.total,
            current: String::new(),
        });
    }
}

/// Checks the cancel token at least every 256 entries.
pub(crate) struct CancelCheck {
    seen: u32,
}

impl CancelCheck {
    pub(crate) fn new() -> Self {
        Self { seen: 0 }
    }

    pub(crate) fn tick(&mut self, token: &CancellationToken) -> Result<(), ArchiveError> {
        if self.seen.is_multiple_of(CANCEL_CHECK_EVERY) && token.load(Ordering::Relaxed) {
            return Err(ArchiveError::Cancelled);
        }
        self.seen = self.seen.wrapping_add(1);
        Ok(())
    }
}

/// Gathers the entries every reader produces, applying the shared rules.
pub(crate) struct Collector<'a> {
    limits: &'a Limits,
    entries: Vec<ArchiveEntry>,
}

impl<'a> Collector<'a> {
    pub(crate) fn new(limits: &'a Limits) -> Self {
        Self {
            limits,
            entries: Vec::new(),
        }
    }

    /// Add one entry the reader yielded. `index` is the format's own
    /// position; root markers are left out (their index still counts).
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn add(
        &mut self,
        index: u32,
        raw: &str,
        kind: EntryKind,
        size: u64,
        packed_size: u64,
        modified_unix: u64,
        encrypted: bool,
    ) -> Result<(), ArchiveError> {
        if is_root_entry(raw) {
            return Ok(());
        }
        let (path, name, problem) = match normalize_inner_path(raw, self.limits) {
            Ok(path) => {
                let name = name_of(&path).to_string();
                (path, name, None)
            }
            Err(problem) => {
                let raw_path = raw.replace('\\', "/");
                let name = name_of(&raw_path).to_string();
                (raw_path, name, Some(problem.to_string()))
            }
        };
        self.entries.push(ArchiveEntry {
            index,
            path,
            name,
            kind,
            size,
            packed_size,
            modified_unix,
            encrypted,
            problem,
        });
        if self.entries.len() > self.limits.max_entries {
            return Err(ArchiveError::TooManyEntries);
        }
        Ok(())
    }

    pub(crate) fn finish(self, format: ArchiveFormat, partial: bool) -> Listing {
        Listing {
            format,
            entries: self.entries,
            partial,
        }
    }
}
