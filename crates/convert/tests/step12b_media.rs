//! Step 12b T4/E8: the media adapter spec, typed options and the exact
//! warning acknowledgements a GIF output requires.
//!
//! Nothing here launches an engine: these are the pure decisions the native
//! dispatch depends on.

use convert::media_adapter::{
    gif_warning_codes, is_media_converter, is_media_format, media_converter_spec,
    media_input_formats, media_output_format, normalize_media_options, preservable_metadata,
    require_acknowledged, require_media_backend, validate_media_options, validate_media_request,
    GifSourceFacts, GIF_TIMESTAMP_US, MAX_GIF_TIMESTAMPS, MAX_MEDIA_DIMENSION,
    MAX_MEDIA_DURATION_MS, MAX_MEDIA_TIME_US, MEDIA_CONVERTER_IDS, MEDIA_MAX_INPUT_BYTES,
    MEDIA_MAX_OUTPUT_BYTES,
};
use convert::{
    ConversionWarningCode, ConvertError, ConvertOptions, ConverterId, FormatId, ImageOptions,
    MediaConversionOptions, MetadataCategory,
};

fn converter(name: &str) -> ConverterId {
    ConverterId::parse(name).expect("validated converter id")
}

fn gif_converter() -> ConverterId {
    converter("media/gif")
}

fn video_converter() -> ConverterId {
    converter("media/video")
}

fn options() -> MediaConversionOptions {
    MediaConversionOptions::default()
}

fn rejected(options: &MediaConversionOptions) -> bool {
    validate_media_options(options).is_err()
}

