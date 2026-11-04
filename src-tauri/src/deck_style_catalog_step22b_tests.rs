//! Step 22b T3 catalog tests. Coordinator runs them; worker wrote only.

use serde_json::json;
use uuid::Uuid;

use crate::deck_style_catalog::{
    apply_remove, apply_save, empty_catalog, load_catalog, save_catalog,
};
use crate::deck_style_types::{DeckStyle, DeckStyleCatalog, MAX_DECK_STYLE_CATALOG_BYTES};

fn color() -> serde_json::Value {
    json!({"r": 255, "g": 255, "b": 255, "a": 255})
}

fn font() -> serde_json::Value {
    json!({"family": "Inter", "source": "bundled", "embeddable": true})
}

fn text(size: f64) -> serde_json::Value {
    json!({
        "font": font(),
        "size_pt": size,
        "bold": false,
        "italic": false,
        "strike": false,
        "underline": "none",
        "script": "normal",
        "foreground": color(),
        "highlight": null,
        "language": "und"
    })
}

fn paragraph() -> serde_json::Value {
    json!({
        "align": "left",
        "direction": "ltr",
        "indent_left_pt": 0,
        "indent_right_pt": 0,
        "first_line_pt": 0,
        "line_spacing": 1.2,
        "before_pt": 0,
        "after_pt": 8,
        "list": "none",
        "outline_level": 0
    })
}

fn style_value(index: u8, name: &str, builtin: bool) -> serde_json::Value {
    let id = if builtin {
        format!("220b000{index}-0000-4000-8000-000000000000")
    } else {
        format!("220b0100-0000-4000-8000-{:012x}", index)
    };
    let layout_id = format!("{}-0002-4000-8000-000000000000", &id[..8]);
    json!({
        "id": id,
        "builtin": builtin,
        "name_key": if builtin { json!(format!("deckStyle.name.{index}")) } else { json!(null) },
        "name": if builtin { json!(null) } else { json!(name) },
        "description_key": null,
        "density": "comfortable",
        "guidance": {"max_bullets": 6, "max_words_per_bullet": 12, "advice_key": null},
        "created_unix": if builtin { 0 } else { 1 },
        "modified_unix": if builtin { 0 } else { 1 },
        "version": 1,
        "theme": {
            "id": id,
            "name": if builtin { format!("deckStyle.name.{index}") } else { name.to_string() },
            "slide_width_pt": 720.0,
            "slide_height_pt": 405.0,
            "colors": {
                "background": color(),
                "text": json!({"r": 0, "g": 0, "b": 0, "a": 255}),
                "muted": json!({"r": 80, "g": 80, "b": 80, "a": 255}),
                "accent": color(),
                "accent2": color(),
                "surface": color()
            },
            "heading_font": font(),
            "body_font": font(),
            "layouts": [{
                "id": layout_id,
                "name": "deckStyle.layout.title_body",
                "kind": "title_body",
                "placeholders": [{
                    "id": format!("{}-0002-4000-8000-000000000001", &id[..8]),
                    "role": "title",
                    "rect": {"x_pt": 36.0, "y_pt": 24.0, "width_pt": 648.0, "height_pt": 54.0, "rotation_deg": 0.0},
                    "text": text(32.0),
                    "paragraph": paragraph()
                }]
            }],
            "default_layout_id": format!("{}-0002-4000-8000-000000000000", &id[..8]),
            "density": "comfortable",
            "version": 1
        }
    })
}

fn style(index: u8, name: &str) -> DeckStyle {
    serde_json::from_value(style_value(index, name, false)).expect("style fixture")
}

fn builtin_style() -> DeckStyle {
    serde_json::from_value(style_value(1, "Business", true)).expect("builtin fixture")
}

fn catalog_with(styles: Vec<DeckStyle>) -> DeckStyleCatalog {
    DeckStyleCatalog {
        schema_version: 1,
        styles,
        revision: 0,
    }
}

#[test]
fn builtin_save_refused() {
    let current = catalog_with(Vec::new());
    let error = apply_save(&current, &builtin_style(), 0).expect_err("builtin must fail");
    assert_eq!(error, "deck_style.invalid");
    assert!(current.styles.is_empty());
}

