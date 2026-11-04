//! Discriminated task options (split from `types.rs`).

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::types::{AiDevice, AiTaskKind, ImageRect, TimeUs};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EmbedMode {
    Query,
    Passage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EmbedTextModel {
    MultilingualE5Small,
    Siglip2Base,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EmbedImageModel {
    Siglip2Base,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TranscribeLanguage {
    Auto,
    En,
    Es,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum UpscaleScale {
    Two,
    #[default]
    Four,
}

impl UpscaleScale {
    pub fn factor(self) -> u32 {
        match self {
            UpscaleScale::Two => 2,
            UpscaleScale::Four => 4,
        }
    }
}

impl Serialize for UpscaleScale {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_u8(self.factor() as u8)
    }
}

impl<'de> Deserialize<'de> for UpscaleScale {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let factor = u8::deserialize(deserializer)?;
        match factor {
            2 => Ok(UpscaleScale::Two),
            4 => Ok(UpscaleScale::Four),
            _ => Err(serde::de::Error::custom("ai.bad_request")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpscaleModel {
    #[default]
    General,
    Photo,
    Drawing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ForegroundModel {
    Birefnet,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InpaintModel {
    Migan,
}

/// Discriminated options. The tag must equal `AiTaskRequest.task`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AiTaskOptions {
    StructuredText {
        #[serde(default = "default_max_output_tokens")]
        max_output_tokens: u32,
        #[serde(default)]
        temperature: f64,
        #[serde(default)]
        seed: u64,
    },
    VisionAnswer {
        #[serde(default = "default_max_output_tokens")]
        max_output_tokens: u32,
        #[serde(default)]
        temperature: f64,
        #[serde(default)]
        seed: u64,
    },
    EmbedText {
        mode: EmbedMode,
        model: EmbedTextModel,
        #[serde(default = "default_truncate_tokens")]
        truncate_tokens: u32,
    },
    EmbedImage {
        model: EmbedImageModel,
    },
    Transcribe {
        language: TranscribeLanguage,
        #[serde(default)]
        translate_to_english: bool,
        #[serde(default)]
        start_us: TimeUs,
        #[serde(default)]
        end_us: Option<TimeUs>,
    },
    Upscale {
        #[serde(default)]
        scale: UpscaleScale,
        #[serde(default)]
        model: UpscaleModel,
        #[serde(default)]
        preview_region: Option<ImageRect>,
        #[serde(default = "default_device")]
        device: AiDevice,
    },
    ForegroundMask {
        model: ForegroundModel,
        #[serde(default = "default_threshold")]
        threshold: f64,
    },
    Inpaint {
        model: InpaintModel,
        mask_artifact_id: Uuid,
    },
}

fn default_max_output_tokens() -> u32 {
    1_024
}
fn default_truncate_tokens() -> u32 {
    512
}
fn default_device() -> AiDevice {
    AiDevice::Auto
}
fn default_threshold() -> f64 {
    0.5
}

impl AiTaskOptions {
    pub fn kind(&self) -> AiTaskKind {
        match self {
            AiTaskOptions::StructuredText { .. } => AiTaskKind::StructuredText,
            AiTaskOptions::VisionAnswer { .. } => AiTaskKind::VisionAnswer,
            AiTaskOptions::EmbedText { .. } => AiTaskKind::EmbedText,
            AiTaskOptions::EmbedImage { .. } => AiTaskKind::EmbedImage,
            AiTaskOptions::Transcribe { .. } => AiTaskKind::Transcribe,
            AiTaskOptions::Upscale { .. } => AiTaskKind::Upscale,
            AiTaskOptions::ForegroundMask { .. } => AiTaskKind::ForegroundMask,
            AiTaskOptions::Inpaint { .. } => AiTaskKind::Inpaint,
        }
    }
}