/// `options_never_become_shell`: the spec offers no free-text option and the
/// validator refuses anything outside the typed ranges.
#[test]
fn options_never_become_shell() {
    let spec = media_converter_spec(gif_converter(), true, &[]).unwrap();
    assert!(spec.options.len() <= 32);
    for option in &spec.options {
        assert!(
            !option
                .id
                .contains(|character: char| character.is_whitespace()),
            "an option id is a single token"
        );
        assert!(option.id.is_ascii(), "an option id is ASCII");
        // No option can carry arbitrary text such as `-vf` or a pipe.
        assert!(!option.id.contains("filter"), "no filter text option");
        assert!(!option.id.contains("command"));
        assert!(option.validate().is_ok());
    }
    // A boolean that could never be true is not advertised. The typed field
    // stays in the shared options and is still refused below.
    assert!(!spec
        .options
        .iter()
        .any(|option| option.id == "burn_subtitles"));

    let mut hostile = options();
    hostile.start_ms = Some(u64::MAX);
    assert!(rejected(&hostile));
    let mut hostile = options();
    hostile.end_ms = Some(u64::MAX);
    assert!(rejected(&hostile));
    let mut speed = options();
    speed.speed = 0.1;
    assert!(rejected(&speed));
    let mut speed = options();
    speed.speed = f64::NAN;
    assert!(rejected(&speed));
    let mut volume = options();
    volume.volume = 9.0;
    assert!(rejected(&volume));
    let mut volume = options();
    volume.volume = f64::INFINITY;
    assert!(rejected(&volume));
    let mut bitrate = options();
    bitrate.bitrate_kbps = Some(7);
    assert!(rejected(&bitrate));
    let mut bitrate = options();
    bitrate.bitrate_kbps = Some(1_000_001);
    assert!(rejected(&bitrate));
    let mut sample_rate = options();
    sample_rate.sample_rate = Some(1_000);
    assert!(rejected(&sample_rate));
    let mut sample_rate = options();
    sample_rate.sample_rate = Some(192_001);
    assert!(rejected(&sample_rate));
    let mut width = options();
    width.width = Some(MAX_MEDIA_DIMENSION + 1);
    assert!(rejected(&width));
    let mut height = options();
    height.height = Some(MAX_MEDIA_DIMENSION + 1);
    assert!(rejected(&height));
    let mut trim = options();
    trim.start_ms = Some(10);
    trim.end_ms = Some(10);
    assert!(rejected(&trim));
    let mut trim = options();
    trim.start_ms = Some(11);
    trim.end_ms = Some(10);
    assert!(rejected(&trim));
    let mut trim = options();
    trim.end_ms = Some(MAX_MEDIA_DURATION_MS);
    assert!(rejected(&trim));
    let mut subtitles = options();
    subtitles.burn_subtitles = true;
    assert!(
        matches!(
            validate_media_options(&subtitles),
            Err(ConvertError::Unsupported)
        ),
        "burning subtitles needs an authorized source"
    );
    // The audited build's encoder table is fixed; a caller-selected codec
    // name is not evidence that the build contains it.
    for codec in ["-vf evil", "libfdk_aac", "", "AUTO", "auto "] {
        let mut video = options();
        video.video_codec = codec.to_string();
        assert!(matches!(
            validate_media_options(&video),
            Err(ConvertError::Unsupported)
        ));
        let mut audio = options();
        audio.audio_codec = codec.to_string();
        assert!(matches!(
            validate_media_options(&audio),
            Err(ConvertError::Unsupported)
        ));
    }
    assert!(validate_media_options(&options()).is_ok());

    // 0 is the option-spec sentinel for "not set", so an untouched dialog
    // never forces a trim, resize, bitrate or sample rate.
    let mut zeroed = options();
    zeroed.start_ms = Some(0);
    zeroed.end_ms = Some(0);
    zeroed.width = Some(0);
    zeroed.height = Some(0);
    zeroed.bitrate_kbps = Some(0);
    zeroed.sample_rate = Some(0);
    assert!(validate_media_options(&zeroed).is_ok());
    let normalized = normalize_media_options(&zeroed);
    assert_eq!(normalized.start_ms, None);
    assert_eq!(normalized.end_ms, None);
    assert_eq!(normalized.width, None);
    assert_eq!(normalized.height, None);
    assert_eq!(normalized.bitrate_kbps, None);
    assert_eq!(normalized.sample_rate, None);
    assert_eq!(normalized.video_codec, "auto");
    assert_eq!(normalized.audio_codec, "auto");

    let mut bounds = options();
    bounds.width = Some(MAX_MEDIA_DIMENSION);
    bounds.height = Some(MAX_MEDIA_DIMENSION);
    bounds.bitrate_kbps = Some(1_000_000);
    bounds.sample_rate = Some(192_000);
    bounds.start_ms = Some(MAX_MEDIA_DURATION_MS - 1);
    bounds.speed = 4.0;
    bounds.volume = 4.0;
    assert!(validate_media_options(&bounds).is_ok());
    bounds.speed = 0.25;
    bounds.volume = 0.0;
    assert!(validate_media_options(&bounds).is_ok());

    // The options family must match the converter family.
    let media = ConvertOptions::Media(options());
    assert!(validate_media_request(&media).is_ok());
    let image = ConvertOptions::Image(ImageOptions::default());
    assert!(matches!(
        validate_media_request(&image),
        Err(ConvertError::BadRequest)
    ));
}

/// `metadata_default_keep`: metadata stays by default, and only categories
/// the output container can carry are promised.
#[test]
fn metadata_default_keep() {
    let preserves = [
        MetadataCategory::Exif,
        MetadataCategory::Date,
        MetadataCategory::Date,
        MetadataCategory::Comments,
    ];
    let video = media_converter_spec(video_converter(), true, &preserves).unwrap();
    assert_eq!(video.engine_id, "media");
    assert_eq!(video.input_mode, "each");
    assert_eq!(
        video.preserves,
        vec![MetadataCategory::Date, MetadataCategory::Comments]
    );
    let audio = media_converter_spec(converter("media/audio"), true, &preserves).unwrap();
    assert_eq!(audio.preserves, video.preserves);
    // A GIF cannot keep EXIF/XMP at all, whatever the caller hoped for.
    let gif = media_converter_spec(gif_converter(), true, &preserves).unwrap();
    assert!(gif.preserves.is_empty());
    assert_eq!(gif.output, FormatId::Gif);
    assert!(preservable_metadata(FormatId::Webm).contains(&MetadataCategory::Date));
    assert!(!preservable_metadata(FormatId::Webm).contains(&MetadataCategory::Exif));
    assert!(preservable_metadata(FormatId::Gif).is_empty());
    // The typed default keeps metadata.
    assert!(options().keep_metadata);
}

