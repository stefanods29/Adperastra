//! Bounded structural Office previews (Step 13 T2).
//!
//! The public surface is split so no file grows into a parser monolith:
//! `office_quick_types` owns the bounded records/window and
//! `office_quick_zip` owns guarded ZIP/XML inspection. This module is the
//! canonical import point for T4 and the exact T2 test file.
//!
//! Legacy binary/RTF inputs return the explicit no-preview fallback; no
//! helper is launched for them.

pub use crate::office_quick_types::*;
pub use crate::office_quick_zip::inspect_quick_package;

#[cfg(test)]
#[path = "office_quick_step13_tests.rs"]
mod step13_tests;
