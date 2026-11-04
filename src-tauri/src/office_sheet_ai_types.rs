//! ai-sheet-1 independent request/cleaning DTOs. No IPC or engine authority.
//! Full proposal/output mirror awaits coordinator-owned 20a DTO reconciliation.
#![allow(dead_code)]

use crate::office_edit_values::{CellAddress, CellInput, CellRange};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SheetAiAction { Formula, Explain, Clean, Chart, Describe }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SheetAiRequest {
    pub action: SheetAiAction,
    pub session_id: String,
    pub expected_revision: u64,
    pub expected_content_id: String,
    pub selection: CellRange,
    #[serde(deserialize_with = "Option::deserialize")]
    pub target: Option<CellAddress>,
    pub header: bool,
    pub include_hidden: bool,
    pub request: String,
    pub locale: String,
    pub request_revision: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SheetCleanOperation {
    TrimSpaces { columns: Vec<u16> },
    NormalizeDate { columns: Vec<u16>, source_format: SheetDateFormat },
    ParseNumber { columns: Vec<u16>, decimal: SheetDecimal, thousands: SheetThousands, allow_leading_zero: bool },
    MarkDuplicates { key_columns: Vec<u16>, clear_duplicate_values: bool },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SheetDateFormat {
    #[serde(rename = "YYYY-MM-DD")] Iso,
    #[serde(rename = "DD/MM/YYYY")] DayFirst,
    #[serde(rename = "MM/DD/YYYY")] MonthFirst,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SheetDecimal { Dot, Comma }
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SheetThousands { None, Dot, Comma, Space }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SheetCleanReason { TrimSpaces, NormalizeDate, ParseNumber, Duplicate }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SheetCleanWarning { AmbiguousDate, InvalidNumber, IdentifierPreserved, FormulaPreserved, DuplicateMarkOnly }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SheetCleanDiff {
    pub address: CellAddress,
    pub before: CellInput,
    pub after: CellInput,
    pub reason: SheetCleanReason,
    #[serde(deserialize_with = "Option::deserialize")]
    pub warning: Option<SheetCleanWarning>,
    #[serde(deserialize_with = "Option::deserialize")]
    pub duplicate_of: Option<CellAddress>,
}

fn uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).map(|id| id.to_string() == value).unwrap_or(false)
}
pub fn validate_sheet_request(request: &SheetAiRequest) -> Result<(), &'static str> {
    let r = &request.selection;
    if !uuid(&request.session_id) || !uuid(&request.expected_content_id) || !uuid(r.sheet_id.to_string().as_str())
        || request.expected_revision == 0 || request.expected_revision > 9_007_199_254_740_991
        || !matches!(request.locale.as_str(), "en" | "es")
        || request.request.is_empty() || request.request.chars().count() > 2000
        || r.first_row > r.last_row || r.last_row > 1_048_575
        || r.first_column > r.last_column || r.last_column > 16_383 {
        return Err("sheet_ai.invalid");
    }
    let rows = u64::from(r.last_row - r.first_row) + 1;
    let columns = u64::from(r.last_column - r.first_column) + 1;
    if rows > 500 || columns > 100 || rows * columns > 2000 { return Err("sheet_ai.invalid"); }
    if request.action == SheetAiAction::Formula && request.target.is_none() { return Err("sheet_ai.invalid"); }
    if let Some(a) = &request.target {
        if a.sheet_id != r.sheet_id || a.row < r.first_row || a.row > r.last_row
            || a.column < r.first_column || a.column > r.last_column { return Err("sheet_ai.invalid"); }
    }
    Ok(())
}
pub fn validate_sheet_clean_operations(operations: &[SheetCleanOperation], width: u16) -> Result<(), &'static str> {
    if operations.is_empty() || operations.len() > 16 || width == 0 || width > 100 { return Err("sheet_ai.invalid"); }
    for operation in operations {
        let columns = match operation {
            SheetCleanOperation::TrimSpaces { columns }
            | SheetCleanOperation::NormalizeDate { columns, .. }
            | SheetCleanOperation::ParseNumber { columns, .. } => columns,
            SheetCleanOperation::MarkDuplicates { key_columns, .. } => key_columns,
        };
        let distinct: std::collections::HashSet<_> = columns.iter().collect();
        if columns.is_empty() || columns.len() > 100 || distinct.len() != columns.len()
            || columns.iter().any(|column| *column >= width) { return Err("sheet_ai.invalid"); }
        if let SheetCleanOperation::ParseNumber { decimal, thousands, .. } = operation {
            if matches!((decimal, thousands), (SheetDecimal::Dot, SheetThousands::Dot)
                | (SheetDecimal::Comma, SheetThousands::Comma)) { return Err("sheet_ai.ambiguous"); }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn script_operation_is_refused() {
        assert!(serde_json::from_str::<SheetCleanOperation>(r#"{"kind":"script","code":"run()"}"#).is_err());
    }
    #[test]
    fn extra_operation_fields_are_refused() {
        assert!(serde_json::from_str::<SheetCleanOperation>(r#"{"kind":"trim_spaces","columns":[0],"script":"run()"}"#).is_err());
    }
    #[test]
    fn overlapping_separators_are_refused() {
        let operation = SheetCleanOperation::ParseNumber { columns: vec![0], decimal: SheetDecimal::Dot,
            thousands: SheetThousands::Dot, allow_leading_zero: false };
        assert_eq!(validate_sheet_clean_operations(&[operation], 1), Err("sheet_ai.ambiguous"));
    }
}
