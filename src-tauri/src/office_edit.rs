//! Native Office editing commands (Step 20a E2/E3/E6/E7/E12/E13/E14/E17/E18/E19,
//! office-edit-1).
//!
//! Every command checks `ensure_main`, bounded identifiers, the active profile
//! and the live session before dispatch. There is no approved engine binding
//! yet, so engine-dependent commands fail with `office_edit.engine_missing`
//! after validation; none invents formatting, items, windows, functions,
//! statistics, spelling, transactions or a print dialog. The coordinator
//! registers these names in `generate_handler!` and in the isolation
//! allowlist, and manages `OfficeEditState::new(profile_id)`.
#![allow(dead_code)]

use std::sync::atomic::Ordering;
use std::sync::Arc;

use convert::PageRange;
use serde::Serialize;
use tauri::{Manager, State, WebviewWindow};
use uuid::Uuid;

use crate::document_types::DocumentError;
use crate::documents::DocumentStore;
use crate::engine_types::OfficeFormat;
use crate::file_grant_backing::GrantedBacking;
use crate::files::FileGrants;
use crate::jobs::{spawn_job, Jobs};
use crate::office_edit_items::{
    DocumentStatistics, OfficeCellWindow, OfficeDisplayCell, OfficeFindMatch, OfficeFindRequest,
    OfficeFormatting, OfficeFormulaLocale, OfficeFunction, OfficeItemKind, OfficeItemPage,
    OfficeSpellingIssue, ParsedOfficeFormula, SheetPrintSettings,
};
use crate::office_edit_sessions::{OfficeEditCommandEngine, OfficeEditState};
use crate::office_edit_transactions::validate_same_content_state;
use crate::office_edit_types::{
    OfficeCapability, OfficeDiscardSavedResult, OfficeEditError, OfficeFamily, OfficeMode,
    OfficeResultPage, OfficeSessionState, OfficeTransaction, OfficeTransactionResult,
    MAX_DTO_BYTES, OFFICE_MAX_INPUT_BYTES,
};
use crate::office_edit_validation::{
    family_of, item_kind_matches, item_page_revision, same_session, selection_family, MAX_ITEM_PAGE,
};
use crate::office_edit_values::{CellRange, OfficeSelection, TextSpan, MAX_SAFE_INTEGER};
use crate::{ensure_main, valid_request_id};

/// Exact names the coordinator adds to `generate_handler!` and `ALLOWED`.
pub const COMMANDS: &[&str] = &[
    "office_edit_basic_page",
    "office_edit_open_start",
    "office_edit_close",
    "office_edit_state",
    "office_edit_render_start",
    "office_edit_capture_start",
    "office_edit_export_start",
    "office_edit_transact",
    "office_edit_undo",
    "office_edit_redo",
    "office_edit_mode",
    "office_edit_discard_saved",
    "office_edit_items",
    "office_edit_formatting",
    "office_edit_cell_window",
    "office_edit_formula_parse",
    "office_edit_formula_format",
    "office_edit_find",
    "office_edit_spelling",
    "office_edit_document_stats",
    "office_edit_functions",
    "office_edit_release_lease",
    "office_edit_print_start",
];

fn code(error: OfficeEditError) -> String {
    error.code().to_string()
}

fn parse_id(value: &str) -> Result<Uuid, String> {
    let parsed = Uuid::parse_str(value).map_err(|_| code(OfficeEditError::Invalid))?;
    if parsed.is_nil() {
        return Err(code(OfficeEditError::Invalid));
    }
    Ok(parsed)
}

fn parse_cursor(cursor: Option<String>) -> Result<Option<String>, String> {
    match cursor {
        Some(value) => Ok(Some(parse_id(&value)?.to_string())),
        None => Ok(None),
    }
}

/// One E14 display window: at most 500 rows, 2,000 cells and 768 KiB.
const MAX_CELL_WINDOW_ROWS: u32 = 500;
const MAX_CELL_WINDOW_CELLS: u32 = 2_000;
const MAX_CELL_WINDOW_BYTES: usize = MAX_DTO_BYTES;
/// E7/E12/E13 request and response bounds.
const MAX_FORMULA_CHARS: usize = 8_192;
const MAX_FUNCTION_ID_CHARS: usize = 64;
const MAX_FIND_QUERY_CHARS: usize = 256;
const MAX_FIND_EXCERPT_UTF16: usize = 512;
const MAX_SPELLING_WORD_CHARS: usize = 256;
const MAX_SPELLING_SUGGESTIONS: usize = 16;
const MAX_LANGUAGE_TAG_CHARS: usize = 64;
const MAX_ERROR_CODE_CHARS: usize = 64;
/// E17 catalogue bounds.
const MAX_FUNCTION_ARGUMENTS: usize = 32;
const MAX_FUNCTION_DISPLAY_CHARS: usize = 64;
const MAX_FUNCTION_ARGUMENT_KEY_CHARS: usize = 128;
const MAX_FUNCTION_DESCRIPTION_KEY_CHARS: usize = 128;
/// E19: one print operation is at most 100 pages, each page selected once.
const MAX_PRINT_PAGES: u64 = 100;
const MAX_PRINT_RANGES: usize = 100;

