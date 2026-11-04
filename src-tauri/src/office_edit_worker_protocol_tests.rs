use super::*;
use serde_json::json;

#[test]
fn memory_capture_chunks_are_bound_to_snapshot_offset_and_size() {
    let request_id = Uuid::new_v4();
    let snapshot_id = Uuid::new_v4();
    let command = WorkerCommand::SnapshotRead {
        snapshot_id,
        offset: 8,
    };
    let mut payload = json!({"Ok":{"snapshot_id":snapshot_id,"offset":8,"bytes":[1,2,3]}});
    assert!(decode(
        &reply(request_id, 4, payload.clone()),
        request_id,
        4,
        &command
    )
    .is_ok());
    payload["Ok"]["offset"] = json!(0);
    assert!(decode(
        &reply(request_id, 4, payload.clone()),
        request_id,
        4,
        &command
    )
    .is_err());
    payload["Ok"]["offset"] = json!(8);
    payload["Ok"]["bytes"] = json!([]);
    assert!(decode(
        &reply(request_id, 4, payload.clone()),
        request_id,
        4,
        &command
    )
    .is_err());
    payload["Ok"]["bytes"] = json!(vec![1u8; 8193]);
    assert!(decode(&reply(request_id, 4, payload), request_id, 4, &command).is_err());
}

fn reply(id: Uuid, revision: u64, result: serde_json::Value) -> Vec<u8> {
    serde_json::to_vec(&json!({"request_id":id,"revision":revision,"result":result})).unwrap()
}

#[test]
fn worker_reply_must_match_request_revision_and_operation() {
    let id = Uuid::new_v4();
    let close = WorkerCommand::Close {};
    assert!(decode(&reply(id, 1, json!({"Ok":null})), id, 1, &close).is_ok());
    assert!(decode(&reply(Uuid::new_v4(), 1, json!({"Ok":null})), id, 1, &close).is_err());
    assert!(decode(&reply(id, 2, json!({"Ok":null})), id, 1, &close).is_err());
    assert!(decode(&reply(id, 1, json!({"Ok":{"size_bytes":5}})), id, 1, &close).is_err());
    assert!(decode(
        &reply(id, 2, json!({"Ok":null})),
        id,
        1,
        &WorkerCommand::Undo {}
    )
    .is_ok());
    assert!(decode(
        &reply(id, 1, json!({"Ok":null})),
        id,
        1,
        &WorkerCommand::Undo {}
    )
    .is_err());
}

#[test]
fn worker_error_never_advances_revision_or_exposes_native_prose() {
    let id = Uuid::new_v4();
    let close = WorkerCommand::Close {};
    assert!(matches!(
        decode(
            &reply(id, 1, json!({"Err":"office_edit.unsupported"})),
            id,
            1,
            &close
        ),
        Err(OfficeEditError::Unsupported)
    ));
    assert!(matches!(
        decode(
            &reply(id, 2, json!({"Err":"office_edit.unsupported"})),
            id,
            1,
            &close
        ),
        Err(OfficeEditError::Failed)
    ));
    assert!(decode(
        &reply(id, 1, json!({"Err":"document content or native path"})),
        id,
        1,
        &close
    )
    .is_err());
}

#[test]
fn worker_targets_have_bounded_forward_only_cursors_and_real_cell_addresses() {
    let id = Uuid::new_v4();
    let list = WorkerCommand::List {
        section_index: 0,
        start: 8,
    };
    let mut result = json!({"Ok":{"items":[{"id":Uuid::new_v4(),"ordinal":9,"text":"000123","address":"A1"}],"next_start":10}});
    assert!(decode(&reply(id, 1, result.clone()), id, 1, &list).is_ok());
    result["Ok"]["next_start"] = json!(9);
    assert!(decode(&reply(id, 1, result.clone()), id, 1, &list).is_err());
    result["Ok"]["next_start"] = json!(10);
    for address in ["A0", "A01", "XFE1", "A1048577", "../A1"] {
        result["Ok"]["items"][0]["address"] = json!(address);
        assert!(decode(&reply(id, 1, result.clone()), id, 1, &list).is_err());
    }
}

#[test]
fn worker_capture_refuses_zero_oversized_and_path_payloads() {
    let id = Uuid::new_v4();
    let capture = WorkerCommand::Capture {};
    for size in [0, MAX_WORKER_ARCHIVE + 1] {
        assert!(decode(
            &reply(id, 1, json!({"Ok":{"size_bytes":size}})),
            id,
            1,
            &capture
        )
        .is_err());
    }
    assert!(decode(
        &reply(id, 1, json!({"Ok":{"size_bytes":42,"path":"x"}})),
        id,
        1,
        &capture
    )
    .is_err());
    assert!(decode(
        &reply(id, 1, json!({"Ok":{"size_bytes":42}})),
        id,
        1,
        &capture
    )
    .is_ok());
}

#[test]
fn worker_requests_refuse_duplicate_targets_nonfinite_values_and_oversized_text() {
    let id = Uuid::new_v4();
    let edit = WorkerEdit {
        selection_id: Uuid::new_v4(),
        value: WorkerValue::Text("safe".into()),
    };
    assert!(encode(
        id,
        1,
        &WorkerCommand::Edit {
            operations: vec![edit.clone()]
        }
    )
    .is_ok());
    assert!(encode(
        id,
        1,
        &WorkerCommand::Edit {
            operations: vec![edit.clone(), edit]
        }
    )
    .is_err());
    for value in [
        WorkerValue::Number(f64::NAN),
        WorkerValue::Text("x".repeat(4097)),
    ] {
        assert!(encode(
            id,
            1,
            &WorkerCommand::Edit {
                operations: vec![WorkerEdit {
                    selection_id: Uuid::new_v4(),
                    value
                }]
            }
        )
        .is_err());
    }
    assert!(encode(Uuid::nil(), 1, &WorkerCommand::Close {}).is_err());
    assert!(decode(
        &vec![b'x'; MAX_WORKER_FRAME + 1],
        id,
        1,
        &WorkerCommand::Close {}
    )
    .is_err());
}
