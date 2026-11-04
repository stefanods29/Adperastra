//! Authoritative correction history for one reviewed extraction (Step 17d T4).
//!
//! Each call is one revision (CAS). The source is never touched; only the
//! reviewed model changes, and every table stays rectangular. The TypeScript
//! `extractionCorrections.ts` mirrors these rules for an immediate preview;
//! this native result is the stored authority.
#![allow(dead_code)]


use uuid::Uuid;

use crate::ai_extraction_requests::ExtractionCorrection;
use crate::ai_extraction_types::{
    ExtractionReview, ExtractionTable, ExtractionValue, ExtractionValueStatus, MAX_TABLE_CELLS,
};
use crate::ai_extraction_validation::validate_review;

pub const MAX_CORRECTIONS: usize = 1000;
pub const MAX_TABLE_COLUMNS: usize = 100;

#[derive(Debug, Clone, Copy)]
enum TableRef {
    Document(usize),
    Receipt(usize),
}

fn find_table(review: &mut ExtractionReview, table_id: Uuid) -> Option<(TableRef, &mut ExtractionTable)> {
    if let Some(index) = review.tables.iter().position(|table| table.id == table_id) {
        return Some((TableRef::Document(index), &mut review.tables[index]));
    }
    let index = review
        .receipts
        .iter()
        .position(|receipt| receipt.line_items.id == table_id)?;
    Some((TableRef::Receipt(index), &mut review.receipts[index].line_items))
}

fn corrected(value: &ExtractionValue, next: String, revision: u64) -> ExtractionValue {
    let mut result = value.clone();
    result.value = next;
    result.status = ExtractionValueStatus::Corrected;
    result.correction_revision = revision;
    result
}

/// Replaces one value anywhere in the reviewed model. `None` means the value
/// does not belong to this review.
pub fn replace_value(review: &mut ExtractionReview, id: Uuid, next: ExtractionValue) -> bool {
    for block in &mut review.blocks {
        if let Some(text) = &mut block.text {
            if text.id == id {
                *text = next;
                return true;
            }
        }
        for item in &mut block.list_items {
            if item.id == id {
                *item = next;
                return true;
            }
        }
    }
    for table in &mut review.tables {
        if replace_in_table(table, id, &next) {
            return true;
        }
    }
    for receipt in &mut review.receipts {
        for field in [
            &mut receipt.vendor,
            &mut receipt.tax_id,
            &mut receipt.date,
            &mut receipt.currency,
            &mut receipt.subtotal,
            &mut receipt.tax,
            &mut receipt.total,
        ] {
            if field.id == id {
                *field = next.clone();
                return true;
            }
        }
        if replace_in_table(&mut receipt.line_items, id, &next) {
            return true;
        }
    }
    false
}

fn replace_in_table(table: &mut ExtractionTable, id: Uuid, next: &ExtractionValue) -> bool {
    for column in &mut table.columns {
        if column.name.id == id {
            column.name = next.clone();
            return true;
        }
    }
    for row in &mut table.rows {
        for cell in &mut row.cells {
            if cell.id == id {
                *cell = next.clone();
                return true;
            }
        }
    }
    false
}

pub fn value_of(review: &ExtractionReview, id: Uuid) -> Option<&ExtractionValue> {
    for block in &review.blocks {
        if let Some(text) = &block.text {
            if text.id == id {
                return Some(text);
            }
        }
        if let Some(item) = block.list_items.iter().find(|item| item.id == id) {
            return Some(item);
        }
    }
    for table in &review.tables {
        if let Some(value) = value_in_table(table, id) {
            return Some(value);
        }
    }
    for receipt in &review.receipts {
        for field in [
            &receipt.vendor,
            &receipt.tax_id,
            &receipt.date,
            &receipt.currency,
            &receipt.subtotal,
            &receipt.tax,
            &receipt.total,
        ] {
            if field.id == id {
                return Some(field);
            }
        }
        if let Some(value) = value_in_table(&receipt.line_items, id) {
            return Some(value);
        }
    }
    None
}

fn value_in_table(table: &ExtractionTable, id: Uuid) -> Option<&ExtractionValue> {
    if let Some(column) = table.columns.iter().find(|column| column.name.id == id) {
        return Some(&column.name);
    }
    table
        .rows
        .iter()
        .flat_map(|row| &row.cells)
        .find(|cell| cell.id == id)
}

fn split_parts(text: &str, separator: &str) -> Vec<String> {
    text.split(separator).map(|part| part.trim().to_string()).collect()
}

fn split_column(
    table: &mut ExtractionTable,
    index: usize,
    separator: &str,
    revision: u64,
) -> Result<(), String> {
    let column = table.columns.get(index).cloned().ok_or_else(|| "ai_extract.invalid".to_string())?;
    let header = split_parts(&column.name.value, separator);
    let widest = table
        .rows
        .iter()
        .map(|row| split_parts(&row.cells[index].value, separator).len())
        .max()
        .unwrap_or(header.len());
    let parts = widest.max(1);
    if table.columns.len() - 1 + parts > MAX_TABLE_COLUMNS {
        return Err("ai_extract.too_large".to_string());
    }
    let names: Vec<String> = (0..parts)
        .map(|part| header.get(part).cloned().unwrap_or_default())
        .collect();
    for row in &mut table.rows {
        let cell = row.cells[index].clone();
        let pieces = split_parts(&cell.value, separator);
        let mut cells: Vec<ExtractionValue> = (0..parts)
            .map(|part| corrected(&cell, pieces.get(part).cloned().unwrap_or_default(), revision))
            .collect();
        if let Some(first) = cells.first_mut() {
            first.id = cell.id;
            first.original = cell.original;
        }
        row.cells.splice(index..=index, cells);
    }
    let mut columns = Vec::with_capacity(parts);
    for name in names {
        columns.push(crate::ai_extraction_types::ExtractionColumn {
            id: Uuid::new_v4(),
            name: corrected(&column.name, name, revision),
            column_type: column.column_type,
        });
    }
    table.columns.splice(index..=index, columns);
    Ok(())
}

