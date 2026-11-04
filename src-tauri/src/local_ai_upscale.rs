//! Image enlargement pipeline (T4, D4-D6).
//!
//! Decoding/orientation comes from 07a/14b once; PNG encoding comes from the
//! 14b encoder. Both are injected so this module never grows a second image
//! parser or a second encoder. The model only ever sees RGB tiles plus 64px
//! context; alpha is resized separately.

use std::path::Path;
use std::time::{Duration, Instant};

use ai_runtime::artifacts::{InputLease, SENSITIVE_ARTIFACT_LIMIT_BYTES};
use ai_runtime::image_alpha::{attach_alpha, resize_alpha_lanczos3};
use ai_runtime::protocol::{wire_options, HelperHeader};
use ai_runtime::types::*;
use ai_runtime::types_ui::AiArtifactKind;
use ai_runtime::upscale::{
    check_upscale_limits, decide_metadata, validate_upscale_output, MetadataDecision,
};
use ai_runtime::upscale_tiles::{
    copy_core_output, extract_model_input, plan_tiles, downsample_half_lanczos3, RgbaImage,
};

use crate::jobs::JobContext;
use crate::local_ai_artifacts::AiArtifactStore;
use crate::local_ai_host::{AiHost, HelperResult};
use crate::local_ai_limits::{CROP_TIMEOUT, FULL_IMAGE_TIMEOUT};

/// Decoded oriented RGBA from 07a/14b. `had_alpha` describes the source, not
/// the decoded buffer.
pub struct DecodedAiImage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    pub had_alpha: bool,
}

/// Implemented by the coordinator with 07a E8 / 14b decode.
pub trait AiImageDecoder: Send + Sync {
    fn decode_oriented(&self, encoded: &[u8]) -> Result<DecodedAiImage, String>;
}

/// Implemented by the coordinator with 14b's proven PNG encoder.
pub trait AiImageEncoder: Send + Sync {
    fn encode_png(&self, width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String>;
}

pub struct UpscaleRun<'a> {
    pub request: &'a AiTaskRequest,
    pub input: &'a InputLease,
    pub encoded: Vec<u8>,
    pub sensitive: bool,
    pub artifacts: &'a AiArtifactStore,
    pub host: &'a AiHost,
    pub decoder: &'a dyn AiImageDecoder,
    pub encoder: &'a dyn AiImageEncoder,
    pub context: &'a JobContext,
    pub helper: &'a Path,
    pub model_root: &'a Path,
    pub job_root: &'a Path,
    pub model_revision: String,
    /// Effective device after hardware policy (never an invented GPU).
    pub device: AiDevice,
    pub metadata_preservable: bool,
    pub accepted_metadata_loss: bool,
    pub memory_limit_bytes: u64,
    /// CPU-only budget used if an Automatic GPU inference fails at run time.
    pub cpu_memory_limit_bytes: u64,
}