/// Run one read-only engine query under the session mutation lock so the
/// revision it was answered for cannot advance while it is being validated.
fn with_engine<T>(
    edit: &OfficeEditState,
    session_id: &str,
    operation: impl FnOnce(
        &dyn OfficeEditCommandEngine,
        Uuid,
        &OfficeSessionState,
    ) -> Result<T, OfficeEditError>,
) -> Result<T, String> {
    edit.current_profile().map_err(code)?;
    let session_id = parse_id(session_id)?;
    let session = edit.session(session_id).map_err(code)?;
    let _guard = session.lock_mutation().map_err(code)?;
    let current = session.snapshot().map_err(code)?;
    if current.busy {
        return Err(code(OfficeEditError::Busy));
    }
    let engine = edit.engine().map_err(code)?;
    let result = operation(engine.as_ref(), session_id, &current).map_err(code)?;
    // A read-only engine query may never advance the session it answered for.
    // The revision and content identity stay exactly those of the locked
    // snapshot, so a stale catalogue/window is refused instead of displayed.
    let after = session.snapshot().map_err(code)?;
    if after.revision != current.revision || after.content_id != current.content_id {
        return Err(code(OfficeEditError::Changed));
    }
    Ok(result)
}

fn bounded_formula(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= MAX_FORMULA_CHARS
        && !value.chars().any(char::is_control)
}

fn valid_function_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_FUNCTION_ID_CHARS
        && value.chars().all(|character| {
            character.is_ascii_uppercase()
                || character.is_ascii_digit()
                || matches!(character, '_' | '.')
        })
}

fn valid_error_code(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ERROR_CODE_CHARS
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
}

fn valid_language_tag(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_LANGUAGE_TAG_CHARS
        && value
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_alphabetic())
        && value.split('-').all(|part| {
            !part.is_empty()
                && part.len() <= 8
                && part
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric())
        })
}

fn validate_parsed_formula(
    parsed: &ParsedOfficeFormula,
    text: &str,
) -> Result<(), OfficeEditError> {
    if parsed.canonical.chars().count() > MAX_FORMULA_CHARS
        || parsed.canonical.chars().any(char::is_control)
        || parsed.functions.len() > MAX_ITEM_PAGE
        || parsed
            .functions
            .iter()
            .any(|function| !valid_function_id(function))
    {
        return Err(OfficeEditError::Failed);
    }
    if parsed.valid && (!parsed.canonical.starts_with('=') || parsed.canonical.chars().count() < 2)
    {
        return Err(OfficeEditError::Failed);
    }
    if parsed
        .error_offset_utf16
        .is_some_and(|offset| offset as usize > text.encode_utf16().count())
    {
        return Err(OfficeEditError::Failed);
    }
    Ok(())
}

fn validate_formatted_formula(formatted: &str) -> Result<(), OfficeEditError> {
    if !bounded_formula(formatted) || !formatted.starts_with('=') {
        return Err(OfficeEditError::Failed);
    }
    Ok(())
}

