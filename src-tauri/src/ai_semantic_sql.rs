//! Small SQL helpers shared by the semantic store and scan (Step 17c T2/T3).

use crate::ai_search_types::{AiSearchError, SemanticVectorKind};

pub(crate) fn model_keys(kind: SemanticVectorKind) -> (&'static str, &'static str) {
    match kind {
        SemanticVectorKind::Text => ("text_model_id", "text_model_revision"),
        SemanticVectorKind::Image => ("image_model_id", "image_model_revision"),
    }
}

pub(crate) fn map_db(error: rusqlite::Error) -> AiSearchError {
    match error {
        rusqlite::Error::SqliteFailure(inner, _)
            if inner.code == rusqlite::ErrorCode::DatabaseBusy
                || inner.code == rusqlite::ErrorCode::DatabaseLocked =>
        {
            AiSearchError::Unavailable
        }
        _ => AiSearchError::Failed,
    }
}
