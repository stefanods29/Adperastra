use super::*;

fn stamp() -> SourceStamp {
    SourceStamp {
        path_key: r"c:\pictures\a.jpg".to_string(),
        volume_id: "00112233".to_string(),
        file_id: "8899aabbccddeeff".to_string(),
        modified_ticks: "133000000000000000".to_string(),
        size_bytes: 400,
    }
}

fn request(path: &str) -> HelperRequest {
    HelperRequest {
        path: path.to_string(),
        source: stamp(),
    }
}

#[test]
fn a_malformed_request_fails() {
    assert_eq!(
        parse_request("not json").err().as_deref(),
        Some("metadata.bad_request")
    );
    assert_eq!(
        parse_request(r#"{"path":"relative.jpg","source":{}}"#)
            .err()
            .as_deref(),
        Some("metadata.bad_request")
    );
    let long = format!(
        r#"{{"path":"C:\\{}","source":{{}}}}"#,
        "x".repeat(MAX_PATH_UNITS + 1)
    );
    assert_eq!(
        parse_request(&long).err().as_deref(),
        Some("metadata.bad_request")
    );
}

#[test]
fn a_valid_request_round_trips() {
    let original = request(r"C:\pictures\a.jpg");
    let line = serde_json::to_string(&original).expect("the request serializes");
    let parsed = parse_request(&line).expect("the request is valid");
    assert_eq!(parsed.path, original.path);
    assert_eq!(parsed.source.path_key, original.source.path_key);
}

#[test]
fn a_request_with_a_parent_component_is_refused() {
    let line = serde_json::to_string(&request(r"C:\pictures\..\Windows\a.jpg"))
        .expect("the request serializes");
    assert_eq!(
        parse_request(&line).err().as_deref(),
        Some("metadata.bad_request")
    );
}

#[test]
fn a_helper_failure_message_keeps_its_code() {
    let message = HelperMessage::Failed {
        code: "metadata.changed".to_string(),
    };
    let line = serde_json::to_string(&message).expect("the message serializes");
    let parsed: HelperMessage = serde_json::from_str(&line).expect("the message parses");
    match parsed {
        HelperMessage::Failed { code } => assert_eq!(code, "metadata.changed"),
        HelperMessage::Info { .. } => panic!("expected a failure"),
    }
}
