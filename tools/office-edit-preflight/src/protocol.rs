//! Private, bounded worker transport. Filesystem authority is fixed at launch.
use std::{
    fs::{File, OpenOptions},
    io::{BufRead, Read, Write},
    path::Path,
};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{session::Session, Replacement, Result, MAX_ARCHIVE};

const MAX_FRAME: usize = 64 * 1024;
const MAX_REQUESTS: usize = 10_000;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    request_id: Uuid,
    expected_revision: u64,
    command: Command,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum Command {
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
        operations: Vec<Edit>,
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

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Edit {
    selection_id: Uuid,
    value: Value,
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    content = "value",
    rename_all = "snake_case",
    deny_unknown_fields
)]
enum Value {
    Text(String),
    Number(f64),
    Boolean(bool),
    Blank,
}

impl Value {
    fn replacement(&self) -> Replacement<'_> {
        match self {
            Self::Text(value) => Replacement::Text(value),
            Self::Number(value) => Replacement::Number(*value),
            Self::Boolean(value) => Replacement::Boolean(*value),
            Self::Blank => Replacement::Blank,
        }
    }
}

#[derive(Serialize)]
struct Reply {
    request_id: Uuid,
    revision: u64,
    result: std::result::Result<serde_json::Value, &'static str>,
}

/// Never allocate beyond one permitted frame, including a missing newline.
fn read_line(reader: &mut impl BufRead) -> Result<Option<Vec<u8>>> {
    let mut line = Vec::new();
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return if line.is_empty() {
                Ok(None)
            } else {
                Err("truncated frame".into())
            };
        }
        let count = available
            .iter()
            .position(|b| *b == b'\n')
            .map_or(available.len(), |n| n + 1);
        if line.len() + count > MAX_FRAME {
            return Err("frame too large".into());
        }
        line.extend_from_slice(&available[..count]);
        reader.consume(count);
        if line.last() == Some(&b'\n') {
            return Ok(Some(line));
        }
    }
}

fn send(writer: &mut impl Write, reply: &Reply) -> Result<()> {
    let bytes = serde_json::to_vec(reply)?;
    if bytes.len() >= MAX_FRAME {
        return Err("reply too large".into());
    }
    writer.write_all(&bytes)?;
    writer.write_all(b"\n")?;
    writer.flush()?;
    Ok(())
}

fn apply(
    session: &mut Session<'_>,
    request: &Request,
    output: Option<&Path>,
    snapshots: &mut crate::snapshot::SnapshotStore,
    windows: &mut crate::sheet_view::WindowStore,
) -> Result<serde_json::Value> {
    // All commands, including close and list, must name the current model.
    session.capture(request.expected_revision)?;
    match &request.command {
        Command::Sheets {} => {
            if session.kind() != "xlsx" {
                return Err("not a workbook".into());
            }
            crate::sheet_view::sheets(&session.capture(request.expected_revision)?)
        }
        Command::SheetWindow {
            section_index,
            first_row,
            last_row,
            first_column,
            last_column,
        } => windows.begin(
            session,
            request.expected_revision,
            *section_index,
            [*first_row, *last_row, *first_column, *last_column],
        ),
        Command::SheetCells { window_id, start } => windows.read(*window_id, *start),
        Command::Validate {} => {
            let bytes = session.capture(request.expected_revision)?;
            let part = crate::parts::resolve_part(session.kind(), &bytes, 0)?;
            crate::rewrite_inner(session.kind(), &bytes, &part, None)?;
            Ok(serde_json::Value::Null)
        }
        Command::List {
            section_index,
            start,
        } => {
            let mut items =
                session.list_page(request.expected_revision, *section_index, *start, 9)?;
            let mut size = 2048;
            let count = items
                .iter()
                .take(8)
                .take_while(|item| {
                    size += serde_json::to_vec(item).map_or(MAX_FRAME, |bytes| bytes.len()) + 1;
                    size < MAX_FRAME
                })
                .count();
            let next_start = items.get(count).map(|item| item.ordinal);
            items.truncate(count);
            let bytes = session.capture(request.expected_revision)?;
            let has_next_section = section_index.checked_add(1).is_some_and(|next| {
                crate::parts::resolve_part(session.kind(), &bytes, next).is_ok()
            });
            Ok(
                serde_json::json!({ "items": items, "next_start": next_start, "has_next_section": has_next_section }),
            )
        }
        Command::Edit { operations } => {
            if operations.is_empty() || operations.len() > 16 {
                return Err("transaction limit".into());
            }
            let edits: Vec<_> = operations
                .iter()
                .map(|e| (e.selection_id, e.value.replacement()))
                .collect();
            session.edit_many(request.expected_revision, &edits, || false)?;
            Ok(serde_json::Value::Null)
        }
        Command::Undo {} => {
            session.undo(request.expected_revision)?;
            Ok(serde_json::Value::Null)
        }
        Command::Redo {} => {
            session.redo(request.expected_revision)?;
            Ok(serde_json::Value::Null)
        }
        Command::Capture {} => {
            let bytes = session.capture(request.expected_revision)?;
            // Only an owned private output supplied by the native launcher.
            // Publishing to a user destination belongs to the parent process.
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(output.ok_or("file capture unavailable")?)?;
            file.write_all(&bytes)?;
            file.flush()?;
            file.sync_all()?;
            Ok(serde_json::json!({ "size_bytes": bytes.len() }))
        }
        Command::Close {} => Ok(serde_json::Value::Null),
        Command::Snapshot {} => {
            let (snapshot_id, size_bytes) =
                snapshots.begin(session.capture(request.expected_revision)?);
            Ok(serde_json::json!({"snapshot_id":snapshot_id,"size_bytes":size_bytes}))
        }
        Command::SnapshotRead {
            snapshot_id,
            offset,
        } => {
            let bytes = snapshots.read(*snapshot_id, *offset)?;
            Ok(serde_json::json!({"snapshot_id":snapshot_id,"offset":offset,"bytes":bytes}))
        }
        Command::SnapshotRelease { snapshot_id } => {
            snapshots.release(*snapshot_id)?;
            Ok(serde_json::Value::Null)
        }
    }
}

