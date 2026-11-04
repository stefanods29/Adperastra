//! Pure privacy inspection and cleaning (Step 08c, contract 24).
//!
//! Nothing in this crate knows about Tauri, windows, dialogs or the user's
//! profile. Callers hand it bounded bytes through `ReadSeek` and an owned
//! output through `std::io::Write`; publication, version history and Undo
//! stay with the native parent (plan/rules.md R-SAFE, R-SEC-9).

pub mod archive;
pub mod error;
pub mod image_clean;
pub mod image_fields;
pub mod inspect;
pub mod iptc;
pub mod media;
pub mod office;
pub mod office_rewrite;
pub mod pdf_clean;
pub mod pdf_fields;
pub mod pdf_graph;
pub mod pdf_verify;
pub mod registry;
pub mod types;
pub mod xmp_rules;

pub use convert::{ConversionInput, MetadataCategory, ReadSeek};
pub use error::PrivacyError;
pub use inspect::{clean_bytes, closure_for, counts_for, effective_categories, inspect_bytes};
pub use registry::{default_registry, PrivacyAdapter, PrivacyRegistry};
pub use types::{
    validate_requested_categories, validate_uuid, Coverage, MetadataContainer, MetadataCount,
    PrivacyCleanSummary, PrivacyClosure, PrivacyContext, PrivacyField, PrivacyFormat,
    PrivacyInspection, PrivacyInspectionPage, PrivacyMode, PrivacyRequest, PrivacyResult,
    PrivacySettings,
};

/// The canonical order of categories in messages, pages and tests.
pub const CATEGORY_ORDER: [MetadataCategory; 14] = [
    MetadataCategory::Exif,
    MetadataCategory::Gps,
    MetadataCategory::Camera,
    MetadataCategory::Date,
    MetadataCategory::Icc,
    MetadataCategory::Xmp,
    MetadataCategory::Iptc,
    MetadataCategory::Author,
    MetadataCategory::Comments,
    MetadataCategory::Attachments,
    MetadataCategory::Forms,
    MetadataCategory::Annotations,
    MetadataCategory::Scripts,
    MetadataCategory::Timestamps,
];

/// A stable order for effective categories and closures.
pub fn sorted_categories(categories: &[MetadataCategory]) -> Vec<MetadataCategory> {
    let mut result = Vec::new();
    for category in CATEGORY_ORDER {
        if categories.contains(&category) && !result.contains(&category) {
            result.push(category);
        }
    }
    result
}

/// True when both category sets contain exactly the same entries.
pub fn same_categories(left: &[MetadataCategory], right: &[MetadataCategory]) -> bool {
    let left = sorted_categories(left);
    let right = sorted_categories(right);
    left == right
}

mod bounded_input;
