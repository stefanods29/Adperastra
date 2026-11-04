//! Provider registrations and review state for Step 17d.
//!
//! OCR/layout, the model gateway, the 08a capture authority and the inline
//! document state are producer runtimes. Until a trusted native registration
//! exists every start command fails closed; nothing here fakes success.
#![allow(dead_code)]


use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::ai_extraction_corrections::apply_corrections;
use crate::ai_extraction_jobs::ReviewPager;
use crate::ai_extraction_types::MAX_REVIEW_PAGE_BYTES;
use crate::ai_extraction_requests::{ExtractionCorrection, ExtractionPublish, ExtractionRequest};
use crate::ai_extraction_types::{ExtractionReview, ExtractionSource};
use crate::ai_inline::{
    InlineCompletion, InlineCompletionRequest, InlineDocumentState, INLINE_TTL_SECONDS,
};

const PREPARED_TTL: Duration = Duration::from_secs(300);

/// The lifetime the WebView expects for a completion (seconds).
pub const INLINE_COMPLETION_TTL_SECONDS: u64 = INLINE_TTL_SECONDS;

/// What the OCR/layout runtime returns before any network access.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreparedSources {
    pub id: Uuid,
    pub sources: Vec<ExtractionSource>,
    pub arguments: Vec<PreparedArgument>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreparedArgument {
    pub name: String,
    pub value: String,
}

/// The trusted OCR/layout and structured-model runtime (07e/17a/14c).
pub trait ExtractionBackend: Send + Sync {
    fn prepare(&self, request: &ExtractionRequest) -> Result<PreparedSources, String>;
    fn extract(
        &self,
        request: &ExtractionRequest,
        prepared: &PreparedSources,
        outbound_consent_id: Option<&str>,
    ) -> Result<ExtractionReview, String>;
}

/// The 08a native snapshot authority, registered by the coordinator.
pub trait ExtractionCaptureSink: Send + Sync {
    fn publish(
        &self,
        bytes: &[u8],
        publish: &ExtractionPublish,
    ) -> Result<crate::export_snapshot_types::ExportSnapshot, String>;
}

/// The owning document and Local AI state for inline suggestions.
pub trait InlineDocumentProvider: Send + Sync {
    fn state(&self, document_id: Uuid) -> Result<InlineDocumentState, String>;
}

pub trait InlineBackend: Send + Sync {
    fn complete(
        &self,
        request: &InlineCompletionRequest,
        current: &InlineDocumentState,
    ) -> Result<InlineCompletion, String>;
}

struct PreparedEntry {
    prepared: PreparedSources,
    created: Instant,
}

struct ReviewEntry {
    pager: ReviewPager,
    last_cursor: Option<Uuid>,
}

/// Managed state for the extraction commands.
#[derive(Default)]
pub struct AiExtractionRuntime {
    extraction: Mutex<Option<Arc<dyn ExtractionBackend>>>,
    capture: Mutex<Option<Arc<dyn ExtractionCaptureSink>>>,
    inline: Mutex<Option<Arc<dyn InlineBackend>>>,
    inline_documents: Mutex<Option<Arc<dyn InlineDocumentProvider>>>,
    prepared: Mutex<HashMap<Uuid, PreparedEntry>>,
    reviews: Mutex<HashMap<Uuid, ReviewEntry>>,
}

impl AiExtractionRuntime {
    pub fn register_extraction(&self, backend: Arc<dyn ExtractionBackend>) {
        if let Ok(mut slot) = self.extraction.lock() {
            *slot = Some(backend);
        }
    }

    pub fn register_capture(&self, sink: Arc<dyn ExtractionCaptureSink>) {
        if let Ok(mut slot) = self.capture.lock() {
            *slot = Some(sink);
        }
    }

    pub fn register_inline(&self, backend: Arc<dyn InlineBackend>) {
        if let Ok(mut slot) = self.inline.lock() {
            *slot = Some(backend);
        }
    }

    pub fn register_inline_documents(&self, provider: Arc<dyn InlineDocumentProvider>) {
        if let Ok(mut slot) = self.inline_documents.lock() {
            *slot = Some(provider);
        }
    }

    pub(crate) fn extraction(&self) -> Result<Arc<dyn ExtractionBackend>, String> {
        self.extraction
            .lock()
            .map_err(|_| "ai_extract.failed".to_string())?
            .clone()
            .ok_or_else(|| "ai_extract.unavailable".to_string())
    }

