//! Bounded transcript retention and paged reads (D6/D7).
//!
//! Ordinary transcripts may use 64 MiB in total; a transcript of a sensitive
//! source stays in RAM with a 4 MiB cap and is never cached. Every page is
//! bounded by both 200 rows and 128 KiB of UTF-8 text, so one answer can never
//! grow into an unbounded IPC payload (P-10).
#![allow(dead_code)]


use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};
use uuid::Uuid;

use crate::speech_types::{
    ERR_CHANGED, ERR_EXPIRED, ERR_TOO_LONG, PAGE_BYTES, PAGE_SEGMENTS, SENSITIVE_MEMORY_BUDGET,
    TRANSCRIPT_MEMORY_BUDGET, TranscriptInfo, TranscriptPage, TranscriptSegment,
};

pub const TRANSCRIPT_IDLE_EXPIRY: Duration = Duration::from_secs(300);
pub const MAX_TRANSCRIPTS: usize = 16;

struct Retained {
    info: TranscriptInfo,
    segments: Vec<TranscriptSegment>,
    text_bytes: usize,
    sensitive: bool,
    profile: Uuid,
    last_read: Instant,
}

pub struct TranscriptStore {
    entries: Mutex<HashMap<Uuid, Retained>>,
}

impl Default for TranscriptStore {
    fn default() -> Self {
        Self::new()
    }
}

impl TranscriptStore {
    pub fn new() -> Self {
        Self { entries: Mutex::new(HashMap::new()) }
    }

    fn lock(&self) -> Result<MutexGuard<'_, HashMap<Uuid, Retained>>, String> {
        self.entries.lock().map_err(|_| "speech transcripts lock poisoned".to_string())
    }

    fn prune(entries: &mut HashMap<Uuid, Retained>) -> usize {
        let before = entries.len();
        entries.retain(|_, entry| entry.last_read.elapsed() <= TRANSCRIPT_IDLE_EXPIRY);
        before - entries.len()
    }

    /// Drops idle transcripts; called on every store interaction so a closed
    /// viewer cannot keep text alive past the idle expiry.
    pub fn cleanup(&self) -> usize {
        self.lock().map(|mut entries| Self::prune(&mut entries)).unwrap_or(0)
    }

    fn total_bytes(entries: &HashMap<Uuid, Retained>) -> usize {
        entries.values().map(|entry| entry.text_bytes).sum()
    }

    /// Inserts one finished transcript with all of its bounds applied first.
    pub fn insert(
        &self,
        info: TranscriptInfo,
        segments: Vec<TranscriptSegment>,
        sensitive: bool,
        profile: Uuid,
    ) -> Result<TranscriptInfo, String> {
        if segments.len() > info.segment_count as usize || info.segment_count > 100_000 {
            return Err(ERR_TOO_LONG.to_string());
        }
        let text_bytes: usize = segments.iter().map(|segment| segment.text.len()).sum();
        let cap = if sensitive { SENSITIVE_MEMORY_BUDGET } else { TRANSCRIPT_MEMORY_BUDGET };
        if text_bytes as u64 > cap {
            return Err(ERR_TOO_LONG.to_string());
        }
        let mut entries = self.lock()?;
        Self::prune(&mut entries);
        if entries.len() >= MAX_TRANSCRIPTS {
            return Err(ERR_TOO_LONG.to_string());
        }
        if Self::total_bytes(&entries) + text_bytes > TRANSCRIPT_MEMORY_BUDGET as usize {
            return Err(ERR_TOO_LONG.to_string());
        }
        entries.insert(
            info.id,
            Retained {
                info: info.clone(),
                segments,
                text_bytes,
                sensitive,
                profile,
                last_read: Instant::now(),
            },
        );
        Ok(info)
    }

    fn entry(
        entries: &mut HashMap<Uuid, Retained>,
        id: Uuid,
        profile: Uuid,
    ) -> Result<&mut Retained, String> {
        let Some(entry) = entries.get_mut(&id) else {
            return Err(ERR_EXPIRED.to_string());
        };
        if entry.profile != profile {
            return Err(ERR_CHANGED.to_string());
        }
        if entry.last_read.elapsed() > TRANSCRIPT_IDLE_EXPIRY {
            return Err(ERR_EXPIRED.to_string());
        }
        entry.last_read = Instant::now();
        Ok(entry)
    }

    pub fn info(&self, id: Uuid, profile: Uuid) -> Result<TranscriptInfo, String> {
        let mut entries = self.lock()?;
        Self::prune(&mut entries);
        Ok(Self::entry(&mut entries, id, profile)?.info.clone())
    }

    /// One bounded page; a segment larger than the page cap is refused, not cut.
    pub fn page(&self, id: Uuid, first: u32, profile: Uuid) -> Result<TranscriptPage, String> {
        let mut entries = self.lock()?;
        Self::prune(&mut entries);
        let entry = Self::entry(&mut entries, id, profile)?;
        let start = first as usize;
        if start > entry.segments.len() {
            return Err(ERR_CHANGED.to_string());
        }
        let mut segments = Vec::new();
        let mut bytes = 0usize;
        for segment in entry.segments.iter().skip(start) {
            let size = segment.text.len();
            if size > PAGE_BYTES {
                return Err(ERR_TOO_LONG.to_string());
            }
            if !segments.is_empty() && (segments.len() >= PAGE_SEGMENTS || bytes + size > PAGE_BYTES) {
                break;
            }
            bytes += size;
            segments.push(segment.clone());
            if segments.len() >= PAGE_SEGMENTS {
                break;
            }
        }
        let consumed = start + segments.len();
        Ok(TranscriptPage {
            transcript_id: id,
            segments,
            next_index: if consumed < entry.segments.len() { Some(consumed as u32) } else { None },
        })
    }

    pub fn all_segments(&self, id: Uuid, profile: Uuid) -> Result<Vec<TranscriptSegment>, String> {
        let mut entries = self.lock()?;
        let entry = Self::entry(&mut entries, id, profile)?;
        Ok(entry.segments.clone())
    }

    /// Release drops new readers; a copy already handed out finishes.
    pub fn release(&self, id: Uuid, profile: Uuid) -> Result<(), String> {
        let mut entries = self.lock()?;
        Self::prune(&mut entries);
        let Some(entry) = entries.get(&id) else {
            return Ok(());
        };
        if entry.profile != profile {
            return Err(ERR_CHANGED.to_string());
        }
        let _ = entries.remove(&id);
        Ok(())
    }

    pub fn is_sensitive(&self, id: Uuid) -> bool {
        self.lock()
            .ok()
            .and_then(|entries| entries.get(&id).map(|entry| entry.sensitive))
            .unwrap_or(false)
    }

    pub fn retained(&self) -> usize {
        self.lock()
            .map(|mut entries| {
                Self::prune(&mut entries);
                entries.len()
            })
            .unwrap_or(0)
    }
}

