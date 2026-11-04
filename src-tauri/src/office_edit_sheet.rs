//! Typed workbook operations (Step 20a E1, office-edit-1).
//!
//! The TypeScript mirror is `src/office/sheetOperations.ts`. Formula text is
//! inert typed data here; generic transfer never gains an executable formula
//! route. Every limit is checked before a mutation is built.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::office_edit_items::{OfficePageSize, OfficePivot, SheetPrintSettings};
use crate::office_edit_types::OfficeEditError;
use crate::office_edit_values::{
    CellAddress, CellFormatPatch, CellInput, CellRange, OfficeChart, OfficeColor,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SheetCellMode {
    All,
    Values,
    Formulas,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SheetAxis {
    Row,
    Column,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SheetSortKey {
    pub column_offset: u32,
    pub direction: SheetSortDirection,
    pub comparison: SheetComparison,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SheetSortDirection {
    Ascending,
    Descending,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SheetComparison {
    Auto,
    Text,
    Number,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SheetFilterPredicate {
    pub column_offset: u32,
    pub kind: SheetFilterKind,
    pub value: CellInput,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SheetFilterKind {
    Equals,
    Contains,
    Greater,
    Less,
    Nonblank,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SheetConditionalRule {
    pub id: Uuid,
    pub range: CellRange,
    pub priority: u32,
    pub kind: SheetConditionalKind,
    pub operator: SheetComparisonOperator,
    pub values: Vec<CellInput>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
    pub colors: Vec<OfficeColor>,
    pub style: CellFormatPatch,
    pub stop_if_true: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SheetConditionalKind {
    Compare,
    Text,
    Formula,
    ColorScale,
    DataBar,
    IconSet,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SheetComparisonOperator {
    Equal,
    NotEqual,
    Greater,
    Less,
    Between,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SheetValidationRule {
    pub kind: SheetValidationKind,
    pub operator: SheetComparisonOperator,
    pub values: Vec<CellInput>,
    pub list: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
    pub allow_blank: bool,
    pub title: String,
    pub message: String,
    pub error_style: SheetErrorStyle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SheetValidationKind {
    Whole,
    Decimal,
    List,
    Date,
    TextLength,
    CustomFormula,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SheetErrorStyle {
    Stop,
    Warning,
    Information,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SheetOperation {
    SetCells {
        range: CellRange,
        values: Vec<Vec<CellInput>>,
        mode: SheetCellMode,
    },
    FormatCells {
        range: CellRange,
        patch: CellFormatPatch,
    },
    MergeCells {
        range: CellRange,
        merged: bool,
    },
    InsertAxis {
        sheet_id: Uuid,
        axis: SheetAxis,
        index: u32,
        count: u32,
    },
    DeleteAxis {
        sheet_id: Uuid,
        axis: SheetAxis,
        index: u32,
        count: u32,
    },
    ResizeAxis {
        sheet_id: Uuid,
        axis: SheetAxis,
        index: u32,
        count: u32,
        size_pt: f64,
    },
    HideAxis {
        sheet_id: Uuid,
        axis: SheetAxis,
        index: u32,
        count: u32,
        hidden: bool,
    },
    AddSheet {
        name: String,
        index: u32,
    },
    RenameSheet {
        sheet_id: Uuid,
        name: String,
    },
    MoveSheet {
        sheet_id: Uuid,
        index: u32,
    },
    DeleteSheet {
        sheet_id: Uuid,
    },
    ColorSheet {
        sheet_id: Uuid,
        color: Option<OfficeColor>,
    },
    Freeze {
        sheet_id: Uuid,
        rows: u32,
        columns: u32,
    },
    Sort {
        range: CellRange,
        has_header: bool,
        keys: Vec<SheetSortKey>,
    },
    Filter {
        range: CellRange,
        predicates: Vec<SheetFilterPredicate>,
    },
    SetConditionalRule {
        rule: SheetConditionalRule,
    },
    DeleteConditionalRule {
        sheet_id: Uuid,
        rule_id: Uuid,
    },
    SetValidation {
        range: CellRange,
        rule: SheetValidationRule,
    },
    ClearValidation {
        range: CellRange,
    },
    UpsertChart {
        chart: OfficeChart,
    },
    DeleteChart {
        sheet_id: Uuid,
        chart_id: Uuid,
    },
    UpsertPivot {
        pivot: OfficePivot,
    },
    DeletePivot {
        sheet_id: Uuid,
        pivot_id: Uuid,
    },
    SetName {
        name: String,
        range: CellRange,
    },
    DeleteName {
        name: String,
    },
    SetPrintSettings {
        settings: SheetPrintSettings,
    },
    Calculate {
        scope: SheetCalculationScope,
        sheet_id: Option<Uuid>,
    },
    SetCalculationMode {
        mode: SheetCalculationMode,
    },
    ReplaceCellMatch {
        address: CellAddress,
        expected: CellInput,
        replacement: CellInput,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SheetCalculationScope {
    Workbook,
    Sheet,
    Selection,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SheetCalculationMode {
    Automatic,
    Manual,
}

impl SheetOperation {
    pub fn validate(&self) -> Result<(), OfficeEditError> {
        match self {
            Self::SetCells { range, values, .. } => {
                if !range.is_valid() || !rectangular(range, values) {
                    return Err(OfficeEditError::Invalid);
                }
                let cells = values.len() * values.first().map(Vec::len).unwrap_or(0);
                if cells > 100_000 {
                    return Err(OfficeEditError::TooLarge);
                }
            }
            Self::FormatCells { range, patch } => {
                if !range.is_valid() || !patch.is_valid() {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::MergeCells { range, .. } | Self::ClearValidation { range } => {
                if !range.is_valid() {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::InsertAxis {
                sheet_id,
                index,
                count,
                ..
            }
            | Self::DeleteAxis {
                sheet_id,
                index,
                count,
                ..
            }
            | Self::HideAxis {
                sheet_id,
                index,
                count,
                ..
            } => {
                if sheet_id.is_nil() || *count == 0 || *count > 10_000 || *index > 1_048_575 {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::ResizeAxis {
                sheet_id,
                index,
                count,
                size_pt,
                ..
            } => {
                if sheet_id.is_nil()
                    || *count == 0
                    || *count > 10_000
                    || *index > 1_048_575
                    || !size_pt.is_finite()
                    || !(1.0..=1_000.0).contains(size_pt)
                {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::AddSheet { name, .. } | Self::RenameSheet { name, .. } => {
                if !valid_sheet_name(name) {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::MoveSheet { sheet_id, .. }
            | Self::DeleteSheet { sheet_id }
            | Self::ColorSheet { sheet_id, .. } => {
                if sheet_id.is_nil() {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::Freeze {
                sheet_id,
                rows,
                columns,
            } => {
                if sheet_id.is_nil() || *rows > 1_048_576 || *columns > 16_384 {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::DeleteConditionalRule { sheet_id, rule_id } => {
                if sheet_id.is_nil() || rule_id.is_nil() {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::DeleteChart { sheet_id, chart_id } => {
                if sheet_id.is_nil() || chart_id.is_nil() {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::DeletePivot { sheet_id, pivot_id } => {
                if sheet_id.is_nil() || pivot_id.is_nil() {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::Sort { range, keys, .. } => {
                if !range.is_valid() || keys.is_empty() || keys.len() > 32 {
                    return Err(OfficeEditError::Invalid);
                }
                let width = range.last_column - range.first_column + 1;
                if keys.iter().any(|key| key.column_offset >= width) {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::Filter { range, predicates } => {
                if !range.is_valid() || predicates.len() > 32 {
                    return Err(OfficeEditError::Invalid);
                }
                let width = range.last_column - range.first_column + 1;
                if predicates.iter().any(|predicate| !predicate.value.is_valid()) {
                    return Err(OfficeEditError::Invalid);
                }
                if predicates
                    .iter()
                    .any(|predicate| predicate.column_offset >= width)
                {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::SetConditionalRule { rule } => validate_conditional(rule)?,
            Self::SetValidation { range, rule } => {
                if !range.is_valid() {
                    return Err(OfficeEditError::Invalid);
                }
                validate_validation(rule)?;
            }
            Self::UpsertChart { chart } => {
                if !chart.is_valid() {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::UpsertPivot { pivot } => validate_pivot(pivot)?,
            Self::SetName { name, range } => {
                if !valid_name(name) || !range.is_valid() {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::DeleteName { name } => {
                if !valid_name(name) {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::SetPrintSettings { settings } => validate_print_settings(settings)?,
            Self::Calculate { scope, sheet_id } => {
                if *scope == SheetCalculationScope::Sheet
                    && sheet_id.is_none_or(|id| id.is_nil())
                {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::ReplaceCellMatch {
                address,
                expected,
                replacement,
            } => {
                if !address.is_valid() || !expected.is_valid() || !replacement.is_valid() {
                    return Err(OfficeEditError::Invalid);
                }
            }
            Self::SetCalculationMode { .. } => {}
        }
        Ok(())
    }
}

fn rectangular(range: &CellRange, values: &[Vec<CellInput>]) -> bool {
    if values.is_empty() {
        return false;
    }
    let height = u64::from(range.last_row - range.first_row) + 1;
    let width = u64::from(range.last_column - range.first_column) + 1;
    values.len() as u64 == height
        && values.iter().all(|row| row.len() as u64 == width)
        && values.iter().flatten().all(CellInput::is_valid)
}

pub fn valid_sheet_name(name: &str) -> bool {
    let length = name.chars().count();
    (1..=31).contains(&length)
        && !name.chars().any(|ch| {
            ch.is_control() || matches!(ch, ':' | '/' | '\\' | '?' | '*' | '[' | ']')
        })
        && !name.starts_with('\'')
        && !name.ends_with('\'')
}

pub fn valid_name(name: &str) -> bool {
    let scalar_count = name.chars().count();
    if scalar_count == 0 || scalar_count > 255 {
        return false;
    }
    let mut chars = name.chars();
    let first = chars.next().unwrap_or(' ');
    if !(first.is_ascii_alphabetic() || first == '_') {
        return false;
    }
    if !chars.all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.')) {
        return false;
    }
    let upper = name.to_ascii_uppercase();
    if matches!(upper.as_str(), "R" | "C") {
        return false;
    }
    // Reject A1 and R1C1 style names.
    let a1 = upper
        .chars()
        .next()
        .is_some_and(|ch| ch.is_ascii_uppercase());
    if a1 {
        let mut letters = 0;
        let mut digits = 0;
        for ch in upper.chars() {
            if ch.is_ascii_uppercase() {
                if digits > 0 {
                    return false;
                }
                letters += 1;
            } else if ch.is_ascii_digit() {
                digits += 1;
            } else {
                return true;
            }
        }
        if letters > 0 && digits > 0 {
            return false;
        }
    }
    true
}

fn validate_conditional(rule: &SheetConditionalRule) -> Result<(), OfficeEditError> {
    if rule.id.is_nil()
        || !rule.range.is_valid()
        || !rule.style.is_valid()
        || !rule.values.iter().all(CellInput::is_valid)
        || rule.values.len() > 3
        || rule.colors.len() > 3
        || rule.text.as_ref().is_some_and(|text| text.chars().count() > 1_024)
        || rule
            .formula
            .as_ref()
            .is_some_and(|formula| formula.chars().count() > 8_192 || !formula.starts_with('='))
    {
        return Err(OfficeEditError::Invalid);
    }
    match rule.kind {
        SheetConditionalKind::Compare => {
            let expected = if rule.operator == SheetComparisonOperator::Between {
                2
            } else {
                1
            };
            if rule.values.len() != expected
                || rule.text.is_some()
                || rule.formula.is_some()
                || !rule.colors.is_empty()
            {
                return Err(OfficeEditError::Invalid);
            }
        }
        SheetConditionalKind::Text => {
            if rule.text.is_none()
                || !rule.values.is_empty()
                || rule.formula.is_some()
                || !rule.colors.is_empty()
            {
                return Err(OfficeEditError::Invalid);
            }
        }
        SheetConditionalKind::Formula => {
            if rule.formula.is_none()
                || !rule.values.is_empty()
                || rule.text.is_some()
                || !rule.colors.is_empty()
            {
                return Err(OfficeEditError::Invalid);
            }
        }
        SheetConditionalKind::ColorScale => {
            if !matches!(rule.values.len(), 2 | 3)
                || rule.colors.len() != rule.values.len()
                || !ascending_numbers(&rule.values)
                || rule.text.is_some()
                || rule.formula.is_some()
            {
                return Err(OfficeEditError::Invalid);
            }
        }
        SheetConditionalKind::DataBar => {
            if rule.values.len() != 2
                || rule.colors.len() != 1
                || !ascending_numbers(&rule.values)
                || rule.text.is_some()
                || rule.formula.is_some()
            {
                return Err(OfficeEditError::Invalid);
            }
        }
        SheetConditionalKind::IconSet => {
            if rule.values.len() != 2
                || rule.colors.len() != 3
                || !ascending_numbers(&rule.values)
                || rule.text.is_some()
                || rule.formula.is_some()
            {
                return Err(OfficeEditError::Invalid);
            }
        }
    }
    Ok(())
}

fn ascending_numbers(values: &[CellInput]) -> bool {
    let numbers: Option<Vec<f64>> = values
        .iter()
        .map(|value| match value {
            CellInput::Number { value } => Some(*value),
            _ => None,
        })
        .collect();
    numbers.is_some_and(|numbers| numbers.windows(2).all(|pair| pair[0] <= pair[1]))
}

fn validate_validation(rule: &SheetValidationRule) -> Result<(), OfficeEditError> {
    if !rule.values.iter().all(CellInput::is_valid)
        || rule.values.len() > 2
        || rule.list.len() > 1_000
        || rule.title.chars().count() > 128
        || rule.message.chars().count() > 255
        || rule
            .formula
            .as_ref()
            .is_some_and(|formula| formula.chars().count() > 8_192 || !formula.starts_with('='))
    {
        return Err(OfficeEditError::Invalid);
    }
    match rule.kind {
        SheetValidationKind::List => {
            if rule.list.is_empty() || !rule.values.is_empty() || rule.formula.is_some() {
                return Err(OfficeEditError::Invalid);
            }
        }
        SheetValidationKind::CustomFormula => {
            if rule.formula.is_none() || !rule.values.is_empty() || !rule.list.is_empty() {
                return Err(OfficeEditError::Invalid);
            }
        }
        SheetValidationKind::Whole
        | SheetValidationKind::Decimal
        | SheetValidationKind::Date
        | SheetValidationKind::TextLength => {
            if !matches!(rule.values.len(), 1 | 2) || !rule.list.is_empty() || rule.formula.is_some()
            {
                return Err(OfficeEditError::Invalid);
            }
        }
    }
    Ok(())
}

fn validate_pivot(pivot: &OfficePivot) -> Result<(), OfficeEditError> {
    if pivot.id.is_nil()
        || !pivot.source.is_valid()
        || !pivot.target.is_valid()
        || pivot.rows.len() > 32
        || pivot.columns.len() > 32
        || pivot.filters.len() > 32
        || pivot.values.is_empty()
        || pivot.values.len() > 32
    {
        return Err(OfficeEditError::Invalid);
    }
    Ok(())
}

pub(crate) fn validate_print_settings(
    settings: &SheetPrintSettings,
) -> Result<(), OfficeEditError> {
    if settings.ranges.is_empty()
        || settings.ranges.len() > 32
        || !settings.ranges.iter().all(CellRange::is_valid)
        || settings.ranges.iter().any(|range| {
            range.sheet_id != settings.ranges[0].sheet_id
        })
        || !matches!(settings.page_size, OfficePageSize::A4 | OfficePageSize::Letter)
        || !finite_print_margins(&settings.margins_mm)
        || settings
            .fit_width_pages
            .is_some_and(|pages| !(1..=100).contains(&pages))
        || settings
            .fit_height_pages
            .is_some_and(|pages| !(1..=100).contains(&pages))
        || settings.repeat_header_rows.is_some_and(|rows| rows.first > rows.last)
    {
        return Err(OfficeEditError::Invalid);
    }
    Ok(())
}

fn finite_print_margins(margins: &crate::office_edit_values::PageMargins) -> bool {
    [margins.top, margins.right, margins.bottom, margins.left]
        .iter()
        .all(|value| value.is_finite() && (0.0..=50.0).contains(value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn max_sheet_cell_is_valid() {
        let sheet = Uuid::new_v4();
        assert!(CellAddress {
            sheet_id: sheet,
            row: 1_048_575,
            column: 16_383
        }
        .is_valid());
        assert!(!CellAddress {
            sheet_id: sheet,
            row: 1_048_576,
            column: 16_383
        }
        .is_valid());
        assert!(!CellAddress {
            sheet_id: sheet,
            row: 1_048_575,
            column: 16_384
        }
        .is_valid());
    }

    #[test]
    fn invalid_sheet_name_rejected() {
        assert!(!valid_sheet_name("a/b"));
        assert!(!valid_sheet_name(""));
        assert!(valid_sheet_name("Sheet 1"));
    }
}
