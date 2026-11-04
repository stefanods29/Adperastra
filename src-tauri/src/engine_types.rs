//! Canonical engine types (Step 12b, revision `engines-2`).
//!
//! One definition per language: this module is the Rust one, the mirror is
//! `src/services/engineTypes.ts`. Nothing here holds a program path, a
//! command line or unbounded engine JSON. A request carries typed values and
//! native guards only; `engine_process` alone decides which executable runs
//! with which arguments (D3).
#![allow(dead_code)]


use convert::{
    ConversionInput, ConverterId, FormatId, MediaConversionOptions, MetadataCategory, PageRange,
};
use fs_service::owned_io::{OwnedOutput, PinnedDirectory, PinnedSource};
use fs_service::SourceStamp;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::export_snapshots::SnapshotLease;

/// A media source is at most 32 GiB (D4).
pub const MEDIA_MAX_SOURCE_BYTES: u64 = 32 * 1024 * 1024 * 1024;
/// An Office source is at most 512 MiB (D4, shared with 08a document caps).
pub const OFFICE_MAX_SOURCE_BYTES: u64 = 512 * 1024 * 1024;
/// All media outputs of one invocation together are at most 32 GiB.
pub const MEDIA_MAX_OUTPUT_BYTES: u64 = 32 * 1024 * 1024 * 1024;
/// Office output of one invocation is at most 1 GiB.
pub const OFFICE_MAX_OUTPUT_BYTES: u64 = 1024 * 1024 * 1024;
/// Longest media duration accepted: 24 hours.
pub const MEDIA_MAX_DURATION_US: u64 = 24 * 60 * 60 * 1_000_000;
/// Most streams one probe may report.
pub const MEDIA_MAX_STREAMS: usize = 64;
/// Most tags one probe may report.
pub const MEDIA_MAX_TAGS: usize = 512;
/// Longest tag value kept.
pub const MEDIA_MAX_TAG_VALUE: usize = 4096;
/// Largest accepted picture side or stream dimension.
pub const MEDIA_MAX_DIMENSION: u32 = 16_384;
/// Most inputs one combine invocation may take.
pub const MAX_ENGINE_INPUTS: usize = 1000;
/// Most outputs one invocation may produce.
pub const MAX_ENGINE_OUTPUTS: usize = 256;
/// Most stable diagnostic codes one result may carry.
pub const MAX_STDERR_CODES: usize = 64;
/// Probe deadline (D4).
pub const PROBE_TIMEOUT_MS: u64 = 15_000;
/// Preview deadline (D4).
pub const PREVIEW_TIMEOUT_MS: u64 = 10_000;
/// One-shot Office render deadline (D4).
pub const OFFICE_RENDER_TIMEOUT_MS: u64 = 120_000;
/// Heartbeat silence that fails an export (D4).
pub const EXPORT_HEARTBEAT_MS: u64 = 30_000;
/// An export may run for a long time, bounded by the heartbeat (D4).
pub const EXPORT_TIMEOUT_MS: u64 = 24 * 60 * 60 * 1000;
/// Preview sample length: three seconds.
pub const PREVIEW_SAMPLE_US: u64 = 3_000_000;
/// Preview picture edge.
pub const PREVIEW_EDGE: u32 = 512;

/// The stable errors this area returns; the UI translates them. The same enum
/// travels on the session wire as `snake_case`, so a reply can never invent a
/// new code.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EngineError {
    BadRequest,
    PackMissing,
    UnsafeBuild,
    SandboxFailed,
    SensitiveUnsupported,
    Busy,
    Timeout,
    Unsupported,
    Changed,
    Cancelled,
    Failed,
}

impl EngineError {
    /// The wire code (`errors.engines.<reason>` in the locale files).
    pub fn code(self) -> &'static str {
        match self {
            Self::BadRequest => "engines.bad_request",
            Self::PackMissing => "engines.pack_missing",
            Self::UnsafeBuild => "engines.unsafe_build",
            Self::SandboxFailed => "engines.sandbox_failed",
            Self::SensitiveUnsupported => "engines.sensitive_unsupported",
            Self::Busy => "engines.busy",
            Self::Timeout => "engines.timeout",
            Self::Unsupported => "engines.unsupported",
            Self::Changed => "engines.changed",
            Self::Cancelled => "engines.cancelled",
            Self::Failed => "engines.failed",
        }
    }

    pub fn message(self) -> String {
        self.code().to_string()
    }
}

