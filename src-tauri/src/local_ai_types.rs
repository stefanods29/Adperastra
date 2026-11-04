//! Native re-export of the canonical `ai-runtime` types.
//!
//! There is exactly one definition: `crates/ai-runtime/src/types.rs` and its
//! split `types_ui.rs`. This module adds only Tauri-facing request/response
//! envelopes; it never copies a field list.
#![allow(dead_code)]


pub use ai_runtime::types::*;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// `ai_artifact_read` arguments. The service splits larger reads into 4 MiB
/// adpfile-style ranges; this command accepts at most 8 MiB.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiArtifactReadRequest {
    pub id: Uuid,
    pub offset: u64,
    pub length: u64,
}

/// `ai_input_acquire` accepts only an immutable snapshot or an opened
/// document. A bare file path is not authorization and is refused.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AiInputAcquire {
    Document {
        document_id: String,
    },
    Snapshot {
        snapshot_id: Uuid,
        document_id: String,
        revision: u64,
    },
}

/// What the UI needs to start a task; no path and no bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiStartReply {
    pub request_id: JobRequestId,
}

/// Empty success for release/idempotent commands.
pub type AiUnit = ();
