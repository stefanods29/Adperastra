//! Step 08b naming oracles (E5, D9). Written, not run by the worker.

use convert::naming::{
    effective_stem, format_index, is_valid_utc_date, normalize_sheet_component,
    render_conversion_name,
};
use convert::types::OutputNamePart;

#[test]
fn exact_index_oracle() {
    assert_eq!(
        render_conversion_name("{stem}-{index}.{ext}", "photo", "jpg", 2, "2026-11-01").unwrap(),
        "photo-002.jpg"
    );
}

#[test]
fn page_part_oracle() {
    let part: OutputNamePart =
        serde_json::from_value(serde_json::json!({"kind":"page","page":2})).unwrap();
    let stem = effective_stem("photo", &part);
    assert_eq!(
        render_conversion_name("{stem}-{index}.{ext}", &stem, "png", 1, "2026-11-01").unwrap(),
        "photo-page-002-001.png"
    );
}

#[test]
fn sheet_part_oracle() {
    let part: OutputNamePart =
        serde_json::from_value(serde_json::json!({"kind":"sheet","sheet":"Budget2026"})).unwrap();
    let stem = effective_stem("book", &part);
    assert_eq!(
        render_conversion_name("{stem}-{index}.{ext}", &stem, "csv", 1, "2026-11-01").unwrap(),
        "book-Budget2026-001.csv"
    );
}

#[test]
fn unknown_token_is_refused() {
    assert!(
        render_conversion_name("{stem}-{unknown}.{ext}", "photo", "jpg", 2, "2026-11-01").is_err()
    );
}

#[test]
fn invalid_patterns_and_dates_are_refused() {
    for pattern in ["{stem}.{ext}.{ext}", "{stem}-{ext}", "{stem}.{ext}/x"] {
        assert!(
            render_conversion_name(pattern, "photo", "jpg", 1, "2026-11-01").is_err(),
            "{pattern}"
        );
    }
    assert!(!is_valid_utc_date("2023-02-29"));
    assert!(is_valid_utc_date("2024-02-29"));
}

#[test]
fn worksheet_component_is_safe() {
    assert_eq!(normalize_sheet_component("A/B"), "A_B");
    assert_eq!(normalize_sheet_component("Name... "), "Name");
    assert_eq!(normalize_sheet_component(""), "sheet");
}

#[test]
fn indexes_keep_three_digits() {
    assert_eq!(format_index(1), "001");
    assert_eq!(format_index(1000), "1000");
}