/// The engine a pack provides (D6).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EngineId {
    Media,
    Office,
}

impl EngineId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Media => "media",
            Self::Office => "office",
        }
    }

    /// The largest source one file of this engine may have.
    pub fn max_source_bytes(self) -> u64 {
        match self {
            Self::Media => MEDIA_MAX_SOURCE_BYTES,
            Self::Office => OFFICE_MAX_SOURCE_BYTES,
        }
    }

    /// The largest total output one invocation of this engine may write.
    pub fn max_output_bytes(self) -> u64 {
        match self {
            Self::Media => MEDIA_MAX_OUTPUT_BYTES,
            Self::Office => OFFICE_MAX_OUTPUT_BYTES,
        }
    }
}

/// Why a capability is not usable; mapped from the audit, never guessed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EngineUnavailableReason {
    PacksMissing,
    UnsafeBuild,
    SandboxFailed,
    Unsupported,
}

/// One audited engine capability (E1).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineCapability {
    pub id: String,
    pub available: bool,
    pub version: String,
    pub reason: Option<EngineUnavailableReason>,
}

impl EngineCapability {
    /// Validate the bounds the UI is promised.
    pub fn validate(&self) -> Result<(), EngineError> {
        if self.id.is_empty() || self.id.len() > 64 || !self.id.is_ascii() {
            return Err(EngineError::BadRequest);
        }
        if self.version.len() > 64 {
            return Err(EngineError::BadRequest);
        }
        if self.available && self.reason.is_some() {
            return Err(EngineError::BadRequest);
        }
        Ok(())
    }
}

fn greatest_common_divisor(left: u32, right: u32) -> u32 {
    if right == 0 {
        left
    } else {
        greatest_common_divisor(right, left % right)
    }
}

/// A reduced, positive frame rate. `den` is at most 100000 (D5).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct FrameRate {
    pub num: u32,
    pub den: u32,
}

impl FrameRate {
    pub fn new(num: u32, den: u32) -> Option<Self> {
        if num == 0 || den == 0 || den > 100_000 {
            return None;
        }
        let common = greatest_common_divisor(num, den);
        Some(Self {
            num: num / common,
            den: den / common,
        })
    }

    /// The rate in microseconds per frame, rounded down, or `None` when the
    /// rate is not a positive rational.
    pub fn frame_us(self) -> Option<u64> {
        if self.num == 0 {
            return None;
        }
        Some((u64::from(self.den) * 1_000_000) / u64::from(self.num))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaStreamKind {
    Video,
    Audio,
    Subtitle,
}

/// One stream of a probed file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MediaStream {
    pub index: u32,
    pub kind: MediaStreamKind,
    pub codec: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub frame_rate: Option<FrameRate>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u8>,
    pub language: Option<String>,
}

/// One metadata tag, already classified into a shared category.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MediaTag {
    pub key: String,
    pub value: String,
    pub category: MetadataCategory,
}

/// A disk file the user asked the engine to read. Only 08a's `file` variant:
/// a snapshot has no stable disk `SourceStamp` to report (E2).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskConversionInput {
    pub kind: DiskFileKind,
    pub path: String,
    pub expected: Option<SourceStamp>,
}

/// The only `ConversionInput` variant probe/preview accept.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiskFileKind {
    File,
}

/// Bounded probe result (D4).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaInfo {
    pub source: SourceStamp,
    pub duration_us: u64,
    pub streams: Vec<MediaStream>,
    pub tags: Vec<MediaTag>,
    pub format: String,
}

