//! Step 22b T4 preview/authorization tests. Worker wrote; coordinator runs.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use serde_json::json;
use uuid::Uuid;

use crate::deck_style_application::{
    authorize_apply, prepare_preview, DeckStyleHost, DeckStylePrepareFacts,
};
use crate::deck_style_types::DeckStyle;

fn color() -> serde_json::Value {
    json!({"r": 255, "g": 255, "b": 255, "a": 255})
}

fn font() -> serde_json::Value {
    json!({"family": "Inter", "source": "bundled", "embeddable": true})
}

fn text(size: f64) -> serde_json::Value {
    json!({
        "font": font(), "size_pt": size, "bold": false, "italic": false,
        "strike": false, "underline": "none", "script": "normal",
        "foreground": color(), "highlight": null, "language": "und"
    })
}

fn paragraph() -> serde_json::Value {
    json!({
        "align": "left", "direction": "ltr", "indent_left_pt": 0,
        "indent_right_pt": 0, "first_line_pt": 0, "line_spacing": 1.2,
        "before_pt": 0, "after_pt": 8, "list": "none", "outline_level": 0
    })
}

fn style() -> DeckStyle {
    let id = "220b0001-0000-4000-8000-000000000000";
    let value = json!({
        "id": id,
        "builtin": true,
        "name_key": "deckStyle.name.business",
        "name": null,
        "description_key": "deckStyle.description.business",
        "density": "comfortable",
        "guidance": {"max_bullets": 6, "max_words_per_bullet": 12, "advice_key": null},
        "created_unix": 0,
        "modified_unix": 0,
        "version": 1,
        "theme": {
            "id": id,
            "name": "deckStyle.name.business",
            "slide_width_pt": 720.0,
            "slide_height_pt": 405.0,
            "colors": {
                "background": color(), "text": json!({"r": 0, "g": 0, "b": 0, "a": 255}),
                "muted": json!({"r": 80, "g": 80, "b": 80, "a": 255}),
                "accent": color(), "accent2": color(), "surface": color()
            },
            "heading_font": font(),
            "body_font": font(),
            "layouts": [{
                "id": "220b0001-0002-4000-8000-000000000000",
                "name": "deckStyle.layout.title_body",
                "kind": "title_body",
                "placeholders": [{
                    "id": "220b0001-0002-4000-8000-000000000001",
                    "role": "title",
                    "rect": {"x_pt": 36.0, "y_pt": 24.0, "width_pt": 648.0, "height_pt": 54.0, "rotation_deg": 0.0},
                    "text": text(18.0),
                    "paragraph": paragraph()
                }]
            }],
            "default_layout_id": "220b0001-0002-4000-8000-000000000000",
            "density": "comfortable",
            "version": 1
        }
    });
    serde_json::from_value(value).expect("style")
}

struct FakeHost {
    facts: DeckStylePrepareFacts,
    verify: Result<(), String>,
    verifications: Arc<AtomicUsize>,
}

impl DeckStyleHost for FakeHost {
    fn prepare_facts(
        &self,
        _session_id: Uuid,
        _slide_ids: Option<&[Uuid]>,
    ) -> Result<DeckStylePrepareFacts, String> {
        Ok(self.facts.clone())
    }

    fn verify_apply(
        &self,
        _session_id: Uuid,
        _style_id: Uuid,
        _expected_revision: u64,
    ) -> Result<(), String> {
        self.verifications.fetch_add(1, Ordering::SeqCst);
        self.verify.clone()
    }
}

fn facts(width: f64, height: f64) -> DeckStylePrepareFacts {
    DeckStylePrepareFacts {
        revision: 5,
        slide_width_pt: width,
        slide_height_pt: height,
        existing_slide_ids: vec![Uuid::parse_str("220b0001-0002-4000-8000-0000000000aa").unwrap()],
        overflow: Vec::new(),
        manual_preserved: Vec::new(),
        available_font_assets: vec!["inter-regular".into(), "inter-bold".into()],
        template_content_omitted: false,
    }
}

#[test]
fn preview_scales_rectangles_and_text_for_a_larger_canvas() {
    let host = FakeHost {
        facts: facts(1440.0, 810.0),
        verify: Ok(()),
        verifications: Arc::new(AtomicUsize::new(0)),
    };
    let preview = prepare_preview(&host, Uuid::new_v4(), &style(), None, 100).expect("preview");
    assert_eq!(preview.theme.slide_width_pt, 1440.0);
    let placeholder = &preview.theme.layouts[0].placeholders[0];
    assert_eq!(placeholder.rect.x_pt, 72.0);
    assert_eq!(placeholder.text.size_pt, 36.0);
}