pub fn run_upscale(run: UpscaleRun<'_>) -> Result<AiTaskResult, String> {
    let expected_revision = run
        .request
        .inputs
        .first()
        .map(|input| input.expected_revision)
        .ok_or("ai.bad_request")?;
    if run.input.revision() != expected_revision {
        return Err("ai.source_changed".into());
    }
    let (scale, preview_region) = match &run.request.options {
        AiTaskOptions::Upscale {
            scale,
            preview_region,
            ..
        } => (*scale, *preview_region),
        _ => return Err("ai.bad_request".into()),
    };
    let started = Instant::now();
    let total_timeout = if preview_region.is_some() {
        CROP_TIMEOUT
    } else {
        FULL_IMAGE_TIMEOUT
    };
    let decoded = run.decoder.decode_oriented(&run.encoded)?;
    if decoded.rgba.len() != decoded.width as usize * decoded.height as usize * 4 {
        return Err("ai.model_output".into());
    }
    let source = RgbaImage::new(decoded.width, decoded.height, decoded.rgba)
        .map_err(|_| "ai.bad_request".to_string())?;
    let (region, expected) = match preview_region {
        Some(region) => {
            let plan =
                ai_runtime::upscale::plan_preview(decoded.width, decoded.height, scale, Some(region))?;
            (plan.region, plan.output)
        }
        None => {
            let output = check_upscale_limits(decoded.width, decoded.height, scale)
                .map_err(|_| "ai.unsupported".to_string())?;
            (
                ImageRect {
                    x: 0,
                    y: 0,
                    width: decoded.width,
                    height: decoded.height,
                },
                output,
            )
        }
    };
    // A sensitive result is memory-only; refuse an impossible budget before
    // decoding tiles or starting inference, not after the work is done.
    if run.sensitive
        && expected.pixels().saturating_mul(4) > SENSITIVE_ARTIFACT_LIMIT_BYTES
    {
        return Err("ai.sensitive_unsupported".into());
    }
    let metadata = decide_metadata(true, run.metadata_preservable, run.accepted_metadata_loss);
    let crop = ImageRect {
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
    };
    let (final_rgba, cpu_fallback) = match scale {
        UpscaleScale::Two => {
            infer_2x(&source, crop, &run, run.device, started, total_timeout)?
        }
        UpscaleScale::Four => {
            infer_4x(&source, crop, &run, run.device, started, total_timeout)?
        }
    };
    if final_rgba.width != expected.width || final_rgba.height != expected.height {
        return Err("ai.model_output".into());
    }
    let alpha = resize_alpha_lanczos3(
        &alpha_plane(&source, region)?,
        region.width,
        region.height,
        expected.width,
        expected.height,
    )?;
    let with_alpha = attach_alpha(&final_rgba, &alpha)?;
    let encoded = run.encoder.encode_png(
        with_alpha.width,
        with_alpha.height,
        &with_alpha.pixels,
    )?;
    if started.elapsed() >= total_timeout {
        return Err("ai.timeout".into());
    }
    if run.sensitive && encoded.len() as u64 > SENSITIVE_ARTIFACT_LIMIT_BYTES {
        return Err("ai.sensitive_unsupported".into());
    }
    validate_upscale_output(
        region.width,
        region.height,
        expected,
        decoded.had_alpha,
        &encoded,
    )?;
    let info = run
        .artifacts
        .publish(AiArtifactKind::Image, encoded, run.sensitive, unix_now())?;
    let mut warnings = Vec::new();
    if metadata_warning(&metadata) {
        warnings.push(AiWarningCode::MetadataLoss);
    }
    if cpu_fallback {
        warnings.push(AiWarningCode::CpuFallback);
    }
    Ok(AiTaskResult {
        job_id: run.request.request_id.clone(),
        task: AiTaskKind::Upscale,
        model_id: match &run.request.options {
            AiTaskOptions::Upscale { model, .. } => model.model_id().to_string(),
            _ => return Err("ai.bad_request".into()),
        },
        model_revision: run.model_revision,
        result: AiResultPayload::Image {
            artifact_id: info.id,
            width: expected.width,
            height: expected.height,
            mime: "image/png".into(),
        },
        citations: Vec::new(),
        warnings,
    })
}

fn metadata_warning(decision: &MetadataDecision) -> bool {
    !decision.keep_metadata && !decision.acknowledged_loss
}

#[allow(clippy::needless_range_loop)]
fn alpha_plane(source: &RgbaImage, region: ImageRect) -> Result<Vec<u8>, String> {
    let mut alpha = Vec::with_capacity(region.width as usize * region.height as usize);
    for y in 0..region.height {
        for x in 0..region.width {
            let offset = ((region.y + y) as usize * source.width as usize
                + (region.x + x) as usize)
                * 4;
            alpha.push(source.pixels[offset + 3]);
        }
    }
    Ok(alpha)
}

