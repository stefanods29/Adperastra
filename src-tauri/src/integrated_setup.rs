//! Fail-closed native providers for states integrated after Step 08a.
//!
//! The coordinator installs the real embedding, source-authorizing and
//! gateway providers when their packs and engines ship. Until then every
//! call reports `ai_search.unavailable`; nothing here pretends that a model
//! is present, so the semantic-search commands stay unavailable instead of
//! answering with invented data.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use fs_service::source_stamp::SourceStamp;
use fs_service::CancellationToken;

use crate::ai_search_types::SemanticVectorKind;
use crate::ai_semantic_jobs::{
    AiSearchGateway, AiSemanticState, EmbeddingInput, EmbeddingReply, SemanticEmbedder,
    SemanticSourceAuthorizer,
};
use crate::local_ai_types::AiInputRef;

const UNAVAILABLE: &str = "ai_search.unavailable";

struct FailClosedEmbedder;

impl SemanticEmbedder for FailClosedEmbedder {
    fn model_identity(&self, _kind: SemanticVectorKind) -> Result<(String, String), String> {
        Err(UNAVAILABLE.to_string())
    }

    fn embed(
        &self,
        _input: EmbeddingInput,
        _cancel: &CancellationToken,
    ) -> Result<EmbeddingReply, String> {
        Err(UNAVAILABLE.to_string())
    }
}

struct FailClosedAuthorizer;

impl SemanticSourceAuthorizer for FailClosedAuthorizer {
    fn authorize_image(&self, _path: &Path) -> Result<AiInputRef, String> {
        Err(UNAVAILABLE.to_string())
    }

    fn stamp_for(&self, _input: &AiInputRef) -> Result<SourceStamp, String> {
        Err(UNAVAILABLE.to_string())
    }
}

struct FailClosedGateway;

impl AiSearchGateway for FailClosedGateway {
    fn complete(
        &self,
        _schema_id: &str,
        _user_json: &str,
        _prepared_id: &str,
        _outbound_consent_id: Option<&str>,
        _cancel: &CancellationToken,
    ) -> Result<String, String> {
        Err(UNAVAILABLE.to_string())
    }
}

/// Managed semantic-search state wired with fail-closed providers.
pub fn ai_semantic_state(profile_dir: PathBuf) -> AiSemanticState {
    AiSemanticState::new(
        profile_dir,
        Arc::new(FailClosedEmbedder),
        Arc::new(FailClosedAuthorizer),
        Arc::new(FailClosedGateway),
    )
}
