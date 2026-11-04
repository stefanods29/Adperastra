//! Translate only proved text and existing-cell intents, atomically.
use crate::{
    office_edit_basic::BasicItem,
    office_edit_deck::DeckOperation,
    office_edit_document::DocumentOperation,
    office_edit_sheet::{SheetCellMode, SheetOperation},
    office_edit_types::{OfficeEditError as Error, OfficeOperation, OfficeTransaction},
    office_edit_values::{CellInput, TextSpan},
    office_edit_worker_protocol::{WorkerEdit, WorkerValue},
    office_ooxml_binding::BasicSession,
};
use std::collections::BTreeMap;
use uuid::Uuid;

fn boundary(text: &str, wanted: u32) -> Result<usize, Error> {
    let mut units = 0;
    for (index, ch) in text.char_indices() {
        if units == wanted {
            return Ok(index);
        }
        units += ch.len_utf16() as u32;
    }
    if units == wanted {
        Ok(text.len())
    } else {
        Err(Error::Invalid)
    }
}

fn replace(
    text: &str,
    span: &TextSpan,
    expected: Option<&str>,
    next: &str,
) -> Result<String, Error> {
    if span.anchor.block_id != span.focus.block_id {
        return Err(Error::Unsupported);
    }
    let first = boundary(text, span.anchor.offset_utf16)?;
    let last = boundary(text, span.focus.offset_utf16)?;
    if last < first || expected.is_some_and(|expected| text.get(first..last) != Some(expected)) {
        return Err(Error::Changed);
    }
    Ok(format!("{}{}{}", &text[..first], next, &text[last..]))
}

fn target(session: &BasicSession, id: Uuid) -> Result<&BasicItem, Error> {
    session.targets.get(&id).ok_or(Error::Changed)
}

pub fn cell_point(address: &str) -> Option<(u32, u32)> {
    let letters = address.bytes().take_while(u8::is_ascii_uppercase).count();
    if !(1..=3).contains(&letters) {
        return None;
    }
    let row = address[letters..].parse::<u32>().ok()?.checked_sub(1)?;
    let column = address[..letters]
        .bytes()
        .fold(0u32, |n, c| n * 26 + u32::from(c - b'A' + 1))
        .checked_sub(1)?;
    (row < 1_048_576 && column < 16_384).then_some((row, column))
}

pub fn translate(
    session: &BasicSession,
    transaction: &OfficeTransaction,
) -> Result<Vec<WorkerEdit>, Error> {
    if transaction.operations.len() > 16 {
        return Err(Error::Unsupported);
    }
    let mut text_edits: BTreeMap<Uuid, String> = BTreeMap::new();
    let mut cells: BTreeMap<Uuid, WorkerValue> = BTreeMap::new();
    for operation in &transaction.operations {
        match operation {
            OfficeOperation::Document(DocumentOperation::ReplaceMatch {
                span,
                expected_text,
                replacement,
            }) => {
                if span.revision != session.state.revision {
                    return Err(Error::Changed);
                }
                let item = target(session, span.anchor.block_id)?;
                if text_edits.contains_key(&item.id) {
                    return Err(Error::Unsupported);
                }
                text_edits.insert(
                    item.id,
                    replace(&item.text, span, Some(expected_text), replacement)?,
                );
            }
            OfficeOperation::Deck(DeckOperation::DeleteText {
                slide_id,
                shape_id,
                span,
            }) => {
                let item = target(session, *shape_id)?;
                if item.section_id != *slide_id
                    || span.anchor.block_id != item.id
                    || span.revision != session.state.revision
                {
                    return Err(Error::Changed);
                }
                let current = text_edits.get(&item.id).unwrap_or(&item.text);
                text_edits.insert(item.id, replace(current, span, None, "")?);
            }
            OfficeOperation::Deck(DeckOperation::InsertText {
                slide_id,
                shape_id,
                position,
                text,
            }) => {
                let item = target(session, *shape_id)?;
                if item.section_id != *slide_id || position.block_id != item.id {
                    return Err(Error::Changed);
                }
                let current = text_edits.get(&item.id).unwrap_or(&item.text);
                let span = TextSpan {
                    anchor: *position,
                    focus: *position,
                    revision: session.state.revision,
                };
                text_edits.insert(item.id, replace(current, &span, None, text)?);
            }
            OfficeOperation::Sheet(SheetOperation::SetCells {
                range,
                values,
                mode,
            }) => {
                if *mode == SheetCellMode::Formulas {
                    return Err(Error::Unsupported);
                }
                if cells.len() + values.iter().map(Vec::len).sum::<usize>() > 16 {
                    return Err(Error::TooLarge);
                }
                for (row_offset, row) in values.iter().enumerate() {
                    for (column_offset, input) in row.iter().enumerate() {
                        let point = (
                            range.first_row + row_offset as u32,
                            range.first_column + column_offset as u32,
                        );
                        let item = session
                            .targets
                            .values()
                            .find(|item| {
                                item.section_id == range.sheet_id
                                    && item
                                        .address
                                        .as_ref()
                                        .and_then(|address| cell_point(address))
                                        == Some(point)
                            })
                            .ok_or(Error::Changed)?;
                        let value = match input {
                            CellInput::Text { text } => WorkerValue::Text(text.clone()),
                            CellInput::Number { value } => WorkerValue::Number(*value),
                            CellInput::Boolean { value } => WorkerValue::Boolean(*value),
                            CellInput::Blank {} => WorkerValue::Blank,
                            _ => return Err(Error::Unsupported),
                        };
                        if cells.insert(item.id, value).is_some() {
                            return Err(Error::Unsupported);
                        }
                    }
                }
            }
            _ => return Err(Error::Unsupported),
        }
    }
    let mut edits = Vec::new();
    for (id, text) in text_edits {
        if text != target(session, id)?.text {
            edits.push(WorkerEdit {
                selection_id: id,
                value: WorkerValue::Text(text),
            });
        }
    }
    edits.extend(cells.into_iter().map(|(selection_id, value)| WorkerEdit {
        selection_id,
        value,
    }));
    if edits.is_empty() {
        return Err(Error::Unsupported);
    }
    Ok(edits)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::office_edit_values::TextPosition;
    #[test]
    fn basic_text_ranges_preserve_unicode_and_refuse_stale_expected_text() {
        let id = Uuid::new_v4();
        let span = TextSpan {
            anchor: TextPosition {
                block_id: id,
                offset_utf16: 1,
            },
            focus: TextPosition {
                block_id: id,
                offset_utf16: 3,
            },
            revision: 1,
        };
        assert_eq!(
            replace("A🐴B", &span, Some("🐴"), "horse").unwrap(),
            "AhorseB"
        );
        assert!(replace("A🐴B", &span, Some("wrong"), "horse").is_err());
        let split = TextSpan {
            focus: TextPosition {
                block_id: id,
                offset_utf16: 2,
            },
            ..span
        };
        assert!(replace("A🐴B", &split, None, "x").is_err());
        assert_eq!(cell_point("XFD1048576"), Some((1_048_575, 16_383)));
        assert_eq!(cell_point("XFE1"), None);
    }
}