/// `audio_without_ack_zero_output_begin`: a GIF of a file with audio requires
/// `audio_loss`; without the acknowledgement the request is refused.
#[test]
fn audio_without_ack_zero_output_begin() {
    let facts = GifSourceFacts {
        has_audio: true,
        ..GifSourceFacts::default()
    };
    assert!(facts.validate().is_ok());
    let required = gif_warning_codes(&facts);
    assert!(required.contains(&ConversionWarningCode::AudioLoss));
    assert!(matches!(
        require_acknowledged(&required, &[ConversionWarningCode::PaletteReduction]),
        Err(ConvertError::WarningRequired)
    ));
    // With every required code accepted the request may start.
    assert!(require_acknowledged(&required, &required).is_ok());
    // Metadata acknowledgement is not a warning acknowledgement.
    assert!(matches!(
        require_acknowledged(&required, &[ConversionWarningCode::AudioLoss]),
        Err(ConvertError::WarningRequired)
    ));
}

/// `gif_fractional_alpha_requires_ack`: fractional alpha cannot survive a GIF.
#[test]
fn gif_fractional_alpha_requires_ack() {
    let facts = GifSourceFacts {
        has_nonbinary_alpha: true,
        ..GifSourceFacts::default()
    };
    let required = gif_warning_codes(&facts);
    assert!(required.contains(&ConversionWarningCode::TransparencyLoss));
    assert!(matches!(
        require_acknowledged(&required, &[ConversionWarningCode::PaletteReduction]),
        Err(ConvertError::WarningRequired)
    ));
}

/// `gif_33333us_requires_frame_rate_change`: 33 333 µs is not a whole number of
/// GIF hundredths of a second.
#[test]
fn gif_33333us_requires_frame_rate_change() {
    let facts = GifSourceFacts {
        frame_timestamps_us: vec![0, 33_333, 66_666],
        ..GifSourceFacts::default()
    };
    assert!(facts.validate().is_ok());
    let required = gif_warning_codes(&facts);
    assert!(required.contains(&ConversionWarningCode::FrameRateChange));
    assert_eq!(GIF_TIMESTAMP_US, 10_000);
}

/// `gif_20000us_exact_timing`: 20 000 µs is exact, so no frame-rate warning.
#[test]
fn gif_20000us_exact_timing() {
    let facts = GifSourceFacts {
        frame_timestamps_us: vec![0, 20_000, 40_000, 60_000],
        ..GifSourceFacts::default()
    };
    let required = gif_warning_codes(&facts);
    assert!(!required.contains(&ConversionWarningCode::FrameRateChange));
    // Quantization always happens, so this one code always remains.
    assert!(required.contains(&ConversionWarningCode::PaletteReduction));
}

/// `gif_offset_timestamps_keep_timing`: a constant start offset is rebased to
/// zero by the GIF writer, so only the deltas decide exactness.
#[test]
fn gif_offset_timestamps_keep_timing() {
    let facts = GifSourceFacts {
        frame_timestamps_us: vec![12_500, 32_500, 52_500],
        ..GifSourceFacts::default()
    };
    assert!(facts.validate().is_ok());
    assert!(!gif_warning_codes(&facts).contains(&ConversionWarningCode::FrameRateChange));
}