fn validate_cell_window(
    window: &OfficeCellWindow,
    requested: &CellRange,
    revision: u64,
) -> Result<(), OfficeEditError> {
    let range = window.range;
    if window.revision != revision
        || range.sheet_id != requested.sheet_id
        || !range.is_valid()
        || range.first_row < requested.first_row
        || range.last_row > requested.last_row
        || range.first_column < requested.first_column
        || range.last_column > requested.last_column
    {
        return Err(OfficeEditError::Changed);
    }
    let columns = range.last_column - range.first_column + 1;
    let mut cells = 0usize;
    let mut display_bytes = 0usize;
    for row in &window.rows {
        if row.len() > columns as usize {
            return Err(OfficeEditError::Failed);
        }
        cells = cells.saturating_add(row.len());
        if cells > MAX_CELL_WINDOW_CELLS as usize {
            return Err(OfficeEditError::TooLarge);
        }
        for cell in row {
            display_bytes = display_bytes.saturating_add(cell.display.len());
            if display_bytes > MAX_CELL_WINDOW_BYTES {
                return Err(OfficeEditError::TooLarge);
            }
            validate_display_cell(cell, &range)?;
        }
    }
    if window.rows.len() > MAX_CELL_WINDOW_ROWS as usize {
        return Err(OfficeEditError::TooLarge);
    }
    if window
        .next_row
        .is_some_and(|next_row| next_row <= range.last_row || next_row > 1_048_575)
    {
        return Err(OfficeEditError::Failed);
    }
    if serde_json::to_vec(window)
        .map(|bytes| bytes.len())
        .unwrap_or(usize::MAX)
        > MAX_CELL_WINDOW_BYTES
    {
        return Err(OfficeEditError::TooLarge);
    }
    Ok(())
}

fn validate_display_cell(
    cell: &OfficeDisplayCell,
    window: &CellRange,
) -> Result<(), OfficeEditError> {
    if !cell.address.is_valid()
        || cell.address.sheet_id != window.sheet_id
        || cell.address.row < window.first_row
        || cell.address.row > window.last_row
        || cell.address.column < window.first_column
        || cell.address.column > window.last_column
        || cell.display.encode_utf16().count() > 32_767
        || !cell.input.is_valid()
        || (!cell.format.is_empty() && !cell.format.is_valid())
        || cell
            .merged_range
            .as_ref()
            .is_some_and(|merged| !merged.is_valid() || merged.sheet_id != window.sheet_id)
        || cell
            .error_code
            .as_deref()
            .is_some_and(|value| !valid_error_code(value))
    {
        return Err(OfficeEditError::Failed);
    }
    Ok(())
}

fn validate_result_page<T: Serialize>(
    page: &OfficeResultPage<T>,
    expected_revision: u64,
) -> Result<(), OfficeEditError> {
    if page.revision != expected_revision
        || page.items.len() > MAX_ITEM_PAGE
        || page.complete == page.next_cursor.is_some()
        || page.next_cursor.is_some_and(|cursor| cursor.is_nil())
    {
        return Err(OfficeEditError::Failed);
    }
    if serde_json::to_vec(page)
        .map(|bytes| bytes.len())
        .unwrap_or(usize::MAX)
        > MAX_DTO_BYTES
    {
        return Err(OfficeEditError::TooLarge);
    }
    Ok(())
}

fn validate_find_page(
    page: &OfficeResultPage<OfficeFindMatch>,
    state: &OfficeSessionState,
) -> Result<(), OfficeEditError> {
    validate_result_page(page, state.revision)?;
    for item in &page.items {
        if item.id.is_nil()
            || !item.selection.is_valid()
            || selection_family(&item.selection) != state.family
            || item.excerpt.encode_utf16().count() > MAX_FIND_EXCERPT_UTF16
        {
            return Err(OfficeEditError::Failed);
        }
    }
    Ok(())
}

fn validate_spelling_page(
    page: &OfficeResultPage<OfficeSpellingIssue>,
    state: &OfficeSessionState,
) -> Result<(), OfficeEditError> {
    validate_result_page(page, state.revision)?;
    for issue in &page.items {
        if issue.id.is_nil()
            || issue.word.is_empty()
            || issue.word.chars().count() > MAX_SPELLING_WORD_CHARS
            || issue.suggestions.len() > MAX_SPELLING_SUGGESTIONS
            || issue.suggestions.iter().any(|suggestion| {
                suggestion.is_empty()
                    || suggestion.chars().count() > MAX_SPELLING_WORD_CHARS
                    || suggestion.chars().any(char::is_control)
            })
        {
            return Err(OfficeEditError::Failed);
        }
        if !issue.span.is_current(state.revision) {
            return Err(OfficeEditError::Changed);
        }
    }
    Ok(())
}

fn validate_document_stats(
    stats: &DocumentStatistics,
    state: &OfficeSessionState,
) -> Result<(), OfficeEditError> {
    if stats.revision != state.revision
        || stats.page == 0
        || stats.page_count == 0
        || stats.page > stats.page_count
        || stats.words > MAX_SAFE_INTEGER
        || stats.characters > MAX_SAFE_INTEGER
        || !valid_language_tag(&stats.language)
    {
        return Err(OfficeEditError::Failed);
    }
    Ok(())
}