    pub(crate) fn capture_sink(&self) -> Result<Arc<dyn ExtractionCaptureSink>, String> {
        self.capture
            .lock()
            .map_err(|_| "ai_extract.failed".to_string())?
            .clone()
            .ok_or_else(|| "ai_extract.unavailable".to_string())
    }

    pub(crate) fn inline_backend(&self) -> Result<Arc<dyn InlineBackend>, String> {
        self.inline
            .lock()
            .map_err(|_| "ai_inline.unavailable".to_string())?
            .clone()
            .ok_or_else(|| "ai_inline.unavailable".to_string())
    }

    pub(crate) fn inline_state(&self, document_id: Uuid) -> Result<InlineDocumentState, String> {
        self.inline_documents
            .lock()
            .map_err(|_| "ai_inline.unavailable".to_string())?
            .clone()
            .ok_or_else(|| "ai_inline.unavailable".to_string())?
            .state(document_id)
    }

    pub(crate) fn store_prepared(&self, prepared: PreparedSources) -> Result<(), String> {
        let mut entries = self
            .prepared
            .lock()
            .map_err(|_| "ai_extract.failed".to_string())?;
        entries.retain(|_, entry| entry.created.elapsed() < PREPARED_TTL);
        entries.insert(
            prepared.id,
            PreparedEntry {
                prepared,
                created: Instant::now(),
            },
        );
        Ok(())
    }

    pub(crate) fn take_prepared(&self, id: Uuid) -> Result<PreparedSources, String> {
        let mut entries = self
            .prepared
            .lock()
            .map_err(|_| "ai_extract.failed".to_string())?;
        let entry = entries.remove(&id).ok_or_else(|| "ai_extract.changed".to_string())?;
        if entry.created.elapsed() >= PREPARED_TTL {
            return Err("ai_extract.changed".to_string());
        }
        Ok(entry.prepared)
    }

    pub(crate) fn review(&self, review_id: Uuid) -> Result<ExtractionReview, String> {
        let reviews = self
            .reviews
            .lock()
            .map_err(|_| "ai_extract.failed".to_string())?;
        reviews
            .get(&review_id)
            .map(|entry| entry.pager.review().clone())
            .ok_or_else(|| "ai_extract.changed".to_string())
    }

    pub(crate) fn store_review(&self, review: ExtractionReview) -> Result<(), String> {
        let pager = ReviewPager::new(review)?;
        let review_id = pager.review().id;
        self.reviews
            .lock()
            .map_err(|_| "ai_extract.failed".to_string())?
            .insert(
                review_id,
                ReviewEntry {
                    pager,
                    last_cursor: None,
                },
            );
        Ok(())
    }

    pub(crate) fn page(&self, review_id: Uuid, cursor: &str) -> Result<ExtractionReview, String> {
        let mut reviews = self
            .reviews
            .lock()
            .map_err(|_| "ai_extract.failed".to_string())?;
        let entry = reviews
            .get_mut(&review_id)
            .ok_or_else(|| "ai_extract.changed".to_string())?;
        if !cursor.is_empty() {
            let wanted = Uuid::parse_str(cursor).map_err(|_| "ai_extract.changed".to_string())?;
            if entry.last_cursor != Some(wanted) {
                return Err("ai_extract.changed".to_string());
            }
        } else if entry.last_cursor.is_some() {
            return Err("ai_extract.changed".to_string());
        }
        let (page, next) = entry.pager.next_page(MAX_REVIEW_PAGE_BYTES)?;
        entry.last_cursor = next;
        Ok(page)
    }

    pub(crate) fn correct(
        &self,
        review_id: Uuid,
        expected_revision: u64,
        corrections: &[ExtractionCorrection],
    ) -> Result<ExtractionReview, String> {
        let mut reviews = self
            .reviews
            .lock()
            .map_err(|_| "ai_extract.failed".to_string())?;
        let entry = reviews
            .get_mut(&review_id)
            .ok_or_else(|| "ai_extract.changed".to_string())?;
        let next = apply_corrections(entry.pager.review(), expected_revision, corrections)?;
        entry.pager = ReviewPager::new(next.clone())?;
        entry.last_cursor = None;
        Ok(next)
    }

    pub(crate) fn release(&self, review_id: Uuid) {
        if let Ok(mut reviews) = self.reviews.lock() {
            reviews.remove(&review_id);
        }
    }
}

#[cfg(test)]
#[path = "ai_extraction_commands_tests.rs"]
mod tests;


