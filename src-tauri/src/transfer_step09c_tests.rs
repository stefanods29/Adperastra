//! Native tests for content-transfer contracts (Step 09c T1). Registered
//! from `main.rs` with `#[cfg(test)] mod transfer_step09c_tests;`.

use crate::export_snapshot_types::{ExportSnapshot, StoragePolicy};
use crate::transfer_types::{
    TransferAction, TransferActionId, TransferCell, TransferCellKind, TransferEnvelope,
    TransferError, TransferPayload, TransferReceipt,
};
use crate::transfer_validation::{
    validate_transfer_action, validate_transfer_envelope, validate_transfer_payload,
    validate_transfer_receipt,
};
use uuid::Uuid;

fn image_envelope(policy: StoragePolicy) -> TransferEnvelope {
    let document = Uuid::new_v4().to_string();
    TransferEnvelope {
        transfer_id: Uuid::new_v4().to_string(),
        source_document_id: Some(document.clone()),
        source_revision: Some(3),
        sensitive: false,
        payload: TransferPayload::Image {
            snapshot: ExportSnapshot {
                snapshot_id: Uuid::new_v4().to_string(),
                document_id: document,
                revision: 3,
                content_id: Uuid::new_v4(),
                mime: "image/png".to_string(),
                byte_len: 64,
                source: None,
                storage_policy: policy,
                expires_unix: 1_000,
            },
            width: 2,
            height: 2,
        },
        expires_unix: 2_000,
        source_tab_id: None,
    }
}

#[test]
fn sensitive_cannot_be_downgraded() {
    let by_source = validate_transfer_envelope(image_envelope(StoragePolicy::Ordinary), true)
        .expect("sensitive source envelope must validate");
    assert!(by_source.sensitive);

    let by_snapshot = validate_transfer_envelope(image_envelope(StoragePolicy::Sensitive), false)
        .expect("sensitive snapshot envelope must validate");
    assert!(by_snapshot.sensitive);

    let ordinary = validate_transfer_envelope(image_envelope(StoragePolicy::Ordinary), false)
        .expect("ordinary envelope must validate");
    assert!(!ordinary.sensitive);
}

#[test]
fn nonfinite_cell_is_refused() {
    let payload = TransferPayload::Cells {
        rows: vec![vec![TransferCell {
            kind: TransferCellKind::Number,
            text: None,
            number: Some(f64::NAN),
            boolean: None,
            format: None,
        }]],
        row_count: 1,
        column_count: 1,
    };
    assert_eq!(validate_transfer_payload(&payload), Err(TransferError::Invalid));
}

#[test]
fn action_and_receipt_validation_refuse_unknown_keys() {
    let action = TransferAction {
        id: TransferActionId::InsertText,
        label_key: "transfer.insertText".to_string(),
        losses: Vec::new(),
        mutates: true,
    };
    assert!(validate_transfer_action(&action).is_ok());
    let bad_action = TransferAction {
        losses: vec!["transfer.unknown".to_string()],
        ..action
    };
    assert_eq!(
        validate_transfer_action(&bad_action),
        Err(TransferError::Invalid)
    );
    let receipt = TransferReceipt {
        transaction_id: Uuid::new_v4().to_string(),
        target_document_id: None,
        revision: Some(2),
        inserted_count: 0,
        losses: Vec::new(),
        complete: true,
    };
    assert!(validate_transfer_receipt(&receipt).is_ok());
}

#[test]
fn pdf_pages_must_be_sorted_and_unique() {
    let snapshot = match image_envelope(StoragePolicy::Ordinary).payload {
        TransferPayload::Image { mut snapshot, .. } => {
            snapshot.mime = "application/pdf".to_string();
            snapshot
        }
        _ => unreachable!(),
    };
    let payload = TransferPayload::PdfPages {
        snapshot,
        pages: vec![2, 1],
    };
    assert_eq!(validate_transfer_payload(&payload), Err(TransferError::Invalid));
}
