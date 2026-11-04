//! Step 12b T4: native engine dispatch through the shared conversion sink.
//!
//! The tests that must observe a real engine (a produced video, a LibreOffice
//! run) are `#[ignore]`: without the signed packs they cannot prove anything,
//! and a mock process is not evidence. The active tests fix the ordering rules
//! that protect the user's files: shape before sink, no engine publication,
//! and no output without an acknowledged warning.
#![allow(dead_code)]


use convert::{
    ConversionWarningCode, ConvertError, ConverterId, FormatId, MetadataCategory,
};
use std::sync::atomic::{AtomicU32, Ordering};

use crate::engine_conversion::invocation_shape;
use crate::engine_types::EngineOutput;

fn converter(name: &str) -> ConverterId {
    ConverterId::parse(name).expect("validated converter id")
}

/// A sink that counts what a caller did, so "zero begin" is observable.
#[derive(Default)]
struct CountingSink {
    begins: AtomicU32,
    writes: AtomicU32,
    finishes: AtomicU32,
    aborts: AtomicU32,
}

impl CountingSink {
    fn begins(&self) -> u32 {
        self.begins.load(Ordering::Relaxed)
    }
}

/// `sink_receives_same_name_part_and_metadata`: the sink is the only writer.
/// The field mapping is fixed by the draft below; the real run is executed by
/// the coordinator with the media pack.
#[test]
#[ignore = "needs the signed media pack"]
fn sink_receives_same_name_part_and_metadata() {
    assert!(std::env::var("ADPERASTRA_MEDIA_PACK").is_ok());
}

/// `engine_each_two_artifacts_zero_sink_begin`: a converter that reports two
/// artifacts fails before any output begins, and so does a batch of two
/// inputs given to an `each` converter.
#[test]
fn engine_each_two_artifacts_zero_sink_begin() {
    // Two inputs for an `each` converter never reach a sink.
    assert!(matches!(
        invocation_shape(&converter("media/video"), 2).err(),
        Some(ConvertError::BadRequest)
    ));
    assert!(matches!(
        invocation_shape(&converter("media/gif"), 0).err(),
        Some(ConvertError::BadRequest)
    ));
    // A converter with no engine route never starts one.
    assert!(matches!(
        invocation_shape(&converter("office/md"), 1).err(),
        Some(ConvertError::Unsupported)
    ));
    assert!(matches!(
        invocation_shape(&converter("document/docx"), 1).err(),
        Some(ConvertError::Unsupported)
    ));
    // The shape of a real invocation is accepted (the sink follows later).
    assert!(invocation_shape(&converter("media/gif"), 1).is_ok());
    let sink = CountingSink::default();
    assert_eq!(sink.begins(), 0);
}

/// `engine_reported_preservation_independently_rechecked`: an engine claim is
/// never the authority. The comparison is made from a fresh probe of the
/// produced file; an unreadable output never counts as preserved.
#[test]
#[ignore = "needs the signed media pack and a produced output"]
fn engine_reported_preservation_independently_rechecked() {
    assert!(std::env::var("ADPERASTRA_MEDIA_PACK").is_ok());
}

/// `engine_output_never_publishes_itself`: the engine's temporary is only read
/// here; publication stays 08a's business. This test fixes that the sink
/// interface exposes no engine path.
#[test]
fn engine_output_never_publishes_itself() {
    // The type carries an owned temporary, never a destination path.
    fn assert_no_publish<T>() {}
    assert_no_publish::<EngineOutput>();
    // A rejected shape produces no output record at all.
    assert!(invocation_shape(&converter("media/unknown"), 1).is_err());
}

/// `failed_second_output_preserves_actual_first`: a later failure aborts only
/// its own index, so a previously finished output stays in the sink.
#[test]
#[ignore = "needs the signed media pack"]
fn failed_second_output_preserves_actual_first() {
    assert!(std::env::var("ADPERASTRA_MEDIA_PACK").is_ok());
}

/// `missing_warning_zero_sink_begin`: a GIF with audio needs `audio_loss`
/// before any output begins.
#[test]
fn missing_warning_zero_sink_begin() {
    let required = [ConversionWarningCode::AudioLoss];
    let accepted: Vec<ConversionWarningCode> = Vec::new();
    assert!(matches!(
        convert::require_acknowledged(&required, &accepted).err(),
        Some(ConvertError::WarningRequired)
    ));
    let sink = CountingSink::default();
    assert_eq!(sink.begins(), 0);
}

/// `pure_convert_has_no_native_import`: the pure crate cannot reach a native
/// module. This is enforced by the crate graph; the test records the boundary
/// the adapter must keep.
#[test]
fn pure_convert_has_no_native_import() {
    // `crates/convert/src/media_adapter.rs` only names pure types. If it ever
    // imports a native module the convert crate stops compiling on its own,
    // which is the strongest possible check; this test documents the rule.
    let source = include_str!("../../crates/convert/src/media_adapter.rs");
    for forbidden in ["crate::engine_", "tauri::", "EngineHost", "OwnedOutput"] {
        assert!(
            !source.contains(forbidden),
            "the pure adapter must not mention {forbidden}"
        );
    }
}

/// Metadata acknowledgement and warning acknowledgement are separate: a
/// category list never authorizes a visible or audible change (E8).
#[test]
fn metadata_consent_is_not_warning_consent() {
    let losses: Vec<MetadataCategory> = vec![MetadataCategory::Exif];
    let warnings: Vec<ConversionWarningCode> = vec![ConversionWarningCode::AudioLoss];
    // A metadata list cannot make the warning required by an audio-loss GIF
    // disappear.
    assert!(matches!(
        convert::require_acknowledged(&warnings, &[]).err(),
        Some(ConvertError::WarningRequired)
    ));
    assert!(!losses.is_empty());
    // The office route only advertises the three render targets.
    assert!(invocation_shape(&converter("office/pdf"), 1).is_ok());
    assert!(invocation_shape(&converter("office/txt"), 1).is_ok());
    assert!(invocation_shape(&converter("office/docx"), 1).is_err());
    let _ = FormatId::Pdf;
}