impl MediaInfo {
    /// Enforce the published bounds on a probe result before the UI sees it.
    pub fn validate(&self) -> Result<(), EngineError> {
        self.source.validate().map_err(|_| EngineError::BadRequest)?;
        if self.duration_us > MEDIA_MAX_DURATION_US {
            return Err(EngineError::BadRequest);
        }
        if self.streams.len() > MEDIA_MAX_STREAMS || self.tags.len() > MEDIA_MAX_TAGS {
            return Err(EngineError::BadRequest);
        }
        if self.format.is_empty() || self.format.len() > 64 {
            return Err(EngineError::BadRequest);
        }
        for stream in &self.streams {
            if stream.codec.len() > 64 {
                return Err(EngineError::BadRequest);
            }
            if let Some(width) = stream.width {
                if width == 0 || width > MEDIA_MAX_DIMENSION {
                    return Err(EngineError::BadRequest);
                }
            }
            if let Some(height) = stream.height {
                if height == 0 || height > MEDIA_MAX_DIMENSION {
                    return Err(EngineError::BadRequest);
                }
            }
            if let Some(rate) = stream.frame_rate {
                if FrameRate::new(rate.num, rate.den) != Some(rate) {
                    return Err(EngineError::BadRequest);
                }
            }
            if let Some(channels) = stream.channels {
                if channels == 0 || channels > 32 {
                    return Err(EngineError::BadRequest);
                }
            }
            if let Some(language) = &stream.language {
                if language.is_empty() || language.len() > 32 {
                    return Err(EngineError::BadRequest);
                }
            }
        }
        for tag in &self.tags {
            if tag.key.is_empty() || tag.key.len() > 128 || tag.value.len() > MEDIA_MAX_TAG_VALUE
            {
                return Err(EngineError::BadRequest);
            }
        }
        Ok(())
    }
}

/// A leased sample of at most three seconds (D6). The lease is the only way
/// the UI reads the bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaPreview {
    pub lease: cache_store::CacheLease,
    pub duration_us: u64,
    pub mime: String,
    pub source_revision: u64,
}

impl MediaPreview {
    /// These previews always come from a disk file, so the revision is 1.
    pub fn validate(&self) -> Result<(), EngineError> {
        if self.duration_us > PREVIEW_SAMPLE_US {
            return Err(EngineError::BadRequest);
        }
        if self.mime.is_empty() || self.mime.len() > 128 {
            return Err(EngineError::BadRequest);
        }
        if self.source_revision != 1 {
            return Err(EngineError::BadRequest);
        }
        Ok(())
    }
}

/// Office containers this step accepts. `potx`/`otp` are inspection inputs
/// for 22a/22b only and are never advertised here.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficeFormat {
    Docx,
    Xlsx,
    Pptx,
    Odt,
    Ods,
    Odp,
    Rtf,
    Doc,
    Xls,
    Ppt,
    Potx,
    Otp,
}

impl OfficeFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Docx => "docx",
            Self::Xlsx => "xlsx",
            Self::Pptx => "pptx",
            Self::Odt => "odt",
            Self::Ods => "ods",
            Self::Odp => "odp",
            Self::Rtf => "rtf",
            Self::Doc => "doc",
            Self::Xls => "xls",
            Self::Ppt => "ppt",
            Self::Potx => "potx",
            Self::Otp => "otp",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Some(match id {
            "docx" => Self::Docx,
            "xlsx" => Self::Xlsx,
            "pptx" => Self::Pptx,
            "odt" => Self::Odt,
            "ods" => Self::Ods,
            "odp" => Self::Odp,
            "rtf" => Self::Rtf,
            "doc" => Self::Doc,
            "xls" => Self::Xls,
            "ppt" => Self::Ppt,
            "potx" => Self::Potx,
            "otp" => Self::Otp,
            _ => return None,
        })
    }

    /// Read the container from a file name; unknown suffixes are refused.
    pub fn from_file_name(name: &str) -> Option<Self> {
        let (_, extension) = name.rsplit_once('.')?;
        Self::from_id(&extension.to_ascii_lowercase())
    }

    /// Read the container from the exact MIME of an immutable snapshot.
    /// Only the OOXML/ODF/RTF/legacy types this step accepts are named.
    pub fn from_mime(mime: &str) -> Option<Self> {
        Some(match mime.split(';').next().unwrap_or("").trim() {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => {
                Self::Docx
            }
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => Self::Xlsx,
            "application/vnd.openxmlformats-officedocument.presentationml.presentation" => {
                Self::Pptx
            }
            "application/vnd.oasis.opendocument.text" => Self::Odt,
            "application/vnd.oasis.opendocument.spreadsheet" => Self::Ods,
            "application/vnd.oasis.opendocument.presentation" => Self::Odp,
            "application/rtf" => Self::Rtf,
            "application/msword" => Self::Doc,
            "application/vnd.ms-excel" => Self::Xls,
            "application/vnd.ms-powerpoint" => Self::Ppt,
            _ => return None,
        })
    }

    /// Templates are only inspection inputs (22a/22b); nothing here renders
    /// or edits them.
    pub fn is_template(self) -> bool {
        matches!(self, Self::Potx | Self::Otp)
    }

    /// The container family decides the fixed PDF filter (D8).
    pub fn family(self) -> OfficeFamily {
        match self {
            Self::Docx | Self::Odt | Self::Rtf | Self::Doc | Self::Potx | Self::Otp => {
                OfficeFamily::Writer
            }
            Self::Xlsx | Self::Ods | Self::Xls => OfficeFamily::Calc,
            Self::Pptx | Self::Odp | Self::Ppt => OfficeFamily::Impress,
        }
    }

    /// The fixed PDF export filter for this family (D8): never HTML
    /// mislabelled as PDF.
    pub fn pdf_filter(self) -> &'static str {
        match self.family() {
            OfficeFamily::Writer => "writer_pdf_Export",
            OfficeFamily::Calc => "calc_pdf_Export",
            OfficeFamily::Impress => "impress_pdf_Export",
        }
    }
}

