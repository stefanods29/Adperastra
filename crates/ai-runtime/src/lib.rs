//! Local AI runtime contracts (Step 14c, revision `ai-runtime-1`).
//!
//! This crate is pure Rust: no Tauri, no Windows API and no process launch.
//! It owns the typed task/result contracts, their bounds, the helper framing,
//! the bounded artifact/input registries and the deterministic tiled
//! enlargement math. The confined helper process and the Windows hardware
//! query live in `src-tauri`, not here.

pub mod artifacts;
pub mod image_alpha;
pub mod options;
pub mod output_validation;
pub mod protocol;
pub mod protocol_header;
pub mod protocol_options;
pub mod schema;
pub mod types;
pub mod types_ui;
pub mod upscale;
pub mod upscale_tiles;
pub mod validation;

pub use types::*;
pub use types_ui::*;

/// Interface revision of these contracts.
pub const AI_RUNTIME_REVISION: &str = "ai-runtime-1";
/// Interface revision of the pinned upstream runtime sources.
pub const AI_UPSTREAM_REVISION: &str = "ai-upstream-1";