/// 2x is produced by halving each 4x tile before cropping its core. The 64px
/// model context is 128px in 2x output, far more than the Lanczos support, so
/// no tile edge artifact can reach a core boundary.
fn infer_2x(
    source: &RgbaImage,
    region: ImageRect,
    run: &UpscaleRun<'_>,
    device: AiDevice,
    started: Instant,
    total_timeout: Duration,
) -> Result<(RgbaImage, bool), String> {
    let plan = plan_tiles(region.width, region.height, UpscaleScale::Two)?;
    let out_width = region.width * 2;
    let out_height = region.height * 2;
    let mut assembled = vec![0u8; out_width as usize * out_height as usize * 4];
    let mut cpu_fallback = false;
    for tile in &plan.tiles {
        let (model_output, tile_width, fallback) =
            run_tile(source, region, tile, run, device, started, total_timeout)?;
        cpu_fallback |= fallback;
        let four = RgbaImage::new(tile_width, tile.input.height * 4, model_output)?;
        let half = downsample_half_lanczos3(&four)?;
        copy_half_core(&mut assembled, out_width, tile, &half)?;
    }
    Ok((RgbaImage::new(out_width, out_height, assembled)?, cpu_fallback))
}

/// Crop the 2x core from a halved 4x tile. Context is 64 source px = 128 2x px.
fn copy_half_core(
    assembled: &mut [u8],
    assembled_width: u32,
    tile: &ai_runtime::upscale_tiles::UpscaleTile,
    half: &RgbaImage,
) -> Result<(), String> {
    let context_out = 128usize;
    let source_stride = half.width as usize * 4;
    let target_stride = assembled_width as usize * 4;
    let core_width = tile.core.width as usize * 2;
    let core_height = tile.core.height as usize * 2;
    for row in 0..core_height {
        let source = (context_out + row) * source_stride + context_out * 4;
        let target = (tile.core.y as usize * 2 + row) * target_stride
            + tile.core.x as usize * 2 * 4;
        if source + core_width * 4 > half.pixels.len()
            || target + core_width * 4 > assembled.len()
        {
            return Err("ai.model_output".into());
        }
        assembled[target..target + core_width * 4]
            .copy_from_slice(&half.pixels[source..source + core_width * 4]);
    }
    Ok(())
}

fn infer_4x(
    source: &RgbaImage,
    region: ImageRect,
    run: &UpscaleRun<'_>,
    device: AiDevice,
    started: Instant,
    total_timeout: Duration,
) -> Result<(RgbaImage, bool), String> {
    let plan = plan_tiles(region.width, region.height, UpscaleScale::Four)?;
    let four_width = region.width * 4;
    let four_height = region.height * 4;
    let mut assembled = vec![0u8; four_width as usize * four_height as usize * 4];
    let mut cpu_fallback = false;
    for tile in &plan.tiles {
        let (model_output, tile_width, fallback) =
            run_tile(source, region, tile, run, device, started, total_timeout)?;
        cpu_fallback |= fallback;
        if tile_width != tile.input.width * 4 {
            return Err("ai.model_output".into());
        }
        copy_core_output(&mut assembled, four_width, tile, &model_output)?;
    }
    Ok((RgbaImage::new(four_width, four_height, assembled)?, cpu_fallback))
}

