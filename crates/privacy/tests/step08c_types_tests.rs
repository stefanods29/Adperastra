//! Step 08c T1: types, defaults and wire invariants.

use convert::{ConversionInput, MetadataCategory};
use privacy::{
    same_categories, sorted_categories, validate_requested_categories, Coverage, MetadataContainer,
    PrivacyField, PrivacyInspection, PrivacyMode, PrivacySettings,
};

#[test]
fn privacy_defaults_remove_nothing() {
    let settings = PrivacySettings::default();
    assert_eq!(settings.mode, PrivacyMode::Keep);
    assert_eq!(settings.image_mode, PrivacyMode::Keep);
    assert_eq!(settings.pdf_mode, PrivacyMode::Keep);
    assert!(settings.image_categories.is_empty());
    assert!(settings.pdf_categories.is_empty());
    assert!(!settings.location_warning);
    assert!(!settings.sharing_prompt);
    assert!(settings.validate().is_ok());
}

#[test]
fn unknown_category_is_refused() {
    assert!(serde_json::from_str::<MetadataCategory>("\"not_a_category\"").is_err());
    assert!(validate_requested_categories(&[]).is_err());
    let settings = PrivacySettings {
        image_categories: vec![MetadataCategory::Gps, MetadataCategory::Gps],
        ..Default::default()
    };
    assert!(settings.validate().is_err());
}

#[test]
fn every_type_mirrors_the_wire_names() {
    let field = PrivacyField {
        category: MetadataCategory::Gps,
        containers: vec![MetadataContainer::Exif, MetadataContainer::Xmp],
        related_categories: vec![MetadataCategory::Camera],
        field_id: "exif.0002".to_string(),
        label_key: "privacy.gps".to_string(),
        preview: "51.5, -0.1".to_string(),
        count: 1,
        content_affecting: false,
        coverage: Coverage::Complete,
    };
    let value = serde_json::to_value(&field).unwrap();
    for key in [
        "category",
        "containers",
        "related_categories",
        "field_id",
        "label_key",
        "preview",
        "count",
        "content_affecting",
        "coverage",
    ] {
        assert!(value.get(key).is_some(), "missing {key}");
    }
    assert_eq!(value["containers"][0], "exif");
    assert_eq!(value["coverage"], "complete");
}

#[test]
fn redacted_input_has_no_raw_bytes_or_path_escape() {
    let input = ConversionInput::File {
        path: r"C:\Secret\holiday.jpg".to_string(),
        expected: None,
    };
    let inspection = PrivacyInspection {
        inspection_id: uuid::Uuid::new_v4().to_string(),
        input,
        source: None,
        fields: vec![PrivacyField {
            category: MetadataCategory::Author,
            containers: vec![MetadataContainer::Exif],
            related_categories: Vec::new(),
            field_id: "exif.013b".to_string(),
            label_key: "privacy.author".to_string(),
            preview: "Synthetic Author".to_string(),
            count: 1,
            content_affecting: false,
            coverage: Coverage::Complete,
        }],
        next_cursor: None,
        complete: true,
        signatures_present: false,
        effective_categories: vec![MetadataCategory::Author],
        expires_unix: 300,
    };
    let value = serde_json::to_value(&inspection).unwrap();
    assert!(value.get("bytes").is_none());
    assert!(value["input"].get("bytes").is_none());
    assert_eq!(value["fields"][0]["preview"], "Synthetic Author");
}

#[test]
fn category_order_and_sets_are_stable() {
    let categories = [
        MetadataCategory::Author,
        MetadataCategory::Gps,
        MetadataCategory::Exif,
    ];
    assert_eq!(
        sorted_categories(&categories),
        vec![
            MetadataCategory::Exif,
            MetadataCategory::Gps,
            MetadataCategory::Author
        ]
    );
    assert!(same_categories(&categories, &categories));
    assert!(!same_categories(&categories, &[MetadataCategory::Gps]));
}