fn valid_translation_key(value: &str, max_chars: usize) -> bool {
    !value.is_empty() && value.chars().count() <= max_chars && !value.chars().any(char::is_control)
}

fn validate_function(function: &OfficeFunction) -> Result<(), OfficeEditError> {
    if !valid_function_id(&function.id)
        || function.display_name.is_empty()
        || function.display_name.chars().count() > MAX_FUNCTION_DISPLAY_CHARS
        || function.display_name.chars().any(char::is_control)
        || function.arguments.len() > MAX_FUNCTION_ARGUMENTS
        || function.min_args > function.max_args
        || !valid_translation_key(
            &function.description_key,
            MAX_FUNCTION_DESCRIPTION_KEY_CHARS,
        )
    {
        return Err(OfficeEditError::Failed);
    }
    for argument in &function.arguments {
        if !valid_translation_key(&argument.name_key, MAX_FUNCTION_ARGUMENT_KEY_CHARS) {
            return Err(OfficeEditError::Failed);
        }
    }
    Ok(())
}

fn validate_functions_page(
    page: &OfficeResultPage<OfficeFunction>,
    state: &OfficeSessionState,
) -> Result<(), OfficeEditError> {
    validate_result_page(page, state.revision)?;
    for function in &page.items {
        validate_function(function)?;
    }
    Ok(())
}

/// Page ranges are 1-based and ordered. One operation may print at most 100
/// pages in total; the engine still proves the ranges against its own layout.
fn validate_print_ranges(ranges: &[PageRange]) -> Result<(), OfficeEditError> {
    if ranges.is_empty() || ranges.len() > MAX_PRINT_RANGES {
        return Err(OfficeEditError::Invalid);
    }
    let mut total: u64 = 0;
    for range in ranges {
        if range.first < 1 || range.last < range.first {
            return Err(OfficeEditError::Invalid);
        }
        let pages = u64::from(range.last) - u64::from(range.first) + 1;
        total = total.saturating_add(pages);
        if total > MAX_PRINT_PAGES {
            return Err(OfficeEditError::TooLarge);
        }
    }
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn office_edit_open_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    edit: State<'_, OfficeEditState>,
    documents: State<'_, Arc<DocumentStore>>,
    grants: State<'_, Arc<FileGrants>>,
    request_id: String,
    document_id: String,
    family: OfficeFamily,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id).map_err(|_| code(OfficeEditError::Invalid))?;
    edit.current_profile().map_err(code)?;
    let document_id = parse_id(&document_id)?;
    let entry = documents
        .entry(document_id)
        .map_err(|error: DocumentError| error.code().to_string())?;
    if entry.info.size > OFFICE_MAX_INPUT_BYTES {
        return Err(code(OfficeEditError::TooLarge));
    }
    let format = OfficeFormat::from_id(&entry.info.ext)
        .or_else(|| OfficeFormat::from_file_name(&entry.info.name))
        .or_else(|| OfficeFormat::from_mime(&entry.info.mime))
        .ok_or_else(|| code(OfficeEditError::Unsupported))?;
    if format.is_template() || family_of(format) != family {
        return Err(code(OfficeEditError::Unsupported));
    }
    let backing = crate::document_grants::resolve_backing(grants.as_ref(), &entry.token)
        .ok_or_else(|| code(OfficeEditError::Changed))?;
    if backing.length() != entry.info.size {
        return Err(code(OfficeEditError::Changed));
    }
    let sensitive = backing.is_sensitive();
    if entry.info.sensitive != sensitive {
        return Err(code(OfficeEditError::Changed));
    }
    if sensitive && matches!(&*backing, GrantedBacking::Disk { .. }) {
        return Err(code(OfficeEditError::SensitiveUnsupported));
    }
    // Keep the 09a registry's initial identity; no source path comes from the UI.
    let input = crate::office_edit_input::authorized_input(document_id, backing, format);
    if !input.is_valid() {
        return Err(code(OfficeEditError::Invalid));
    }
    if !edit.has_engine() {
        return Err(code(OfficeEditError::EngineMissing));
    }
    let token = jobs.begin(&request_id, 0)?;
    let app = window.app_handle().clone();
    spawn_job(app, request_id, token, move |context| {
        let state = context.app().state::<OfficeEditState>();
        let opened = state.open_session(input, family).map_err(code)?;
        serde_json::to_value(opened).map_err(|_| code(OfficeEditError::Failed))
    });
    Ok(())
}

