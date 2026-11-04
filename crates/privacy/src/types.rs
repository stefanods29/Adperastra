//! Exact privacy DTOs (Step 08c, `privacy-1`).
//!
//! Field names and bounds are the canonical wire contract; the TypeScript
//! mirror lives in `src/services/privacy.ts`. Shared conversion types are
//! imported from the `convert` crate and are never copied here.

use serde::{Deserialize, Serialize};

use convert::{ConversionInput, ConversionReport, MetadataCategory};
use fs_service::{CancellationToken, OpProgress, SourceStamp};

use crate::error::PrivacyError;

/// One bounded piece of metadata provenance.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MetadataContainer {
    Exif,
    Xmp,
    Iptc,
    PdfInfo,
    PdfStructure,
}

/// How complete a field's removal coverage is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Coverage {
    Complete,
    Partial,
    Unknown,
}

impl Coverage {
    /// The weakest coverage of two observations.
    pub fn weaker(self, other: Coverage) -> Coverage {
        match (self, other) {
            (Coverage::Unknown, _) | (_, Coverage::Unknown) => Coverage::Unknown,
            (Coverage::Partial, _) | (_, Coverage::Partial) => Coverage::Partial,
            _ => Coverage::Complete,
        }
    }
}

/// One detected metadata field. `preview` is escaped text for display only;
/// it is never interpreted as HTML, a path or a link.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PrivacyField {
    pub category: MetadataCategory,
    pub containers: Vec<MetadataContainer>,
    #[serde(default)]
    pub related_categories: Vec<MetadataCategory>,
    /// Stable adapter path ID, ASCII, at most 128 characters.
    pub field_id: String,
    /// Translation key such as `privacy.gps`, never a display sentence.
    pub label_key: String,
    #[serde(default)]
    pub preview: String,
    pub count: u32,
    #[serde(default)]
    pub content_affecting: bool,
    pub coverage: Coverage,
}

impl PrivacyField {
    pub fn validate(&self) -> Result<(), PrivacyError> {
        if self.field_id.is_empty()
            || self.field_id.len() > 128
            || !self.field_id.is_ascii()
            || self.field_id.chars().any(char::is_control)
        {
            return Err(PrivacyError::BadRequest);
        }
        if self.label_key.is_empty() || self.label_key.len() > 128 {
            return Err(PrivacyError::BadRequest);
        }
        if self.preview.chars().count() > 512 || self.preview.chars().any(char::is_control) {
            return Err(PrivacyError::BadRequest);
        }
        if self.containers.is_empty() || self.containers.len() > 5 {
            return Err(PrivacyError::BadRequest);
        }
        let mut unique = Vec::new();
        for container in &self.containers {
            if unique.contains(container) {
                return Err(PrivacyError::BadRequest);
            }
            unique.push(*container);
        }
        if self.related_categories.len() > 16 {
            return Err(PrivacyError::BadRequest);
        }
        let mut unique = Vec::new();
        for category in &self.related_categories {
            if unique.contains(category) {
                return Err(PrivacyError::BadRequest);
            }
            unique.push(*category);
        }
        Ok(())
    }
}

/// One page of the global inspection result. `next_cursor` is an opaque
/// native UUID; a page never returns more than 256 rows.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivacyInspectionPage {
    pub items: Vec<PrivacyInspection>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    pub complete: bool,
}

/// The result of inspecting one input.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivacyInspection {
    pub inspection_id: String,
    pub input: ConversionInput,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<SourceStamp>,
    /// At most 256 rows per page; `complete` belongs to the page cursor.
    pub fields: Vec<PrivacyField>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    pub complete: bool,
    pub signatures_present: bool,
    /// Every category that selecting the requested categories would remove.
    pub effective_categories: Vec<MetadataCategory>,
    /// Unix seconds; a stale inspection is never mutation authorization.
    pub expires_unix: u64,
}

/// The exact removal closure disclosed to the user before cleaning.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PrivacyClosure {
    pub requested_categories: Vec<MetadataCategory>,
    pub effective_categories: Vec<MetadataCategory>,
    pub content_affecting: bool,
    pub appearance_affecting: bool,
    pub signatures_present: bool,
}

/// The user's cleaning choice. Every acknowledgement is explicit and starts
/// false; no wrapper fills one in.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PrivacyRequest {
    pub inspection_ids: Vec<String>,
    pub categories: Vec<MetadataCategory>,
    pub dest_dir: String,
    #[serde(default)]
    pub replace: bool,
    #[serde(default)]
    pub accepted_content_changes: bool,
    #[serde(default)]
    pub accepted_signature_change: bool,
    #[serde(default)]
    pub accepted_appearance_changes: bool,
    pub accepted_effective_categories: Vec<MetadataCategory>,
    /// Localized filename suffix (` - Cleaned`, ` - Limpio`). Additive and
    /// optional; the UI resolves `privacy.cleanedName` for its language.
    #[serde(default)]
    pub cleaned_suffix: Option<String>,
}

/// A bounded count per category, never an arbitrary huge value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MetadataCount {
    pub category: MetadataCategory,
    pub count: u32,
    pub coverage: Coverage,
}

/// A completed cleaning result: the shared report plus before/after counts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivacyResult {
    pub report: ConversionReport,
    pub inspections_before: Vec<MetadataCount>,
    pub inspections_after: Vec<MetadataCount>,
}