/// SRT/VTT use integer milliseconds; the end is never before start + 1 ms.
pub fn cue_milliseconds(start_us: u64, end_us: u64) -> Result<(u64, u64), String> {
    if end_us <= start_us {
        return Err(ERR_CHANGED.to_string());
    }
    let start = start_us / 1_000;
    let end = end_us.div_ceil(1_000).max(start + 1);
    Ok((start, end))
}

fn stamp(millis: u64, separator: char) -> String {
    let hours = millis / 3_600_000;
    let minutes = (millis % 3_600_000) / 60_000;
    let seconds = (millis % 60_000) / 1_000;
    format!("{hours:02}:{minutes:02}:{seconds:02}{separator}{:03}", millis % 1_000)
}

pub fn to_srt(segments: &[TranscriptSegment]) -> Result<String, String> {
    let mut out = String::new();
    for (index, segment) in segments.iter().enumerate() {
        let (start, end) = cue_milliseconds(segment.start_us, segment.end_us)?;
        out.push_str(&format!(
            "{}\r\n{} --> {}\r\n{}\r\n\r\n",
            index + 1,
            stamp(start, ','),
            stamp(end, ','),
            segment.text
        ));
    }
    Ok(out)
}

pub fn to_vtt(segments: &[TranscriptSegment]) -> Result<String, String> {
    let mut out = String::from("WEBVTT\n\n");
    for segment in segments {
        let (start, end) = cue_milliseconds(segment.start_us, segment.end_us)?;
        out.push_str(&format!("{} --> {}\n{}\n\n", stamp(start, '.'), stamp(end, '.'), segment.text));
    }
    Ok(out)
}

pub fn to_plain_text(segments: &[TranscriptSegment]) -> String {
    segments.iter().map(|segment| segment.text.as_str()).collect::<Vec<_>>().join("\n")
}
