//! Canonical AI wire types (revision `ai-runtime-1`).
//!
//! Wire structs use snake_case fields, UUIDs as strings and non-negative
//! integer counts/times. `src/services/localAiTypes.ts` mirrors these names.
//! Task options live in `options.rs` and are re-exported here.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub use crate::options::*;

/// The existing `runJob`/`newRequestId` ASCII id; at most 64 characters.
pub type JobRequestId = String;
/// Microseconds, the same unit as 12b `engineTypes.TimeUs`.
pub type TimeUs = u64;
/// Native-issued profile identity. Artifacts and inputs never cross profiles.
pub type ProfileId = Uuid;

pub const MAX_REQUEST_ID: usize = 64;
pub const MAX_PROMPT_VALUE_SCALARS: usize = 65_536;
pub const MAX_PROMPT_ARGUMENTS: usize = 32;
pub const MAX_INPUTS: usize = 128;
pub const MAX_CITATIONS: usize = 256;
pub const MAX_WARNINGS: usize = 32;
pub const MAX_TEXT_CHUNKS: usize = 64;
pub const MAX_TEXT_CHUNK_BYTES: usize = 65_536;
pub const MAX_TEXT_PAGE_BYTES: usize = 65_536;
pub const MAX_STRUCTURED_OUTPUT_BYTES: usize = 262_144;
pub const MAX_MODEL_ID: usize = 96;
pub const MAX_MODEL_REVISION: usize = 64;
pub const MAX_TEMPLATE_ID: usize = 96;
pub const MAX_SCHEMA_ID: usize = 96;
pub const MAX_ARGUMENT_NAME: usize = 64;
pub const MAX_CITATION_QUOTE_SCALARS: usize = 500;
pub const MAX_IMAGE_EDGE: u32 = 32_768;
pub const MAX_IMAGE_PIXELS: u64 = 100_000_000;
pub const MAX_ENCODED_INPUT_BYTES: u64 = 268_435_456;
pub const MAX_BATCH_ITEMS: usize = 1_000;
pub const MAX_CONTEXT_TOKENS: u32 = 8_192;
pub const MAX_OUTPUT_TOKENS: u32 = 4_096;
pub const MAX_EMBEDDING_ROWS: u32 = 128;
pub const DEFAULT_IDLE_UNLOAD_SECONDS: u32 = 120;
pub const MIN_IDLE_UNLOAD_SECONDS: u32 = 30;
pub const MAX_IDLE_UNLOAD_SECONDS: u32 = 600;
pub const DEFAULT_MEMORY_LIMIT_MB: u32 = 4_096;
pub const MIN_MEMORY_LIMIT_MB: u32 = 512;
pub const MAX_MEMORY_LIMIT_MB: u32 = 8_192;

/// Every task the runtime reserves a typed variant for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiTaskKind {
    StructuredText,
    VisionAnswer,
    EmbedText,
    EmbedImage,
    Transcribe,
    Upscale,
    ForegroundMask,
    Inpaint,
}

impl AiTaskKind {
    pub const ALL: [AiTaskKind; 8] = [
        AiTaskKind::StructuredText,
        AiTaskKind::VisionAnswer,
        AiTaskKind::EmbedText,
        AiTaskKind::EmbedImage,
        AiTaskKind::Transcribe,
        AiTaskKind::Upscale,
        AiTaskKind::ForegroundMask,
        AiTaskKind::Inpaint,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            AiTaskKind::StructuredText => "structured_text",
            AiTaskKind::VisionAnswer => "vision_answer",
            AiTaskKind::EmbedText => "embed_text",
            AiTaskKind::EmbedImage => "embed_image",
            AiTaskKind::Transcribe => "transcribe",
            AiTaskKind::Upscale => "upscale",
            AiTaskKind::ForegroundMask => "foreground_mask",
            AiTaskKind::Inpaint => "inpaint",
        }
    }

    pub fn is_image_task(self) -> bool {
        matches!(
            self,
            AiTaskKind::Upscale | AiTaskKind::ForegroundMask | AiTaskKind::Inpaint
        )
    }
}

/// The two user interface languages of this step.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiLocale {
    En,
    Es,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiDevice {
    Auto,
    Cpu,
    Gpu,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiTier {
    Auto,
    Small,
    Default,
    Pro,
}

/// A native-issued, profile-bound source reference.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiInputKind {
    Document,
    Snapshot,
    Artifact,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiInputRef {
    pub kind: AiInputKind,
    pub id: Uuid,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiPromptTrust {
    User,
    Source,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiPromptArgument {
    pub name: String,
    pub value: String,
    pub trust: AiPromptTrust,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiPromptRequest {
    pub template_id: String,
    pub template_revision: u32,
    pub arguments: Vec<AiPromptArgument>,
    pub output_schema_id: String,
}

/// A rectangle inside the oriented source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImageRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiTaskRequest {
    pub request_id: JobRequestId,
    pub task: AiTaskKind,
    pub locale: AiLocale,
    pub inputs: Vec<AiInputRef>,
    pub prompt: Option<AiPromptRequest>,
    pub options: AiTaskOptions,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiWarningCode {
    CpuFallback,
    Approximate,
    Truncated,
    Experimental,
    MetadataLoss,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EmbeddingNormalization {
    L2,
}

/// What one completed task produced. Exactly one variant is present.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AiResultPayload {
    Structured {
        schema_id: String,
        canonical_json: String,
    },
    Embeddings {
        artifact_id: Uuid,
        rows: u32,
        dimensions: u16,
        normalization: EmbeddingNormalization,
    },
    Transcript {
        artifact_id: Uuid,
        duration_us: TimeUs,
        segment_count: u32,
    },
    Image {
        artifact_id: Uuid,
        width: u32,
        height: u32,
        mime: String,
    },
    Mask {
        artifact_id: Uuid,
        width: u32,
        height: u32,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AiSourceLocation {
    Text { start: u64, end: u64 },
    Page { page: u32 },
    Time { start_us: TimeUs, end_us: TimeUs },
    Sheet { sheet_id: String, range: String },
    Slide { slide_id: String },
    Image { region: Option<ImageRect> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiCitation {
    pub input_id: Uuid,
    pub revision: u64,
    pub location: AiSourceLocation,
    pub quote: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiTaskResult {
    pub job_id: JobRequestId,
    pub task: AiTaskKind,
    pub model_id: String,
    pub model_revision: String,
    pub result: AiResultPayload,
    pub citations: Vec<AiCitation>,
    pub warnings: Vec<AiWarningCode>,
}
