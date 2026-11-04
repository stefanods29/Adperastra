//! Local transcription commands (`speech-1` E3).
//!
//! Speech is an independent optional pack (`ai_speech`); it never needs the
//! assistant and never uses the network. The 12b engine supplies authorized
//! PCM and the confined helper runs whisper.cpp. Without those producers the
//! command reports `speech.pack_missing`; no transcript is invented.
#![allow(dead_code)]


use ai_runtime::AiInputRef;
use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;
use std::sync::OnceLock;
use tauri::{AppHandle, State, WebviewWindow};
use uuid::Uuid;

use crate::ai_actions::active_profile;
use crate::jobs::{spawn_job, Jobs};
use crate::speech_captions::{caption_input, caption_window, caption_generations};
use crate::speech_decode::{chunk_frames, plan_chunks, DecodeClock, PcmChunk};
use crate::speech_overlap::{merge_chunks, SegmentDraft};
use crate::speech_transcripts::TranscriptStore;
use crate::speech_types::{
    validate_request, whisper_ticks_to_us, SpeechLanguage, TranscriptInfo, TranscriptPage,
    TranscriptSegment, TranscriptionRequest, ERR_CHANGED, ERR_FAILED, ERR_PACK_MISSING,
    ERR_PERMISSION, ERR_INVALID, SAMPLE_RATE,
};

/// What the pack registry reports; presence of a file alone is not enough.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpeechCapability {
    pub available: bool,
    pub pack_id: Option<String>,
    pub model_id: Option<String>,
    pub reason: Option<String>,
}

pub trait SpeechCapabilitySource: Send + Sync {
    fn capability(&self) -> SpeechCapability;
}

/// A capability row backed by the verified `ai_speech` pack record.
///
/// An installed-but-unverified pack is never reported as usable; a missing
/// pack is reported as `pack_missing` without a network attempt.
pub struct VerifiedSpeechPack {
    pub pack: Option<crate::local_ai_pack::VerifiedPack>,
    pub model_id: Option<String>,
}

impl SpeechCapabilitySource for VerifiedSpeechPack {
    fn capability(&self) -> SpeechCapability {
        match &self.pack {
            Some(pack)
                if pack.binary_verified
                    && pack.id == "ai_speech"
                    && pack.capability == "ai.transcribe" =>
            {
                SpeechCapability {
                    available: true,
                    pack_id: Some(pack.id.clone()),
                    model_id: self.model_id.clone(),
                    reason: None,
                }
            }
            Some(pack) => SpeechCapability {
                available: false,
                pack_id: Some(pack.id.clone()),
                model_id: self.model_id.clone(),
                reason: Some("unverified".to_string()),
            },
            None => SpeechCapability {
                available: false,
                pack_id: None,
                model_id: None,
                reason: Some("pack_missing".to_string()),
            },
        }
    }
}

static CAPABILITY: OnceLock<Box<dyn SpeechCapabilitySource>> = OnceLock::new();

pub fn install_capability_source(source: Box<dyn SpeechCapabilitySource>) -> Result<(), String> {
    CAPABILITY
        .set(source)
        .map(|_| ())
        .map_err(|_| "speech capability already installed".to_string())
}

pub fn capability() -> SpeechCapability {
    CAPABILITY.get().map(|source| source.capability()).unwrap_or(SpeechCapability {
        available: false,
        pack_id: None,
        model_id: None,
        reason: Some("pack_missing".to_string()),
    })
}

/// Speech works with or without the assistant; only its own pack matters.
pub fn speech_available(capability: &SpeechCapability, _assistant_available: bool) -> bool {
    capability.available
}

/// A verified whisper.cpp adapter running in the confined helper.
pub trait WhisperAdapter: Send + Sync {
    fn decode_chunk(&self, pcm: &[f32], language: SpeechLanguage) -> Result<Vec<RawSegment>, String>;
}

/// 12b's authorized, bounded decode of one range.
pub trait PcmSource: Send + Sync {
    fn decode(&self, input: &AiInputRef, start_us: u64, end_us: u64) -> Result<Vec<f32>, String>;

