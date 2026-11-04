//! Step 15 T3 waveform tests. Attached by `waveforms.rs` with `#[path]`.

use super::*;
use crate::media_edit_types::{MediaEditError, WavePeak};

fn stamp(ticks: &str) -> fs_service::SourceStamp {
    fs_service::SourceStamp {
        path_key: "C:\\media\\clip.mp4".to_string(),
        volume_id: "00000000".to_string(),
        file_id: "0000000000000001".to_string(),
        modified_ticks: ticks.to_string(),
        size_bytes: 1024,
    }
}

fn source(duration_us: u64, ticks: &str) -> MediaSource {
    MediaSource {
        id: Uuid::nil(),
        path: "C:\\media\\clip.mp4".to_string(),
        stamp: stamp(ticks),
        duration_us,
        video_rate: Some(crate::engine_types::FrameRate { num: 30, den: 1 }),
        audio_rate: Some(48_000),
        sensitive: false,
    }
}

#[test]
fn five_hundred_twelve_bucket_page_bound() {
    let source = source(20_000_000, "10");
    let peaks = vec![WavePeak { min: -0.25, max: 0.25 }; 2000];
    let first = page_from_peaks(&source, 0, 0, 2000, &peaks).unwrap();
    assert_eq!(first.buckets.len(), 512);
    assert_eq!(first.total_buckets, 2000);
    let middle = page_from_peaks(&source, 0, 1488, 2000, &peaks).unwrap();
    assert_eq!(middle.buckets.len(), 512);
    let last = page_from_peaks(&source, 0, 1980, 2000, &peaks).unwrap();
    assert_eq!(last.buckets.len(), 20);
    assert_eq!(
        page_from_peaks(&source, 0, 2001, 2000, &peaks).unwrap_err(),
        MediaEditError::BadRequest
    );
}

#[test]
fn sourcechanged_invalidatescache() {
    let before = source(10_000_000, "10");
    let after = source(10_000_000, "11");
    assert_eq!(
        ensure_source_unchanged(&before.stamp, &after.stamp),
        Err(MediaEditError::Changed)
    );
    assert_ne!(waveform_cache_key(&before, 0), waveform_cache_key(&after, 0));
    assert_ne!(waveform_cache_key(&before, 0), waveform_cache_key(&before, 1));
}

#[test]
fn total_buckets_are_capped_at_one_hundred_minutes() {
    assert_eq!(total_buckets_for_duration(10_000_000), 1000);
    assert_eq!(total_buckets_for_duration(0), 0);
    assert_eq!(total_buckets_for_duration(24 * 60 * 60 * 1_000_000), MAX_WAVEFORM_BUCKETS);
}

#[test]
fn cache_never_grows_past_its_budget() {
    let mut cache = WaveformCache::new(2 * PEAK_BYTES);
    for key in ["a", "b", "c"] {
        cache.put(
            key.to_string(),
            Arc::new(CachedWaveform {
                peaks: vec![WavePeak { min: -1.0, max: 1.0 }],
                total_buckets: 1,
            }),
        );
    }
    assert_eq!(cache.entries.len(), 2);
    assert!(cache.get("a").is_none());
    assert!(cache.get("c").is_some());
    assert!(cache.bytes <= 2 * PEAK_BYTES);
}

#[test]
fn invalid_channels_and_peaks_are_refused() {
    let source = source(10_000_000, "10");
    let peaks = vec![WavePeak { min: -0.5, max: 0.5 }; 4];
    assert_eq!(
        page_from_peaks(&source, 8, 0, 4, &peaks).unwrap_err(),
        MediaEditError::BadRequest
    );
    let invalid = vec![WavePeak { min: 0.5, max: 1.5 }; 4];
    assert_eq!(
        page_from_peaks(&source, 0, 0, 4, &invalid).unwrap_err(),
        MediaEditError::Failed
    );
}
