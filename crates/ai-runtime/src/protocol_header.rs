//! Fixed binary helper header (split for the 400-line rule).

use uuid::Uuid;

use crate::protocol::{HEADER_MAGIC, MAX_HEADER_BYTES, MAX_INPUT_BYTES, PROTOCOL_VERSION};
use crate::protocol_options::{
    decode_wire_options, encode_wire_options, read_u32, read_u64, task_from_tag, task_tag,
};
use crate::types::{
    AiDevice, AiLocale, AiTaskKind, AiTaskOptions, EmbedImageModel, EmbedMode, EmbedTextModel,
    ForegroundModel, InpaintModel, TranscribeLanguage, UpscaleModel, UpscaleScale, MAX_IMAGE_EDGE,
    MAX_IMAGE_PIXELS,
};

/// Fixed option block shared with `wire.h`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WireOptions {
    pub kind: AiTaskKind,
    pub scale: Option<UpscaleScale>,
    pub model: u8,
    pub device: AiDevice,
    pub preview_region: Option<(u32, u32, u32, u32)>,
    pub max_output_tokens: u32,
    pub seed: u64,
    pub temperature_milli: i32,
    pub threshold_milli: u32,
    pub mask_artifact_id: Option<Uuid>,
    pub embed_mode: EmbedMode,
    pub translate_to_english: bool,
    pub start_us: u64,
    pub end_us: Option<u64>,
    pub language: TranscribeLanguage,
}

