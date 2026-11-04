//! Transaction and history dispatch for the native Office commands (20a T2).
//!
//! Identity, idempotency and revision checks happen here before the installed
//! engine port is called. Without an engine every path stops with
//! `office_edit.engine_missing` and leaves session, history and cache alone.

use uuid::Uuid;

use crate::office_edit_sessions::OfficeEditState;
use crate::office_edit_transactions::{
    history_fingerprint, transaction_fingerprint, validate_mutation_result,
};
use crate::office_edit_types::{
    OfficeEditError, OfficeTransaction, OfficeTransactionResult,
};

pub fn transact(
    edit: &OfficeEditState,
    session_id: Uuid,
    transaction: OfficeTransaction,
) -> Result<OfficeTransactionResult, OfficeEditError> {
    transaction.validate()?;
    if !crate::office_edit_validation::valid_transaction_label(&transaction.label_key) {
        return Err(OfficeEditError::Invalid);
    }
    let fingerprint = transaction_fingerprint(session_id, &transaction)?;
    let session = edit.session(session_id)?;
    let _guard = session.lock_mutation()?;
    let current = session.snapshot()?;
    if current.busy {
        return Err(OfficeEditError::Busy);
    }
    if let Some(receipt) = session.lookup_transaction(transaction.transaction_id, &fingerprint)? {
        return Ok(receipt);
    }
    if transaction.expected_revision != current.revision {
        return Err(OfficeEditError::Changed);
    }
    if transaction
        .selection_after
        .as_ref()
        .is_some_and(|selection| {
            crate::office_edit_validation::selection_family(selection) != current.family
        })
    {
        return Err(OfficeEditError::Invalid);
    }
    for operation in &transaction.operations {
        if !crate::office_edit_validation::operation_family_matches(operation, current.family) {
            return Err(OfficeEditError::Invalid);
        }
        operation.validate(current.revision)?;
    }
    let engine = edit.engine()?;
    let result = engine.transact(session_id, &transaction)?;
    validate_mutation_result(&current, transaction.transaction_id, &result, false)?;
    session.commit(current.revision, result.state.clone())?;
    session.retain_transaction(transaction.transaction_id, fingerprint, result.clone())?;
    Ok(result)
}

pub fn history(
    edit: &OfficeEditState,
    session_id: Uuid,
    expected_revision: u64,
    transaction_id: Uuid,
    redo: bool,
) -> Result<OfficeTransactionResult, OfficeEditError> {
    if !(1..=crate::office_edit_values::MAX_SAFE_INTEGER).contains(&expected_revision) {
        return Err(OfficeEditError::Invalid);
    }
    let fingerprint = history_fingerprint(session_id, redo, expected_revision, transaction_id);
    let session = edit.session(session_id)?;
    let _guard = session.lock_mutation()?;
    let current = session.snapshot()?;
    if current.busy {
        return Err(OfficeEditError::Busy);
    }
    if let Some(receipt) = session.lookup_transaction(transaction_id, &fingerprint)? {
        return Ok(receipt);
    }
    if expected_revision != current.revision {
        return Err(OfficeEditError::Changed);
    }
    if (redo && !current.can_redo) || (!redo && !current.can_undo) {
        return Err(OfficeEditError::Unsupported);
    }
    let engine = edit.engine()?;
    let result = if redo {
        engine.redo(session_id, expected_revision, transaction_id)?
    } else {
        engine.undo(session_id, expected_revision, transaction_id)?
    };
    validate_mutation_result(&current, transaction_id, &result, true)?;
    session.commit(current.revision, result.state.clone())?;
    session.retain_transaction(transaction_id, fingerprint, result.clone())?;
    Ok(result)
}
