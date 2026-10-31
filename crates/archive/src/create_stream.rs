//! The stream pieces one creation shares (Step 06e T6): a capped writer, the
//! progress meter, guarded source copies and the reader that verifies a
//! source after its last byte.

use std::cell::Cell;
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::rc::Rc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use fs_service::owned_io::{OwnedIoError, PinnedSource};
use fs_service::{CancellationToken, OpProgress};

use crate::create_plan::{CreateEntry, CreatePlan};
use crate::error::ArchiveError;
use crate::limits::{CHUNK_BYTES, MAX_SKIPPED_REPORT};
use crate::plan::SkippedEntry;

/// The skipped list and counts a writer fills, bounded like a report.
pub(crate) struct WriteOutcome {
    pub files: u64,
    pub folders: u64,
    pub skipped: Vec<SkippedEntry>,
    pub skipped_more: u64,
}

impl WriteOutcome {
    pub(crate) fn from_plan(plan: &CreatePlan) -> Self {
        let listed = plan.skipped.len().min(MAX_SKIPPED_REPORT);
        Self {
            files: 0,
            folders: 0,
            skipped: plan.skipped[..listed].to_vec(),
            skipped_more: (plan.skipped.len() - listed) as u64 + plan.skipped_more,
        }
    }

    pub(crate) fn skip(&mut self, path: &str, reason: &str) {
        if self.skipped.len() < MAX_SKIPPED_REPORT {
            self.skipped.push(SkippedEntry {
                path: path.to_string(),
                reason: reason.to_string(),
            });
        } else {
            self.skipped_more += 1;
        }
    }
}

const PROGRESS_EVERY: Duration = Duration::from_millis(100);

/// Counts the bytes written to the spool and stops at the cap.
pub(crate) struct CountingWriter<'a> {
    inner: &'a mut File,
    written: Rc<Cell<u64>>,
    cap: u64,
    oversize: Rc<Cell<bool>>,
}

impl<'a> CountingWriter<'a> {
    pub(crate) fn new(
        inner: &'a mut File,
        cap: u64,
        written: Rc<Cell<u64>>,
        oversize: Rc<Cell<bool>>,
    ) -> Self {
        Self {
            inner,
            written,
            cap,
            oversize,
        }
    }
}

impl Write for CountingWriter<'_> {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        let total = self.written.get().saturating_add(buffer.len() as u64);
        if total > self.cap {
            self.oversize.set(true);
            return Err(io::Error::other("the archive exceeds the output cap"));
        }
        let written = self.inner.write(buffer)?;
        self.written.set(self.written.get() + written as u64);
        Ok(written)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

impl Seek for CountingWriter<'_> {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        self.inner.seek(position)
    }
}

/// Progress for one plan, reported at most every 100 ms.
pub(crate) struct BuildProgress<'a> {
    items_total: usize,
    items_done: usize,
    bytes_total: u64,
    bytes_done: u64,
    last: Instant,
    sink: &'a mut dyn FnMut(&OpProgress),
}

impl<'a> BuildProgress<'a> {
    pub(crate) fn new(
        items_total: usize,
        bytes_total: u64,
        sink: &'a mut dyn FnMut(&OpProgress),
    ) -> Self {
        Self {
            items_total,
            items_done: 0,
            bytes_total,
            bytes_done: 0,
            last: Instant::now(),
            sink,
        }
    }

    pub(crate) fn bytes(&mut self, read: usize, current: &str) {
        self.bytes_done = self.bytes_done.saturating_add(read as u64);
        self.note(current, false);
    }

    pub(crate) fn item(&mut self, current: &str) {
        self.items_done += 1;
        self.note(current, true);
    }

    fn note(&mut self, current: &str, force: bool) {
        if !force && self.last.elapsed() < PROGRESS_EVERY {
            return;
        }
        self.last = Instant::now();
        (self.sink)(&OpProgress {
            items_done: self.items_done,
            items_total: self.items_total,
            bytes_done: self.bytes_done,
            bytes_total: self.bytes_total,
            current: current.to_string(),
        });
    }
}

