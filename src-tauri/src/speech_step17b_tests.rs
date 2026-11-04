//! Step 17b T3 oracles for standalone local transcription.
//! Included by `speech.rs` as `#[cfg(test)] #[path = "speech_step17b_tests.rs"] mod step17b_tests;`.

use ai_runtime::{AiInputKind, AiInputRef};
use uuid::Uuid;

use crate::speech::{build_segments, capability, speech_available, RawSegment, SpeechCapability};
use crate::speech_decode::DecodeClock;
use crate::speech_overlap::{merge_overlap, SegmentDraft};
use crate::speech_transcripts::TranscriptStore;
use crate::speech_types::{
    validate_request, whisper_ticks_to_us, SpeechLanguage, TranscriptInfo, TranscriptionRequest,
    ERR_CHANGED, ERR_TOO_LONG,
};

fn input() -> AiInputRef {
    AiInputRef {
        kind: AiInputKind::Document,
        id: Uuid::new_v4(),
        expected_revision: 1,
    }
}

fn request(start_us: u64, end_us: u64) -> TranscriptionRequest {
    TranscriptionRequest {
        input: input(),
        language: SpeechLanguage::En,
        translate_to_english: false,
        start_us,
        end_us: Some(end_us),
    }
}

fn info(id: Uuid, count: u32) -> TranscriptInfo {
    TranscriptInfo {
        id,
        source_input_id: Uuid::new_v4(),
        source_revision: 1,
        language: "en".to_string(),
        duration_us: 30_000_000,
        segment_count: count,
        partial: false,
        model_id: "ggml-base".to_string(),
        model_revision: "1".to_string(),
        expires_unix: 10,
    }
}

#[test]
fn whisper_tick_123_is_1230000_us() {
    assert_eq!(whisper_ticks_to_us(123).unwrap(), 1_230_000);
}

#[test]
fn segment_end_is_exclusive() {
    assert!(crate::speech_types::segment_is_valid(1_000_000, 2_000_000));
    assert!(!crate::speech_types::segment_is_valid(1_000_000, 1_000_000));
    let raw = vec![RawSegment {
        text: "zero".to_string(),
        start_tick: 100,
        end_tick: 100,
        confidence: None,
    }];
    let (segments, _) = build_segments(vec![(0, raw)], 0).unwrap();
    assert!(segments.is_empty(), "an empty range is dropped, not invented");
}

#[test]
fn overlap_identical_suffix_counts_once() {
    let previous = SegmentDraft { text: "Hello. Budget 120.".to_string(), start_us: 0, end_us: 30_000_000 };
    let next = SegmentDraft { text: "Budget 120. Goodbye.".to_string(), start_us: 29_000_000, end_us: 59_000_000 };
    let merged = merge_overlap(&previous, &next);
    assert_eq!(merged.segment.unwrap().text, "Goodbye.");
}

#[test]
fn nonmatching_overlap_words_kept() {
    let previous = SegmentDraft { text: "Hello. Budget".to_string(), start_us: 0, end_us: 30_000_000 };
    let next = SegmentDraft { text: "one hundred. Goodbye.".to_string(), start_us: 29_000_000, end_us: 59_000_000 };
    let merged = merge_overlap(&previous, &next);
    assert_eq!(merged.segment.unwrap().text, "one hundred. Goodbye.");
}

#[test]
fn silence_zero_segments() {
    let (segments, partial) = build_segments(vec![(0, Vec::new())], 0).unwrap();
    assert!(segments.is_empty());
    assert!(!partial);
}

#[test]
fn transcription_3601s_refused() {
    assert!(validate_request(&request(0, 3_600_000_000)).is_ok());
    assert_eq!(
        validate_request(&request(0, 3_601_000_000)).unwrap_err(),
        ERR_TOO_LONG
    );
    assert!(validate_request(&request(5_000, 5_000)).is_err());
}

fn segment(index: u32, text: String) -> crate::speech_types::TranscriptSegment {
    crate::speech_types::TranscriptSegment {
        id: Uuid::new_v4(),
        index,
        start_us: index as u64 * 1_000_000,
        end_us: index as u64 * 1_000_000 + 1_000_000,
        text,
        confidence: None,
        speaker_id: None,
    }
}

#[test]
fn page_128_kib_cap() {
    let store = TranscriptStore::new();
    let profile = Uuid::new_v4();
    let id = Uuid::new_v4();
    let text = "x".repeat(2_000);
    let segments: Vec<_> = (0..200).map(|index| segment(index, text.clone())).collect();
    store.insert(info(id, 200), segments, false, profile).unwrap();
    let page = store.page(id, 0, profile).unwrap();
    let bytes: usize = page.segments.iter().map(|segment| segment.text.len()).sum();
    assert!(bytes <= 128 * 1024);
    assert!(page.segments.len() <= 200);
    assert!(page.next_index.is_some(), "the rest stays pageable");
}

#[test]
fn source_changed_refused() {
    let store = TranscriptStore::new();
    let owner = Uuid::new_v4();
    let other = Uuid::new_v4();
    let id = Uuid::new_v4();
    store.insert(info(id, 1), vec![segment(0, "Hello.".to_string())], false, owner).unwrap();
    assert_eq!(store.info(id, other).unwrap_err(), ERR_CHANGED);
}

#[test]
fn cancel_no_pcm_spool() {
    let temp = tempfile::tempdir().unwrap();
    let mut pcm = vec![0.1f32; 16_000 * 30];
    let clock = DecodeClock::start();
    assert!(clock.check(true, &mut pcm).is_err());
    assert!(pcm.is_empty(), "cancellation drops the PCM buffer");
    assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0, "no PCM spool file");
}

#[test]
fn standalone_no_assistant_required() {
    let ready = SpeechCapability {
        available: true,
        pack_id: Some("ai_speech".to_string()),
        model_id: Some("ggml-base".to_string()),
        reason: None,
    };
    assert!(speech_available(&ready, false));
    let missing = SpeechCapability { available: false, pack_id: None, model_id: None, reason: Some("pack_missing".to_string()) };
    assert!(!speech_available(&missing, true));
    // An uninstalled source is reported as missing, never as a silent success.
    let unset = capability();
    assert!(!unset.available);
}
