//! Typed media options → one argument string (Step 12b T4).
//!
//! Options never become shell text (R-SEC-7). Every flag comes from a fixed
//! table here; user text (paths, a subtitle source name) is quoted with the
//! documented `CreateProcessW` algorithm and can never introduce a second
//! command, a redirect or a pipe. Nothing is ever passed to `cmd.exe`.
//!
//! The pure adapter (`crates/convert/src/media_adapter.rs`) validates the
//! typed options; this module only translates already-validated values.
#![allow(dead_code)]


use std::path::Path;

use convert::{FormatId, MediaConversionOptions};

use crate::engine_types::{FrameRate, PREVIEW_EDGE, PREVIEW_SAMPLE_US};

/// The preview filter: the picture fits the 512 px box without enlargement.
fn preview_video_filter() -> String {
    format!(
        "scale=w={edge}:h={edge}:force_original_aspect_ratio=decrease:force_divisible_by=2",
        edge = PREVIEW_EDGE
    )
}

/// Quote one argument exactly as the C runtime would parse it back.
pub fn quote_argument(value: &str) -> String {
    if !value.is_empty() && !value.contains([' ', '\t', '"']) {
        return value.to_string();
    }
    let mut quoted = String::with_capacity(value.len() + 2);
    quoted.push('"');
    let mut backslashes = 0usize;
    for character in value.chars() {
        match character {
            '\\' => backslashes += 1,
            '"' => {
                for _ in 0..=backslashes * 2 {
                    quoted.push('\\');
                }
                quoted.push('"');
                backslashes = 0;
            }
            other => {
                for _ in 0..backslashes {
                    quoted.push('\\');
                }
                backslashes = 0;
                quoted.push(other);
            }
        }
    }
    for _ in 0..backslashes * 2 {
        quoted.push('\\');
    }
    quoted.push('"');
    quoted
}

/// Join arguments into the single command line `CreateProcessW` receives.
pub fn command_line(arguments: &[String]) -> String {
    arguments
        .iter()
        .map(|argument| quote_argument(argument))
        .collect::<Vec<_>>()
        .join(" ")
}

/// The inverse of `quote_argument`, for verifying a built line in tests.
pub(crate) fn split_arguments(line: &str) -> Vec<String> {
    let mut arguments = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut started = false;
    let mut backslashes = 0usize;
    let mut characters = line.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            ' ' | '\t' if !in_quotes => {
                if started {
                    arguments.push(std::mem::take(&mut current));
                    started = false;
                }
                backslashes = 0;
            }
            '\\' => {
                backslashes += 1;
                started = true;
            }
            '"' => {
                if backslashes % 2 == 1 {
                    for _ in 0..backslashes / 2 {
                        current.push('\\');
                    }
                    current.push('"');
                } else {
                    for _ in 0..backslashes / 2 {
                        current.push('\\');
                    }
                    if in_quotes && characters.peek().is_none() {
                        in_quotes = false;
                    } else {
                        in_quotes = !in_quotes;
                    }
                }
                backslashes = 0;
                started = true;
            }
            other => {
                for _ in 0..backslashes {
                    current.push('\\');
                }
                backslashes = 0;
                current.push(other);
                started = true;
            }
        }
    }
    for _ in 0..backslashes {
        current.push('\\');
    }
    if started {
        arguments.push(current);
    }
    arguments
}

/// Microseconds as a decimal second value with exactly six places, so the
/// integer timing contract is never rounded through floating milliseconds.
pub fn seconds_from_us(microseconds: u64) -> String {
    format!("{}.{:06}", microseconds / 1_000_000, microseconds % 1_000_000)
}

/// `ffprobe` arguments: bounded JSON on stdout, no stdin.
pub fn probe_arguments(input: &Path) -> Vec<String> {
    let mut arguments: Vec<String> = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        "-i",
    ]
    .iter()
    .map(|flag| flag.to_string())
    .collect();
    arguments.push(input.to_string_lossy().into_owned());
    arguments
}

