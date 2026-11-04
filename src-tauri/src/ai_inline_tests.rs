//! Native inline contract tests for Step 17d T6.

use uuid::Uuid;

use super::{
    sanitize_completion, validate_completion, validate_request, InlineCompletion,
    InlineCompletionRequest, InlineDocumentState, InlineFileType, INLINE_MAX_SUGGESTION,
};

fn state(document_id: Uuid, revision: u64, content_id: Uuid) -> InlineDocumentState {
    InlineDocumentState {
        document_id,
        revision,
        content_id,
        cursor_max: 100,
        file_type: InlineFileType::Text,
        editing_enabled: true,
        locked: false,
        local_backend: true,
    }
}

fn request(document_id: Uuid, revision: u64, content_id: Uuid) -> InlineCompletionRequest {
    InlineCompletionRequest {
        document_id,
        revision,
        content_id,
        cursor_utf16: 12,
        before: "The meeting ".to_string(),
        after: " begins".to_string(),
        file_type: InlineFileType::Text,
        language: "text".to_string(),
        generation: 2,
    }
}

#[test]
fn inline_request_is_bound_to_revision_and_content() {
    let document_id = Uuid::new_v4();
    let content_id = Uuid::new_v4();
    let current = state(document_id, 4, content_id);
    let valid = request(document_id, 4, content_id);
    assert!(validate_request(&valid, &current).is_ok());

    let mut stale_revision = valid.clone();
    stale_revision.revision = 3;
    assert_eq!(
        validate_request(&stale_revision, &current).err().as_deref(),
        Some("ai_inline.changed")
    );
    let mut stale_content = valid.clone();
    stale_content.content_id = Uuid::new_v4();
    assert_eq!(
        validate_request(&stale_content, &current).err().as_deref(),
        Some("ai_inline.changed")
    );
    let mut past_cursor = valid.clone();
    past_cursor.cursor_utf16 = 101;
    assert_eq!(
        validate_request(&past_cursor, &current).err().as_deref(),
        Some("ai_inline.changed")
    );
}

#[test]
fn inline_locked_or_api_is_unavailable() {
    let document_id = Uuid::new_v4();
    let content_id = Uuid::new_v4();
    let valid = request(document_id, 1, content_id);
    let mut locked = state(document_id, 1, content_id);
    locked.locked = true;
    assert_eq!(
        validate_request(&valid, &locked).err().as_deref(),
        Some("ai_inline.unavailable")
    );
    let mut api = state(document_id, 1, content_id);
    api.local_backend = false;
    assert_eq!(
        validate_request(&valid, &api).err().as_deref(),
        Some("ai_inline.unavailable")
    );
    let mut read_only = state(document_id, 1, content_id);
    read_only.editing_enabled = false;
    assert_eq!(
        validate_request(&valid, &read_only).err().as_deref(),
        Some("ai_inline.unavailable")
    );
}

#[test]
fn inline_completion_is_plain_and_bounded() {
    assert!(sanitize_completion(" begins at ten").is_ok());
    assert_eq!(
        sanitize_completion("two\nparagraphs").err().as_deref(),
        Some("ai_inline.changed")
    );
    assert_eq!(
        sanitize_completion("tab\there").err().as_deref(),
        Some("ai_inline.changed")
    );
    assert_eq!(
        sanitize_completion(&"x".repeat(INLINE_MAX_SUGGESTION + 1))
            .err()
            .as_deref(),
        Some("ai_inline.changed")
    );
    assert!(sanitize_completion(&"x".repeat(INLINE_MAX_SUGGESTION)).is_ok());
    assert!(sanitize_completion("").is_err());
}

#[test]
fn inline_stale_result_is_dropped() {
    let document_id = Uuid::new_v4();
    let content_id = Uuid::new_v4();
    let valid = request(document_id, 1, content_id);
    let mut completion = InlineCompletion {
        generation: 2,
        revision: 1,
        content_id,
        cursor_utf16: 12,
        text: " begins at ten".to_string(),
        expires_unix: 2_000_000_000,
    };
    assert!(validate_completion(&completion, &valid).is_ok());
    completion.generation = 3;
    assert_eq!(
        validate_completion(&completion, &valid).err().as_deref(),
        Some("ai_inline.changed")
    );
    completion.generation = 2;
    completion.cursor_utf16 = 11;
    assert_eq!(
        validate_completion(&completion, &valid).err().as_deref(),
        Some("ai_inline.changed")
    );
}
