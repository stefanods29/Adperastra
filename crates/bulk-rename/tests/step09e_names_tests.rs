use bulk_rename::operations::{transform_name, validate_preset, validate_request, TemplateValues};
use bulk_rename::types::*;

fn request(operations: Vec<RenameOperation>) -> RenameRequest {
    RenameRequest {
        paths: vec![
            r"C:\fixtures\a.txt".into(),
            r"C:\fixtures\b.txt".into(),
            r"C:\fixtures\c.txt".into(),
        ],
        operations,
        include_extension: false,
        excluded_indices: vec![],
        date_zone: DateZone::Utc,
        request_revision: 1,
    }
}
fn name(request: &RenameRequest, index: u32, original: &str) -> Result<String, String> {
    transform_name(request, index, original, false, &TemplateValues::default())
}
#[test]
fn numbering_skips_excluded_rows() {
    let mut r = request(vec![RenameOperation::Number {
        start: 1,
        step: 1,
        padding: 3,
        position: NumberPosition::Prefix,
        separator: String::new(),
    }]);
    r.excluded_indices = vec![1];
    assert_eq!(name(&r, 0, "a.txt").unwrap(), "001a.txt");
    assert_eq!(name(&r, 1, "b.txt").unwrap(), "b.txt");
    assert_eq!(name(&r, 2, "c.txt").unwrap(), "002c.txt");
}
#[test]
fn unicode_upper_expands_safely() {
    let r = request(vec![RenameOperation::Case {
        mode: CaseMode::Upper,
    }]);
    assert_eq!(name(&r, 0, "straße.txt").unwrap(), "STRASSE.txt");
    assert_eq!(
        name(&r, 0, &format!("{}.txt", "ß".repeat(126))).unwrap_err(),
        "rename.invalid_name"
    );
}
#[test]
fn extension_not_changed_by_default() {
    let r = request(vec![RenameOperation::Case {
        mode: CaseMode::Upper,
    }]);
    assert_eq!(name(&r, 0, "photo.jpg").unwrap(), "PHOTO.jpg");
    assert_eq!(name(&r, 0, ".profile").unwrap(), ".PROFILE");
    assert_eq!(
        transform_name(&r, 0, "folder.ext", true, &TemplateValues::default()).unwrap(),
        "FOLDER.EXT"
    );
}
#[test]
fn regex_backreference_refused() {
    let r = request(vec![RenameOperation::Replace {
        find: r"(a)\1".into(),
        replacement: "x".into(),
        regex: true,
        match_case: true,
    }]);
    assert_eq!(validate_request(&r).unwrap_err(), "rename.regex");
}
fn explicit(names: &[(u32, &str)]) -> RenameRequest {
    request(vec![RenameOperation::ExplicitNames {
        names: names
            .iter()
            .map(|(input_index, new_name)| ExplicitRenameName {
                input_index: *input_index,
                new_name: (*new_name).into(),
            })
            .collect(),
    }])
}
#[test]
fn explicit_names_exact_coverage() {
    let mut r = explicit(&[(0, "x.txt"), (2, "z.txt")]);
    r.excluded_indices = vec![1];
    assert!(validate_request(&r).is_ok());
    r.excluded_indices.clear();
    assert_eq!(validate_request(&r).unwrap_err(), "rename.bad_request");
}
#[test]
fn explicit_names_duplicate_index_refused() {
    assert_eq!(
        validate_request(&explicit(&[(0, "a"), (0, "b"), (2, "c")])).unwrap_err(),
        "rename.bad_request"
    );
}
#[test]
fn explicit_names_exclusive() {
    let mut r = explicit(&[(0, "a"), (1, "b"), (2, "c")]);
    r.operations
        .push(RenameOperation::Prefix { text: "x".into() });
    assert_eq!(validate_request(&r).unwrap_err(), "rename.bad_request");
}
#[test]
fn explicit_names_keeps_full_extension() {
    let mut r = explicit(&[(0, "a.png"), (1, "b.png"), (2, "c.png")]);
    assert_eq!(name(&r, 0, "source.jpg").unwrap(), "a.png");
    r.include_extension = true;
    assert_eq!(validate_request(&r).unwrap_err(), "rename.bad_request");
}
#[test]
fn explicit_names_preset_refused() {
    let r = explicit(&[(0, "a"), (1, "b"), (2, "c")]);
    let preset = RenamePreset {
        id: uuid::Uuid::new_v4(),
        name: "Example".into(),
        operations: r.operations,
        include_extension: false,
        date_zone: DateZone::Utc,
        version: 1,
    };
    assert_eq!(validate_preset(&preset).unwrap_err(), "rename.bad_request");
}
#[test]
fn metadata_only_is_normalized() {
    let r = request(vec![RenameOperation::Template {
        pattern: "{camera_model}".into(),
    }]);
    let values = TemplateValues {
        camera_model: Some("A:/?__B. ".into()),
        ..Default::default()
    };
    assert_eq!(
        transform_name(&r, 0, "photo.jpg", false, &values).unwrap(),
        "A_B.jpg"
    );
}
#[test]
fn regex_replacement_capture_indices_only() {
    let r = request(vec![RenameOperation::Replace {
        find: "(a)".into(),
        replacement: "${1}$$".into(),
        regex: true,
        match_case: true,
    }]);
    assert_eq!(name(&r, 0, "a.txt").unwrap(), "a$.txt");
    let r = request(vec![RenameOperation::Replace {
        find: "(?P<word>a)".into(),
        replacement: "$word".into(),
        regex: true,
        match_case: true,
    }]);
    assert_eq!(validate_request(&r).unwrap_err(), "rename.regex");
}