#[tauri::command]
pub async fn office_edit_close(
    window: WebviewWindow,
    edit: State<'_, OfficeEditState>,
    session_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    edit.current_profile().map_err(code)?;
    let session_id = parse_id(&session_id)?;
    crate::office_edit_background::run(window.app_handle().clone(), move |edit| {
        edit.close_session(session_id).map_err(code)
    })
    .await
}

#[tauri::command]
pub async fn office_edit_state(
    window: WebviewWindow,
    edit: State<'_, OfficeEditState>,
    session_id: String,
) -> Result<OfficeSessionState, String> {
    ensure_main(window.label())?;
    let session_id = parse_id(&session_id)?;
    edit.current_profile().map_err(code)?;
    crate::office_edit_background::run(window.app_handle().clone(), move |edit| {
        let session = edit.session(session_id).map_err(code)?;
        edit.refresh_state(&session).map_err(code)
    })
    .await
}

#[tauri::command]
pub async fn office_edit_transact(
    window: WebviewWindow,
    edit: State<'_, OfficeEditState>,
    session_id: String,
    transaction: OfficeTransaction,
) -> Result<OfficeTransactionResult, String> {
    ensure_main(window.label())?;
    edit.current_profile().map_err(code)?;
    let session_id = parse_id(&session_id)?;
    crate::office_edit_background::run(window.app_handle().clone(), move |edit| {
        crate::office_edit_dispatch::transact(edit, session_id, transaction).map_err(code)
    })
    .await
}

#[tauri::command]
pub async fn office_edit_undo(
    window: WebviewWindow,
    edit: State<'_, OfficeEditState>,
    session_id: String,
    expected_revision: u64,
    transaction_id: String,
) -> Result<OfficeTransactionResult, String> {
    ensure_main(window.label())?;
    edit.current_profile().map_err(code)?;
    let session_id = parse_id(&session_id)?;
    let transaction_id = parse_id(&transaction_id)?;
    crate::office_edit_background::run(window.app_handle().clone(), move |edit| {
        crate::office_edit_dispatch::history(
            edit,
            session_id,
            expected_revision,
            transaction_id,
            false,
        )
        .map_err(code)
    })
    .await
}

#[tauri::command]
pub async fn office_edit_redo(
    window: WebviewWindow,
    edit: State<'_, OfficeEditState>,
    session_id: String,
    expected_revision: u64,
    transaction_id: String,
) -> Result<OfficeTransactionResult, String> {
    ensure_main(window.label())?;
    edit.current_profile().map_err(code)?;
    let session_id = parse_id(&session_id)?;
    let transaction_id = parse_id(&transaction_id)?;
    crate::office_edit_background::run(window.app_handle().clone(), move |edit| {
        crate::office_edit_dispatch::history(
            edit,
            session_id,
            expected_revision,
            transaction_id,
            true,
        )
        .map_err(code)
    })
    .await
}

#[tauri::command]
pub async fn office_edit_mode(
    window: WebviewWindow,
    edit: State<'_, OfficeEditState>,
    session_id: String,
    mode: OfficeMode,
) -> Result<OfficeSessionState, String> {
    ensure_main(window.label())?;
    edit.current_profile().map_err(code)?;
    let session_id = parse_id(&session_id)?;
    crate::office_edit_background::run(window.app_handle().clone(), move |edit| {
        let session = edit.session(session_id).map_err(code)?;
        let _guard = session.lock_mutation().map_err(code)?;
        let current = session.snapshot().map_err(code)?;
        if current.busy {
            return Err(code(OfficeEditError::Busy));
        }
        if current.mode == mode {
            return Ok(current);
        }
        if mode == OfficeMode::Reviewing && current.family != OfficeFamily::Document {
            return Err(code(OfficeEditError::Unsupported));
        }
        let engine = edit.engine().map_err(code)?;
        let next = engine.set_mode(session_id, mode).map_err(code)?;
        validate_same_content_state(&current, &next).map_err(code)?;
        if next.mode != mode {
            return Err(code(OfficeEditError::Failed));
        }
        session
            .commit(current.revision, next.clone())
            .map_err(code)?;
        Ok(next)
    })
    .await
}

