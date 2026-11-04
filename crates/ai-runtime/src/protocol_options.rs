//! Binary option block shared with `wire.h` (split for the 400-line rule).

use uuid::Uuid;

use crate::protocol_header::WireOptions;
use crate::types::{AiDevice, AiTaskKind, EmbedMode, TranscribeLanguage, UpscaleScale};

pub(crate) fn task_tag(task: AiTaskKind) -> u8 {
    match task {
        AiTaskKind::StructuredText => 1,
        AiTaskKind::VisionAnswer => 2,
        AiTaskKind::EmbedText => 3,
        AiTaskKind::EmbedImage => 4,
        AiTaskKind::Transcribe => 5,
        AiTaskKind::Upscale => 6,
        AiTaskKind::ForegroundMask => 7,
        AiTaskKind::Inpaint => 8,
    }
}

pub(crate) fn task_from_tag(tag: u8) -> Result<AiTaskKind, String> {
    Ok(match tag {
        1 => AiTaskKind::StructuredText,
        2 => AiTaskKind::VisionAnswer,
        3 => AiTaskKind::EmbedText,
        4 => AiTaskKind::EmbedImage,
        5 => AiTaskKind::Transcribe,
        6 => AiTaskKind::Upscale,
        7 => AiTaskKind::ForegroundMask,
        8 => AiTaskKind::Inpaint,
        _ => return Err("ai.bad_request".into()),
    })
}

pub(crate) fn encode_wire_options(out: &mut Vec<u8>, wire: &WireOptions) {
    out.push(task_tag(wire.kind));
    out.push(match wire.scale {
        Some(UpscaleScale::Two) => 2,
        Some(UpscaleScale::Four) => 4,
        None => 0,
    });
    out.push(wire.model);
    out.push(match wire.device {
        AiDevice::Auto => 0,
        AiDevice::Cpu => 1,
        AiDevice::Gpu => 2,
    });
    let region = wire.preview_region.unwrap_or((0, 0, 0, 0));
    for value in [region.0, region.1, region.2, region.3] {
        out.extend_from_slice(&value.to_le_bytes());
    }
    out.extend_from_slice(&wire.max_output_tokens.to_le_bytes());
    out.extend_from_slice(&wire.seed.to_le_bytes());
    out.extend_from_slice(&wire.temperature_milli.to_le_bytes());
    out.extend_from_slice(&wire.threshold_milli.to_le_bytes());
    out.extend_from_slice(wire.mask_artifact_id.unwrap_or(Uuid::nil()).as_bytes());
    out.push(match wire.embed_mode {
        EmbedMode::Query => 1,
        EmbedMode::Passage => 2,
    });
    out.push(u8::from(wire.translate_to_english));
    out.extend_from_slice(&wire.start_us.to_le_bytes());
    out.extend_from_slice(&wire.end_us.unwrap_or(u64::MAX).to_le_bytes());
    out.push(match wire.language {
        TranscribeLanguage::Auto => 0,
        TranscribeLanguage::En => 1,
        TranscribeLanguage::Es => 2,
    });
}

pub(crate) fn decode_wire_options(
    task: AiTaskKind,
    bytes: &[u8],
    cursor: &mut usize,
) -> Result<WireOptions, String> {
    let need = 4 + 16 + 4 + 8 + 4 + 4 + 16 + 1 + 1 + 8 + 8 + 1;
    if *cursor + need > bytes.len() {
        return Err("ai.bad_request".into());
    }
    if bytes[*cursor] != task_tag(task) {
        return Err("ai.bad_request".into());
    }
    *cursor += 1;
    let scale = match bytes[*cursor] {
        0 => None,
        2 => Some(UpscaleScale::Two),
        4 => Some(UpscaleScale::Four),
        _ => return Err("ai.bad_request".into()),
    };
    *cursor += 1;
    let model = bytes[*cursor];
    *cursor += 1;
    let device = match bytes[*cursor] {
        0 => AiDevice::Auto,
        1 => AiDevice::Cpu,
        2 => AiDevice::Gpu,
        _ => return Err("ai.bad_request".into()),
    };
    *cursor += 1;
    let mut region = [0u32; 4];
    for slot in &mut region {
        *slot = read_u32(bytes, cursor)?;
    }
    let max_output_tokens = read_u32(bytes, cursor)?;
    let seed = read_u64(bytes, cursor)?;
    let temperature_milli = i32::from_le_bytes(
        bytes[*cursor..*cursor + 4]
            .try_into()
            .map_err(|_| "ai.bad_request")?,
    );
    *cursor += 4;
    let threshold_milli = read_u32(bytes, cursor)?;
    let mut uuid = [0u8; 16];
    uuid.copy_from_slice(&bytes[*cursor..*cursor + 16]);
    *cursor += 16;
    let mask = Uuid::from_bytes(uuid);
    let embed_mode = match bytes[*cursor] {
        1 => EmbedMode::Query,
        2 => EmbedMode::Passage,
        _ => return Err("ai.bad_request".into()),
    };
    *cursor += 1;
    let translate_to_english = bytes[*cursor] != 0;
    *cursor += 1;
    let start_us = read_u64(bytes, cursor)?;
    let end_raw = read_u64(bytes, cursor)?;
    let language = match bytes[*cursor] {
        0 => TranscribeLanguage::Auto,
        1 => TranscribeLanguage::En,
        2 => TranscribeLanguage::Es,
        _ => return Err("ai.bad_request".into()),
    };
    *cursor += 1;
    Ok(WireOptions {
        kind: task,
        scale,
        model,
        device,
        preview_region: if region[2] == 0 || region[3] == 0 {
            None
        } else {
            Some((region[0], region[1], region[2], region[3]))
        },
        max_output_tokens,
        seed,
        temperature_milli,
        threshold_milli,
        mask_artifact_id: if mask.is_nil() { None } else { Some(mask) },
        embed_mode,
        translate_to_english,
        start_us,
        end_us: if end_raw == u64::MAX {
            None
        } else {
            Some(end_raw)
        },
        language,
    })
}

pub(crate) fn read_u32(bytes: &[u8], cursor: &mut usize) -> Result<u32, String> {
    if *cursor + 4 > bytes.len() {
        return Err("ai.bad_request".into());
    }
    let value = u32::from_le_bytes(bytes[*cursor..*cursor + 4].try_into().unwrap_or_default());
    *cursor += 4;
    Ok(value)
}

pub(crate) fn read_u64(bytes: &[u8], cursor: &mut usize) -> Result<u64, String> {
    if *cursor + 8 > bytes.len() {
        return Err("ai.bad_request".into());
    }
    let value = u64::from_le_bytes(bytes[*cursor..*cursor + 8].try_into().unwrap_or_default());
    *cursor += 8;
    Ok(value)
}
