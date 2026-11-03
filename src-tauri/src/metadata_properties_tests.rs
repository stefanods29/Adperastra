use super::*;
use crate::metadata_types::MAX_LIST_ENTRIES;

#[test]
fn the_allowlist_is_fixed_and_ordered() {
    let names: Vec<&str> = PROPERTY_SPECS
        .iter()
        .map(|spec| spec.canonical_name)
        .collect();
    assert_eq!(
        names,
        vec![
            "System.Image.HorizontalSize",
            "System.Image.VerticalSize",
            "System.Photo.Orientation",
            "System.Photo.DateTaken",
            "System.Photo.CameraManufacturer",
            "System.Photo.CameraModel",
            "System.Media.Duration",
            "System.Video.Compression",
            "System.Video.FrameRate",
            "System.Title",
            "System.Music.Artist",
            "System.Music.AlbumTitle",
            "System.Author",
            "System.Document.PageCount",
            "System.Document.WordCount",
        ]
    );
}

#[test]
fn no_row_is_repeated() {
    for (index, spec) in PROPERTY_SPECS.iter().enumerate() {
        for other in PROPERTY_SPECS.iter().skip(index + 1) {
            assert_ne!(spec.field, other.field);
            assert_ne!(spec.canonical_name, other.canonical_name);
        }
    }
}

#[test]
fn splitting_stops_at_the_list_limit() {
    let text = (0..(MAX_LIST_ENTRIES + 4))
        .map(|index| format!("author {index}"))
        .collect::<Vec<_>>()
        .join("; ");
    let list = split_list_text(&text);
    assert!(list.len() <= MAX_LIST_ENTRIES + 1);
    assert_eq!(list[0], "author 0");
}

#[test]
fn text_fields_take_the_first_trimmed_value() {
    assert_eq!(
        value_for_values(
            MetadataFieldId::CameraMake,
            vec!["  Contoso  ".to_string(), "Other".to_string()],
            None,
            None,
        ),
        Some(MetadataValue::Text {
            value: "Contoso".to_string()
        })
    );
    assert_eq!(
        value_for_values(
            MetadataFieldId::CameraMake,
            vec!["   ".to_string()],
            None,
            None
        ),
        None
    );
}

#[test]
fn list_fields_keep_distinct_trimmed_entries() {
    assert_eq!(
        value_for_values(
            MetadataFieldId::Author,
            vec![
                " Ana ".to_string(),
                "Ana".to_string(),
                "Luis".to_string(),
                "  ".to_string(),
            ],
            None,
            None,
        ),
        Some(MetadataValue::List {
            value: vec!["Ana".to_string(), "Luis".to_string()]
        })
    );
}

#[test]
fn a_fractional_frame_rate_is_not_divided_twice() {
    assert_eq!(
        value_for_values(MetadataFieldId::FrameRate, Vec::new(), None, Some(23.976)),
        Some(MetadataValue::Decimal { value: 23.976 })
    );
    assert_eq!(
        value_for_values(MetadataFieldId::FrameRate, Vec::new(), Some(0), None),
        None
    );
}

#[test]
fn scalar_property_text_preserves_semicolons() {
    let raw = values_for_text(MetadataFieldId::AudioTitle, "Budget; Review");
    assert_eq!(
        value_for_values(MetadataFieldId::AudioTitle, raw, None, None),
        Some(MetadataValue::Text {
            value: "Budget; Review".into()
        })
    );
    assert_eq!(
        values_for_text(MetadataFieldId::Author, "Ana; Luis"),
        vec!["Ana", "Luis"]
    );
}