/// The three LibreOffice application families.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OfficeFamily {
    Writer,
    Calc,
    Impress,
}

impl OfficeFamily {
    /// The bounded `--convert-to` name used for text output.
    pub fn text_filter(self) -> &'static str {
        match self {
            Self::Writer => "txt:Text",
            Self::Calc => "csv:Text - txt - csv (StarCalc)",
            Self::Impress => "txt:Text",
        }
    }

    /// The bounded `--convert-to` name used for HTML output.
    pub fn html_filter(self) -> &'static str {
        match self {
            Self::Writer => "html:XHTML Writer File",
            Self::Calc => "html:HTML (StarCalc)",
            Self::Impress => "html:HTML (StarImpress)",
        }
    }
}

/// What a one-shot Office render produces.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficeRenderTarget {
    Pdf,
    Html,
    Txt,
}

impl OfficeRenderTarget {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pdf => "pdf",
            Self::Html => "html",
            Self::Txt => "txt",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Some(match id {
            "pdf" => Self::Pdf,
            "html" => Self::Html,
            "txt" => Self::Txt,
            _ => return None,
        })
    }

    /// The MIME every validated artifact of this target must carry.
    pub fn mime(self) -> &'static str {
        match self {
            Self::Pdf => "application/pdf",
            Self::Html => "text/html",
            Self::Txt => "text/plain",
        }
    }

    pub fn extension(self) -> &'static str {
        self.as_str()
    }
}

/// One-shot Office render request (E4): no field can enable macros or
/// external links, and no destination path is accepted.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfficeRenderRequest {
    pub input: ConversionInput,
    pub target: OfficeRenderTarget,
    pub format: OfficeFormat,
    pub include_comments: bool,
    pub include_notes: bool,
    pub ranges: Vec<PageRange>,
}

impl OfficeRenderRequest {
    /// Validate every field the native side reads.
    pub fn validate(&self) -> Result<(), EngineError> {
        validate_office_render(self.format, self.target, &self.ranges)
    }
}

/// The field rules of a render request, without touching the input identity
/// (that check lives with the renderer, which owns the guarded source).
pub fn validate_office_render(
    format: OfficeFormat,
    target: OfficeRenderTarget,
    ranges: &[PageRange],
) -> Result<(), EngineError> {
    if format.is_template() {
        return Err(EngineError::Unsupported);
    }
    if !matches!(
        target,
        OfficeRenderTarget::Pdf | OfficeRenderTarget::Html | OfficeRenderTarget::Txt
    ) {
        return Err(EngineError::Unsupported);
    }
    if ranges.len() > 1000 {
        return Err(EngineError::BadRequest);
    }
    let mut total: u64 = 0;
    for range in ranges {
        if range.first == 0 || range.last < range.first {
            return Err(EngineError::BadRequest);
        }
        total = total.saturating_add(u64::from(range.last - range.first) + 1);
    }
    if total > 10_000 {
        return Err(EngineError::BadRequest);
    }
    Ok(())
}

