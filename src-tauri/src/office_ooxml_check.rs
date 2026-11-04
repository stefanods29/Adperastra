//! Disposable command-line check of the real native binding and copy sink.
use crate::{
    engine_types::OfficeFormat,
    file_grant_backing::GrantedBacking,
    office_edit_basic::BasicItem,
    office_edit_deck::DeckOperation,
    office_edit_document::DocumentOperation,
    office_edit_sessions::OfficeEditCommandEngine,
    office_edit_sheet::{SheetCellMode, SheetOperation},
    office_edit_types::*,
    office_edit_values::{CellInput, CellRange, TextPosition, TextSpan},
    office_ooxml_binding::BasicOfficeEngine,
};
use std::{
    io::{Read, Write},
    path::Path,
    sync::Arc,
};
use uuid::Uuid;
pub const FLAG: &str = "--office-engine-check";

fn operations(
    item: &BasicItem,
    family: OfficeFamily,
    revision: u64,
    next: &str,
) -> Result<Vec<OfficeOperation>, String> {
    let anchor = TextPosition {
        block_id: item.id,
        offset_utf16: 0,
    };
    let span = TextSpan {
        anchor,
        focus: TextPosition {
            offset_utf16: item.text.encode_utf16().count() as u32,
            ..anchor
        },
        revision,
    };
    Ok(match family {
        OfficeFamily::Document => {
            vec![OfficeOperation::Document(DocumentOperation::ReplaceMatch {
                span,
                expected_text: item.text.clone(),
                replacement: next.to_owned(),
            })]
        }
        OfficeFamily::Deck => vec![
            OfficeOperation::Deck(DeckOperation::DeleteText {
                slide_id: item.section_id,
                shape_id: item.id,
                span,
            }),
            OfficeOperation::Deck(DeckOperation::InsertText {
                slide_id: item.section_id,
                shape_id: item.id,
                position: anchor,
                text: next.to_owned(),
            }),
        ],
        OfficeFamily::Sheet => {
            let (row, column) = item
                .address
                .as_ref()
                .and_then(|a| crate::office_ooxml_operations::cell_point(a))
                .ok_or("invalid test cell")?;
            vec![OfficeOperation::Sheet(SheetOperation::SetCells {
                range: CellRange {
                    sheet_id: item.section_id,
                    first_row: row,
                    last_row: row,
                    first_column: column,
                    last_column: column,
                },
                values: vec![vec![CellInput::Text {
                    text: next.to_owned(),
                }]],
                mode: SheetCellMode::Values,
            })]
        }
    })
}

