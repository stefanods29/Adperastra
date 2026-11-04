//! Bounded 16 kHz mono decode planning for local transcription (D6).
//!
//! Consent, the pack lease and the 12b decoder live in the producers; this
//! module only decides how the authorized range is cut into 30 s windows with
//! 1 s overlap, proves the budget before allocation, and keeps every sample
//! in memory (there is no PCM spool file at any point).
#![allow(dead_code)]


use std::time::{Duration, Instant};

use crate::speech_types::{
    ERR_INVALID, ERR_TOO_LONG, SAMPLE_RATE, WHISPER_TICK_US,
};

pub const CHUNK_SECONDS: u64 = 30;
pub const OVERLAP_SECONDS: u64 = 1;
pub const CHUNK_US: u64 = CHUNK_SECONDS * 1_000_000;
pub const OVERLAP_US: u64 = OVERLAP_SECONDS * 1_000_000;
pub const CHUNK_DEADLINE: Duration = Duration::from_secs(60);
pub const TOTAL_DEADLINE: Duration = Duration::from_secs(30 * 60);
pub const MAX_PCM_BYTES: u64 = 3_600 * SAMPLE_RATE as u64 * 4;

/// One decode window; `offset_us` is the chunk's position in the source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PcmChunk {
    pub start_us: u64,
    pub end_us: u64,
}

impl PcmChunk {
    pub fn offset_us(&self) -> u64 {
        self.start_us
    }

    pub fn duration_us(&self) -> u64 {
        self.end_us - self.start_us
    }
}

/// Windows of 30 s advancing 29 s at a time; the last one ends at `end_us`.
pub fn plan_chunks(start_us: u64, end_us: u64) -> Result<Vec<PcmChunk>, String> {
    if end_us <= start_us {
        return Err(ERR_INVALID.to_string());
    }
    if end_us - start_us > 3_600_000_000 {
        return Err(ERR_TOO_LONG.to_string());
    }
    let mut chunks = Vec::new();
    let mut cursor = start_us;
    while cursor < end_us {
        let end = (cursor + CHUNK_US).min(end_us);
        chunks.push(PcmChunk { start_us: cursor, end_us: end });
        if end == end_us {
            break;
        }
        cursor += CHUNK_US - OVERLAP_US;
    }
    Ok(chunks)
}

/// Float32 mono bytes for `seconds`, checked before every allocation.
pub fn float_mono_bytes(seconds: u64) -> Result<u64, String> {
    seconds
        .checked_mul(SAMPLE_RATE as u64)
        .and_then(|frames| frames.checked_mul(4))
        .ok_or_else(|| ERR_TOO_LONG.to_string())
}

/// Frames one chunk holds at exactly 16 kHz.
pub fn chunk_frames(chunk: &PcmChunk) -> Result<u64, String> {
    let micros = chunk.duration_us();
    if micros == 0 {
        return Err(ERR_INVALID.to_string());
    }
    Ok((micros * SAMPLE_RATE as u64).div_ceil(1_000_000))
}

/// Converts one whisper tick range into a clamped source range.
pub fn clamp_to_source(start_us: u64, end_us: u64, source_duration_us: u64) -> Result<(u64, u64), String> {
    if end_us <= start_us {
        return Err(ERR_INVALID.to_string());
    }
    if start_us >= source_duration_us {
        return Err(ERR_INVALID.to_string());
    }
    Ok((start_us, end_us.min(source_duration_us)))
}

/// Per-chunk deadline with the overall session deadline kept separate.
pub struct DecodeClock {
    started: Instant,
}

impl DecodeClock {
    pub fn start() -> Self {
        Self { started: Instant::now() }
    }

    pub fn chunk_expired(&self) -> bool {
        self.started.elapsed() > CHUNK_DEADLINE
    }

    pub fn total_expired(&self) -> bool {
        self.started.elapsed() > TOTAL_DEADLINE
    }

    /// A cancelled job never allocates or keeps more PCM.
    pub fn check(&self, cancelled: bool, pcm: &mut Vec<f32>) -> Result<(), String> {
        if cancelled {
            pcm.clear();
            pcm.shrink_to_fit();
            return Err("speech.cancelled".to_string());
        }
        if self.total_expired() {
            pcm.clear();
            return Err("speech.failed".to_string());
        }
        if pcm.len() as u64 * 4 > MAX_PCM_BYTES {
            pcm.clear();
            return Err(ERR_TOO_LONG.to_string());
        }
        Ok(())
    }
}

/// The exact 10 ms tick offset of a chunk, used to compensate timestamps.
pub fn chunk_tick_offset(chunk: &PcmChunk) -> u64 {
    chunk.start_us / WHISPER_TICK_US
}