/// Where a guarded engine input comes from. A snapshot lease is memory-only
/// and never serialized into a UI request.
#[allow(clippy::large_enum_variant)]
pub enum EngineSource {
    Disk(PinnedSource),
    Snapshot(SnapshotLease),
}

/// One authorized input the parent hands to the engine.
pub struct EngineInput {
    pub input_index: u32,
    pub original: ConversionInput,
    pub stamp: Option<SourceStamp>,
    pub source: EngineSource,
    /// Decided natively, never by the UI.
    pub sensitive: bool,
}

impl EngineInput {
    /// Resolve the exact disk file or immutable snapshot the parent authorized.
    /// No path or identity is accepted separately from the original request.
    pub fn resolve(
        input_index: u32,
        original: ConversionInput,
        cache: &crate::cache::CacheService,
        snapshots: &crate::export_snapshots::ExportSnapshots,
    ) -> Result<Self, String> {
        match &original {
            ConversionInput::File { path, expected } => {
                crate::validate_absolute_path(path).map_err(|_| EngineError::BadRequest.message())?;
                let path = std::path::PathBuf::from(path);
                let stamp = cache
                    .source_stamp(&path)
                    .map_err(|_| EngineError::Changed.message())?;
                if expected.as_ref().is_some_and(|expected| expected != &stamp) {
                    return Err(EngineError::Changed.message());
                }
                let identity = fs_service::owned_io::SourceIdentity::capture(&path)
                    .map_err(|_| EngineError::Changed.message())?;
                let pinned = PinnedSource::open(&path, &identity)
                    .map_err(|_| EngineError::Changed.message())?;
                Ok(Self {
                    input_index,
                    original,
                    stamp: Some(stamp),
                    source: EngineSource::Disk(pinned),
                    sensitive: false,
                })
            }
            ConversionInput::Snapshot {
                snapshot_id,
                document_id,
                revision,
            } => {
                let lease = snapshots
                    .resolve(snapshot_id, document_id, *revision)
                    .map_err(|_| EngineError::Changed.message())?;
                let sensitive = lease.snapshot.storage_policy
                    == crate::export_snapshot_types::StoragePolicy::Sensitive;
                let stamp = lease.snapshot.source.clone();
                Ok(Self {
                    input_index,
                    original,
                    stamp,
                    source: EngineSource::Snapshot(lease),
                    sensitive,
                })
            }
        }
    }

    /// The immutable source revision carried by the authorized input.
    pub fn source_revision(&self) -> u64 {
        match &self.original {
            ConversionInput::File { .. } => 1,
            ConversionInput::Snapshot { revision, .. } => *revision,
        }
    }

    /// Snapshot content identity, when this input came from an editor model.
    pub fn source_content_id(&self) -> Option<Uuid> {
        match &self.source {
            EngineSource::Disk(_) => None,
            EngineSource::Snapshot(lease) => Some(lease.snapshot.content_id),
        }
    }

    /// The Office container of this authorized input. A disk file is named by
    /// its suffix; a snapshot has no file name, so its validated MIME is the
    /// identity. `None` means no supported Office container.
    pub fn office_format(&self) -> Option<OfficeFormat> {
        match &self.original {
            ConversionInput::File { path, .. } => {
                OfficeFormat::from_file_name(path.rsplit(['\\', '/']).next().unwrap_or(path))
            }
            ConversionInput::Snapshot { .. } => match &self.source {
                EngineSource::Disk(_) => None,
                EngineSource::Snapshot(lease) => OfficeFormat::from_mime(&lease.snapshot.mime),
            },
        }
    }

    /// A sensitive input would need a plaintext temporary file, which these
    /// CLI engines cannot avoid (D3).
    pub fn refuse_sensitive(&self) -> Result<(), EngineError> {
        if self.sensitive {
            return Err(EngineError::SensitiveUnsupported);
        }
        Ok(())
    }
}

