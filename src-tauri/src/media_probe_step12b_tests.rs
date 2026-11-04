//! Step 12b T3: bounded probing and the exact sample timing of D5.

use fs_service::SourceStamp;

use crate::media_preview::{accept_sample, preview_options_key, sample_bounds};
use crate::media_probe::{parse_probe_json, trim_samples, ProbeError};

/// `probe65streams -> too_large`: one stream past the cap refuses the whole
/// result instead of truncating it.
#[test]
fn probe_refuses_more_than_64_streams() {
    let streams: Vec<String> = (0..65)
        .map(|index| {
            format!("{{\"index\":{index},\"codec_type\":\"audio\",\"codec_name\":\"aac\"}}")
        })
        .collect();
    let document = format!(
        "{{\"streams\":[{}],\"format\":{{\"duration\":\"2.5\",\"format_name\":\"mp4\"}}}}",
        streams.join(",")
    );
    assert_eq!(
        parse_probe_json(document.as_bytes()).err(),
        Some(ProbeError::TooLarge)
    );

    // Exactly 64 streams is still accepted.
    let streams: Vec<String> = (0..64)
        .map(|index| {
            format!("{{\"index\":{index},\"codec_type\":\"audio\",\"codec_name\":\"aac\"}}")
        })
        .collect();
    let document = format!(
        "{{\"streams\":[{}],\"format\":{{\"duration\":\"2.5\",\"format_name\":\"mp4\"}}}}",
        streams.join(",")
    );
    let parsed = parse_probe_json(document.as_bytes()).unwrap();
    assert_eq!(parsed.streams.len(), 64);
    assert_eq!(parsed.duration_us, 2_500_000);
}

/// `trim_samples: start1us/end1000001us at48000 -> samples1..48000 inclusive`.
#[test]
fn trim_samples_start_1us_end_1000001us_at_48000() {
    let range = trim_samples(Some(1), Some(1_000_001), 48_000, 10_000_000).unwrap();
    assert_eq!(range.first, 1);
    assert_eq!(range.end_exclusive, 48_001);
    assert_eq!(range.last_inclusive(), Some(48_000));
    assert_eq!(range.count(), 48_000);

    // A whole-file trim starts at zero.
    let all = trim_samples(None, None, 44_100, 1_000_000).unwrap();
    assert_eq!(all.first, 0);
    assert_eq!(all.last_inclusive(), Some(44_099));
    // An empty range is refused.
    assert_eq!(
        trim_samples(Some(5), Some(5), 48_000, 10_000_000).err(),
        Some(ProbeError::Missing)
    );
}

/// `stale_sample_revision_ignored`: an older request or a changed source never
/// replaces the newest sample.
#[test]
fn stale_sample_revision_ignored() {
    let stamp = SourceStamp {
        path_key: "C:\\media\\clip.mp4".to_string(),
        volume_id: "0a1b2c3d".to_string(),
        file_id: "00112233445566aa".to_string(),
        modified_ticks: "133000000000000001".to_string(),
        size_bytes: 4096,
    };
    let changed = SourceStamp {
        modified_ticks: "133000000000000002".to_string(),
        ..stamp.clone()
    };
    assert!(accept_sample(&stamp, &stamp, 7, 7));
    assert!(!accept_sample(&stamp, &stamp, 6, 7));
    assert!(!accept_sample(&stamp, &changed, 7, 7));
}

/// A sample never exceeds three seconds and never leaves the file.
#[test]
fn preview_samples_stay_inside_the_source() {
    assert_eq!(sample_bounds(None, 10_000_000), (0, 3_000_000));
    assert_eq!(sample_bounds(Some(2_500), 10_000_000), (2_500_000, 3_000_000));
    assert_eq!(sample_bounds(Some(9_500), 10_000_000), (9_500_000, 500_000));
    let key = preview_options_key(Some(2_500), Some(512), None, true);
    assert!(key.contains("start=2500"));
    assert!(key.len() <= 256);
}

/// A tag value past the cap refuses the result; unknown keys are not given a
/// category they do not have.
#[test]
fn oversized_tags_are_refused() {
    let value = "v".repeat(4097);
    let document = format!(
        "{{\"streams\":[],\"format\":{{\"duration\":\"1.0\",\"format_name\":\"mp3\",\
          \"tags\":{{\"artist\":\"{value}\"}}}}}}"
    );
    assert_eq!(
        parse_probe_json(document.as_bytes()).err(),
        Some(ProbeError::TooLarge)
    );
    let unknown = br#"{"streams":[],"format":{"duration":"1.0","format_name":"mp3",
        "tags":{"vendor_private":"x"}}}"#;
    assert!(parse_probe_json(unknown).unwrap().tags.is_empty());
}
