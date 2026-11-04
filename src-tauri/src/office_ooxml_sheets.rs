//! Workbook tabs and a bounded live-model grid, backed by the isolated worker.
use crate::{
    office_edit_basic::BasicItem,
    office_edit_items::{OfficeCellWindow, OfficeDisplayCell, OfficeItemPage, OfficeSheetItem},
    office_edit_types::OfficeEditError as Error,
    office_edit_values::{CellAddress, CellFormatPatch, CellInput, CellRange},
    office_edit_worker_protocol::{WorkerCommand, WorkerPayload},
    office_ooxml_binding::BasicSession,
};
use uuid::Uuid;

pub fn items(session: &mut BasicSession) -> Result<OfficeItemPage, Error> {
    let WorkerPayload::Sheets(meta) = session.worker.request(&WorkerCommand::Sheets {})? else {
        return Err(Error::Failed);
    };
    let items = meta
        .items
        .into_iter()
        .map(|sheet| OfficeSheetItem {
            id: *session
                .sections
                .entry(sheet.index)
                .or_insert_with(Uuid::new_v4),
            name: sheet.name,
            index: sheet.index as u32,
            hidden: sheet.hidden,
            color: None,
            rows: 1_048_576,
            columns: 16_384,
        })
        .collect();
    Ok(OfficeItemPage::Sheets {
        items,
        next_cursor: None,
        complete: true,
        revision: session.state.revision,
    })
}

pub fn window(session: &mut BasicSession, range: &CellRange) -> Result<OfficeCellWindow, Error> {
    if !range.is_valid() {
        return Err(Error::Invalid);
    }
    let index = *session
        .sections
        .iter()
        .find(|(_, id)| **id == range.sheet_id)
        .map(|(index, _)| index)
        .ok_or(Error::Invalid)?;
    let columns = range.last_column - range.first_column + 1;
    let total = (range.last_row - range.first_row + 1)
        .checked_mul(columns)
        .ok_or(Error::TooLarge)? as usize;
    if !range.is_valid() || total > 2000 {
        return Err(Error::TooLarge);
    }
    let WorkerPayload::SheetWindow(info) = session.worker.request(&WorkerCommand::SheetWindow {
        section_index: index,
        first_row: range.first_row,
        last_row: range.last_row,
        first_column: range.first_column,
        last_column: range.last_column,
    })?
    else {
        return Err(Error::Failed);
    };
    if info.cell_count != total {
        return Err(Error::Failed);
    }
    let mut start = 0;
    let mut cells = Vec::with_capacity(total);
    let mut targets = std::collections::HashMap::new();
    while start < total {
        let WorkerPayload::SheetCells(page) =
            session.worker.request(&WorkerCommand::SheetCells {
                window_id: info.window_id,
                start,
            })?
        else {
            return Err(Error::Failed);
        };
        if page.items.len() > total - start {
            return Err(Error::Failed);
        }
        for item in page.items {
            let row = range.first_row + (cells.len() as u32 / columns);
            let column = range.first_column + (cells.len() as u32 % columns);
            if item.row != row
                || item.column != column
                || crate::office_ooxml_operations::cell_point(&item.address) != Some((row, column))
            {
                return Err(Error::Failed);
            }
            let input: CellInput = serde_json::from_value(item.input).map_err(|_| Error::Failed)?;
            let format: CellFormatPatch =
                serde_json::from_value(item.format).map_err(|_| Error::Failed)?;
            if !input.is_valid() || (!format.is_empty() && !format.is_valid()) {
                return Err(Error::Failed);
            }
            if let Some(id) = item.target_id {
                targets.insert(
                    id,
                    BasicItem {
                        id,
                        section_id: range.sheet_id,
                        text: item.display.clone(),
                        address: Some(item.address),
                    },
                );
            }
            cells.push(OfficeDisplayCell {
                address: CellAddress {
                    sheet_id: range.sheet_id,
                    row,
                    column,
                },
                display: item.display,
                input,
                format,
                error_code: None,
                merged_range: None,
                editable: item.target_id.is_some(),
            });
        }
        start = cells.len();
        if page.next_start != ((start < total).then_some(start)) {
            return Err(Error::Failed);
        }
    }
    session.targets = targets;
    let rows = cells
        .chunks(columns as usize)
        .map(|row| row.to_vec())
        .collect();
    Ok(OfficeCellWindow {
        revision: session.state.revision,
        range: *range,
        rows,
        next_row: None,
    })
}