    /// The authorized source duration. A source decoder that cannot prove the
    /// duration fails closed instead of guessing a caption window.
    fn duration_us(&self, _input: &AiInputRef) -> Result<u64, String> {
        Err(ERR_PACK_MISSING.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RawSegment {
    pub text: String,
    /// Whisper centisecond ticks relative to the chunk start.
    pub start_tick: u64,
    pub end_tick: u64,
    pub confidence: Option<f64>,
}

static WHISPER: OnceLock<Box<dyn WhisperAdapter>> = OnceLock::new();
static PCM: OnceLock<Box<dyn PcmSource>> = OnceLock::new();

pub fn install_whisper(adapter: Box<dyn WhisperAdapter>) -> Result<(), String> {
    WHISPER.set(adapter).map(|_| ()).map_err(|_| "speech whisper already installed".to_string())
}

pub fn install_pcm_source(source: Box<dyn PcmSource>) -> Result<(), String> {
    PCM.set(source).map(|_| ()).map_err(|_| "speech pcm already installed".to_string())
}

/// The installed whisper adapter; without the pack it is never faked.
pub fn whisper_adapter() -> Result<&'static dyn WhisperAdapter, String> {
    WHISPER
        .get()
        .map(|adapter| adapter.as_ref())
        .ok_or_else(|| ERR_PACK_MISSING.to_string())
}

/// The installed authorized PCM decoder; without it no sample is invented.
pub fn pcm_source() -> Result<&'static dyn PcmSource, String> {
    PCM.get()
        .map(|source| source.as_ref())
        .ok_or_else(|| ERR_PACK_MISSING.to_string())
}

/// A verified helper refusal is reported as a missing pack, never as a
/// successful empty transcript.
pub fn provider_error(error: String) -> String {
    match error.as_str() {
        "ai.pack_missing" | "ai.unsupported" | "ai.unverified" => ERR_PACK_MISSING.to_string(),
        other if other.starts_with("ai.") => ERR_FAILED.to_string(),
        _ => error,
    }
}

/// The typed error for an unavailable or unverified speech pack.
pub fn capability_error(capability: &SpeechCapability) -> String {
    match capability.reason.as_deref() {
        Some("unverified") | Some("unsupported") => ERR_PACK_MISSING.to_string(),
        Some("failed") => ERR_FAILED.to_string(),
        _ => ERR_PACK_MISSING.to_string(),
    }
}

pub static TRANSCRIPTS: OnceLock<TranscriptStore> = OnceLock::new();

pub fn transcript_store() -> &'static TranscriptStore {
    TRANSCRIPTS.get_or_init(TranscriptStore::new)
}

fn source_revision(input: &AiInputRef) -> u64 {
    input.expected_revision
}

/// Converts raw chunk segments into absolute, ordered transcript segments.
pub fn build_segments(
    chunks: Vec<(u64, Vec<RawSegment>)>,
    start_index: u32,
) -> Result<(Vec<TranscriptSegment>, bool), String> {
    let mut drafts: Vec<Vec<SegmentDraft>> = Vec::new();
    for (chunk_start_us, raw) in chunks {
        let mut chunk = Vec::new();
        for segment in raw {
            let start = chunk_start_us
                .checked_add(whisper_ticks_to_us(segment.start_tick)?)
                .ok_or_else(|| ERR_INVALID.to_string())?;
            let end = chunk_start_us
                .checked_add(whisper_ticks_to_us(segment.end_tick)?)
                .ok_or_else(|| ERR_INVALID.to_string())?;
            if end <= start {
                continue;
            }
            chunk.push(SegmentDraft { text: crate::speech_types::escape_text(&segment.text), start_us: start, end_us: end });
        }
        drafts.push(chunk);
    }
    let (merged, partial) = merge_chunks(drafts);
    let mut segments = Vec::with_capacity(merged.len());
    for (offset, draft) in merged.into_iter().enumerate() {
        segments.push(TranscriptSegment {
            id: Uuid::new_v4(),
            index: start_index + offset as u32,
            start_us: draft.start_us,
            end_us: draft.end_us,
            text: crate::speech_types::normalize_nfc(&draft.text),
            confidence: None,
            speaker_id: None,
        });
    }
    Ok((segments, partial))
}