/// `gif_timestamp_facts_are_bounded`: a probe cannot feed an unbounded or
/// malformed timestamp list into a preflight.
#[test]
fn gif_timestamp_facts_are_bounded() {
    let too_many = GifSourceFacts {
        frame_timestamps_us: (0..=MAX_GIF_TIMESTAMPS as u64)
            .map(|index| index * 20_000)
            .collect(),
        ..GifSourceFacts::default()
    };
    assert!(matches!(too_many.validate(), Err(ConvertError::TooLarge)));
    // Refusing to scan the list cannot promise exact timing.
    assert!(gif_warning_codes(&too_many).contains(&ConversionWarningCode::FrameRateChange));

    let too_late = GifSourceFacts {
        frame_timestamps_us: vec![0, MAX_MEDIA_TIME_US + 1],
        ..GifSourceFacts::default()
    };
    assert!(matches!(too_late.validate(), Err(ConvertError::BadRequest)));

    let backwards = GifSourceFacts {
        frame_timestamps_us: vec![0, 20_000, 20_000],
        ..GifSourceFacts::default()
    };
    assert!(matches!(
        backwards.validate(),
        Err(ConvertError::BadRequest)
    ));
    assert!(gif_warning_codes(&backwards).contains(&ConversionWarningCode::FrameRateChange));
}

/// `unknown_warning_refused`: a duplicate code or a code the request did not
/// require is refused.
#[test]
fn unknown_warning_refused() {
    let required = [ConversionWarningCode::PaletteReduction];
    assert_eq!(require_acknowledged(&required, &required).ok(), Some(()));
    assert!(matches!(
        require_acknowledged(
            &required,
            &[
                ConversionWarningCode::PaletteReduction,
                ConversionWarningCode::PaletteReduction
            ]
        ),
        Err(ConvertError::BadRequest)
    ));
    // A code this source did not require is not blanket consent.
    assert!(matches!(
        require_acknowledged(&required, &[ConversionWarningCode::AudioLoss]),
        Err(ConvertError::BadRequest)
    ));
    // An unregistered converter is not advertised at all.
    assert!(media_converter_spec(converter("media/avi"), true, &[]).is_err());
    assert!(!is_media_converter(&converter("media/avi")));
}

/// `no_backend_specs_are_inert`: without an engine backend no spec advertises
/// a usable converter, and the native dispatch gate refuses.
#[test]
fn no_backend_specs_are_inert() {
    assert!(require_media_backend(true).is_ok());
    assert!(matches!(
        require_media_backend(false),
        Err(ConvertError::Unsupported)
    ));
    for id in MEDIA_CONVERTER_IDS {
        let spec = media_converter_spec(converter(id), false, &[MetadataCategory::Date]).unwrap();
        assert!(!spec.available, "a missing backend never advertises output");
        assert!(spec.validate().is_ok());
        let ready = media_converter_spec(converter(id), true, &[]).unwrap();
        assert!(ready.available);
    }
}

/// `media_formats_are_bounded`: every advertised input/output is one of the
/// explicit media formats, and the spec table matches the route helpers.
#[test]
fn media_formats_are_bounded() {
    for id in MEDIA_CONVERTER_IDS {
        let spec = media_converter_spec(converter(id), true, &[]).unwrap();
        assert!(spec.validate().is_ok());
        assert!(!spec.inputs.is_empty());
        assert!(spec.inputs.iter().all(|format| is_media_format(*format)));
        assert!(is_media_format(spec.output));
        assert_eq!(
            media_input_formats(&converter(id)).map(|inputs| inputs.to_vec()),
            Some(spec.inputs.clone())
        );
        assert_eq!(media_output_format(&converter(id)), Some(spec.output));
        assert_eq!(spec.max_input_bytes, MEDIA_MAX_INPUT_BYTES);
        assert_eq!(spec.max_output_bytes, MEDIA_MAX_OUTPUT_BYTES);
        assert_eq!(spec.input_mode, "each");
        assert_eq!(spec.engine_id, "media");
    }
    assert_eq!(
        media_output_format(&video_converter()),
        Some(FormatId::Webm)
    );
    assert_eq!(
        media_output_format(&converter("media/audio")),
        Some(FormatId::Flac)
    );
    assert_eq!(media_output_format(&gif_converter()), Some(FormatId::Gif));
}