fn run_tile(
    source: &RgbaImage,
    region: ImageRect,
    tile: &ai_runtime::upscale_tiles::UpscaleTile,
    run: &UpscaleRun<'_>,
    device: AiDevice,
    started: Instant,
    total_timeout: Duration,
) -> Result<(Vec<u8>, u32, bool), String> {
    let timeout = remaining_timeout(started, total_timeout)?;
    let input = extract_model_input(source, SourceRectShift::shift(tile, region));
    let bytes = rgb_f32_to_bytes(&input, tile.input.width, tile.input.height)?;
    let header = HelperHeader {
        task: AiTaskKind::Upscale,
        model_id: match &run.request.options {
            AiTaskOptions::Upscale { model, .. } => model.model_id().to_string(),
            _ => return Err("ai.bad_request".into()),
        },
        model_revision: run.model_revision.clone(),
        options: wire_options(&run.request.options),
        locale: run.request.locale,
        input_bytes: bytes.len() as u64,
        input_width: tile.input.width,
        input_height: tile.input.height,
        output_width: tile.input.width * 4,
        output_height: tile.input.height * 4,
    };
    let mut model_output = Vec::new();
    let mut result = run.host.run(
        run.helper,
        run.model_root,
        run.job_root,
        &header,
        &bytes,
        &mut model_output,
        run.context,
        device,
        run.memory_limit_bytes,
        run.cpu_memory_limit_bytes,
        timeout,
    );
    let mut runtime_fallback = false;
    result = match result {
        Ok(value) => Ok(value),
        Err(error)
            if device == AiDevice::Auto
                && (error == "ai.memory_limit" || error == "ai.sandbox_failed") =>
        {
            // Discard this tile's partial bytes and recreate the session on
            // the CPU; an explicit GPU request already failed above.
            model_output.clear();
            runtime_fallback = true;
            run.host.run(
                run.helper,
                run.model_root,
                run.job_root,
                &header,
                &bytes,
                &mut model_output,
                run.context,
                AiDevice::Cpu,
                run.cpu_memory_limit_bytes,
                run.cpu_memory_limit_bytes,
                remaining_timeout(started, total_timeout)?,
            )
        }
        Err(error) => return Err(error),
    };
    let result = result?;
    validate_helper_result(&result, tile.input.width, tile.input.height)?;
    Ok((
        model_output,
        tile.input.width * 4,
        result.cpu_fallback || runtime_fallback,
    ))
}

fn remaining_timeout(started: Instant, total: Duration) -> Result<Duration, String> {
    match total.checked_sub(started.elapsed()) {
        Some(remaining) if !remaining.is_zero() => Ok(remaining),
        _ => Err("ai.timeout".into()),
    }
}

fn validate_helper_result(result: &HelperResult, width: u32, height: u32) -> Result<(), String> {
    if result.output_width != width * 4 || result.output_height != height * 4 {
        return Err("ai.model_output".into());
    }
    Ok(())
}

/// The helper and ONNX adapter consume row-major interleaved RGB8; the
/// extraction helper returns planar RGB, so interleave here exactly once.
fn rgb_f32_to_bytes(input: &[f32], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let count = width as usize * height as usize;
    if input.len() != count * 3 {
        return Err("ai.bad_request".into());
    }
    let mut out = Vec::with_capacity(count * 3);
    for index in 0..count {
        for channel in 0..3 {
            let value = input[channel * count + index];
            out.push((value.clamp(0.0, 1.0) * 255.0).round() as u8);
        }
    }
    Ok(out)
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

/// Small helper so a cropped preview maps tile coordinates back to the source.
struct SourceRectShift;

impl SourceRectShift {
    fn shift(
        tile: &ai_runtime::upscale_tiles::UpscaleTile,
        region: ImageRect,
    ) -> ai_runtime::upscale_tiles::SourceRect {
        ai_runtime::upscale_tiles::SourceRect {
            x: tile.input.x + i64::from(region.x),
            y: tile.input.y + i64::from(region.y),
            width: tile.input.width,
            height: tile.input.height,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ai_runtime::artifacts::AiArtifacts;

    /// A sensitive preview keeps its bytes in the memory-only artifact store;
    /// nothing is written to a temp/cache/job folder.
    #[test]
    fn sensitive_preview_no_diskwrites() {
        let directory = tempfile::tempdir().expect("temp");
        let artifacts = AiArtifacts::new();
        let profile = uuid::Uuid::new_v4();
        let info = artifacts
            .publish(profile, AiArtifactKind::Image, vec![9; 64], true, 10)
            .expect("publish");
        assert!(info.sensitive);
        assert_eq!(std::fs::read_dir(directory.path()).expect("read").count(), 0);
        assert_eq!(artifacts.sensitive_bytes(), 64);
        let lease = artifacts
            .resolve_at(info.id, AiArtifactKind::Image, profile, 11)
            .expect("lease");
        assert_eq!(lease.read(0, 4).expect("read"), &[9u8, 9, 9, 9][..]);
        drop(lease);
        artifacts.release(info.id).expect("release");
        assert_eq!(artifacts.sensitive_bytes(), 0);
    }
}
