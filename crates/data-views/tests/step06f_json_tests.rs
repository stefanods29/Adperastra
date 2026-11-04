use data_views::error::DataError;
use data_views::json::{children, copy_text, find_next, parse_json, JsonKind};

#[test]
fn order_and_duplicates_stay() {
    let doc = parse_json(r#"{"b":1,"a":2,"b":3}"#).unwrap();
    let keys: Vec<String> = children(&doc, doc.root(), 0, 10)
        .into_iter()
        .filter_map(|node| node.key)
        .collect();
    assert_eq!(keys, ["b", "a", "b"]);
}

#[test]
fn kinds_and_previews() {
    let doc = parse_json(r#"[1,"x",true,null,{},[]]"#).unwrap();
    let nodes = children(&doc, doc.root(), 0, 10);
    let kinds: Vec<JsonKind> = nodes.iter().map(|node| node.kind).collect();
    assert_eq!(
        kinds,
        [
            JsonKind::Number,
            JsonKind::String,
            JsonKind::Bool,
            JsonKind::Null,
            JsonKind::Object,
            JsonKind::Array,
        ]
    );
    let previews: Vec<&str> = nodes.iter().map(|node| node.preview.as_str()).collect();
    assert_eq!(previews, ["1", "x", "true", "null", "", ""]);
}

#[test]
fn invalid_reports_the_place() {
    assert_eq!(
        parse_json(r#"{"a":1,}"#).unwrap_err(),
        DataError::Invalid { line: 1, column: 8 }
    );
}

#[test]
fn comments_are_invalid() {
    assert!(matches!(
        parse_json("// comment\n{}").unwrap_err(),
        DataError::Invalid { .. }
    ));
}

#[test]
fn trailing_text_is_invalid() {
    assert!(matches!(
        parse_json("{} x").unwrap_err(),
        DataError::Invalid { .. }
    ));
}

#[test]
fn too_deep_is_refused() {
    let text = format!("{}{}", "[".repeat(200), "]".repeat(200));
    assert_eq!(parse_json(&text).unwrap_err(), DataError::TooDeep);
}

#[test]
fn pages_and_counts() {
    let text: String = format!(
        "[{}]",
        (0..2_500)
            .map(|index| index.to_string())
            .collect::<Vec<_>>()
            .join(",")
    );
    let doc = parse_json(&text).unwrap();
    let page = children(&doc, doc.root(), 1_000, 1_000);
    assert_eq!(page.len(), 1_000);
    assert_eq!(page[0].index, Some(1_000));
    assert_eq!(doc.node_info(doc.root()).child_count, 2_500);
}

#[test]
fn long_strings_are_cut() {
    let text = format!("\"{}\"", "x".repeat(301));
    let doc = parse_json(&text).unwrap();
    let info = doc.node_info(doc.root());
    assert_eq!(info.preview.chars().count(), 300);
    assert!(info.preview_cut);
}

#[test]
fn find_walks_and_wraps() {
    let doc = parse_json(r#"{"name":"Ana","list":["ana","x"]}"#).unwrap();
    let root = doc.root();
    let root_children = children(&doc, root, 0, 10);
    let name_value = root_children[0].id;
    let list = root_children[1].id;
    let first = find_next(&doc, "ANA", false, None, false).unwrap();
    assert_eq!(first.id, name_value);
    assert_eq!(first.ancestors, [root]);
    let second = find_next(&doc, "ANA", false, Some(first.id), false).unwrap();
    assert_eq!(second.id, children(&doc, list, 0, 10)[0].id);
    assert_eq!(second.ancestors, [root, list]);
    let third = find_next(&doc, "ANA", false, Some(second.id), false).unwrap();
    assert_eq!(third.id, name_value);
}

#[test]
fn find_can_require_case() {
    let doc = parse_json(r#"{"name":"Ana","list":["ana","x"]}"#).unwrap();
    assert_eq!(find_next(&doc, "ANA", true, None, false), None);
}

#[test]
fn copy_is_bounded() {
    let text = format!("\"{}\"", "x".repeat(1_048_577));
    let doc = parse_json(&text).unwrap();
    assert_eq!(
        copy_text(&doc, doc.root()).unwrap_err(),
        DataError::TooLarge
    );
}

#[test]
fn copy_prints_pretty_json() {
    let doc = parse_json(r#"{"a":[1]}"#).unwrap();
    let expected = serde_json::to_string_pretty(&serde_json::json!({"a": [1]})).unwrap();
    assert_eq!(copy_text(&doc, doc.root()).unwrap(), expected);
}
