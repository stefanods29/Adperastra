//! Bounded BLAKE3 stages for duplicate review (Step 11c T4 D6).
//!
//! Stage 2 hashes `8-byte LE size + first 64 KiB + last 64 KiB` (or the
//! whole file once when it is at most 128 KiB). It is a filter, never proof
//! of equality. Stage 3 hashes the entire file through a `PinnedSource` in
//! 1 MiB chunks, checks cancellation, and revalidates the source stamp
//! before and after the read. A changed, busy or unreadable file is
//! excluded; it is never reported as a match.

use std::io::{Read, Seek, SeekFrom};

use fs_service::owned_io::{OwnedIoError, PinnedSource};
use fs_service::{capture_source_stamp, CancellationToken, SourceStamp};

use crate::duplicate_candidates::CandidateFile;

/// A stamp-keyed full-hash cache. The storage store implements this with a
/// separate 128 MiB allowance; a missing entry is always safe because stage
/// 3 recomputes the hash.
pub trait DuplicateHashCache {
    fn get(&self, key: &fs_service::FileIdentityKey, stamp: &SourceStamp) -> Option<[u8; 32]>;
    fn put(
        &mut self,
        key: &fs_service::FileIdentityKey,
        stamp: &SourceStamp,
        hash: &[u8; 32],
    );
}

pub const HEAD_TAIL_BYTES: usize = 64 * 1024;
pub const SMALL_FILE_BYTES: u64 = 128 * 1024;
pub const FULL_HASH_CHUNK: usize = 1024 * 1024;

fn map_owned(error: OwnedIoError) -> String {
    match error {
        OwnedIoError::SourceChanged | OwnedIoError::ReparseRefused => {
            "duplicates.changed".to_string()
        }
        _ => "storage.unavailable".to_string(),
    }
}

fn check_cancel(cancel: &CancellationToken) -> Result<(), String> {
    if cancel.load(std::sync::atomic::Ordering::Relaxed) {
        Err("ops.cancelled".to_string())
    } else {
        Ok(())
    }
}

/// The stage-2 filter hash. Readers that implement `Seek` are read exactly
/// once for files at most 128 KiB; larger files read one head and one tail.
pub fn partial_hash_reader<R: Read + Seek>(
    reader: &mut R,
    len: u64,
    cancel: &CancellationToken,
) -> Result<[u8; 32], String> {
    let mut hasher = blake3::Hasher::new();
    hasher.update(&len.to_le_bytes());
    check_cancel(cancel)?;
    if len <= SMALL_FILE_BYTES {
        let mut buffer = vec![0u8; usize::try_from(len).map_err(|_| "storage.invalid".to_string())?];
        if !buffer.is_empty() {
            reader
                .read_exact(&mut buffer)
                .map_err(|_| "storage.unavailable".to_string())?;
            hasher.update(&buffer);
        }
    } else {
        let mut head = vec![0u8; HEAD_TAIL_BYTES];
        reader
            .read_exact(&mut head)
            .map_err(|_| "storage.unavailable".to_string())?;
        hasher.update(&head);
        check_cancel(cancel)?;
        reader
            .seek(SeekFrom::End(-(HEAD_TAIL_BYTES as i64)))
            .map_err(|_| "storage.unavailable".to_string())?;
        let mut tail = vec![0u8; HEAD_TAIL_BYTES];
        reader
            .read_exact(&mut tail)
            .map_err(|_| "storage.unavailable".to_string())?;
        hasher.update(&tail);
    }
    check_cancel(cancel)?;
    Ok(*hasher.finalize().as_bytes())
}

/// Stage 2 through a guarded source handle.
pub fn partial_hash(
    candidate: &CandidateFile,
    cancel: &CancellationToken,
) -> Result<[u8; 32], String> {
    let mut source = PinnedSource::open(
        std::path::Path::new(candidate.primary_path()),
        &candidate.identity,
    )
    .map_err(map_owned)?;
    let hash = {
        let file = source.file_mut();
        file.seek(SeekFrom::Start(0))
            .map_err(|_| "storage.unavailable".to_string())?;
        partial_hash_reader(file, candidate.logical_bytes, cancel)?
    };
    source.verify_after_read().map_err(map_owned)?;
    Ok(hash)
}