/// Transcribes one bounded in-memory mono 16 kHz capture (dictation).
///
/// The samples never leave RAM; each 30 s window is cut with the same 1 s
/// overlap as a file so timestamps stay in source microseconds.
pub fn transcribe_pcm(
    samples: &[f32],
    language: SpeechLanguage,
) -> Result<(Vec<TranscriptSegment>, bool), String> {
    if samples.is_empty() {
        return Ok((Vec::new(), false));
    }
    let duration_us = (samples.len() as u64)
        .checked_mul(1_000_000)
        .ok_or_else(|| ERR_INVALID.to_string())?
        / SAMPLE_RATE as u64;
    let chunks = plan_chunks(0, duration_us)?;
    let adapter = whisper_adapter()?;
    let mut decoded = Vec::with_capacity(chunks.len());
    for chunk in &chunks {
        let begin = (chunk.start_us * SAMPLE_RATE as u64 / 1_000_000) as usize;
        if begin >= samples.len() {
            break;
        }
        let frames = chunk_frames(chunk)? as usize;
        let end = begin.saturating_add(frames).min(samples.len());
        let raw = adapter
            .decode_chunk(&samples[begin..end], language)
            .map_err(provider_error)?;
        decoded.push((chunk.start_us, raw));
    }
    build_segments(decoded, 0)
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[tauri::command]
pub async fn speech_transcribe_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    request_id: String,
    request: TranscriptionRequest,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    validate_request(&request)?;
    let capability = capability();
    if !speech_available(&capability, true) {
        return Err(capability_error(&capability));
    }
    let profile = active_profile()?;
    let token = jobs.begin(&request_id, 1)?;
    let request_clone = request.clone();
    spawn_job(app, request_id, token, move |context| {
        let adapter = whisper_adapter()?;
        let pcm_source = pcm_source()?;
        let end_us = request_clone.end_us.ok_or_else(|| ERR_INVALID.to_string())?;
        let chunks = plan_chunks(request_clone.start_us, end_us)?;
        let mut decoded = Vec::new();
        let mut pcm = Vec::new();
        let clock = DecodeClock::start();
        for chunk in &chunks {
            let mut samples = pcm_source
                .decode(&request_clone.input, chunk.start_us, chunk.end_us)
                .map_err(provider_error)?;
            if context.token().load(Ordering::Relaxed) {
                clock.check(true, &mut pcm)?;
            }
            let raw = match adapter.decode_chunk(&samples, request_clone.language) {
                Ok(segments) => segments,
                Err(error) => {
                    samples.fill(0.0);
                    return Err(provider_error(error));
                }
            };
            samples.fill(0.0);
            samples.clear();
            decoded.push((chunk.start_us, raw));
            clock.check(context.token().load(Ordering::Relaxed), &mut pcm)?;
        }
        let (segments, partial) = build_segments(decoded, 0)?;
        let info = TranscriptInfo {
            id: Uuid::new_v4(),
            source_input_id: request_clone.input.id,
            source_revision: source_revision(&request_clone.input),
            language: request_clone.language.tag().to_string(),
            duration_us: end_us - request_clone.start_us,
            segment_count: segments.len() as u32,
            partial,
            model_id: capability.model_id.clone().unwrap_or_else(|| "ggml-base".to_string()),
            model_revision: "5359861c739e955e79d9a303bcbc70fb988958b1".to_string(),
            expires_unix: now_unix() + 3_600,
        };
        let info = transcript_store().insert(info, segments, false, profile)?;
        serde_json::to_value(info).map_err(|_| ERR_FAILED.to_string())
    });
    Ok(())
}

