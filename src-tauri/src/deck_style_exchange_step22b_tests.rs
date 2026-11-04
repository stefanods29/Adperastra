//! Step 22b T5 style-file exchange tests. Worker wrote; coordinator runs.

use serde_json::json;

use crate::deck_style_exchange::{parse_style_file, publish_new_style_file, serialize_style_file};

fn style_json() -> serde_json::Value {
    let id = "220b0100-0000-4000-8000-000000000001";
    json!({
        "id": id,
        "builtin": false,
        "name_key": null,
        "name": "Exchanged style",
        "description_key": null,
        "density": "comfortable",
        "guidance": {"max_bullets": 6, "max_words_per_bullet": 12, "advice_key": null},
        "created_unix": 1,
        "modified_unix": 1,
        "version": 1,
        "theme": {
            "id": id,
            "name": "Exchanged style",
            "slide_width_pt": 720.0,
            "slide_height_pt": 405.0,
            "colors": {
                "background": {"r": 255, "g": 255, "b": 255, "a": 255},
                "text": {"r": 0, "g": 0, "b": 0, "a": 255},
                "muted": {"r": 80, "g": 80, "b": 80, "a": 255},
                "accent": {"r": 0, "g": 0, "b": 255, "a": 255},
                "accent2": {"r": 0, "g": 128, "b": 0, "a": 255},
                "surface": {"r": 240, "g": 240, "b": 240, "a": 255}
            },
            "heading_font": {"family": "Inter", "source": "bundled", "embeddable": true},
            "body_font": {"family": "Inter", "source": "bundled", "embeddable": true},
            "layouts": [{
                "id": "220b0100-0002-4000-8000-000000000000",
                "name": "deckStyle.layout.title_body",
                "kind": "title_body",
                "placeholders": [{
                    "id": "220b0100-0002-4000-8000-000000000001",
                    "role": "title",
                    "rect": {"x_pt": 36.0, "y_pt": 24.0, "width_pt": 648.0, "height_pt": 54.0, "rotation_deg": 0.0},
                    "text": {
                        "font": {"family": "Inter", "source": "bundled", "embeddable": true},
                        "size_pt": 32.0, "bold": true, "italic": false, "strike": false,
                        "underline": "none", "script": "normal",
                        "foreground": {"r": 0, "g": 0, "b": 0, "a": 255},
                        "highlight": null, "language": "und"
                    },
                    "paragraph": {
                        "align": "left", "direction": "ltr", "indent_left_pt": 0,
                        "indent_right_pt": 0, "first_line_pt": 0, "line_spacing": 1.2,
                        "before_pt": 0, "after_pt": 8, "list": "none", "outline_level": 0
                    }
                }]
            }],
            "default_layout_id": "220b0100-0002-4000-8000-000000000000",
            "density": "comfortable",
            "version": 1
        }
    })
}

fn file_bytes() -> Vec<u8> {
    serde_json::to_vec(&json!({"schema_version": 1, "style": style_json()})).expect("json")
}

#[test]
fn round_trips_one_normalized_style() {
    let bytes = file_bytes();
    let style = parse_style_file(&bytes).expect("parse");
    let written = serialize_style_file(&style).expect("serialize");
    let again = parse_style_file(&written).expect("parse again");
    assert_eq!(style.id, again.id);
    assert_eq!(again.name.as_deref(), Some("Exchanged style"));
}

#[test]
fn newer_schema_is_refused_with_the_bytes_unchanged() {
    let bytes = br#"{"schema_version":2,"style":{}}"#.to_vec();
    let before = bytes.clone();
    let error = parse_style_file(&bytes).expect_err("newer");
    assert_eq!(error, "deck_style.schema_newer");
    assert_eq!(bytes, before);
}

#[test]
fn unknown_keys_and_builtins_are_refused() {
    let mut value: serde_json::Value = serde_json::from_slice(&file_bytes()).expect("value");
    value
        .get_mut("style")
        .and_then(|style| style.as_object_mut())
        .expect("style")
        .insert("notes".to_string(), json!("template notes"));
    let bytes = serde_json::to_vec(&value).expect("json");
    assert_eq!(parse_style_file(&bytes).expect_err("unknown"), "deck_style.invalid");

    let mut builtin: serde_json::Value = serde_json::from_slice(&file_bytes()).expect("value");
    builtin
        .get_mut("style")
        .and_then(|style| style.as_object_mut())
        .expect("style")
        .insert("builtin".to_string(), json!(true));
    let bytes = serde_json::to_vec(&builtin).expect("json");
    assert_eq!(parse_style_file(&bytes).expect_err("builtin"), "deck_style.invalid");
}

#[test]
fn export_never_replaces_a_foreign_file() {
    let dir = tempfile::tempdir().expect("temp");
    let target = dir.path().join("chosen.adp-deck-style");
    std::fs::write(&target, b"foreign bytes").expect("foreign");
    let error = publish_new_style_file(&target.to_string_lossy(), &file_bytes()).expect_err("no replace");
    assert_eq!(error, "deck_style.failed");
    assert_eq!(std::fs::read(&target).expect("still foreign"), b"foreign bytes");
}

#[test]
fn export_creates_one_new_file() {
    let dir = tempfile::tempdir().expect("temp");
    let target = dir.path().join("created.adp-deck-style");
    publish_new_style_file(&target.to_string_lossy(), &file_bytes()).expect("publish");
    let written = std::fs::read(&target).expect("read");
    assert_eq!(parse_style_file(&written).expect("valid").name.as_deref(), Some("Exchanged style"));
}