/// Stage 3: full BLAKE3 in 1 MiB chunks plus stamp checks. Returns
/// `duplicates.changed` when the object is no longer the reviewed one.
pub fn full_hash_guarded(
    candidate: &CandidateFile,
    cancel: &CancellationToken,
    progress: &mut dyn FnMut(u64),
) -> Result<[u8; 32], String> {
    let mut source = PinnedSource::open(
        std::path::Path::new(candidate.primary_path()),
        &candidate.identity,
    )
    .map_err(map_owned)?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = vec![0u8; FULL_HASH_CHUNK];
    let mut total = 0u64;
    loop {
        check_cancel(cancel)?;
        let read = source
            .file_mut()
            .read(&mut buffer)
            .map_err(|_| "storage.unavailable".to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        total = total.saturating_add(read as u64);
        progress(total);
    }
    if total != candidate.logical_bytes {
        return Err("duplicates.changed".to_string());
    }
    source.verify_after_read().map_err(map_owned)?;
    drop(source);
    let after = capture_source_stamp(std::path::Path::new(candidate.primary_path()))
        .map_err(|_| "duplicates.changed".to_string())?;
    if !stamp_matches(&after, &candidate.source) {
        return Err("duplicates.changed".to_string());
    }
    Ok(*hasher.finalize().as_bytes())
}

pub fn stamp_matches(after: &SourceStamp, before: &SourceStamp) -> bool {
    after.path_key == before.path_key
        && after.volume_id == before.volume_id
        && after.file_id == before.file_id
        && after.modified_ticks == before.modified_ticks
        && after.size_bytes == before.size_bytes
}

#[cfg(test)]
mod tests {
    use super::{partial_hash_reader, HEAD_TAIL_BYTES, SMALL_FILE_BYTES};
    use std::io::{self, Read, Seek, SeekFrom};
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    struct CountingReader {
        inner: io::Cursor<Vec<u8>>,
        reads: usize,
    }

    impl Read for CountingReader {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            self.reads += 1;
            self.inner.read(buffer)
        }
    }

    impl Seek for CountingReader {
        fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
            self.inner.seek(position)
        }
    }

    #[test]
    fn files_at_most_128_kib_are_read_once() {
        let mut reader = CountingReader {
            inner: io::Cursor::new(vec![7u8; 12]),
            reads: 0,
        };
        let cancel = Arc::new(AtomicBool::new(false));
        partial_hash_reader(&mut reader, 12, &cancel).unwrap();
        assert_eq!(reader.reads, 1);
    }

    #[test]
    fn large_files_hash_one_head_and_one_tail() {
        let bytes = vec![3u8; HEAD_TAIL_BYTES * 2 + 10];
        let mut reader = CountingReader {
            inner: io::Cursor::new(bytes.clone()),
            reads: 0,
        };
        let cancel = Arc::new(AtomicBool::new(false));
        partial_hash_reader(&mut reader, bytes.len() as u64, &cancel).unwrap();
        assert_eq!(reader.reads, 2);
    }

    #[test]
    #[allow(clippy::assertions_on_constants)]
    fn the_filter_hash_uses_the_reported_length() {
        let short = vec![0u8; 4];
        let long = vec![0u8; 5];
        let cancel = Arc::new(AtomicBool::new(false));
        let mut short_reader = io::Cursor::new(short);
        let mut long_reader = io::Cursor::new(long);
        let first = partial_hash_reader(&mut short_reader, 4, &cancel).unwrap();
        let second = partial_hash_reader(&mut long_reader, 5, &cancel).unwrap();
        assert_ne!(first, second);
        assert!(SMALL_FILE_BYTES >= 4);
    }
}
