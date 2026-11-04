//! The pure converter contract (Step 08a E6).
//!
//! This module knows nothing about Tauri, the filesystem or the parent's
//! owned outputs: a converter borrows bounded readers, writes through a
//! sink and reports progress. The native parent alone publishes files.

use std::collections::BTreeMap;
use std::io::{Read, Seek};
use std::sync::atomic::Ordering;

use fs_service::{new_cancellation_token, CancellationToken, OpProgress, SourceStamp};

use crate::error::ConvertError;
use crate::types::{
    ConversionPreviewData, ConversionWarningCode, ConvertOptions, ConverterId, ConverterSpec,
    OutputDraft, OutputMetadata, PreparedOutput,
};

/// A bounded reader the converter may own. Implemented only for readers the
/// helper itself created (a pinned file handle or an in-memory snapshot).
pub trait ReadSeek: Read + Seek + Send {}
impl ReadSeek for std::fs::File {}
impl ReadSeek for std::io::Cursor<Vec<u8>> {}
impl ReadSeek for std::io::Cursor<&[u8]> {}

/// One source an adapter may read. The bytes come from a guarded file or an
/// immutable snapshot; a converter never sees a user path it can reopen.
pub struct ConvertSource {
    pub input_index: u32,
    pub name: String,
    pub mime: String,
    pub byte_len: u64,
    pub source_stamp: Option<SourceStamp>,
    pub reader: Box<dyn ReadSeek>,
}

impl ConvertSource {
    pub fn from_bytes(
        input_index: u32,
        name: impl Into<String>,
        mime: impl Into<String>,
        bytes: Vec<u8>,
        source_stamp: Option<SourceStamp>,
    ) -> Self {
        let byte_len = bytes.len() as u64;
        Self {
            input_index,
            name: name.into(),
            mime: mime.into(),
            byte_len,
            source_stamp,
            reader: Box::new(std::io::Cursor::new(bytes)),
        }
    }

    /// Read the whole source again, bounded by `max_bytes`, and leave the
    /// reader at its start for the adapter's real pass.
    pub fn read_bounded(&mut self, max_bytes: u64) -> Result<Vec<u8>, ConvertError> {
        if self.byte_len > max_bytes {
            return Err(ConvertError::TooLarge);
        }
        self.reader
            .seek(std::io::SeekFrom::Start(0))
            .map_err(|_| ConvertError::Io(std::io::ErrorKind::InvalidInput.into()))?;
        let mut bytes = Vec::with_capacity(usize::try_from(self.byte_len).unwrap_or(0));
        self.reader
            .by_ref()
            .take(max_bytes.saturating_add(1))
            .read_to_end(&mut bytes)
            .map_err(ConvertError::Io)?;
        if bytes.len() as u64 != self.byte_len || bytes.len() as u64 > max_bytes {
            return Err(ConvertError::TooLarge);
        }
        self.reader
            .seek(std::io::SeekFrom::Start(0))
            .map_err(|_| ConvertError::Io(std::io::ErrorKind::InvalidInput.into()))?;
        Ok(bytes)
    }
}

/// What one invocation may do besides converting: report progress and stop.
pub struct ConvertContext {
    pub cancel: CancellationToken,
    pub progress: Box<dyn FnMut(OpProgress) -> Result<(), ConvertError> + Send>,
    pub max_output_bytes: u64,
}

impl ConvertContext {
    pub fn new(cancel: CancellationToken, max_output_bytes: u64) -> Self {
        Self {
            cancel,
            progress: Box::new(|_| Ok(())),
            max_output_bytes,
        }
    }

    pub fn new_for_test(max_output_bytes: u64) -> Self {
        Self::new(new_cancellation_token(), max_output_bytes)
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    pub fn report(&mut self, progress: OpProgress) -> Result<(), ConvertError> {
        if self.is_cancelled() {
            return Err(ConvertError::Cancelled);
        }
        (self.progress)(progress)
    }

    /// Refuse once the output budget would be exceeded.
    pub fn check_output_budget(&self, bytes: u64) -> Result<(), ConvertError> {
        if bytes > self.max_output_bytes {
            return Err(ConvertError::TooLarge);
        }
        Ok(())
    }
}

/// One output target. Implementations must keep at most one open output and
/// number them contiguously from zero.
pub trait ConvertOutputSink {
    fn begin(&mut self, draft: OutputDraft) -> Result<u32, ConvertError>;
    fn write(&mut self, output_index: u32, bytes: &[u8]) -> Result<(), ConvertError>;
    fn finish(&mut self, output_index: u32, metadata: OutputMetadata) -> Result<(), ConvertError>;
    fn abort(&mut self, output_index: u32) -> Result<(), ConvertError>;
}

/// The exact adapter contract (interface revision `conversion-2`).
pub trait Converter: Send + Sync {
    fn spec(&self) -> ConverterSpec;
    fn preview(
        &self,
        inputs: &mut [ConvertSource],
        options: &ConvertOptions,
        context: &mut ConvertContext,
    ) -> Result<ConversionPreviewData, ConvertError>;
    /// Warnings this exact source/options pair requires before the first
    /// `sink.begin`. Adapters that can only know after reading the source
    /// (table safety prefixes, cached formulas, sheet selection) report them
    /// here; the shared parent preflight merges the list.
    fn required_warnings(
        &self,
        _inputs: &mut [ConvertSource],
        _options: &ConvertOptions,
    ) -> Result<Vec<ConversionWarningCode>, ConvertError> {
        Ok(Vec::new())
    }
    fn convert(
        &self,
        inputs: &mut [ConvertSource],
        options: &ConvertOptions,
        output: &mut dyn ConvertOutputSink,
        context: &mut ConvertContext,
    ) -> Result<PreparedOutput, ConvertError>;
}

/// The process-wide adapter table. Registration is compile-time only: no
/// data from the UI can add or replace an adapter.
#[derive(Default)]
pub struct ConverterRegistry {
    adapters: BTreeMap<String, Box<dyn Converter>>,
}

impl ConverterRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Reject a duplicate ID; a later step adds a new ID, never a shadow.
    pub fn register(&mut self, converter: Box<dyn Converter>) -> Result<(), ConvertError> {
        let spec = converter.spec();
        spec.validate()?;
        if self.adapters.contains_key(spec.id.as_str()) {
            return Err(ConvertError::BadRequest);
        }
        self.adapters
            .insert(spec.id.as_str().to_string(), converter);
        Ok(())
    }

    pub fn get(&self, id: &str) -> Option<&dyn Converter> {
        self.adapters.get(id).map(|boxed| boxed.as_ref())
    }

    pub fn specs(&self) -> Vec<ConverterSpec> {
        self.adapters
            .values()
            .map(|converter| converter.spec())
            .collect()
    }

    pub fn ids(&self) -> Vec<ConverterId> {
        self.adapters
            .values()
            .map(|converter| converter.spec().id)
            .collect()
    }
}