/// Which engine capability one action needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineCapabilityId {
    MediaProbe,
    MediaPreview,
    MediaEncode,
    OfficeConvert,
    OfficeReadBridge,
}

impl EngineCapabilityId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::MediaProbe => "media.probe",
            Self::MediaPreview => "media.preview",
            Self::MediaEncode => "media.encode",
            Self::OfficeConvert => "office.convert",
            Self::OfficeReadBridge => "office_read_bridge",
        }
    }

    pub fn engine(self) -> EngineId {
        match self {
            Self::MediaProbe | Self::MediaPreview | Self::MediaEncode => EngineId::Media,
            Self::OfficeConvert | Self::OfficeReadBridge => EngineId::Office,
        }
    }
}

/// What the caller asks the engine to do (tagged action of `EngineRequest`).
pub enum EngineAction {
    ProbeMedia {
        inputs: Vec<EngineInput>,
    },
    PreviewMedia {
        inputs: Vec<EngineInput>,
        options: MediaConversionOptions,
    },
    ConvertMedia {
        inputs: Vec<EngineInput>,
        converter_id: ConverterId,
        output_format: FormatId,
        options: MediaConversionOptions,
    },
    RenderOffice {
        inputs: Vec<EngineInput>,
        options: OfficeRenderRequest,
    },
}

impl EngineAction {
    /// The capability this action needs.
    pub fn capability(&self) -> EngineCapabilityId {
        match self {
            Self::ProbeMedia { .. } => EngineCapabilityId::MediaProbe,
            Self::PreviewMedia { .. } => EngineCapabilityId::MediaPreview,
            Self::ConvertMedia { .. } => EngineCapabilityId::MediaEncode,
            Self::RenderOffice { .. } => EngineCapabilityId::OfficeConvert,
        }
    }

    /// The inputs, borrowed.
    pub fn inputs(&self) -> &[EngineInput] {
        match self {
            Self::ProbeMedia { inputs }
            | Self::PreviewMedia { inputs, .. }
            | Self::ConvertMedia { inputs, .. }
            | Self::RenderOffice { inputs, .. } => inputs,
        }
    }

    /// Validate the exact input cardinality and bounds (E6).
    pub fn validate(&self) -> Result<(), EngineError> {
        let inputs = self.inputs();
        if inputs.is_empty() || inputs.len() > MAX_ENGINE_INPUTS {
            return Err(EngineError::BadRequest);
        }
        // Every 12b converter is an `each` converter: one input, one output,
        // one invocation. A batch is separate invocations in input order.
        match self {
            Self::ProbeMedia { .. }
            | Self::PreviewMedia { .. }
            | Self::ConvertMedia { .. }
            | Self::RenderOffice { .. } => {
                if inputs.len() != 1 {
                    return Err(EngineError::BadRequest);
                }
            }
        }
        for (position, input) in inputs.iter().enumerate() {
            if input.input_index as usize != position && inputs.len() == 1 {
                return Err(EngineError::BadRequest);
            }
            input.refuse_sensitive()?;
            let limit = self.capability().engine().max_source_bytes();
            if let Some(stamp) = input.stamp.as_ref() {
                stamp.validate().map_err(|_| EngineError::BadRequest)?;
                if stamp.size_bytes > limit {
                    return Err(EngineError::BadRequest);
                }
            }
            // A snapshot has no disk stamp, so its immutable length is the
            // only bound available before it is copied.
            if let ConversionInput::Snapshot { revision, .. } = &input.original {
                if *revision >= (1u64 << 53) {
                    return Err(EngineError::BadRequest);
                }
            }
            if let EngineSource::Snapshot(lease) = &input.source {
                if lease.snapshot.byte_len > limit {
                    return Err(EngineError::BadRequest);
                }
            }
        }
        Ok(())
    }

    /// The wall-clock limit this action may take (D4).
    pub fn default_timeout_ms(&self) -> u64 {
        match self {
            Self::ProbeMedia { .. } => PROBE_TIMEOUT_MS,
            Self::PreviewMedia { .. } => PREVIEW_TIMEOUT_MS,
            Self::RenderOffice { .. } => OFFICE_RENDER_TIMEOUT_MS,
            // Exports may run for a long time; the heartbeat catches a stall.
            Self::ConvertMedia { .. } => 24 * 60 * 60 * 1000,
        }
    }
}