fn run(source: &Path, destination: &Path) -> Result<(), String> {
    crate::validate_absolute_path(source.to_str().ok_or("invalid path")?)?;
    crate::validate_absolute_path(destination.to_str().ok_or("invalid path")?)?;
    let format = OfficeFormat::from_file_name(source.to_str().ok_or("invalid name")?)
        .ok_or("unsupported fixture")?;
    let family = crate::office_edit_validation::family_of(format);
    let identity =
        fs_service::owned_io::SourceIdentity::capture(source).map_err(|_| "source unavailable")?;
    let pinned = Arc::new(
        fs_service::owned_io::PinnedSource::open(source, &identity)
            .map_err(|_| "source unavailable")?,
    );
    let length = pinned
        .file()
        .metadata()
        .map_err(|_| "source unavailable")?
        .len();
    if length > 16 * 1024 * 1024 {
        return Err("fixture too large".into());
    }
    let backing = Arc::new(GrantedBacking::Disk {
        source: pinned,
        length,
    });
    let mut original = Vec::new();
    backing
        .reader()
        .read_to_end(&mut original)
        .map_err(|_| "read failed")?;
    let document_id = Uuid::new_v4();
    let saved = Uuid::new_v4();
    let input = Arc::new(AuthorizedOfficeInput {
        document_id,
        initial_revision: 1,
        initial_content_id: saved,
        backing: OfficeInputBacking::Original(backing),
        format,
        source: None,
        sensitive: false,
    });
    let engine = BasicOfficeEngine::new(std::env::temp_dir().join("adp-office-native-check"));
    let code = |e: OfficeEditError| e.code().to_owned();
    let session = engine
        .open(input, family, &OfficeSecurityPolicy::default())
        .map_err(code)?;
    let id = session.session_id;
    let sheet_target = if family == OfficeFamily::Sheet {
        use crate::office_edit_items::{OfficeItemKind, OfficeItemPage};
        let OfficeItemPage::Sheets { items, .. } = engine
            .items(id, OfficeItemKind::Sheets, None)
            .map_err(code)?
        else {
            return Err("missing workbook tabs".into());
        };
        let first = items.first().ok_or("missing first worksheet")?;
        let window = engine
            .cell_window(
                id,
                &CellRange {
                    sheet_id: first.id,
                    first_row: 0,
                    last_row: 5,
                    first_column: 0,
                    last_column: 3,
                },
            )
            .map_err(code)?;
        if window.rows.len() != 6
            || window.rows.iter().any(|row| row.len() != 4)
            || !window.rows.iter().flatten().any(|cell| cell.editable)
        {
            return Err("invalid live workbook grid".into());
        }
        let cell = window
            .rows
            .iter()
            .flatten()
            .find(|cell| cell.editable && matches!(cell.input, CellInput::Blank { .. }))
            .ok_or("fixture has no editable empty cell")?;
        Some(cell.address)
    } else {
        None
    };
    engine.set_mode(id, OfficeMode::Editing).map_err(code)?;
    let edit = |revision: u64, suffix: &str| -> Result<OfficeTransactionResult, String> {
        let item = if let Some(target) = sheet_target {
            let window = engine
                .cell_window(
                    id,
                    &CellRange {
                        sheet_id: target.sheet_id,
                        first_row: target.row,
                        last_row: target.row,
                        first_column: target.column,
                        last_column: target.column,
                    },
                )
                .map_err(code)?;
            let cell = window
                .rows
                .first()
                .and_then(|row| row.first())
                .filter(|cell| cell.editable)
                .ok_or("missing editable test cell")?;
            BasicItem {
                id: Uuid::nil(),
                section_id: target.sheet_id,
                address: Some(format!(
                    "{}{}",
                    char::from(b'A' + target.column as u8),
                    target.row + 1
                )),
                text: cell.display.clone(),
            }
        } else {
            engine
                .basic_page(id, revision, 0, 0)
                .map_err(code)?
                .items
                .into_iter()
                .next()
                .ok_or("fixture has no eligible target")?
        };
        let next = format!("{}{}", item.text, suffix);
        engine
            .transact(
                id,
                &OfficeTransaction {
                    transaction_id: Uuid::new_v4(),
                    expected_revision: revision,
                    operations: operations(&item, family, revision, &next)?,
                    selection_after: None,
                    label_key: "office.transaction".to_owned(),
                },
            )
            .map_err(code)
    };
    let first_state = edit(1, " edited")?.state;
    let mut first = Vec::new();
    engine
        .capture(id, first_state.revision, &mut first)
        .map_err(code)?;
    let first_hash = blake3::hash(&first);
    let second_state = edit(2, " again")?.state;
    let mut second = Vec::new();
    engine
        .capture(id, second_state.revision, &mut second)
        .map_err(code)?;
    if first == second || first_hash != blake3::hash(&first) {
        return Err("capture not immutable".into());
    }
    let undone = engine.undo(id, 3, Uuid::new_v4()).map_err(code)?;
    if undone.state.content_id != first_state.content_id {
        return Err("undo identity mismatch".into());
    }
    let mut bytes = Vec::new();
    engine.capture(id, 4, &mut bytes).map_err(code)?;
    if bytes != first {
        return Err("undo bytes mismatch".into());
    }
    let redone = engine.redo(id, 4, Uuid::new_v4()).map_err(code)?;
    if redone.state.content_id != second_state.content_id {
        return Err("redo identity mismatch".into());
    }
    bytes.clear();
    engine.capture(id, 5, &mut bytes).map_err(code)?;
    if bytes != second {
        return Err("redo bytes mismatch".into());
    }
    engine
        .discard_saved(id, saved, 5, second_state.content_id)
        .map_err(code)?;
    bytes.clear();
    engine.capture(id, 6, &mut bytes).map_err(code)?;
    if bytes != original {
        return Err("discard changed original bytes".into());
    }
    engine.close(id).map_err(code)?;
    let parent = fs_service::owned_io::PinnedDirectory::open(
        destination.parent().ok_or("invalid destination")?,
    )
    .map_err(|_| "destination unavailable")?;
    let mut output = fs_service::owned_io::OwnedOutput::create(&parent, "office-check")
        .map_err(|_| "copy creation failed")?;
    output
        .file_mut()
        .write_all(&first)
        .map_err(|_| "copy failed")?;
    output.flush_sync().map_err(|_| "copy flush failed")?;
    output
        .close()
        .publish_to(destination)
        .map_err(|_| "destination exists or copy failed")?;
    println!(
        "{}",
        serde_json::json!({"format":format.as_str(),"native_edit_capture_undo_redo_discard":true,"captures_repeatable":true,"copy_bytes":first.len()})
    );
    Ok(())
}

pub fn main() -> i32 {
    let args: Vec<_> = std::env::args_os().collect();
    if args.len() != 4 {
        return 1;
    }
    match run(Path::new(&args[2]), Path::new(&args[3])) {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("{error}");
            1
        }
    }
}
