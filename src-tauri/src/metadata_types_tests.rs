use super::*;
use crate::metadata_properties::{canonical_name, field_for_property_name, PROPERTY_SPECS};

fn source_stamp() -> SourceStamp {
    SourceStamp {
        path_key: r"c:\pictures\a.jpg".to_string(),
        volume_id: "00112233".to_string(),
        file_id: "8899aabbccddeeff".to_string(),
        modified_ticks: "133000000000000000".to_string(),
        size_bytes: 400,
    }
}

fn info_with(field: MetadataFieldId, value: MetadataValue) -> MetadataInfo {
    let mut info = MetadataInfo::new(source_stamp());
    info.push(MetadataField { id: field, value });
    info.finalize()
}

#[test]
fn duration_ticks_become_milliseconds() {
    assert_eq!(duration_ms_from_ticks(12_345_678), Some(1_234));
    assert_eq!(duration_ms_from_ticks(9_999), Some(0));
    // u64::MAX ticks are still an exact JavaScript number of milliseconds.
    assert_eq!(
        duration_ms_from_ticks(u64::MAX),
        Some(1_844_674_407_370_955)
    );
}

#[test]
fn frame_rate_units_become_frames_per_second() {
    let rate = frame_rate_from_units(29_970).expect("a positive rate");
    assert!((rate - 29.97).abs() < 1e-9);
    assert_eq!(frame_rate_from_units(0), None);
}

#[test]
fn a_list_keeps_only_its_first_sixteen_entries() {
    let values: Vec<String> = (0..17).map(|index| format!("entry {index}")).collect();
    let list = normalized_list(values);
    assert_eq!(list.len(), MAX_LIST_ENTRIES);
    assert_eq!(list[0], "entry 0");
    assert_eq!(list[15], "entry 15");
}

#[test]
fn a_text_over_the_limit_is_refused_as_partial() {
    let info = info_with(
        MetadataFieldId::CameraModel,
        MetadataValue::Text {
            value: "x".repeat(MAX_TEXT_CHARS + 1),
        },
    );
    assert!(info.fields.is_empty());
    assert!(info.partial);
    assert_eq!(info.missing, vec![MetadataFieldId::CameraModel]);
}

#[test]
fn unknown_properties_are_omitted() {
    assert_eq!(
        field_for_property_name("System.Image.HorizontalSize"),
        Some(MetadataFieldId::Width)
    );
    assert_eq!(field_for_property_name("System.Unknown.Fact"), None);
    assert_eq!(
        field_for_property_name("System.Image.HorizontalSize "),
        None
    );
}

#[test]
fn every_allowlisted_name_has_exactly_one_row() {
    assert_eq!(PROPERTY_SPECS.len(), ALL_FIELD_IDS.len());
    for field in ALL_FIELD_IDS {
        let name = canonical_name(field);
        assert!(!name.is_empty());
        assert_eq!(field_for_property_name(name), Some(field));
    }
    assert_eq!(
        canonical_name(MetadataFieldId::DurationMs),
        "System.Media.Duration"
    );
}

#[test]
fn a_wrong_kind_is_dropped_instead_of_coerced() {
    let info = info_with(
        MetadataFieldId::Width,
        MetadataValue::Text {
            value: "400".to_string(),
        },
    );
    assert!(info.fields.is_empty());
    assert!(info.partial);
}

#[test]
fn dimensions_and_counts_have_their_table_bounds() {
    assert_eq!(positive_dimension(0), None);
    assert_eq!(positive_dimension(400), Some(400));
    assert_eq!(orientation_value(0), None);
    assert_eq!(orientation_value(6), Some(6));
    assert_eq!(orientation_value(9), None);
    assert!(
        info_with(
            MetadataFieldId::PageCount,
            MetadataValue::Integer {
                value: u32::MAX as u64
            }
        )
        .fields
        .len()
            == 1
    );
    assert!(info_with(
        MetadataFieldId::PageCount,
        MetadataValue::Integer {
            value: u32::MAX as u64 + 1
        }
    )
    .fields
    .is_empty());
}

#[test]
fn filetimes_become_utc_iso_strings() {
    assert_eq!(
        filetime_to_iso8601(116_444_736_000_000_000),
        Some("1970-01-01T00:00:00Z".to_string())
    );
    let three_hours = 11_045u64 * 10_000_000;
    assert_eq!(
        filetime_to_iso8601(116_444_736_000_000_000 + three_hours),
        Some("1970-01-01T03:04:05Z".to_string())
    );
    assert_eq!(
        filetime_to_iso8601(0),
        Some("1601-01-01T00:00:00Z".to_string())
    );
}

#[test]
fn dates_must_have_the_utc_shape() {
    assert!(is_iso8601_utc("2020-02-29T23:59:59Z"));
    assert!(!is_iso8601_utc("2021-02-29T00:00:00Z"));
    assert!(!is_iso8601_utc("2020-04-31T00:00:00Z"));
    assert!(!is_iso8601_utc("2020-13-01T00:00:00Z"));
    assert!(!is_iso8601_utc("2020-01-01T24:00:00Z"));
    assert!(!is_iso8601_utc("2020-01-01T00:00:00"));
    assert!(!is_iso8601_utc("2020-01-01 00:00:00Z"));
}