/// A three-second preview sample at a 512 px edge. Video becomes VP9/Opus in
/// WebM; audio becomes a short PCM WAV that our own viewer already plays.
pub fn preview_arguments(
    input: &Path,
    output: &Path,
    start_us: u64,
    duration_us: u64,
    audio_only: bool,
) -> Vec<String> {
    let duration = duration_us.clamp(1, PREVIEW_SAMPLE_US);
    let mut arguments = base_arguments();
    arguments.push("-ss".to_string());
    arguments.push(seconds_from_us(start_us));
    arguments.push("-i".to_string());
    arguments.push(input.to_string_lossy().into_owned());
    arguments.push("-t".to_string());
    arguments.push(seconds_from_us(duration));
    if audio_only {
        arguments.extend(strings(&[
            "-vn", "-sn", "-dn", "-map", "0:a:0", "-c:a", "pcm_s16le", "-f", "wav",
        ]));
    } else {
        arguments.extend(strings(&["-map", "0:v:0", "-map", "0:a:0?"]));
        arguments.extend(pair("-vf", &preview_video_filter()));
        arguments.extend(strings(&[
            "-r", "10", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34", "-c:a", "libopus",
            "-b:a", "48k", "-f", "webm",
        ]));
    }
    arguments.push("-y".to_string());
    arguments.push(output.to_string_lossy().into_owned());
    arguments
}

/// The arguments of one media conversion. Everything comes from validated
/// typed values; no option string is ever concatenated by the caller.
pub fn convert_arguments(
    input: &Path,
    output: &Path,
    format: &FormatId,
    options: &MediaConversionOptions,
    video: bool,
) -> Vec<String> {
    let mut arguments = base_arguments();
    if let Some(start_ms) = options.start_ms {
        arguments.push("-ss".to_string());
        arguments.push(seconds_from_us(start_ms.saturating_mul(1000)));
    }
    arguments.push("-i".to_string());
    arguments.push(input.to_string_lossy().into_owned());
    if let Some(end_ms) = options.end_ms {
        let start_ms = options.start_ms.unwrap_or(0);
        let length = end_ms.saturating_sub(start_ms).saturating_mul(1000);
        if length > 0 {
            arguments.push("-t".to_string());
            arguments.push(seconds_from_us(length));
        }
    }
    // Metadata stays by default (D6); clearing it is an explicit choice.
    arguments.extend(strings(if options.keep_metadata {
        &["-map_metadata", "0"]
    } else {
        &["-map_metadata", "-1"]
    }));
    // 0 is the shared "keep the source size" value; it never becomes a
    // zero-pixel scale filter.
    if let Some(width) = options.width.filter(|width| *width > 0) {
        let height = options.height.filter(|height| *height > 0);
        arguments.extend(pair("-vf", &fit_filter(width, height)));
    }
    if let Some(rate) = options.sample_rate {
        arguments.extend(pair("-ar", &rate.to_string()));
    }
    if let Some(bitrate) = options.bitrate_kbps {
        arguments.extend(pair("-b:v", &format!("{bitrate}k")));
    }
    if (options.speed - 1.0).abs() > f64::EPSILON {
        arguments.extend(pair("-filter:a", &format!("atempo={:.3}", options.speed)));
    }
    if (options.volume - 1.0).abs() > f64::EPSILON {
        arguments.extend(pair("-filter:a", &format!("volume={:.3}", options.volume)));
    }
    if !options.burn_subtitles {
        arguments.extend(strings(&["-sn"]));
    }
    let codecs = codecs_for(format, video);
    arguments.extend(codecs);
    arguments.push("-y".to_string());
    arguments.push(output.to_string_lossy().into_owned());
    arguments
}

/// The exact `-c:v`/`-c:a` values of one container. Anything that needs a
/// codec the audited build does not enumerate stays out of this table.
fn codecs_for(format: &FormatId, video: bool) -> Vec<String> {
    let mut codecs: Vec<String> = Vec::new();
    let name = format_name(format);
    match name {
        "webm" => codecs.extend(strings(&["-c:v", "libvpx-vp9", "-c:a", "libopus"])),
        "mp4" | "mov" => codecs.extend(strings(&["-c:v", "mpeg4", "-c:a", "aac"])),
        "mkv" => codecs.extend(strings(&["-c:v", "libvpx-vp9", "-c:a", "libopus"])),
        // GIF carries no audio stream; dropping it is the loss the caller
        // acknowledged, not something ffmpeg may decide differently.
        "gif" => codecs.extend(strings(&["-an", "-c:v", "gif"])),
        "mp3" => codecs.extend(strings(&["-c:a", "libmp3lame"])),
        "opus" | "ogg" => codecs.extend(strings(&["-c:a", "libopus"])),
        "flac" => codecs.extend(strings(&["-c:a", "flac"])),
        "wav" => codecs.extend(strings(&["-c:a", "pcm_s16le"])),
        "aac" => codecs.extend(strings(&["-c:a", "aac"])),
        _ => {}
    }
    if !video {
        codecs.retain(|value| {
            !value.starts_with("-c:v") && value != "libvpx-vp9" && value != "mpeg4" && value != "gif"
        });
        codecs.extend(strings(&["-vn"]));
    }
    codecs
}