/// One automatic-caption window around the playhead (D8/E4).
///
/// The generation belongs to the source the player shows: a seek increments
/// it, and an answer from an older generation is refused before it can reach
/// the transcript store. Only 30 s are decoded and no SRT file is written.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn speech_captions_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    request_id: String,
    input: AiInputRef,
    language: SpeechLanguage,
    start_us: u64,
    generation: u32,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    caption_input(&input)?;
    if generation == 0 || start_us > i64::MAX as u64 {
        return Err(ERR_INVALID.to_string());
    }
    let capability = capability();
    if !speech_available(&capability, true) {
        return Err(capability_error(&capability));
    }
    let generations = caption_generations();
    generations.begin(input.id, generation)?;
    let profile = active_profile()?;
    let token = match jobs.begin(&request_id, 1) {
        Ok(token) => token,
        Err(error) => {
            generations.cancel(input.id);
            return Err(error);
        }
    };
    spawn_job(app, request_id, token, move |context| {
        if !generations.is_current(input.id, generation) {
            return Err(ERR_CHANGED.to_string());
        }
        if let Some(previous) = generations.take_transcript(input.id, generation) {
            let _ = transcript_store().release(previous, profile);
        }
        let source = pcm_source()?;
        let adapter = whisper_adapter()?;
        let duration_us = source.duration_us(&input).map_err(provider_error)?;
        let (start_us, end_us) = caption_window(start_us, duration_us)?;
        if !generations.is_current(input.id, generation) {
            return Err(ERR_CHANGED.to_string());
        }
        let clock = DecodeClock::start();
        let mut samples = Vec::new();
        clock.check(context.token().load(Ordering::Relaxed), &mut samples)?;
        samples = source
            .decode(&input, start_us, end_us)
            .map_err(provider_error)?;
        clock.check(context.token().load(Ordering::Relaxed), &mut samples)?;
        let expected_frames = chunk_frames(&PcmChunk { start_us, end_us })? as usize;
        if samples.len() > expected_frames {
            samples[expected_frames..].fill(0.0);
            samples.truncate(expected_frames);
        }
        if samples.is_empty() {
            return Err(ERR_CHANGED.to_string());
        }
        let decoded_frames = samples.len() as u64;
        let raw = match adapter.decode_chunk(&samples, language) {
            Ok(segments) => segments,
            Err(error) => {
                samples.fill(0.0);
                samples.clear();
                return Err(provider_error(error));
            }
        };
        samples.fill(0.0);
        samples.clear();
        samples.shrink_to_fit();
        clock.check(context.token().load(Ordering::Relaxed), &mut samples)?;
        if !generations.is_current(input.id, generation) {
            return Err(ERR_CHANGED.to_string());
        }
        let actual_end_us = start_us
            .saturating_add(decoded_frames.saturating_mul(1_000_000) / SAMPLE_RATE as u64)
            .min(end_us);
        let (segments, partial) = build_segments(vec![(start_us, raw)], 0)?;
        let info = TranscriptInfo {
            id: Uuid::new_v4(),
            source_input_id: input.id,
            source_revision: source_revision(&input),
            language: language.tag().to_string(),
            duration_us: actual_end_us.saturating_sub(start_us),
            segment_count: segments.len() as u32,
            partial,
            model_id: capability.model_id.clone().unwrap_or_else(|| "ggml-base".to_string()),
            model_revision: "5359861c739e955e79d9a303bcbc70fb988958b1".to_string(),
            expires_unix: now_unix() + 3_600,
        };
        let info = transcript_store().insert(info, segments, false, profile)?;
        if !generations.is_current(input.id, generation) {
            let _ = transcript_store().release(info.id, profile);
            return Err(ERR_CHANGED.to_string());
        }
        generations.record_transcript(input.id, generation, info.id);
        serde_json::to_value(info).map_err(|_| ERR_FAILED.to_string())
    });
    Ok(())
}

#[tauri::command]
pub fn speech_transcript_page(window: WebviewWindow, id: String, first: u32) -> Result<TranscriptPage, String> {
    crate::ensure_main(window.label())?;
    let parsed = Uuid::parse_str(&id).map_err(|_| ERR_CHANGED.to_string())?;
    transcript_store().page(parsed, first, active_profile()?)
}

#[tauri::command]
pub fn speech_transcript_release(window: WebviewWindow, id: String) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    let parsed = Uuid::parse_str(&id).map_err(|_| ERR_CHANGED.to_string())?;
    transcript_store().release(parsed, active_profile()?)
}

/// The permission error a denied native microphone dialog returns.
pub fn microphone_denied() -> String {
    ERR_PERMISSION.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pack_alone_without_availability_is_off() {
        let cap = SpeechCapability {
            available: false,
            pack_id: Some("ai_speech".to_string()),
            model_id: Some("ggml-base".to_string()),
            reason: Some("unverified".to_string()),
        };
        assert!(!speech_available(&cap, true));
    }
}