#[test]
fn preview_preserves_four_by_three_dimensions() {
    let host = FakeHost {
        facts: facts(960.0, 720.0),
        verify: Ok(()),
        verifications: Arc::new(AtomicUsize::new(0)),
    };
    let preview = prepare_preview(&host, Uuid::new_v4(), &style(), None, 100).expect("preview");
    assert_eq!(preview.theme.slide_width_pt, 960.0);
    assert_eq!(preview.theme.slide_height_pt, 720.0);
}

#[test]
fn overflow_blocks_apply_without_document_effects() {
    let mut host_facts = facts(720.0, 405.0);
    host_facts.overflow = vec![(Uuid::new_v4(), Uuid::new_v4())];
    let verifications = Arc::new(AtomicUsize::new(0));
    let host = FakeHost {
        facts: host_facts,
        verify: Ok(()),
        verifications: verifications.clone(),
    };
    let preview = prepare_preview(&host, Uuid::new_v4(), &style(), None, 100).expect("preview");
    let acknowledged: Vec<Uuid> = preview.warnings.iter().map(|warning| warning.id()).collect();
    let error = authorize_apply(&host, preview.id, &acknowledged, 100).expect_err("overflow");
    assert_eq!(error, "deck_style.unsupported");
    assert_eq!(verifications.load(Ordering::SeqCst), 0);
}

#[test]
fn source_change_fails_with_zero_effects() {
    let verifications = Arc::new(AtomicUsize::new(0));
    let host = FakeHost {
        facts: facts(720.0, 405.0),
        verify: Err("deck_style.changed".to_string()),
        verifications: verifications.clone(),
    };
    let preview = prepare_preview(&host, Uuid::new_v4(), &style(), None, 100).expect("preview");
    let acknowledged: Vec<Uuid> = preview.warnings.iter().map(|warning| warning.id()).collect();
    let error = authorize_apply(&host, preview.id, &acknowledged, 100).expect_err("changed");
    assert_eq!(error, "deck_style.changed");
    assert_eq!(verifications.load(Ordering::SeqCst), 1);
}

#[test]
fn manual_format_warning_requires_its_exact_id() {
    let mut host_facts = facts(720.0, 405.0);
    let slide = Uuid::new_v4();
    host_facts.existing_slide_ids.push(slide);
    host_facts.manual_preserved = vec![slide];
    let verifications = Arc::new(AtomicUsize::new(0));
    let host = FakeHost {
        facts: host_facts,
        verify: Ok(()),
        verifications: verifications.clone(),
    };
    let preview = prepare_preview(&host, Uuid::new_v4(), &style(), None, 100).expect("preview");
    assert!(authorize_apply(&host, preview.id, &[], 100).is_err());
    assert_eq!(verifications.load(Ordering::SeqCst), 0);

    let second = prepare_preview(&host, Uuid::new_v4(), &style(), None, 100).expect("preview again");
    let warnings: Vec<Uuid> = second.warnings.iter().map(|warning| warning.id()).collect();
    let applied = authorize_apply(&host, second.id, &warnings, 100).expect("authorized");
    assert_eq!(applied.expected_revision, 5);
    assert_eq!(verifications.load(Ordering::SeqCst), 1);
}

#[test]
fn expired_preview_is_refused() {
    let host = FakeHost {
        facts: facts(720.0, 405.0),
        verify: Ok(()),
        verifications: Arc::new(AtomicUsize::new(0)),
    };
    let preview = prepare_preview(&host, Uuid::new_v4(), &style(), None, 100).expect("preview");
    let error = authorize_apply(&host, preview.id, &[], 100 + 301).expect_err("expired");
    assert_eq!(error, "deck_style.changed");
}

#[test]
fn unknown_scope_slide_is_refused() {
    let host = FakeHost {
        facts: facts(720.0, 405.0),
        verify: Ok(()),
        verifications: Arc::new(AtomicUsize::new(0)),
    };
    let error = prepare_preview(&host, Uuid::new_v4(), &style(), Some(&[Uuid::new_v4()]), 100)
        .expect_err("unknown slide");
    assert_eq!(error, "deck_style.invalid");
}
