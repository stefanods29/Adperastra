//! The pure adapter registry (Step 08c E2).
//!
//! Later Office/media/archive adapters register through this same trait. An
//! adapter never sees a Tauri state, an owned output, a destination path or
//! another reader; the native parent alone publishes.

use std::io::Write;

use convert::{MetadataCategory, ReadSeek};

use crate::error::PrivacyError;
use crate::image_clean::ImagePrivacyAdapter;
use crate::pdf_clean::PdfPrivacyAdapter;
use crate::types::{PrivacyCleanSummary, PrivacyContext, PrivacyField};

pub trait PrivacyAdapter: Send + Sync {
    /// Stable lower ASCII adapter ID (`image`, `pdf`).
    fn id(&self) -> &'static str;
    /// Every category this adapter can inspect and remove.
    fn categories(&self) -> &'static [MetadataCategory];
    fn inspect(
        &self,
        input: &mut dyn ReadSeek,
        context: &mut PrivacyContext,
    ) -> Result<Vec<PrivacyField>, PrivacyError>;
    fn clean(
        &self,
        input: &mut dyn ReadSeek,
        categories: &[MetadataCategory],
        output: &mut dyn Write,
        context: &mut PrivacyContext,
    ) -> Result<PrivacyCleanSummary, PrivacyError>;
}

/// A bounded set of static adapters, never user-registered executable code.
pub struct PrivacyRegistry {
    adapters: Vec<Box<dyn PrivacyAdapter>>,
}

impl PrivacyRegistry {
    pub fn new() -> Self {
        Self {
            adapters: Vec::new(),
        }
    }

    pub fn register(&mut self, adapter: Box<dyn PrivacyAdapter>) -> Result<(), PrivacyError> {
        if self.adapters.iter().any(|item| item.id() == adapter.id()) {
            return Err(PrivacyError::BadRequest);
        }
        if self.adapters.len() >= 16 {
            return Err(PrivacyError::BadRequest);
        }
        self.adapters.push(adapter);
        Ok(())
    }

    pub fn get(&self, id: &str) -> Option<&dyn PrivacyAdapter> {
        self.adapters
            .iter()
            .find(|adapter| adapter.id() == id)
            .map(|adapter| adapter.as_ref())
    }

    pub fn ids(&self) -> Vec<&'static str> {
        self.adapters.iter().map(|adapter| adapter.id()).collect()
    }
}

impl Default for PrivacyRegistry {
    fn default() -> Self {
        let mut registry = Self::new();
        // Both built-in registrations are infallible for a fresh registry.
        let _ = registry.register(Box::new(ImagePrivacyAdapter));
        let _ = registry.register(Box::new(PdfPrivacyAdapter));
        registry
    }
}

/// The app's static adapter set.
pub fn default_registry() -> PrivacyRegistry {
    PrivacyRegistry::default()
}

/// Categories offered by the image adapter.
pub const IMAGE_CATEGORIES: &[MetadataCategory] = &[
    MetadataCategory::Exif,
    MetadataCategory::Gps,
    MetadataCategory::Camera,
    MetadataCategory::Date,
    MetadataCategory::Icc,
    MetadataCategory::Xmp,
    MetadataCategory::Iptc,
    MetadataCategory::Author,
    MetadataCategory::Comments,
];

/// Categories offered by the PDF adapter. GPS/camera/date/EXIF inside nested
/// images are not offered unless an adapter can prove their coverage.
pub const PDF_CATEGORIES: &[MetadataCategory] = &[
    MetadataCategory::Author,
    MetadataCategory::Xmp,
    MetadataCategory::Attachments,
    MetadataCategory::Annotations,
    MetadataCategory::Scripts,
    MetadataCategory::Forms,
    MetadataCategory::Comments,
    MetadataCategory::Timestamps,
];