/// Which skip reason an entry gets when its source cannot be opened.
pub(crate) fn open_reason(error: &OwnedIoError) -> &'static str {
    match error {
        OwnedIoError::SourceChanged => "source_changed",
        OwnedIoError::ReparseRefused => "link_entry",
        OwnedIoError::Io(io) if io.kind() == io::ErrorKind::PermissionDenied => "access_denied",
        _ => "other",
    }
}

/// Open the enumerated source with a read guard, or say why not.
pub(crate) fn open_source(entry: &CreateEntry) -> Result<PinnedSource, &'static str> {
    let Some(identity) = entry.identity else {
        return Err("source_changed");
    };
    PinnedSource::open(&entry.source, &identity).map_err(|error| open_reason(&error))
}

/// Read one guarded source into `out`. A change during the read aborts the
/// unpublished output: a half-read file is never written into an archive.
pub(crate) fn copy_source(
    mut source: PinnedSource,
    expected: u64,
    out: &mut dyn Write,
    token: &CancellationToken,
    on_bytes: &mut dyn FnMut(usize),
) -> Result<(), ArchiveError> {
    let mut buffer = vec![0u8; CHUNK_BYTES];
    let mut total = 0u64;
    loop {
        if token.load(Ordering::Relaxed) {
            return Err(ArchiveError::Cancelled);
        }
        let read = match source.file_mut().read(&mut buffer) {
            Ok(read) => read,
            Err(_) => return Err(ArchiveError::SourceChanged),
        };
        if read == 0 {
            break;
        }
        total = total.saturating_add(read as u64);
        if total > expected {
            return Err(ArchiveError::SourceChanged);
        }
        crate::list::note_activity(read);
        out.write_all(&buffer[..read])
            .map_err(|_| ArchiveError::OutputChanged)?;
        on_bytes(read);
    }
    if total != expected {
        return Err(ArchiveError::SourceChanged);
    }
    source
        .verify_after_read()
        .map_err(|_| ArchiveError::SourceChanged)?;
    Ok(())
}

/// What stopped a guarded read inside the 7z writer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SourceFailure {
    Cancelled,
    Changed,
}

/// A reader the 7z writer pulls a file through; it checks the token per
/// chunk and verifies the source at the end.
pub(crate) struct GuardedReader<'a> {
    source: PinnedSource,
    expected: u64,
    total: u64,
    token: &'a CancellationToken,
    on_read: &'a mut dyn FnMut(usize),
    failure: &'a Cell<Option<SourceFailure>>,
}

impl<'a> GuardedReader<'a> {
    pub(crate) fn new(
        source: PinnedSource,
        expected: u64,
        token: &'a CancellationToken,
        on_read: &'a mut dyn FnMut(usize),
        failure: &'a Cell<Option<SourceFailure>>,
    ) -> Self {
        Self {
            source,
            expected,
            total: 0,
            token,
            on_read,
            failure,
        }
    }
}

impl Read for GuardedReader<'_> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if self.token.load(Ordering::Relaxed) {
            self.failure.set(Some(SourceFailure::Cancelled));
            return Err(io::Error::from(io::ErrorKind::Interrupted));
        }
        let read = self.source.file_mut().read(buffer)?;
        if read == 0 {
            if self.total != self.expected || self.source.verify_after_read().is_err() {
                self.failure.set(Some(SourceFailure::Changed));
                return Err(io::Error::other("the source changed"));
            }
            return Ok(0);
        }
        self.total = self.total.saturating_add(read as u64);
        if self.total > self.expected {
            self.failure.set(Some(SourceFailure::Changed));
            return Err(io::Error::other("the source changed"));
        }
        crate::list::note_activity(read);
        (self.on_read)(read);
        Ok(read)
    }
}