#[tauri::command]
pub async fn office_edit_discard_saved(
    window: WebviewWindow,
    edit: State<'_, OfficeEditState>,
    session_id: String,
    saved_content_id: String,
    expected_revision: u64,
    expected_content_id: String,
) -> Result<OfficeDiscardSavedResult, String> {
    ensure_main(window.label())?;
    edit.current_profile().map_err(code)?;
    let session_id = parse_id(&session_id)?;
    let saved_content_id = parse_id(&saved_content_id)?;
    let expected_content_id = parse_id(&expected_content_id)?;
    crate::office_edit_background::run(window.app_handle().clone(), move |edit| {
        let session = edit.session(session_id).map_err(code)?;
        let _guard = session.lock_mutation().map_err(code)?;
        let current = session.snapshot().map_err(code)?;
        if current.busy {
            return Err(code(OfficeEditError::Busy));
        }
        if expected_revision != current.revision
            || expected_content_id != current.content_id
            || saved_content_id != current.saved_content_id
        {
            return Err(code(OfficeEditError::Changed));
        }
        let engine = edit.engine().map_err(code)?;
        let result = engine
            .discard_saved(
                session_id,
                saved_content_id,
                expected_revision,
                expected_content_id,
            )
            .map_err(code)?;
        if !same_session(&current, &result.state)
            || result.state.saved_content_id != saved_content_id
        {
            return Err(code(OfficeEditError::Failed));
        }
        if result.changed {
            if result.state.revision <= current.revision
                || result.state.content_id != saved_content_id
                || result.state.dirty
            {
                return Err(code(OfficeEditError::Changed));
            }
        } else if result.state.revision != current.revision
            || result.state.content_id != current.content_id
        {
            return Err(code(OfficeEditError::Changed));
        }
        if result.state.content_id == result.state.saved_content_id && result.state.dirty {
            return Err(code(OfficeEditError::Failed));
        }
        session
            .commit(current.revision, result.state.clone())
            .map_err(code)?;
        Ok(result)
    })
    .await
}

#[tauri::command]
pub fn office_edit_items(
    window: WebviewWindow,
    edit: State<'_, OfficeEditState>,
    session_id: String,
    kind: OfficeItemKind,
    cursor: Option<String>,
) -> Result<OfficeItemPage, String> {
    ensure_main(window.label())?;
    edit.current_profile().map_err(code)?;
    let session_id = parse_id(&session_id)?;
    let cursor = match cursor {
        Some(value) => {
            let parsed = parse_id(&value)?;
            Some(parsed.to_string())
        }
        None => None,
    };
    let session = edit.session(session_id).map_err(code)?;
    let _guard = session.lock_mutation().map_err(code)?;
    let current = session.snapshot().map_err(code)?;
    if current.busy {
        return Err(code(OfficeEditError::Busy));
    }
    if !item_kind_matches(kind, current.family) {
        return Err(code(OfficeEditError::Unsupported));
    }
    let engine = edit.engine().map_err(code)?;
    let page = engine
        .items(session_id, kind, cursor.as_deref())
        .map_err(code)?;
    let (revision, count, valid) = item_page_revision(&page);
    if count > MAX_ITEM_PAGE || revision != current.revision {
        return Err(code(OfficeEditError::Failed));
    }
    if !valid {
        return Err(code(OfficeEditError::Failed));
    }
    Ok(page)
}

#[tauri::command]
pub fn office_edit_formatting(
    window: WebviewWindow,
    edit: State<'_, OfficeEditState>,
    session_id: String,
    selection: OfficeSelection,
) -> Result<OfficeFormatting, String> {
    ensure_main(window.label())?;
    edit.current_profile().map_err(code)?;
    let session_id = parse_id(&session_id)?;
    if !selection.is_valid() {
        return Err(code(OfficeEditError::Invalid));
    }
    let session = edit.session(session_id).map_err(code)?;
    let _guard = session.lock_mutation().map_err(code)?;
    let current = session.snapshot().map_err(code)?;
    if current.busy {
        return Err(code(OfficeEditError::Busy));
    }
    if selection_family(&selection) != current.family {
        return Err(code(OfficeEditError::Invalid));
    }
    let engine = edit.engine().map_err(code)?;
    let formatting = engine.formatting(session_id, &selection).map_err(code)?;
    if formatting.selection != selection
        || formatting.style_ids.len() > 1_000
        || formatting.sheet_ids.len() > 1_000
        || formatting.slide_ids.len() > 1_000
    {
        return Err(code(OfficeEditError::Failed));
    }
    Ok(formatting)
}

#[tauri::command]
pub fn office_edit_release_lease(
    window: WebviewWindow,
    edit: State<'_, OfficeEditState>,
    lease_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    edit.current_profile().map_err(code)?;
    let lease_id = parse_id(&lease_id)?;
    crate::office_edit_leases::release_office_lease(lease_id).map_err(code)
}

