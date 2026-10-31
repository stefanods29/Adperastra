//! Listing a tar archive, plain or inside gzip or xz (Step 06d T3). The
//! stream is read once, in order; every byte that passes is counted so the
//! progress bar can say how far the compressed file has been read.

use crate::entry::{ArchiveFormat, EntryKind, Listing};
use crate::error::ArchiveError;
use crate::limits::Limits;
use crate::list::{CancelCheck, Collector, ProgressMeter};
use fs_service::CancellationToken;
use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// Counts every byte the decoder produces or reads.
pub(crate) struct CountingReader<R> {
    inner: R,
    counter: Arc<AtomicU64>,
}

impl<R: Read> Read for CountingReader<R> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        let read = self.inner.read(buffer)?;
        self.counter.fetch_add(read as u64, Ordering::Relaxed);
        Ok(read)
    }
}

/// List a tar stream. `packed` is true for a plain tar, where the packed
/// size of an entry is its size.
#[allow(clippy::too_many_arguments)]
pub(crate) fn list_tar<R: Read>(
    reader: R,
    format: ArchiveFormat,
    packed: bool,
    limits: &Limits,
    token: &CancellationToken,
    counter: Arc<AtomicU64>,
    meter: &mut ProgressMeter<'_>,
) -> Result<Listing, ArchiveError> {
    let counting = CountingReader {
        inner: reader,
        counter: Arc::clone(&counter),
    };
    let mut archive = tar::Archive::new(counting);
    let mut collector = Collector::new(limits);
    let mut cancel = CancelCheck::new();
    let mut partial = false;
    let mut entries = match archive.entries() {
        Ok(entries) => entries,
        Err(_) => return Ok(collector.finish(format, true)),
    };
    let mut index = 0u32;
    loop {
        cancel.tick(token)?;
        let entry = match entries.next() {
            None => break,
            Some(Ok(entry)) => entry,
            Some(Err(_)) => {
                partial = true;
                break;
            }
        };
        let raw = String::from_utf8_lossy(&entry.path_bytes()).into_owned();
        let header = entry.header();
        let kind = header.entry_type();
        let known = kind.is_file() || kind.is_dir() || kind.is_symlink() || kind.is_hard_link();
        let entry_kind = if kind.is_dir() {
            EntryKind::Folder
        } else if kind.is_symlink() || kind.is_hard_link() {
            EntryKind::Link
        } else {
            EntryKind::File
        };
        let size = entry.size();
        let modified = header.mtime().unwrap_or(0);
        if known {
            collector.add(
                index,
                &raw,
                entry_kind,
                size,
                if packed { size } else { 0 },
                modified,
                false,
            )?;
        }
        index = index.wrapping_add(1);
        meter.maybe(counter.load(Ordering::Relaxed));
    }
    Ok(collector.finish(format, partial))
}
