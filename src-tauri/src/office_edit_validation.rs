//! Shared bounded checks for the native Office editing commands (Step 20a).
//!
//! These helpers only inspect DTOs. They never read content, call an engine or
//! authorize a mutation; a failed check maps to a stable `office_edit.*` code.

use uuid::Uuid;

use crate::engine_types::OfficeFormat;
use crate::office_edit_items::{OfficeItemKind, OfficeItemPage};
use crate::office_edit_types::{
    AuthorizedOfficeInput, BindingSession, OfficeCapability, OfficeEditError, OfficeFamily,
    OfficeOperation, OfficeSessionState,
};
use crate::office_edit_values::OfficeSelection;

pub const MAX_PROFILE_ID: usize = 64;
pub const MAX_ITEM_PAGE: usize = 256;

/// The stable wire code of one typed error.
pub fn code(error: OfficeEditError) -> String {
    error.code().to_string()
}

/// Parse one canonical non-nil UUID argument or return `office_edit.invalid`.
pub fn parse_id(value: &str) -> Result<Uuid, String> {
    let parsed = Uuid::parse_str(value).map_err(|_| code(OfficeEditError::Invalid))?;
    if parsed.is_nil() {
        return Err(code(OfficeEditError::Invalid));
    }
    Ok(parsed)
}

pub fn valid_profile_id(profile_id: &str) -> bool {
    !profile_id.is_empty()
        && profile_id.len() <= MAX_PROFILE_ID
        && profile_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
}

pub fn family_of(format: OfficeFormat) -> OfficeFamily {
    match format {
        OfficeFormat::Docx
        | OfficeFormat::Odt
        | OfficeFormat::Rtf
        | OfficeFormat::Doc
        | OfficeFormat::Potx
        | OfficeFormat::Otp => OfficeFamily::Document,
        OfficeFormat::Xlsx | OfficeFormat::Ods | OfficeFormat::Xls => OfficeFamily::Sheet,
        OfficeFormat::Pptx | OfficeFormat::Odp | OfficeFormat::Ppt => OfficeFamily::Deck,
    }
}

pub fn item_kind_matches(kind: OfficeItemKind, family: OfficeFamily) -> bool {
    match kind {
        OfficeItemKind::Headings | OfficeItemKind::Styles | OfficeItemKind::Changes => {
            family == OfficeFamily::Document
        }
        OfficeItemKind::Comments => {
            matches!(family, OfficeFamily::Document | OfficeFamily::Deck)
        }
        OfficeItemKind::Sheets | OfficeItemKind::Pivots => family == OfficeFamily::Sheet,
        OfficeItemKind::Slides | OfficeItemKind::Masters => family == OfficeFamily::Deck,
        OfficeItemKind::Charts => {
            matches!(family, OfficeFamily::Sheet | OfficeFamily::Deck)
        }
    }
}

pub fn selection_family(selection: &OfficeSelection) -> OfficeFamily {
    match selection {
        OfficeSelection::Document { .. } => OfficeFamily::Document,
        OfficeSelection::Sheet { .. } => OfficeFamily::Sheet,
        OfficeSelection::Deck { .. } => OfficeFamily::Deck,
    }
}

pub fn operation_family_matches(
    operation: &OfficeOperation,
    family: OfficeFamily,
) -> bool {
    matches!(
        (operation, family),
        (OfficeOperation::Document(_), OfficeFamily::Document)
            | (OfficeOperation::Sheet(_), OfficeFamily::Sheet)
            | (OfficeOperation::Deck(_), OfficeFamily::Deck)
    )
}

pub fn same_session(current: &OfficeSessionState, next: &OfficeSessionState) -> bool {
    next.session_id == current.session_id
        && next.document_id == current.document_id
        && next.family == current.family
        && next.format == current.format
        && next.is_valid()
}

/// Approval keeps transaction labels inside the translated app namespace.
pub fn valid_transaction_label(label: &str) -> bool {
    !label.is_empty() && label.len() <= 128 && label.starts_with("office.")
}

/// The first engine state must describe the same immutable input the session
/// was opened with. A sensitive session additionally needs a memory-only
/// engine capability before it is admitted.
pub fn validate_initial_state(
    input: &AuthorizedOfficeInput,
    family: OfficeFamily,
    binding: &BindingSession,
) -> Result<(), OfficeEditError> {
    let state = &binding.initial_state;
    if binding.session_id != state.session_id || !state.is_valid() {
        return Err(OfficeEditError::Failed);
    }
    if state.document_id != input.document_id
        || state.family != family
        || state.format != input.format
    {
        return Err(OfficeEditError::Invalid);
    }
    if state.revision != input.initial_revision
        || state.content_id != input.initial_content_id
    {
        return Err(OfficeEditError::Changed);
    }
    if state.busy {
        return Err(OfficeEditError::Busy);
    }
    if input.sensitive && !state.capabilities.contains(&OfficeCapability::SensitiveMemory) {
        return Err(OfficeEditError::SensitiveUnsupported);
    }
    Ok(())
}

/// Page bounds and item identities of one item result.
pub fn item_page_revision(page: &OfficeItemPage) -> (u64, usize, bool) {
    match page {
        OfficeItemPage::Headings {
            items,
            revision,
            ..
        } => (*revision, items.len(), items.iter().all(|item| {
            !item.id.is_nil()
                && !item.title.is_empty()
                && item.title.chars().count() <= 512
                && (1..=6).contains(&item.level)
                && item.page >= 1
        })),
        OfficeItemPage::Styles {
            items, revision, ..
        } => (*revision, items.len(), items.iter().all(|item| item.is_valid())),
        OfficeItemPage::Comments {
            items, revision, ..
        } => (*revision, items.len(), items.iter().all(|item| item.is_valid())),
        OfficeItemPage::Changes {
            items, revision, ..
        } => (*revision, items.len(), items.iter().all(|item| {
            !item.id.is_nil()
                && item.author.chars().count() <= 128
                && item.excerpt.chars().count() <= 512
                && item.span.is_valid()
        })),
        OfficeItemPage::Sheets {
            items, revision, ..
        } => (*revision, items.len(), items.iter().all(|item| {
            !item.id.is_nil()
                && !item.name.is_empty()
                && item.name.chars().count() <= 31
        })),
        OfficeItemPage::Slides {
            items, revision, ..
        } => (*revision, items.len(), items.iter().all(|item| {
            !item.id.is_nil()
                && !item.layout_id.is_nil()
                && item.title.chars().count() <= 512
                && item.notes_preview.chars().count() <= 512
        })),
        OfficeItemPage::Masters {
            items, revision, ..
        } => (*revision, items.len(), items.iter().all(|theme| !theme.id.is_nil())),
        OfficeItemPage::Charts {
            items, revision, ..
        } => (*revision, items.len(), items.iter().all(|chart| !chart.id.is_nil())),
        OfficeItemPage::Pivots {
            items, revision, ..
        } => (*revision, items.len(), items.iter().all(|pivot| {
            !pivot.id.is_nil()
                && pivot.rows.len() <= 32
                && pivot.columns.len() <= 32
                && !pivot.values.is_empty()
                && pivot.values.len() <= 32
                && pivot.filters.len() <= 32
        })),
    }
}