/// E14: one bounded visible-cell window. No whole-sheet upload and no second
/// workbook parser; without an approved binding the answer is `engine_missing`.
#[tauri::command]
pub async fn office_edit_cell_window(
    window: WebviewWindow,
    edit: State<'_, OfficeEditState>,
    session_id: String,
    range: CellRange,
) -> Result<OfficeCellWindow, String> {
    ensure_main(window.label())?;
    if !range.is_valid() {
        return Err(code(OfficeEditError::Invalid));
    }
    let rows = range.last_row - range.first_row + 1;
    let columns = range.last_column - range.first_column + 1;
    if rows > MAX_CELL_WINDOW_ROWS || rows.saturating_mul(columns) > MAX_CELL_WINDOW_CELLS {
        return Err(code(OfficeEditError::TooLarge));
    }
    edit.current_profile().map_err(code)?;
    crate::office_edit_background::run(window.app_handle().clone(), move |edit| {
        with_engine(edit, &session_id, |engine, session_id, current| {
            if current.family != OfficeFamily::Sheet {
                return Err(OfficeEditError::Unsupported);
            }
            let window = engine.cell_window(session_id, &range)?;
            validate_cell_window(&window, &range, current.revision)?;
            Ok(window)
        })
    })
    .await
}

/// E7: display text to the canonical English/comma AST owned by the engine.
/// A textual function-name replacement is never used as a fallback.
#[tauri::command]
pub fn office_edit_formula_parse(
    window: WebviewWindow,
    edit: State<'_, OfficeEditState>,
    session_id: String,
    text: String,
    locale: OfficeFormulaLocale,
) -> Result<ParsedOfficeFormula, String> {
    ensure_main(window.label())?;
    if !bounded_formula(&text) {
        return Err(code(OfficeEditError::Invalid));
    }
    with_engine(edit.inner(), &session_id, |engine, session_id, current| {
        if current.family != OfficeFamily::Sheet {
            return Err(OfficeEditError::Unsupported);
        }
        let parsed = engine.formula_parse(session_id, &text, locale)?;
        validate_parsed_formula(&parsed, &text)?;
        Ok(parsed)
    })
}

/// E7: canonical AST to the locale display notation.
#[tauri::command]
pub fn office_edit_formula_format(
    window: WebviewWindow,
    edit: State<'_, OfficeEditState>,
    session_id: String,
    canonical: String,
    locale: OfficeFormulaLocale,
) -> Result<String, String> {
    ensure_main(window.label())?;
    if !bounded_formula(&canonical) || !canonical.starts_with('=') {
        return Err(code(OfficeEditError::Invalid));
    }
    with_engine(edit.inner(), &session_id, |engine, session_id, current| {
        if current.family != OfficeFamily::Sheet {
            return Err(OfficeEditError::Unsupported);
        }
        let formatted = engine.formula_format(session_id, &canonical, locale)?;
        validate_formatted_formula(&formatted)?;
        Ok(formatted)
    })
}

/// E7: bounded search with no regular-expression mode.
#[tauri::command]
pub fn office_edit_find(
    window: WebviewWindow,
    edit: State<'_, OfficeEditState>,
    session_id: String,
    query: OfficeFindRequest,
    cursor: Option<String>,
) -> Result<OfficeResultPage<OfficeFindMatch>, String> {
    ensure_main(window.label())?;
    if query.query.is_empty()
        || query.query.chars().count() > MAX_FIND_QUERY_CHARS
        || query.query.chars().any(char::is_control)
    {
        return Err(code(OfficeEditError::Invalid));
    }
    let cursor = parse_cursor(cursor)?;
    with_engine(edit.inner(), &session_id, |engine, session_id, current| {
        let page = engine.find(session_id, &query, cursor.as_deref())?;
        validate_find_page(&page, current)?;
        Ok(page)
    })
}

/// E12: local spelling only. Grammar, style, AI and network checkers are out
/// of scope; the bound span must still belong to the current revision.
#[tauri::command]
pub fn office_edit_spelling(
    window: WebviewWindow,
    edit: State<'_, OfficeEditState>,
    session_id: String,
    span: TextSpan,
    cursor: Option<String>,
) -> Result<OfficeResultPage<OfficeSpellingIssue>, String> {
    ensure_main(window.label())?;
    if !span.is_valid() {
        return Err(code(OfficeEditError::Invalid));
    }
    let cursor = parse_cursor(cursor)?;
    with_engine(edit.inner(), &session_id, |engine, session_id, current| {
        if !span.is_current(current.revision) {
            return Err(OfficeEditError::Changed);
        }
        let page = engine.spelling(session_id, &span, cursor.as_deref())?;
        validate_spelling_page(&page, current)?;
        Ok(page)
    })
}

