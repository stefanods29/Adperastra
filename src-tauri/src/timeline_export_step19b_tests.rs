//! Step 19b T5: command-surface validation tests for the native timeline
//! export request and graph. These are pure: no engine, job, file or output is
//! involved, and the current unsupported gate is not exercised here.

use super::{parse_export_request, parse_render_graph};
use crate::timeline_render_types::TimelineRenderError;
use serde_json::{json, Value};

fn request_json() -> Value {
    json!({
        "project_snapshot": {
            "snapshot_id": "11111111-1111-4111-8111-111111111111",
            "document_id": "22222222-2222-4222-8222-222222222222",
            "revision": 3,
            "content_id": "33333333-3333-4333-8333-333333333333",
            "mime": "application/vnd.adperastra.timeline+json",
            "byte_len": 4096,
            "storage_policy": "ordinary",
            "expires_unix": crate::export_snapshot_types::now_unix() + 600
        },
        "dest_dir": "C:\\Videos",
        "file_name": "timeline.webm",
        "container": "webm",
        "video_codec": "vp9",
        "audio_codec": "opus",
        "width": 1920,
        "height": 1080,
        "frame_rate": { "num": 30, "den": 1 },
        "metadata_keep": true,
        "subtitle_mode": "off",
        "accepted_losses": [],
        "accepted_warning_codes": [],
        "composition": {
            "placement": "absolute_start_us",
            "stacking": "track_index",
            "fit": "fit_pad",
            "background": [0, 0, 0, 255]
        }
    })
}

fn graph_json() -> Value {
    json!({
        "nodes": [
            {
                "kind": "source",
                "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                "source_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                "stream_index": 0
            },
            {
                "kind": "trim",
                "id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                "input": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                "start_us": 0,
                "end_us": 1000000
            },
            {
                "kind": "encode",
                "id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                "video_input": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                "audio_input": null,
                "container": "webm",
                "video_codec": "vp9",
                "audio_codec": "opus"
            }
        ],
        "edges": [
            {
                "from": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                "to": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                "port": "video"
            },
            {
                "from": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                "to": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                "port": "video"
            }
        ],
        "duration_us": 1000000
    })
}

#[test]
fn typed_request_and_graph_pass_validation() {
    let request = parse_export_request(request_json()).unwrap();
    assert_eq!(request.validate(), Ok(()));
    let graph = parse_render_graph(graph_json()).unwrap();
    assert_eq!(request.validate_graph(&graph), Ok(()));
}

#[test]
fn unknown_request_field_is_a_bad_request() {
    let mut value = request_json();
    value["graph"] = json!({});
    assert_eq!(
        parse_export_request(value).err(),
        Some(TimelineRenderError::BadRequest)
    );
}

#[test]
fn metadata_loss_and_explicit_bitrate_are_refused() {
    let mut value = request_json();
    value["metadata_keep"] = json!(false);
    let request = parse_export_request(value).unwrap();
    assert_eq!(request.validate(), Err(TimelineRenderError::BadRequest));

    let mut value = request_json();
    value["bitrate_kbps"] = json!(12_000);
    let request = parse_export_request(value).unwrap();
    assert_eq!(request.validate(), Err(TimelineRenderError::Unsupported));
}

#[test]
fn warning_codes_must_be_known_and_unique() {
    let mut value = request_json();
    value["accepted_warning_codes"] = json!(["audio_clipping"]);
    let request = parse_export_request(value).unwrap();
    assert_eq!(request.validate(), Ok(()));

    let mut value = request_json();
    value["accepted_warning_codes"] = json!(["made_up_code"]);
    let request = parse_export_request(value).unwrap();
    assert_eq!(
        request.validate(),
        Err(TimelineRenderError::WarningRequired)
    );

    let mut value = request_json();
    value["accepted_warning_codes"] = json!(["audio_loss", "audio_loss"]);
    let request = parse_export_request(value).unwrap();
    assert_eq!(request.validate(), Err(TimelineRenderError::BadRequest));
}

#[test]
fn sensitive_snapshot_is_unsupported() {
    let mut value = request_json();
    value["project_snapshot"]["storage_policy"] = json!("sensitive");
    let request = parse_export_request(value).unwrap();
    assert_eq!(request.validate(), Err(TimelineRenderError::Unsupported));
}

#[test]
fn stale_snapshot_is_changed() {
    let mut value = request_json();
    value["project_snapshot"]["expires_unix"] = json!(1);
    let request = parse_export_request(value).unwrap();
    assert_eq!(request.validate(), Err(TimelineRenderError::Changed));
}

#[test]
fn graph_encoder_must_match_the_request() {
    let request = parse_export_request(request_json()).unwrap();
    let mut value = graph_json();
    value["nodes"][2]["container"] = json!("mkv");
    let graph = parse_render_graph(value).unwrap();
    assert_eq!(
        request.validate_graph(&graph),
        Err(TimelineRenderError::BadRequest)
    );
}
