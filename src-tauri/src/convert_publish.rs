//! Owned output publication for conversions (Step 08a D3/D4).
//!
//! Every output is written to a random staging file in the pinned
//! destination, flushed, verified against the helper's length and SHA-256,
//! and only then renamed into place with replacement disabled. A collision
//! searches `name (1)`, `name (2)`, ... The original sources are never
//! touched.

use std::io::Write;
use std::path::PathBuf;

use convert::{ConvertError, ConvertOutputSink, FormatId, OutputDraft, OutputMetadata};
use fs_service::owned_io::{OwnedIoError, OwnedOutput, PinnedDirectory};
use sha2::{Digest, Sha256};

/// Keep this much free space on the destination volume.
pub const FREE_SPACE_MARGIN: u64 = 64 * 1024 * 1024;
/// Never try more numbered names than this.
pub const MAX_NAME_ATTEMPTS: u32 = 10_000;
static PUBLICATION: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub struct PublishedOutput {
    pub output_index: u32,
    pub path: PathBuf,
    pub byte_len: u64,
}

struct OpenOutput {
    output: OwnedOutput,
    hasher: Sha256,
    written: u64,
    index: u32,
}

pub struct PublishSink {
    destination: PinnedDirectory,
    stem: String,
    format: FormatId,
    open: Option<OpenOutput>,
    next_index: u32,
    published: Vec<PublishedOutput>,
    fail_flush_for_test: bool,
}

impl PublishSink {
    pub fn new(destination: PinnedDirectory, stem: String, format: FormatId) -> Self {
        Self {
            destination,
            stem,
            format,
            open: None,
            next_index: 0,
            published: Vec::new(),
            fail_flush_for_test: false,
        }
    }

    #[cfg(test)]
    pub fn new_failing_flush(destination: PinnedDirectory, stem: String, format: FormatId) -> Self {
        let mut sink = Self::new(destination, stem, format);
        sink.fail_flush_for_test = true;
        sink
    }

    pub fn published(&self) -> &[PublishedOutput] {
        &self.published
    }

    /// Refuse before the first byte when the volume has less than the
    /// output plus the 64 MiB safety margin.
    pub fn ensure_free_space(&self, needed: u64) -> Result<(), ConvertError> {
        let available =
            fs2::available_space(self.destination.path()).map_err(|_| ConvertError::NoSpace)?;
        if available.saturating_sub(needed) < FREE_SPACE_MARGIN {
            return Err(ConvertError::NoSpace);
        }
        Ok(())
    }

    fn publish_name(&mut self, output: &mut OwnedOutput) -> Result<PathBuf, ConvertError> {
        let base = convert::options::output_name(&self.stem, self.format);
        for attempt in 0..MAX_NAME_ATTEMPTS {
            let name = convert::options::collision_name(&base, attempt);
            match output.publish_name(&name) {
                Ok(path) => return Ok(path),
                Err(OwnedIoError::TargetExists) => continue,
                Err(error) => {
                    return Err(match error {
                        OwnedIoError::InvalidName | OwnedIoError::StagingTaken => {
                            ConvertError::BadRequest
                        }
                        OwnedIoError::OutputChanged => ConvertError::Changed,
                        _ => ConvertError::Io(std::io::Error::other("publish failed")),
                    })
                }
            }
        }
        Err(ConvertError::NoSpace)
    }
}

impl ConvertOutputSink for PublishSink {
    fn begin(&mut self, _draft: OutputDraft) -> Result<u32, ConvertError> {
        if self.open.is_some() {
            return Err(ConvertError::BadRequest);
        }
        let output = OwnedOutput::create(&self.destination, &self.stem)
            .map_err(|_| ConvertError::Io(std::io::Error::other("staging failed")))?;
        let index = self.next_index;
        self.next_index = self
            .next_index
            .checked_add(1)
            .ok_or(ConvertError::TooLarge)?;
        self.open = Some(OpenOutput {
            output,
            hasher: Sha256::new(),
            written: 0,
            index,
        });
        Ok(index)
    }

    fn write(&mut self, output_index: u32, bytes: &[u8]) -> Result<(), ConvertError> {
        let open = self.open.as_mut().ok_or(ConvertError::BadRequest)?;
        if open.index != output_index {
            return Err(ConvertError::BadRequest);
        }
        let next = open
            .written
            .checked_add(bytes.len() as u64)
            .ok_or(ConvertError::TooLarge)?;
        if next > convert::types::MAX_IMAGE_OUTPUT_BYTES || bytes.len() > 1024 * 1024 {
            return Err(ConvertError::TooLarge);
        }
        open.output
            .file_mut()
            .write_all(bytes)
            .map_err(ConvertError::Io)?;
        open.hasher.update(bytes);
        open.written = open
            .written
            .checked_add(bytes.len() as u64)
            .ok_or(ConvertError::TooLarge)?;
        let _ = output_index;
        Ok(())
    }

    fn finish(&mut self, output_index: u32, metadata: OutputMetadata) -> Result<(), ConvertError> {
        let mut open = self.open.take().ok_or(ConvertError::BadRequest)?;
        if open.index != output_index || metadata.byte_len != open.written {
            return Err(ConvertError::Changed);
        }
        let digest = std::mem::replace(&mut open.hasher, Sha256::new()).finalize();
        let mut hex = String::with_capacity(64);
        for byte in digest.iter() {
            hex.push_str(&format!("{byte:02x}"));
        }
        if hex != metadata.hash_sha256 {
            return Err(ConvertError::Changed);
        }
        if self.fail_flush_for_test {
            return Err(ConvertError::Io(std::io::Error::other(
                "injected flush failure",
            )));
        }
        open.output
            .flush_sync()
            .map_err(|_| ConvertError::Io(std::io::Error::other("flush failed")))?;
        // A conservative global publication gate also enforces at most one
        // final publication per destination volume.
        let _publication = PUBLICATION
            .lock()
            .map_err(|_| ConvertError::Io(std::io::Error::other("publication lock poisoned")))?;
        let path = self.publish_name(&mut open.output)?;
        self.published.push(PublishedOutput {
            output_index,
            path,
            byte_len: metadata.byte_len,
        });
        Ok(())
    }

    fn abort(&mut self, _output_index: u32) -> Result<(), ConvertError> {
        self.open.take();
        Ok(())
    }
}

#[cfg(test)]
#[path = "convert_publish_step08a_tests.rs"]
mod step08a_tests;
