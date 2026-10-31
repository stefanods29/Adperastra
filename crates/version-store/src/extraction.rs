//! Bounded and verified decoding. Publishing never replaces another file.

use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use rusqlite::{params, OptionalExtension};

use crate::coordination::StoreLock;
use crate::{StoreError, VersionStore, MAX_SNAPSHOT_BYTES};

static EXTRACT_COUNTER: AtomicU64 = AtomicU64::new(0);

impl VersionStore {
    /// Decompress into an owned staging file and publish without replacing.
    pub fn extract(&self, id: i64, dest: &Path) -> Result<(), StoreError> {
        let _lock = StoreLock::acquire(&self.dir)?;
        self.extract_locked(id, dest)
    }

    pub(crate) fn extract_locked(&self, id: i64, dest: &Path) -> Result<(), StoreError> {
        self.record_for(id)?;
        let parent = dest
            .parent()
            .ok_or_else(|| StoreError::Io("missing extraction parent".to_string()))?;
        std::fs::create_dir_all(parent)?;
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let name = format!(
            "~version-{}-{nanos}-{}.partial",
            std::process::id(),
            EXTRACT_COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        let partial = parent.join(name);
        let mut target = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&partial)?;
        let written = (|| -> Result<(), StoreError> {
            self.decode_checked(id, &mut target)?;
            target.flush()?;
            target.sync_all()?;
            Ok(())
        })();
        drop(target);
        if let Err(error) = written {
            let _ = std::fs::remove_file(&partial);
            return Err(error);
        }
        if let Err(error) = fs_service::move_without_replacing(&partial, dest) {
            let _ = std::fs::remove_file(&partial);
            return Err(StoreError::Io(error.to_string()));
        }
        Ok(())
    }

    pub fn read_bytes(&self, id: i64) -> Result<Vec<u8>, StoreError> {
        let _lock = StoreLock::acquire(&self.dir)?;
        self.read_bytes_locked(id)
    }

    pub(crate) fn read_bytes_locked(&self, id: i64) -> Result<Vec<u8>, StoreError> {
        let mut bytes = Vec::new();
        self.decode_checked(id, &mut bytes)?;
        Ok(bytes)
    }

    pub(crate) fn record_for(&self, id: i64) -> Result<(String, u64), StoreError> {
        let record: Option<(String, i64)> = self
            .conn
            .query_row(
                "SELECT hash, size FROM versions WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let (hash, size) = record.ok_or(StoreError::NotFound)?;
        if size < 0 || size as u64 > MAX_SNAPSHOT_BYTES {
            return Err(StoreError::TooLarge);
        }
        Ok((hash, size as u64))
    }

    fn decode_checked(&self, id: i64, output: &mut impl Write) -> Result<(), StoreError> {
        let (hash, size) = self.record_for(id)?;
        let source = File::open(self.blob_path(&hash))?;
        let mut decoder = zstd::stream::read::Decoder::new(source)?;
        // A corrupt frame cannot request an unbounded decompression window.
        decoder.window_log_max(28)?;
        let mut bounded = BoundedOutput {
            output,
            hash: blake3::Hasher::new(),
            written: 0,
            limit: size,
        };
        std::io::copy(&mut decoder, &mut bounded)?;
        if bounded.written != size || bounded.hash.finalize().to_string() != hash {
            return Err(StoreError::Io(
                "snapshot content failed verification".to_string(),
            ));
        }
        Ok(())
    }
}

struct BoundedOutput<'a, W> {
    output: &'a mut W,
    hash: blake3::Hasher,
    written: u64,
    limit: u64,
}

impl<W: Write> Write for BoundedOutput<'_, W> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() as u64 > self.limit.saturating_sub(self.written) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "snapshot output limit exceeded",
            ));
        }
        let written = self.output.write(bytes)?;
        self.hash.update(&bytes[..written]);
        self.written += written as u64;
        Ok(written)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.output.flush()
    }
}
