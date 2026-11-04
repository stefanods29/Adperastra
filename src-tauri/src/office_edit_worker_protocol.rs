//! Bounded native side of the OOXML worker protocol.
//!
//! This codec carries no filesystem paths. It does not install a binding or
//! grant an editing capability; the selected engine must still own its live
//! session, confinement, deadline and immutable capture publication.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::office_edit_types::OfficeEditError;
use crate::office_edit_values::MAX_SAFE_INTEGER;

pub const MAX_WORKER_FRAME: usize = 64 * 1024;
pub const MAX_WORKER_ARCHIVE: u64 = 16 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WorkerCommand {
    Sheets {},
    SheetWindow {
        section_index: usize,
        first_row: u32,
        last_row: u32,
        first_column: u32,
        last_column: u32,
    },
    SheetCells {
        window_id: Uuid,
        start: usize,
    },
    Validate {},
    List {
        section_index: usize,
        start: usize,
    },
    Edit {
        operations: Vec<WorkerEdit>,
    },
    Undo {},
    Redo {},
    Capture {},
    Snapshot {},
    SnapshotRead {
        snapshot_id: Uuid,
        offset: usize,
    },
    SnapshotRelease {
        snapshot_id: Uuid,
    },
    Close {},
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkerEdit {
    pub selection_id: Uuid,
    pub value: WorkerValue,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum WorkerValue {
    Text(String),
    Number(f64),
    Boolean(bool),
    Blank,
}

impl WorkerValue {
    fn is_valid(&self) -> bool {
        match self {
            Self::Text(text) => {
                text.len() <= 4096
                    && !text
                        .chars()
                        .any(|c| c.is_control() || matches!(c, '\u{fffe}' | '\u{ffff}'))
            }
            Self::Number(number) => number.is_finite(),
            Self::Boolean(_) | Self::Blank => true,
        }
    }
}

#[derive(Serialize)]
struct Request<'a> {
    request_id: Uuid,
    expected_revision: u64,
    command: &'a WorkerCommand,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerTarget {
    pub id: Uuid,
    pub ordinal: usize,
    pub text: String,
    pub address: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerTargetPage {
    #[serde(default)]
    pub has_next_section: bool,
    pub items: Vec<WorkerTarget>,
    pub next_start: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerCapture {
    pub size_bytes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerSnapshot {
    pub snapshot_id: Uuid,
    pub size_bytes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerChunk {
    pub snapshot_id: Uuid,
    pub offset: usize,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum WorkerPayload {
    Sheets(crate::office_ooxml_sheet_protocol::Sheets),
    SheetWindow(crate::office_ooxml_sheet_protocol::WindowInfo),
    SheetCells(crate::office_ooxml_sheet_protocol::Cells),
    Empty(()),
    Targets(WorkerTargetPage),
    Capture(WorkerCapture),
    Snapshot(WorkerSnapshot),
    Chunk(WorkerChunk),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Reply {
    request_id: Uuid,
    revision: u64,
    result: Result<WorkerPayload, WorkerError>,
}

#[derive(Deserialize)]
enum WorkerError {
    #[serde(rename = "office_edit.unsupported")]
    Unsupported,
}

/// Serialize exactly one newline-terminated frame after native bounds checks.
pub fn encode(
    request_id: Uuid,
    expected_revision: u64,
    command: &WorkerCommand,
) -> Result<Vec<u8>, OfficeEditError> {
    if request_id.is_nil() || !(1..MAX_SAFE_INTEGER).contains(&expected_revision) {
        return Err(OfficeEditError::Invalid);
    }
    if let WorkerCommand::Edit { operations } = command {
        let mut ids = std::collections::HashSet::new();
        if operations.is_empty()
            || operations.len() > 16
            || operations.iter().any(|edit| {
                edit.selection_id.is_nil()
                    || !ids.insert(edit.selection_id)
                    || !edit.value.is_valid()
            })
        {
            return Err(OfficeEditError::Invalid);
        }
    }
    let mut bytes = serde_json::to_vec(&Request {
        request_id,
        expected_revision,
        command,
    })
    .map_err(|_| OfficeEditError::Invalid)?;
    if bytes.len() >= MAX_WORKER_FRAME {
        return Err(OfficeEditError::TooLarge);
    }
    bytes.push(b'\n');
    Ok(bytes)
}

/// Wrong identities, revision jumps and mismatched payloads are protocol
/// failures. The caller must stop that worker, rather than accepting its state.
pub fn decode(
    bytes: &[u8],
    request_id: Uuid,
    expected_revision: u64,
    command: &WorkerCommand,
) -> Result<(u64, WorkerPayload), OfficeEditError> {
    if bytes.len() > MAX_WORKER_FRAME
        || request_id.is_nil()
        || !(1..MAX_SAFE_INTEGER).contains(&expected_revision)
    {
        return Err(OfficeEditError::Invalid);
    }
    let reply: Reply = serde_json::from_slice(bytes).map_err(|_| OfficeEditError::Failed)?;
    if reply.request_id != request_id {
        return Err(OfficeEditError::Failed);
    }
    let payload = match reply.result {
        Ok(payload) => payload,
        Err(_) if reply.revision == expected_revision => return Err(OfficeEditError::Unsupported),
        Err(_) => return Err(OfficeEditError::Failed),
    };
    let mutates = matches!(
        command,
        WorkerCommand::Edit { .. } | WorkerCommand::Undo {} | WorkerCommand::Redo {}
    );
    if reply.revision != expected_revision + u64::from(mutates) {
        return Err(OfficeEditError::Failed);
    }
    let valid = match (command, &payload) {
        (WorkerCommand::Sheets {}, WorkerPayload::Sheets(sheets)) => sheets.valid(),
        (
            WorkerCommand::SheetWindow {
                first_row,
                last_row,
                first_column,
                last_column,
                ..
            },
            WorkerPayload::SheetWindow(info),
        ) => {
            !info.window_id.is_nil()
                && last_row >= first_row
                && last_column >= first_column
                && u64::from(last_row - first_row + 1) * u64::from(last_column - first_column + 1)
                    == info.cell_count as u64
                && info.cell_count <= 2000
        }
        (WorkerCommand::SheetCells { window_id, start }, WorkerPayload::SheetCells(cells)) => {
            cells.valid(*window_id, *start)
        }
        (WorkerCommand::Snapshot {}, WorkerPayload::Snapshot(info)) => {
            !info.snapshot_id.is_nil() && (1..=MAX_WORKER_ARCHIVE).contains(&info.size_bytes)
        }
        (
            WorkerCommand::SnapshotRead {
                snapshot_id,
                offset,
            },
            WorkerPayload::Chunk(chunk),
        ) => {
            chunk.snapshot_id == *snapshot_id
                && chunk.offset == *offset
                && !chunk.bytes.is_empty()
                && chunk.bytes.len() <= 8192
                && chunk
                    .offset
                    .checked_add(chunk.bytes.len())
                    .is_some_and(|end| end <= MAX_WORKER_ARCHIVE as usize)
        }
        (WorkerCommand::List { start, .. }, WorkerPayload::Targets(page)) => {
            page.items.len() <= 8
                && page.items.iter().all(|target| {
                    !target.id.is_nil()
                        && target.ordinal >= *start
                        && target.text.len() <= 4096
                        && target
                            .address
                            .as_ref()
                            .is_none_or(|address| valid_address(address))
                })
                && page
                    .next_start
                    .is_none_or(|next| page.items.last().is_some_and(|last| next > last.ordinal))
        }
        (WorkerCommand::Capture {}, WorkerPayload::Capture(info)) => {
            (1..=MAX_WORKER_ARCHIVE).contains(&info.size_bytes)
        }
        (
            WorkerCommand::Edit { .. }
            | WorkerCommand::Undo {}
            | WorkerCommand::Redo {}
            | WorkerCommand::Validate {}
            | WorkerCommand::SnapshotRelease { .. }
            | WorkerCommand::Close {},
            WorkerPayload::Empty(()),
        ) => true,
        _ => false,
    };
    if !valid {
        return Err(OfficeEditError::Failed);
    }
    Ok((reply.revision, payload))
}

fn valid_address(address: &str) -> bool {
    let letters = address.bytes().take_while(u8::is_ascii_uppercase).count();
    if !(1..=3).contains(&letters) {
        return false;
    }
    let row = &address[letters..];
    !row.starts_with('0')
        && row.bytes().all(|b| b.is_ascii_digit())
        && row
            .parse::<u32>()
            .is_ok_and(|r| (1..=1_048_576).contains(&r))
        && address[..letters]
            .bytes()
            .fold(0u32, |n, b| n * 26 + u32::from(b - b'A' + 1))
            <= 16_384
}

#[cfg(test)]
#[path = "office_edit_worker_protocol_tests.rs"]
mod tests;
