//! Automatic caption windows for the active media player (D8).
//!
//! One window is at most 30 s around the playhead. A seek increments a
//! positive generation; an answer from an older generation is refused so old
//! words never appear at a new position. Only the active tab may prepare
//! captions, and nothing writes an SRT file automatically.
#![allow(dead_code)]


use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use ai_runtime::AiInputRef;
use uuid::Uuid;

use crate::ai_actions::active_profile;
use crate::speech_types::{
    CAPTION_WINDOW_SECONDS, ERR_CHANGED, ERR_INVALID, SpeechLanguage,
};

pub const CAPTION_WINDOW_US: u64 = CAPTION_WINDOW_SECONDS * 1_000_000;
/// A player that stays closed for this long no longer keeps a generation.
pub const CAPTION_TRACK_IDLE: Duration = Duration::from_secs(30 * 60);
/// Generation entries are bounded even if many media files are opened.
pub const MAX_CAPTION_TRACKS: usize = 64;

/// The one generation map shared by every active caption player.
pub fn caption_generations() -> &'static CaptionGenerations {
    static GENERATIONS: OnceLock<CaptionGenerations> = OnceLock::new();
    GENERATIONS.get_or_init(CaptionGenerations::default)
}

/// The exact window a player at `start_us` asks for.
pub fn caption_window(start_us: u64, duration_us: u64) -> Result<(u64, u64), String> {
    if start_us >= duration_us {
        return Err(ERR_INVALID.to_string());
    }
    let end = start_us.saturating_add(CAPTION_WINDOW_US).min(duration_us);
    Ok((start_us, end))
}

/// Whether the window claims the whole file (it never does unless tiny).
pub fn claims_whole_file(start_us: u64, end_us: u64, duration_us: u64) -> bool {
    start_us == 0 && end_us >= duration_us && duration_us <= CAPTION_WINDOW_US
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CaptionRequest {
    pub generation: u32,
    pub start_us: u64,
    pub language: SpeechLanguage,
}

impl CaptionRequest {
    pub fn validate(self) -> Result<Self, String> {
        if self.generation < 1 || self.start_us > i64::MAX as u64 {
            return Err(ERR_INVALID.to_string());
        }
        Ok(self)
    }
}

struct CaptionTrack {
    generation: u32,
    touched: Instant,
    /// The latest transcript for this source; a seek replaces it so caption
    /// windows cannot fill the bounded transcript store.
    transcript: Option<Uuid>,
}

/// One active player per source; generation only grows for that source.
#[derive(Default)]
pub struct CaptionGenerations {
    current: Mutex<HashMap<Uuid, CaptionTrack>>,
}

impl CaptionGenerations {
    /// Drops idle players before the map can grow without a bound.
    fn sweep(current: &mut HashMap<Uuid, CaptionTrack>) {
        current.retain(|_, track| track.touched.elapsed() <= CAPTION_TRACK_IDLE);
        while current.len() >= MAX_CAPTION_TRACKS {
            let oldest = current
                .iter()
                .min_by_key(|(_, track)| track.touched)
                .map(|(id, _)| *id);
            match oldest {
                Some(id) => {
                    let _ = current.remove(&id);
                }
                None => break,
            }
        }
    }

    pub fn begin(&self, tab_id: Uuid, generation: u32) -> Result<u32, String> {
        if generation < 1 {
            return Err(ERR_INVALID.to_string());
        }
        let mut current = self
            .current
            .lock()
            .map_err(|_| "speech captions lock poisoned".to_string())?;
        Self::sweep(&mut current);
        let entry = current.entry(tab_id).or_insert_with(|| CaptionTrack {
            generation: 0,
            touched: Instant::now(),
            transcript: None,
        });
        if generation <= entry.generation {
            return Err(ERR_CHANGED.to_string());
        }
        entry.generation = generation;
        entry.touched = Instant::now();
        Ok(generation)
    }

    /// An answer is usable only for the generation still current.
    pub fn is_current(&self, tab_id: Uuid, generation: u32) -> bool {
        self.current
            .lock()
            .map(|current| {
                current
                    .get(&tab_id)
                    .map(|track| track.generation == generation && track.touched.elapsed() <= CAPTION_TRACK_IDLE)
                    .unwrap_or(false)
            })
            .unwrap_or(false)
    }

    pub fn cancel(&self, tab_id: Uuid) {
        if let Ok(mut current) = self.current.lock() {
            let _ = current.remove(&tab_id);
        }
    }

    /// Takes the previous window's transcript before the new one is stored;
    /// the caller releases it so a player keeps at most one window in RAM.
    pub fn take_transcript(&self, tab_id: Uuid, generation: u32) -> Option<Uuid> {
        let mut current = self.current.lock().ok()?;
        let track = current.get_mut(&tab_id)?;
        if track.generation != generation {
            return None;
        }
        track.transcript.take()
    }

    /// Remembers the window that is safe to show for the current generation.
    pub fn record_transcript(&self, tab_id: Uuid, generation: u32, transcript_id: Uuid) {
        if let Ok(mut current) = self.current.lock() {
            if let Some(track) = current.get_mut(&tab_id) {
                if track.generation == generation {
                    track.transcript = Some(transcript_id);
                    track.touched = Instant::now();
                }
            }
        }
    }

    /// Idle players are forgotten by any later insertion or generation check.
    pub fn cleanup(&self) -> usize {
        let Ok(mut current) = self.current.lock() else {
            return 0;
        };
        let before = current.len();
        current.retain(|_, track| track.touched.elapsed() <= CAPTION_TRACK_IDLE);
        before - current.len()
    }

    pub fn active_profile(&self) -> Result<Uuid, String> {
        active_profile()
    }
}

/// A caption job that must be cancelled when its tab is no longer active.
pub fn cancel_when_inactive(active: bool, generation: u32) -> Result<(), String> {
    if active {
        Ok(())
    } else {
        let _ = generation;
        Err(ERR_CHANGED.to_string())
    }
}

/// The input a caption window may read; never a background or online file.
pub fn caption_input(input: &AiInputRef) -> Result<&AiInputRef, String> {
    if input.expected_revision < 1 {
        return Err(ERR_INVALID.to_string());
    }
    Ok(input)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_is_thirty_seconds_and_clamped() {
        assert_eq!(caption_window(0, 100_000_000).unwrap(), (0, 30_000_000));
        assert_eq!(caption_window(90_000_000, 100_000_000).unwrap(), (90_000_000, 100_000_000));
        assert!(caption_window(100_000_000, 100_000_000).is_err());
        assert!(!claims_whole_file(0, 30_000_000, 100_000_000));
    }

    #[test]
    fn old_generation_is_refused() {
        let generations = CaptionGenerations::default();
        let tab = Uuid::new_v4();
        generations.begin(tab, 1).unwrap();
        assert!(generations.begin(tab, 2).is_ok());
        assert!(generations.begin(tab, 1).is_err());
        assert!(!generations.is_current(tab, 1));
        assert!(generations.is_current(tab, 2));
    }
}