/// One confined invocation (E3).
pub struct EngineRequest {
    pub request_id: Uuid,
    pub timeout_ms: u64,
    pub work_dir: PinnedDirectory,
    pub action: EngineAction,
}

impl EngineRequest {
    /// Validate the whole request before anything is launched.
    pub fn validate(&self) -> Result<(), EngineError> {
        if self.timeout_ms == 0 {
            return Err(EngineError::BadRequest);
        }
        let ceiling = self.action.default_timeout_ms();
        if self.timeout_ms > ceiling {
            return Err(EngineError::BadRequest);
        }
        self.action.validate()
    }
}

/// One validated engine output. The file is owned here; the parent copies and
/// publishes it through 08a's sink, and the engine never sees a destination.
pub struct EngineOutput {
    pub output_id: Uuid,
    pub relative_name: String,
    pub mime: String,
    pub byte_len: u64,
    pub content_hash_sha256: String,
    pub owned_output: OwnedOutput,
}

impl EngineOutput {
    /// Check the recorded identity against the handle this output owns. The
    /// open handle is authoritative, never a path string.
    pub fn verify(&mut self) -> Result<(), EngineError> {
        if !valid_relative_basename(&self.relative_name) {
            return Err(EngineError::Failed);
        }
        if self.mime.is_empty() || self.mime.len() > 128 {
            return Err(EngineError::Failed);
        }
        if !is_sha256_hex(&self.content_hash_sha256) {
            return Err(EngineError::Failed);
        }
        let length = self
            .owned_output
            .file_mut()
            .metadata()
            .map_err(|_| EngineError::Failed)?
            .len();
        if length != self.byte_len {
            return Err(EngineError::Failed);
        }
        // The hash itself was computed while the parent copied the bytes into
        // this exact owned handle (E6); a second full read here would double
        // the I/O of a 32 GiB media output without adding evidence.
        Ok(())
    }
}

/// Why an engine stopped; a stable code, never raw stderr text (D4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EngineDiagnostic {
    SandboxDenied,
    BadArguments,
    MissingInput,
    UnsupportedCodec,
    EncoderFailed,
    DecoderFailed,
    OutputMissing,
    OutputTooLarge,
    NoSpace,
    MacrosBlocked,
    ExternalLinkBlocked,
    ProfileFailed,
    Unknown,
}

/// What one invocation produced. Evidence to check, never authority by itself
/// (E6).
pub struct EngineResult {
    pub exit_code: i32,
    pub outputs: Vec<EngineOutput>,
    pub bytes_written: u64,
    pub metadata_lost: Vec<MetadataCategory>,
    pub stderr_codes: Vec<EngineDiagnostic>,
}

impl EngineResult {
    /// Reject a result that carries more than the published bounds.
    pub fn validate(&mut self) -> Result<(), EngineError> {
        if self.outputs.len() > MAX_ENGINE_OUTPUTS || self.stderr_codes.len() > MAX_STDERR_CODES {
            return Err(EngineError::Failed);
        }
        let total: u64 = self.outputs.iter().map(|output| output.byte_len).sum();
        if total != self.bytes_written {
            return Err(EngineError::Failed);
        }
        for output in self.outputs.iter_mut() {
            output.verify()?;
        }
        Ok(())
    }
}

/// One rendered Office section (E4/E7).
pub struct OfficeRenderedArtifact {
    pub output: EngineOutput,
    pub section_id: String,
    pub format: OfficeRenderTarget,
    pub page_count: u32,
}

/// One-shot or session render result. Revision is the input snapshot revision
/// or 1 for an unedited disk source.
pub struct RenderedOffice {
    pub artifacts: Vec<OfficeRenderedArtifact>,
    pub engine_version: String,
    pub source_revision: u64,
}