#[test]
fn fields_are_sorted_and_deduplicated() {
    let mut info = MetadataInfo::new(source_stamp());
    info.push(MetadataField {
        id: MetadataFieldId::CameraModel,
        value: MetadataValue::Text {
            value: "  Model  ".to_string(),
        },
    });
    info.push(MetadataField {
        id: MetadataFieldId::Width,
        value: MetadataValue::Integer { value: 400 },
    });
    info.push(MetadataField {
        id: MetadataFieldId::Width,
        value: MetadataValue::Integer { value: 200 },
    });
    let info = info.finalize();
    assert_eq!(info.fields.len(), 2);
    assert_eq!(info.fields[0].id, MetadataFieldId::Width);
    assert_eq!(info.fields[1].id, MetadataFieldId::CameraModel);
    assert_eq!(
        info.fields[1].value,
        MetadataValue::Text {
            value: "Model".to_string()
        }
    );
}

#[test]
fn the_serialized_payload_stays_inside_the_limit() {
    let mut info = MetadataInfo::new(source_stamp());
    for field in [
        MetadataFieldId::CameraMake,
        MetadataFieldId::CameraModel,
        MetadataFieldId::VideoCodec,
        MetadataFieldId::AudioTitle,
        MetadataFieldId::AudioAlbum,
    ] {
        info.push(MetadataField {
            id: field,
            value: MetadataValue::Text {
                value: "á".repeat(MAX_TEXT_CHARS - 1),
            },
        });
    }
    info.push(MetadataField {
        id: MetadataFieldId::AudioArtist,
        value: MetadataValue::List {
            value: (0..MAX_LIST_ENTRIES)
                .map(|index| format!("{index}{}", "ø".repeat(MAX_TEXT_CHARS - 4)))
                .collect(),
        },
    });
    let info = info.finalize();
    let bytes = serde_json::to_vec(&info).expect("the result serializes");
    assert!(bytes.len() <= MAX_SERIALIZED_BYTES);
    assert!(info.partial);
    assert!(!info.missing.is_empty());
    assert!(info.fields.len() < 6);
}

#[test]
fn request_validation_refuses_relative_and_unknown_inputs() {
    let good = MetadataRequest {
        path: r"C:\Users\me\a.jpg".to_string(),
        consumer_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301".to_string(),
    };
    assert_eq!(validate_request(&good), Ok(()));
    let mut relative = good.clone();
    relative.path = r"pictures\a.jpg".to_string();
    assert_eq!(
        validate_request(&relative),
        Err("metadata.bad_request".to_string())
    );
    let mut parent = good.clone();
    parent.path = r"C:\Users\..\Windows\a.jpg".to_string();
    assert_eq!(
        validate_request(&parent),
        Err("metadata.bad_request".to_string())
    );
    let mut consumer = good;
    consumer.consumer_id = "not-a-uuid".to_string();
    assert_eq!(
        validate_request(&consumer),
        Err("metadata.bad_request".to_string())
    );
}

#[test]
fn values_from_raw_units_match_the_table() {
    use crate::metadata_properties::{split_list_text, value_for_values};
    assert_eq!(
        value_for_values(
            MetadataFieldId::DurationMs,
            Vec::new(),
            Some(12_345_678),
            None
        ),
        Some(MetadataValue::Integer { value: 1_234 })
    );
    assert_eq!(
        value_for_values(MetadataFieldId::FrameRate, Vec::new(), Some(29_970), None),
        Some(MetadataValue::Decimal { value: 29.97 })
    );
    assert_eq!(
        value_for_values(MetadataFieldId::Orientation, Vec::new(), Some(6), None),
        Some(MetadataValue::Integer { value: 6 })
    );
    assert_eq!(
        split_list_text(" Ana ; Luis ; Ana "),
        vec!["Ana".to_string(), "Luis".to_string(), "Ana".to_string()]
    );
    assert_eq!(
        value_for_values(MetadataFieldId::Width, Vec::new(), Some(0), None),
        None
    );
}

#[test]
fn normalization_keeps_missing_ids_and_is_idempotent() {
    let mut info = info_with(MetadataFieldId::Height, MetadataValue::Integer { value: 0 });
    info.missing.push(MetadataFieldId::CameraMake);
    let once = info.finalize();
    let twice = once.clone().finalize();
    assert_eq!(
        serde_json::to_vec(&once).unwrap(),
        serde_json::to_vec(&twice).unwrap()
    );
    assert_eq!(
        twice.missing,
        vec![MetadataFieldId::Height, MetadataFieldId::CameraMake]
    );
}
#[test]
fn an_oversized_unicode_source_cannot_escape_with_no_fields() {
    let mut source = source_stamp();
    source.path_key = format!("c:\\{}", "界".repeat(30_000));
    assert_eq!(
        MetadataInfo::new(source).validated().unwrap_err(),
        "metadata.too_large"
    );
}
#[test]
fn valid_pre_epoch_dates_and_leap_days_are_kept() {
    assert_eq!(
        filetime_to_iso8601(113_288_544_000_000_000).as_deref(),
        Some("1960-01-01T00:00:00Z")
    );
    assert_eq!(
        filetime_to_iso8601(116_444_736_000_000_000).as_deref(),
        Some("1970-01-01T00:00:00Z")
    );
    assert!(is_iso8601_utc("1960-02-29T00:00:00Z"));
    assert!(!is_iso8601_utc("1900-02-29T00:00:00Z"));
    assert!(is_iso8601_utc("9999-12-31T23:59:59Z"));
}
#[test]
fn a_truncated_list_reports_its_missing_coverage() {
    let info = info_with(
        MetadataFieldId::Author,
        MetadataValue::List {
            value: (0..17).map(|n| n.to_string()).collect(),
        },
    );
    assert!(info.partial);
    assert_eq!(info.missing, vec![MetadataFieldId::Author]);
    assert!(matches!(&info.fields[0].value,MetadataValue::List{value} if value.len()==16));
}