/// E13: bounded whole-document statistics for the current revision.
#[tauri::command]
pub fn office_edit_document_stats(
    window: WebviewWindow,
    edit: State<'_, OfficeEditState>,
    session_id: String,
) -> Result<DocumentStatistics, String> {
    ensure_main(window.label())?;
    with_engine(edit.inner(), &session_id, |engine, session_id, current| {
        let stats = engine.document_stats(session_id)?;
        validate_document_stats(&stats, current)?;
        Ok(stats)
    })
}

/// E17: only the approved engine's local supported-function catalogue. The
/// answer is paginated and bounded; labels stay translation keys, never
/// engine-supplied UI text.
#[tauri::command]
pub fn office_edit_functions(
    window: WebviewWindow,
    edit: State<'_, OfficeEditState>,
    session_id: String,
    locale: OfficeFormulaLocale,
    cursor: Option<String>,
) -> Result<OfficeResultPage<OfficeFunction>, String> {
    ensure_main(window.label())?;
    let cursor = parse_cursor(cursor)?;
    with_engine(edit.inner(), &session_id, |engine, session_id, current| {
        if current.family != OfficeFamily::Sheet {
            return Err(OfficeEditError::Unsupported);
        }
        let page = engine.functions(session_id, locale, cursor.as_deref())?;
        validate_functions_page(&page, current)?;
        Ok(page)
    })
}

/// E19: explicit print start. One job and one system print operation for the
/// exact session/revision; the engine owns the dialog and no output path or
/// silent-print mode exists. A missing engine or print provider stays typed.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn office_edit_print_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    edit: State<'_, OfficeEditState>,
    request_id: String,
    session_id: String,
    expected_revision: u64,
    ranges: Vec<PageRange>,
    sheet_settings: Option<SheetPrintSettings>,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id).map_err(|_| code(OfficeEditError::Invalid))?;
    edit.current_profile().map_err(code)?;
    let session_id = parse_id(&session_id)?;
    if !(1..=MAX_SAFE_INTEGER).contains(&expected_revision) {
        return Err(code(OfficeEditError::Invalid));
    }
    validate_print_ranges(&ranges).map_err(code)?;
    let session = edit.session(session_id).map_err(code)?;
    let current = session.snapshot().map_err(code)?;
    if current.busy {
        return Err(code(OfficeEditError::Busy));
    }
    if current.revision != expected_revision {
        return Err(code(OfficeEditError::Changed));
    }
    if sheet_settings
        .as_ref()
        .is_some_and(|_| current.family != OfficeFamily::Sheet)
    {
        return Err(code(OfficeEditError::Unsupported));
    }
    if let Some(settings) = &sheet_settings {
        crate::office_edit_sheet::validate_print_settings(settings).map_err(code)?;
    }
    // A missing engine is refused before a job exists; the service receives
    // the typed `office_edit.engine_missing`, never a fake successful print.
    let engine = edit.engine().map_err(code)?;
    if !current.capabilities.contains(&OfficeCapability::Print) {
        return Err(code(OfficeEditError::Unsupported));
    }
    let document_id = current.document_id;
    let content_id = current.content_id;
    // One output reservation for one print operation. The shared job rejects
    // a duplicate request id before the renderer is touched.
    let token = jobs.begin(&request_id, 1)?;
    let app = window.app_handle().clone();
    spawn_job(app, request_id, token, move |context| {
        let state = context.app().state::<OfficeEditState>();
        let session = state.session(session_id).map_err(code)?;
        let baseline = session.snapshot().map_err(code)?;
        if baseline.busy {
            return Err(code(OfficeEditError::Busy));
        }
        if baseline.document_id != document_id
            || baseline.revision != expected_revision
            || baseline.content_id != content_id
            || !baseline.capabilities.contains(&OfficeCapability::Print)
        {
            return Err(code(OfficeEditError::Changed));
        }
        if context.token().load(Ordering::Relaxed) {
            return Err(code(OfficeEditError::Cancelled));
        }
        engine
            .print(
                session_id,
                expected_revision,
                &ranges,
                sheet_settings.as_ref(),
            )
            .map_err(code)?;
        Ok(serde_json::Value::Null)
    });
    Ok(())
}