fn serve(
    session: &mut Session<'_>,
    input: &mut impl BufRead,
    output: &mut impl Write,
    capture: Option<&Path>,
) -> Result<()> {
    let mut seen = std::collections::HashSet::new();
    let mut snapshots = crate::snapshot::SnapshotStore::default();
    let mut windows = crate::sheet_view::WindowStore::default();
    for _ in 0..MAX_REQUESTS {
        let Some(line) = read_line(input)? else {
            return Ok(());
        };
        // Malformed frames terminate the worker; no native exception or text
        // from the document is emitted as an error message.
        let request: Request = serde_json::from_slice(&line)?;
        if request.request_id.is_nil() || !seen.insert(request.request_id) {
            return Err("invalid request identity".into());
        }
        let result = apply(session, &request, capture, &mut snapshots, &mut windows)
            .map_err(|_| "office_edit.unsupported");
        let close = matches!(request.command, Command::Close {}) && result.is_ok();
        send(
            output,
            &Reply {
                request_id: request.request_id,
                revision: session.revision(),
                result,
            },
        )?;
        if close {
            return Ok(());
        }
    }
    Err("request limit".into())
}

pub fn run(source: &Path, capture: &Path) -> Result<()> {
    run_inner(source, Some(capture))
}

pub fn run_memory(source: &Path) -> Result<()> {
    run_inner(source, None)
}

fn run_inner(source: &Path, capture: Option<&Path>) -> Result<()> {
    let kind = source
        .extension()
        .and_then(|s| s.to_str())
        .ok_or("unsupported format")?;
    if !matches!(kind, "docx" | "xlsx" | "pptx") {
        return Err("unsupported format".into());
    }
    let mut bytes = Vec::new();
    File::open(source)?
        .take(MAX_ARCHIVE as u64 + 1)
        .read_to_end(&mut bytes)?;
    let mut session = Session::new(kind, bytes)?;
    serve(
        &mut session,
        &mut std::io::stdin().lock(),
        &mut std::io::stdout().lock(),
        capture,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_reject_overflow_and_truncation() {
        assert!(read_line(&mut std::io::Cursor::new(vec![b'x'; MAX_FRAME + 1])).is_err());
        assert!(read_line(&mut std::io::Cursor::new(b"{}")).is_err());
        assert_eq!(
            read_line(&mut std::io::Cursor::new(b"{}\n")).unwrap(),
            Some(b"{}\n".to_vec())
        );
    }

    #[test]
    fn stale_request_cannot_capture_or_close_and_duplicate_ids_terminate() {
        let id = Uuid::new_v4();
        let line =
            serde_json::json!({"request_id":id,"expected_revision":9,"command":{"kind":"capture"}})
                .to_string();
        let input = format!("{line}\n{line}\n");
        let mut out = Vec::new();
        let mut session = Session::new("docx", vec![]).unwrap();
        let destination =
            std::env::temp_dir().join(format!("adp-protocol-{}.docx", Uuid::new_v4()));
        assert!(serve(
            &mut session,
            &mut std::io::Cursor::new(input),
            &mut out,
            Some(&destination)
        )
        .is_err());
        assert!(!destination.exists());
        let reply: serde_json::Value =
            serde_json::from_slice(out.strip_suffix(b"\n").unwrap()).unwrap();
        assert_eq!(reply["revision"], 1);
        assert_eq!(reply["result"]["Err"], "office_edit.unsupported");
    }

    #[test]
    fn commands_cannot_supply_a_path_or_unknown_operation() {
        let id = Uuid::new_v4();
        for command in [
            serde_json::json!({"kind":"capture","path":"x"}),
            serde_json::json!({"kind":"shell"}),
        ] {
            assert!(serde_json::from_value::<Request>(
                serde_json::json!({"request_id":id,"expected_revision":1,"command":command})
            )
            .is_err());
        }
    }
}