/// The lowercase name of a format ID without guessing at an extension. This
/// table is the only place media and Office output formats are named. Text
/// has no `FormatId`: the Office text target is named, together with its
/// `text/plain` MIME, by `OfficeRenderTarget`.
pub fn format_name(format: &FormatId) -> &'static str {
    match format {
        FormatId::Webm => "webm",
        FormatId::Mp4 => "mp4",
        FormatId::Mkv => "mkv",
        FormatId::Mov => "mov",
        FormatId::Gif => "gif",
        FormatId::Mp3 => "mp3",
        FormatId::Opus => "opus",
        FormatId::Ogg => "ogg",
        FormatId::Flac => "flac",
        FormatId::Wav => "wav",
        FormatId::Aac => "aac",
        FormatId::Pdf => "pdf",
        FormatId::Html => "html",
        _ => "bin",
    }
}

/// The MIME of one produced container, detected by the parent afterwards.
pub fn format_mime(format: &FormatId) -> &'static str {
    match format {
        FormatId::Webm => "video/webm",
        FormatId::Mp4 => "video/mp4",
        FormatId::Mkv => "video/x-matroska",
        FormatId::Mov => "video/quicktime",
        FormatId::Gif => "image/gif",
        FormatId::Mp3 => "audio/mpeg",
        FormatId::Opus => "audio/opus",
        FormatId::Ogg => "audio/ogg",
        FormatId::Flac => "audio/flac",
        FormatId::Wav => "audio/wav",
        FormatId::Aac => "audio/aac",
        FormatId::Pdf => "application/pdf",
        FormatId::Html => "text/html",
        _ => "application/octet-stream",
    }
}

/// The first-frame timestamp of the frame grid of `rate` at or after `start`.
pub fn first_frame_at_or_after(start_us: u64, rate: Option<FrameRate>) -> u64 {
    let Some(rate) = rate else {
        return start_us;
    };
    let Some(frame_us) = rate.frame_us() else {
        return start_us;
    };
    if frame_us == 0 {
        return start_us;
    }
    // Exact frame boundaries can fall between microseconds (30 fps is
    // 33333.33 us); round the target frame's timestamp up.
    let numerator = u128::from(rate.num);
    let denominator = u128::from(rate.den) * 1_000_000;
    let frame_index = (u128::from(start_us) * numerator).div_ceil(denominator);
    let timestamp = (frame_index * denominator).div_ceil(numerator);
    u64::try_from(timestamp).unwrap_or(u64::MAX)
}

fn base_arguments() -> Vec<String> {
    strings(&["-nostdin", "-hide_banner", "-loglevel", "error", "-progress", "pipe:1"])
}

fn fit_filter(width: u32, height: Option<u32>) -> String {
    let height = height.unwrap_or(width);
    format!("scale=w={width}:h={height}:force_original_aspect_ratio=decrease")
}

fn pair(flag: &str, value: &str) -> Vec<String> {
    vec![flag.to_string(), value.to_string()]
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quoting_survives_the_documented_parser() {
        for value in [
            "plain.mp4",
            "with space.mp4",
            "quote\"inside.mp4",
            "trailing\\",
            "back\\\\slash",
            "",
            "日本語 の ファイル.mp4",
        ] {
            let quoted = quote_argument(value);
            assert_eq!(
                split_arguments(&quoted),
                vec![value.to_string()],
                "round trip of {value:?}"
            );
        }
    }

    #[test]
    fn timings_never_round_through_milliseconds() {
        assert_eq!(seconds_from_us(1), "0.000001");
        assert_eq!(seconds_from_us(1_000_000), "1.000000");
        assert_eq!(first_frame_at_or_after(33_333, FrameRate::new(30, 1)), 33_334);
        assert_eq!(first_frame_at_or_after(33_333, None), 33_333);
    }

    #[test]
    fn codec_tables_only_name_audited_encoders() {
        assert!(codecs_for(&FormatId::Webm, true).contains(&"libvpx-vp9".to_string()));
        let audio_only = codecs_for(&FormatId::Mp3, false);
        assert!(audio_only.contains(&"-vn".to_string()));
        assert!(!audio_only.contains(&"libvpx-vp9".to_string()));
    }
}
