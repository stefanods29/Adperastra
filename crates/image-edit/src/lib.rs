//! Pure image-editing math (Step 14b). No Tauri, no filesystem access and no
//! user paths: the UI and the native command layer own those concerns.

pub mod adjustments;
pub mod geometry;
pub mod project;
pub mod project_tiles;
pub mod types;

pub use adjustments::{apply_adjustments, apply_preset};
pub use geometry::{
    angle_bounds, natural_output_size, normalize_crop, output_to_source_affine, rotated_size,
    source_to_output_affine,
};
pub use types::{
    AdjustmentPreset, Affine2D, ImageAdjustments, ImageGeometry, ImageOverlay, ImageSize, Point,
    Rect, TileRef, MAX_IMAGE_EDGE, MAX_IMAGE_PIXELS, MAX_OVERLAYS, MAX_OVERLAY_POINTS, TILE_EDGE,
};
