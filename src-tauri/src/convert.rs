//! Native conversion facade (Step 08a T4). The work lives in
//! `convert_jobs`/`convert_publish`/`convert_helper`; this module names the
//! public surface the coordinator registers.

pub use crate::convert_jobs::{
    convert_preview_start, convert_report_page, convert_start, run_job, run_preview_job,
    ConversionPreview,
};
pub use crate::convert_publish::{PublishSink, PublishedOutput, FREE_SPACE_MARGIN};

/// The stable area name every error code starts with.
pub const AREA: &str = "convert";

/// The only converters this build advertises.
pub fn available_converter_ids() -> Vec<String> {
    let registry = ::convert::builtin_registry();
    registry
        .specs()
        .into_iter()
        .filter(|spec| spec.available)
        .map(|spec| spec.id.as_str().to_string())
        .collect()
}