#[test]
fn duplicate_name_casefolded_refused() {
    let first = style(1, "Quarterly report");
    let current = DeckStyleCatalog {
        schema_version: 1,
        styles: vec![first],
        revision: 3,
    };
    let second = style(2, "QUARTERLY REPORT");
    let error = apply_save(&current, &second, 3).expect_err("duplicate name");
    assert_eq!(error, "deck_style.invalid");
    assert_eq!(current.styles.len(), 1);
}

#[test]
fn save_edits_one_existing_style_without_a_duplicate_id() {
    let current = DeckStyleCatalog {
        schema_version: 1,
        styles: vec![style(1, "First")],
        revision: 2,
    };
    let mut edited = style(1, "First");
    edited.name = Some("Renamed".to_string());
    edited.modified_unix = 2;
    let saved = apply_save(&current, &edited, 2).expect("edit");
    assert_eq!(saved.styles.len(), 1);
    assert_eq!(saved.styles[0].name.as_deref(), Some("Renamed"));
    assert_eq!(saved.revision, 3);
    assert_eq!(current.styles[0].name.as_deref(), Some("First"));
}

#[test]
fn stale_revision_rejected() {
    let current = catalog_with(vec![style(1, "One")]);
    let error = apply_save(&current, &style(2, "Two"), 1).expect_err("stale revision");
    assert_eq!(error, "deck_style.changed");
    assert_eq!(current.revision, 0);
}

#[test]
fn failed_write_keeps_catalog() {
    let dir = tempfile::tempdir().expect("temp");
    let valid = dir.path().join("styles/deck/catalog.json");
    let original = catalog_with(vec![style(1, "Kept")]);
    save_catalog(&valid, &original).expect("write original");
    let before = std::fs::read(&valid).expect("read original");

    let blocked = dir.path().join("blocked");
    std::fs::write(&blocked, b"not a folder").expect("block parent");
    let failing = blocked.join("catalog.json");
    assert!(save_catalog(&failing, &catalog_with(vec![style(2, "Lost")])).is_err());

    let after = std::fs::read(&valid).expect("read original again");
    assert_eq!(before, after);
    assert_eq!(load_catalog(&valid).expect("reload").styles.len(), 1);
}

#[test]
fn undo_restores_exact_catalog_and_advances_revision() {
    let current = catalog_with(Vec::new());
    let added = style(1, "Restored");
    let saved = apply_save(&current, &added, 0).expect("save");
    assert_eq!(saved.revision, 1);
    assert_eq!(saved.styles[0].name.as_deref(), Some("Restored"));
    let removed = apply_remove(&saved, added.id, saved.revision).expect("remove");
    assert_eq!(removed.revision, 2);
    assert!(removed.styles.is_empty());
    let redone = apply_save(&removed, &added, removed.revision).expect("redo");
    assert_eq!(redone.revision, 3);
    assert_eq!(redone.styles[0].id, added.id);
}

#[test]
fn over_four_mib_refused_without_reading() {
    let dir = tempfile::tempdir().expect("temp");
    let path = dir.path().join("catalog.json");
    std::fs::write(&path, vec![b' '; MAX_DECK_STYLE_CATALOG_BYTES + 1]).expect("large file");
    let error = load_catalog(&path).expect_err("too large");
    assert_eq!(error, "deck_style.too_large");
}

#[test]
fn newer_schema_retained() {
    let dir = tempfile::tempdir().expect("temp");
    let path = dir.path().join("catalog.json");
    let text = br#"{"schema_version":2,"styles":[]}"#;
    std::fs::write(&path, text).expect("newer file");
    let error = load_catalog(&path).expect_err("newer schema");
    assert_eq!(error, "deck_style.schema_newer");
    assert_eq!(std::fs::read(&path).expect("unchanged"), text);
}

#[test]
fn unknown_style_id_remove_refused() {
    let current = empty_catalog();
    let error = apply_remove(&current, Uuid::nil(), 0).expect_err("missing");
    assert_eq!(error, "deck_style.invalid");
}