/// What an adapter removed and what independent re-inspection retained.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PrivacyCleanSummary {
    pub removed_category_counts: Vec<MetadataCount>,
    pub retained_category_counts: Vec<MetadataCount>,
    /// `unknown` is never reported as success by the parent.
    pub coverage: Coverage,
    pub output_bytes: u64,
}

/// Privacy settings (schema 18).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrivacyMode {
    #[default]
    Keep,
    Ask,
    Remove,
}

fn empty_categories() -> Vec<MetadataCategory> {
    Vec::new()
}

/// Keep/ask/remove choices for future user-started actions. This never
/// authorizes background edits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PrivacySettings {
    #[serde(default)]
    pub mode: PrivacyMode,
    #[serde(default)]
    pub image_mode: PrivacyMode,
    #[serde(default)]
    pub pdf_mode: PrivacyMode,
    #[serde(default = "empty_categories")]
    pub image_categories: Vec<MetadataCategory>,
    #[serde(default = "empty_categories")]
    pub pdf_categories: Vec<MetadataCategory>,
    #[serde(default)]
    pub location_warning: bool,
    #[serde(default)]
    pub sharing_prompt: bool,
}

impl Default for PrivacySettings {
    fn default() -> Self {
        Self {
            mode: PrivacyMode::Keep,
            image_mode: PrivacyMode::Keep,
            pdf_mode: PrivacyMode::Keep,
            image_categories: Vec::new(),
            pdf_categories: Vec::new(),
            location_warning: false,
            sharing_prompt: false,
        }
    }
}

impl PrivacySettings {
    pub fn validate(&self) -> Result<(), String> {
        for categories in [&self.image_categories, &self.pdf_categories] {
            if categories.len() > 16 {
                return Err("too many privacy categories".to_string());
            }
            let mut unique = Vec::new();
            for category in categories {
                if unique.contains(category) {
                    return Err("duplicate privacy category".to_string());
                }
                unique.push(*category);
            }
        }
        Ok(())
    }

    /// The chosen mode for an image/PDF input, never a vague "remove all".
    pub fn mode_for(&self, format: PrivacyFormat) -> PrivacyMode {
        match format {
            PrivacyFormat::Image => self.image_mode,
            PrivacyFormat::Pdf => self.pdf_mode,
        }
    }

    /// The exact fixed categories saved for a format.
    pub fn categories_for(&self, format: PrivacyFormat) -> &[MetadataCategory] {
        match format {
            PrivacyFormat::Image => &self.image_categories,
            PrivacyFormat::Pdf => &self.pdf_categories,
        }
    }
}

/// The two supported cleaning families.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrivacyFormat {
    Image,
    Pdf,
}

/// What one pure adapter may do while inspecting or cleaning. It never owns
/// a second input/output reader, and no Tauri type appears here.
pub struct PrivacyContext {
    pub(crate) cancel: CancellationToken,
    pub(crate) progress: Box<dyn FnMut(OpProgress) -> Result<(), PrivacyError> + Send>,
    pub(crate) source_stamp: Option<SourceStamp>,
    pub(crate) max_output_bytes: u64,
}

impl PrivacyContext {
    pub fn new(
        cancel: CancellationToken,
        source_stamp: Option<SourceStamp>,
        max_output_bytes: u64,
    ) -> Self {
        Self {
            cancel,
            progress: Box::new(|_| Ok(())),
            source_stamp,
            max_output_bytes,
        }
    }

    /// A context for callers that have no job (tests and pure adapters).
    #[doc(hidden)]
    pub fn for_test(max_output_bytes: u64) -> Self {
        Self::new(fs_service::new_cancellation_token(), None, max_output_bytes)
    }

    pub fn with_progress(
        mut self,
        progress: Box<dyn FnMut(OpProgress) -> Result<(), PrivacyError> + Send>,
    ) -> Self {
        self.progress = progress;
        self
    }

    pub fn check_cancelled(&self) -> Result<(), PrivacyError> {
        if self.cancel.load(std::sync::atomic::Ordering::Relaxed) {
            Err(PrivacyError::Cancelled)
        } else {
            Ok(())
        }
    }

    pub fn report(&mut self, progress: OpProgress) -> Result<(), PrivacyError> {
        self.check_cancelled()?;
        (self.progress)(progress)
    }

    pub fn source_stamp(&self) -> Option<&SourceStamp> {
        self.source_stamp.as_ref()
    }

    pub fn max_output_bytes(&self) -> u64 {
        self.max_output_bytes
    }
}

/// Validate a category list: non-empty, no duplicates, at most 16 entries.
pub fn validate_requested_categories(categories: &[MetadataCategory]) -> Result<(), PrivacyError> {
    if categories.is_empty() || categories.len() > 16 {
        return Err(PrivacyError::BadRequest);
    }
    let mut unique = Vec::new();
    for category in categories {
        if unique.contains(category) {
            return Err(PrivacyError::BadRequest);
        }
        unique.push(*category);
    }
    Ok(())
}

/// Validate an inspection ID as a UUID string.
pub fn validate_uuid(value: &str, field: &str) -> Result<(), PrivacyError> {
    if uuid::Uuid::try_parse(value).is_err() {
        return Err(PrivacyError::BadRequest);
    }
    let _ = field;
    Ok(())
}