fn merge_columns(
    table: &mut ExtractionTable,
    mut indices: Vec<usize>,
    separator: &str,
    revision: u64,
) -> Result<(), String> {
    indices.sort_unstable();
    indices.dedup();
    if indices.len() < 2 {
        return Err("ai_extract.invalid".to_string());
    }
    let first = indices[0];
    let columns: Vec<_> = indices.iter().map(|index| table.columns[*index].clone()).collect();
    let name = columns
        .iter()
        .map(|column| column.name.value.as_str())
        .collect::<Vec<_>>()
        .join(separator);
    for row in &mut table.rows {
        let joined = indices
            .iter()
            .map(|index| row.cells[*index].value.as_str())
            .collect::<Vec<_>>()
            .join(separator);
        let merged = corrected(&row.cells[first], joined, revision);
        for index in indices.iter().rev() {
            row.cells.remove(*index);
        }
        row.cells.insert(first, merged);
    }
    let merged_name = corrected(&columns[0].name, name, revision);
    for index in indices.iter().rev() {
        table.columns.remove(*index);
    }
    table.columns.insert(
        first,
        crate::ai_extraction_types::ExtractionColumn {
            id: Uuid::new_v4(),
            name: merged_name,
            column_type: columns[0].column_type,
        },
    );
    Ok(())
}

fn apply_one(
    review: &mut ExtractionReview,
    correction: &ExtractionCorrection,
    revision: u64,
) -> Result<(), String> {
    match correction {
        ExtractionCorrection::Field { id, expected, value } => {
            let current = value_of(review, *id).ok_or_else(|| "ai_extract.invalid".to_string())?;
            if &current.value != expected {
                return Err("ai_extract.changed".to_string());
            }
            let next = corrected(current, value.clone(), revision);
            if !replace_value(review, *id, next) {
                return Err("ai_extract.invalid".to_string());
            }
            Ok(())
        }
        ExtractionCorrection::TableCell {
            table_id,
            row_id,
            column_id,
            expected,
            value,
        } => {
            let (reference, table) =
                find_table(review, *table_id).ok_or_else(|| "ai_extract.invalid".to_string())?;
            let _ = reference;
            let column = table
                .columns
                .iter()
                .position(|column| column.id == *column_id)
                .ok_or_else(|| "ai_extract.invalid".to_string())?;
            let row = table
                .rows
                .iter_mut()
                .find(|row| row.id == *row_id)
                .ok_or_else(|| "ai_extract.invalid".to_string())?;
            let cell = row.cells.get_mut(column).ok_or_else(|| "ai_extract.invalid".to_string())?;
            if &cell.value != expected {
                return Err("ai_extract.changed".to_string());
            }
            *cell = corrected(cell, value.clone(), revision);
            Ok(())
        }
        ExtractionCorrection::SplitColumn {
            table_id,
            column_id,
            separator,
        } => {
            let (reference, table) =
                find_table(review, *table_id).ok_or_else(|| "ai_extract.invalid".to_string())?;
            let index = table
                .columns
                .iter()
                .position(|column| column.id == *column_id)
                .ok_or_else(|| "ai_extract.invalid".to_string())?;
            split_column(table, index, separator, revision)?;
            let _ = reference;
            Ok(())
        }
        ExtractionCorrection::MergeColumns {
            table_id,
            column_ids,
            separator,
        } => {
            let (reference, table) =
                find_table(review, *table_id).ok_or_else(|| "ai_extract.invalid".to_string())?;
            let mut indices = Vec::with_capacity(column_ids.len());
            for id in column_ids {
                let index = table
                    .columns
                    .iter()
                    .position(|column| column.id == *id)
                    .ok_or_else(|| "ai_extract.invalid".to_string())?;
                indices.push(index);
            }
            merge_columns(table, indices, separator, revision)?;
            let _ = reference;
            Ok(())
        }
    }
}

/// One atomic batch: revision + 1 and a new content id, or no change at all.
pub fn apply_corrections(
    review: &ExtractionReview,
    expected_revision: u64,
    corrections: &[ExtractionCorrection],
) -> Result<ExtractionReview, String> {
    if review.revision != expected_revision {
        return Err("ai_extract.changed".to_string());
    }
    if corrections.is_empty() || corrections.len() > MAX_CORRECTIONS {
        return Err("ai_extract.invalid".to_string());
    }
    validate_review(review)?;
    let mut next: ExtractionReview =
        serde_json::from_value(serde_json::to_value(review).map_err(|_| "ai_extract.invalid".to_string())?)
            .map_err(|_| "ai_extract.invalid".to_string())?;
    let revision = expected_revision + 1;
    for correction in corrections {
        if !correction.is_valid() {
            return Err("ai_extract.invalid".to_string());
        }
        apply_one(&mut next, correction, revision)?;
    }
    next.revision = revision;
    next.content_id = Uuid::new_v4();
    next.next_cursor = None;
    if next.total_cells() > MAX_TABLE_CELLS {
        return Err("ai_extract.too_large".to_string());
    }
    validate_review(&next)?;
    Ok(next)
}

#[cfg(test)]
#[path = "ai_extraction_corrections_tests.rs"]
mod tests;