/// `media_format_ids_map_extensions_and_mimes`: every video/audio format the
/// media adapter names resolves from its extension and MIME and back, without
/// touching the image/document IDs.
#[test]
fn media_format_ids_map_extensions_and_mimes() {
    let formats = [
        (FormatId::Mp4, "mp4", "video/mp4"),
        (FormatId::Mkv, "mkv", "video/x-matroska"),
        (FormatId::Mov, "mov", "video/quicktime"),
        (FormatId::Webm, "webm", "video/webm"),
        (FormatId::Mp3, "mp3", "audio/mpeg"),
        (FormatId::Wav, "wav", "audio/wav"),
        (FormatId::Flac, "flac", "audio/flac"),
        (FormatId::Ogg, "ogg", "audio/ogg"),
        (FormatId::Opus, "opus", "audio/opus"),
        (FormatId::Aac, "aac", "audio/aac"),
    ];
    for (format, extension, mime) in formats {
        assert_eq!(format.extension(), extension);
        assert_eq!(format.mime(), mime);
        assert_eq!(FormatId::from_extension(extension), Some(format));
        assert_eq!(
            FormatId::from_extension(&extension.to_uppercase()),
            Some(format)
        );
        assert_eq!(FormatId::from_mime(mime), Some(format));
        assert_eq!(
            FormatId::from_mime(&format!("{mime}; charset=binary")),
            Some(format)
        );
        assert!(is_media_format(format));
    }
    // Aliases seen in real files and in the file MIME table.
    assert_eq!(FormatId::from_extension("m4v"), Some(FormatId::Mp4));
    assert_eq!(FormatId::from_extension("m4a"), Some(FormatId::Mp4));
    assert_eq!(FormatId::from_mime("audio/mp4"), Some(FormatId::Mp4));
    assert_eq!(FormatId::from_extension("oga"), Some(FormatId::Ogg));
    assert_eq!(FormatId::from_mime("audio/x-wav"), Some(FormatId::Wav));
    assert_eq!(FormatId::from_mime("audio/x-flac"), Some(FormatId::Flac));
    // The image and document IDs keep their mappings.
    assert_eq!(FormatId::Png.extension(), "png");
    assert_eq!(FormatId::SevenZ.extension(), "7z");
    assert_eq!(FormatId::from_extension("jpeg"), Some(FormatId::Jpeg));
    assert_eq!(FormatId::from_extension("avi"), None);
}

/// `media_warning_codes_have_exact_wire_codes`: the two Step 12b warning
/// variants use the contract's codes and leave the earlier codes untouched.
#[test]
fn media_warning_codes_have_exact_wire_codes() {
    assert_eq!(
        serde_json::to_string(&ConversionWarningCode::AudioLoss).unwrap(),
        "\"audio_loss\""
    );
    assert_eq!(
        serde_json::to_string(&ConversionWarningCode::FrameRateChange).unwrap(),
        "\"frame_rate_change\""
    );
    assert_eq!(
        serde_json::from_str::<ConversionWarningCode>("\"audio_loss\"").unwrap(),
        ConversionWarningCode::AudioLoss
    );
    assert_eq!(
        serde_json::to_string(&ConversionWarningCode::TransparencyLoss).unwrap(),
        "\"transparency_loss\""
    );
    assert_eq!(
        serde_json::to_string(&ConversionWarningCode::SheetSelection).unwrap(),
        "\"sheet_selection\""
    );
}