impl RenderedOffice {
    /// Enforce the published bounds on a render result.
    pub fn validate(&mut self) -> Result<(), EngineError> {
        if self.artifacts.len() > 1000 {
            return Err(EngineError::Failed);
        }
        if self.engine_version.len() > 64 {
            return Err(EngineError::Failed);
        }
        if self.source_revision >= (1u64 << 53) {
            return Err(EngineError::Failed);
        }
        for artifact in self.artifacts.iter_mut() {
            if !valid_section_id(&artifact.section_id) {
                return Err(EngineError::Failed);
            }
            if artifact.page_count > 10_000 {
                return Err(EngineError::Failed);
            }
            artifact.output.verify()?;
        }
        Ok(())
    }
}

/// True for a 64-character lowercase hexadecimal SHA-256.
pub fn is_sha256_hex(text: &str) -> bool {
    text.len() == 64
        && text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// True when the name is exactly one Windows path component.
pub fn valid_relative_basename(name: &str) -> bool {
    if name.is_empty() || name.len() > 255 {
        return false;
    }
    if name == "." || name == ".." {
        return false;
    }
    if name.contains('/') || name.contains('\\') || name.contains(':') {
        return false;
    }
    if name.chars().any(|character| character.is_control()) {
        return false;
    }
    if name.ends_with('.') || name.ends_with(' ') {
        return false;
    }
    fs_service::validate_new_name(name).is_ok()
}

/// A section ID is ASCII, 1..=64 characters (`document`, `sheet:0`, ...).
pub fn valid_section_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_graphic() && byte != b'/' && byte != b'\\')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_rates_reduce_and_bound() {
        assert_eq!(FrameRate::new(60, 2), Some(FrameRate { num: 30, den: 1 }));
        assert_eq!(FrameRate::new(30_000, 1_001), Some(FrameRate { num: 30_000, den: 1_001 }));
        assert_eq!(FrameRate::new(0, 1), None);
        assert_eq!(FrameRate::new(1, 100_001), None);
        assert_eq!(FrameRate::new(1, 1).unwrap().frame_us(), Some(1_000_000));
    }

    #[test]
    fn basenames_cannot_escape() {
        assert!(valid_relative_basename("clip.mp4"));
        assert!(!valid_relative_basename("..\\escape.mp4"));
        assert!(!valid_relative_basename("C:clip.mp4"));
        assert!(!valid_relative_basename("clip.mp4."));
        assert!(!valid_relative_basename("CON"));
    }

    #[test]
    fn office_formats_keep_templates_out() {
        assert_eq!(OfficeFormat::from_id("docx"), Some(OfficeFormat::Docx));
        assert_eq!(OfficeFormat::from_id("zip"), None);
        assert!(OfficeFormat::Potx.is_template());
        assert_eq!(OfficeFormat::Xlsx.pdf_filter(), "calc_pdf_Export");
        assert_eq!(
            OfficeFormat::from_file_name("Deck.PPTX"),
            Some(OfficeFormat::Pptx)
        );
    }

    #[test]
    fn section_ids_stay_ascii_and_short() {
        assert!(valid_section_id("document"));
        assert!(valid_section_id("sheet:3"));
        assert!(!valid_section_id(""));
        assert!(!valid_section_id("sheet\\3"));
        assert!(!valid_section_id(&"a".repeat(65)));
    }

    #[test]
    fn hashes_are_lowercase_hex_64() {
        assert!(is_sha256_hex(&"a".repeat(64)));
        assert!(!is_sha256_hex(&"A".repeat(64)));
        assert!(!is_sha256_hex(&"a".repeat(63)));
    }

    #[test]
    fn office_ranges_are_validated() {
        let ranges = vec![PageRange { first: 2, last: 1 }];
        assert_eq!(
            validate_office_render(OfficeFormat::Docx, OfficeRenderTarget::Pdf, &ranges),
            Err(EngineError::BadRequest)
        );
        assert_eq!(
            validate_office_render(
                OfficeFormat::Docx,
                OfficeRenderTarget::Pdf,
                &[PageRange { first: 1, last: 3 }]
            ),
            Ok(())
        );
        // Templates are inspection inputs only.
        assert_eq!(
            validate_office_render(OfficeFormat::Potx, OfficeRenderTarget::Pdf, &[]),
            Err(EngineError::Unsupported)
        );
    }
}