pub fn wire_options(options: &AiTaskOptions) -> WireOptions {
    let mut wire = WireOptions {
        kind: options.kind(),
        scale: None,
        model: 0,
        device: AiDevice::Auto,
        preview_region: None,
        max_output_tokens: 0,
        seed: 0,
        temperature_milli: 0,
        threshold_milli: 500,
        mask_artifact_id: None,
        embed_mode: EmbedMode::Query,
        translate_to_english: false,
        start_us: 0,
        end_us: None,
        language: TranscribeLanguage::Auto,
    };
    match options {
        AiTaskOptions::StructuredText {
            max_output_tokens,
            temperature,
            seed,
        }
        | AiTaskOptions::VisionAnswer {
            max_output_tokens,
            temperature,
            seed,
        } => {
            wire.max_output_tokens = *max_output_tokens;
            wire.temperature_milli = (temperature * 1000.0).round() as i32;
            wire.seed = *seed;
        }
        AiTaskOptions::EmbedText { mode, model, .. } => {
            wire.embed_mode = *mode;
            wire.model = match model {
                EmbedTextModel::MultilingualE5Small => 1,
                EmbedTextModel::Siglip2Base => 2,
            };
        }
        AiTaskOptions::EmbedImage { model } => {
            wire.model = match model {
                EmbedImageModel::Siglip2Base => 2,
            };
        }
        AiTaskOptions::Transcribe {
            language,
            translate_to_english,
            start_us,
            end_us,
        } => {
            wire.language = *language;
            wire.translate_to_english = *translate_to_english;
            wire.start_us = *start_us;
            wire.end_us = *end_us;
        }
        AiTaskOptions::Upscale {
            scale,
            model,
            preview_region,
            device,
        } => {
            wire.scale = Some(*scale);
            wire.model = match model {
                UpscaleModel::General => 1,
                UpscaleModel::Photo => 2,
                UpscaleModel::Drawing => 3,
            };
            wire.preview_region =
                preview_region.map(|rect| (rect.x, rect.y, rect.width, rect.height));
            wire.device = *device;
        }
        AiTaskOptions::ForegroundMask { model, threshold } => {
            wire.model = match model {
                ForegroundModel::Birefnet => 4,
            };
            wire.threshold_milli = (threshold * 1000.0).round() as u32;
        }
        AiTaskOptions::Inpaint {
            model,
            mask_artifact_id,
        } => {
            wire.model = match model {
                InpaintModel::Migan => 5,
            };
            wire.mask_artifact_id = Some(*mask_artifact_id);
        }
    }
    wire
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelperHeader {
    pub task: AiTaskKind,
    /// Catalog model id, never a path.
    pub model_id: String,
    pub model_revision: String,
    pub options: WireOptions,
    pub locale: AiLocale,
    pub input_bytes: u64,
    pub input_width: u32,
    pub input_height: u32,
    pub output_width: u32,
    pub output_height: u32,
}

impl HelperHeader {
    pub fn validate(&self) -> Result<(), String> {
        if self.model_id.is_empty()
            || self.model_id.len() > crate::types::MAX_MODEL_ID
            || !self.model_id.is_ascii()
            || self.model_revision.is_empty()
            || self.model_revision.len() > crate::types::MAX_MODEL_REVISION
            || !self.model_revision.is_ascii()
            || self.options.kind != self.task
            || self.input_bytes == 0
            || self.input_bytes > MAX_INPUT_BYTES
            || self.input_width == 0
            || self.input_height == 0
            || self.output_width == 0
            || self.output_height == 0
            || self.input_width > MAX_IMAGE_EDGE
            || self.input_height > MAX_IMAGE_EDGE
            || self.output_width > MAX_IMAGE_EDGE
            || self.output_height > MAX_IMAGE_EDGE
            || u64::from(self.input_width) * u64::from(self.input_height) > MAX_IMAGE_PIXELS
            || u64::from(self.output_width) * u64::from(self.output_height) > MAX_IMAGE_PIXELS
            || (self.task == AiTaskKind::Upscale && self.options.scale.is_none())
            || (self.task == AiTaskKind::Upscale
                && (self.output_width != self.input_width.saturating_mul(4)
                    || self.output_height != self.input_height.saturating_mul(4)))
            || (self.task == AiTaskKind::Upscale
                && self.input_bytes
                    != u64::from(self.input_width) * u64::from(self.input_height) * 3)
        {
            return Err("ai.bad_request".into());
        }
        Ok(())
    }
}

fn push_str(out: &mut Vec<u8>, value: &str) -> Result<(), String> {
    let bytes = value.as_bytes();
    if bytes.len() > u16::MAX as usize {
        return Err("ai.bad_request".into());
    }
    out.extend_from_slice(&(bytes.len() as u16).to_le_bytes());
    out.extend_from_slice(bytes);
    Ok(())
}

fn take_str(bytes: &[u8], cursor: &mut usize) -> Result<String, String> {
    if *cursor + 2 > bytes.len() {
        return Err("ai.bad_request".into());
    }
    let length = u16::from_le_bytes([bytes[*cursor], bytes[*cursor + 1]]) as usize;
    *cursor += 2;
    if *cursor + length > bytes.len() {
        return Err("ai.bad_request".into());
    }
    let value = std::str::from_utf8(&bytes[*cursor..*cursor + length])
        .map_err(|_| "ai.bad_request")?
        .to_string();
    *cursor += length;
    Ok(value)
}

pub fn encode_header(header: &HelperHeader) -> Result<Vec<u8>, String> {
    header.validate()?;
    let mut out = Vec::with_capacity(128);
    out.extend_from_slice(&HEADER_MAGIC);
    out.extend_from_slice(&PROTOCOL_VERSION.to_le_bytes());
    out.push(task_tag(header.task));
    out.push(match header.locale {
        AiLocale::En => 1,
        AiLocale::Es => 2,
    });
    push_str(&mut out, &header.model_id)?;
    push_str(&mut out, &header.model_revision)?;
    out.extend_from_slice(&header.input_bytes.to_le_bytes());
    out.extend_from_slice(&header.input_width.to_le_bytes());
    out.extend_from_slice(&header.input_height.to_le_bytes());
    out.extend_from_slice(&header.output_width.to_le_bytes());
    out.extend_from_slice(&header.output_height.to_le_bytes());
    encode_wire_options(&mut out, &header.options);
    if out.len() > MAX_HEADER_BYTES {
        return Err("ai.bad_request".into());
    }
    Ok(out)
}

pub fn decode_header(bytes: &[u8]) -> Result<HelperHeader, String> {
    if bytes.len() < 64 || bytes.len() > MAX_HEADER_BYTES || bytes[..8] != HEADER_MAGIC {
        return Err("ai.bad_request".into());
    }
    let version = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]);
    if version != PROTOCOL_VERSION {
        return Err("ai.bad_request".into());
    }
    let task = task_from_tag(bytes[12])?;
    let locale = match bytes[13] {
        1 => AiLocale::En,
        2 => AiLocale::Es,
        _ => return Err("ai.bad_request".into()),
    };
    let mut cursor = 14usize;
    let model_id = take_str(bytes, &mut cursor)?;
    let model_revision = take_str(bytes, &mut cursor)?;
    let input_bytes = read_u64(bytes, &mut cursor)?;
    let input_width = read_u32(bytes, &mut cursor)?;
    let input_height = read_u32(bytes, &mut cursor)?;
    let output_width = read_u32(bytes, &mut cursor)?;
    let output_height = read_u32(bytes, &mut cursor)?;
    let options = decode_wire_options(task, bytes, &mut cursor)?;
    if cursor != bytes.len() {
        return Err("ai.bad_request".into());
    }
    let header = HelperHeader {
        task,
        model_id,
        model_revision,
        options,
        locale,
        input_bytes,
        input_width,
        input_height,
        output_width,
        output_height,
    };
    header.validate()?;
    Ok(header)
}
