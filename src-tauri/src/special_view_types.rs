//! Special viewers (Step 07g): the canonical shared types for 3D models,
//! camera RAW, Windows codec images and Photoshop files.
//!
//! Wire structs use snake_case fields (plan/conventions.md 3.1.5). Every
//! field is bounded before a helper is started; the UI mirrors these names
//! in `src/services/specialViews.ts`.

use fs_service::SourceStamp;
use serde::{Deserialize, Serialize};

use cache_store::CacheLease;

/// Largest source any special viewer opens (D3/D7).
pub const SPECIAL_MAX_SOURCE_BYTES: u64 = 256 * 1024 * 1024;
/// Vertex cap for one SafeScene blob (D3).
pub const SPECIAL_MAX_VERTICES: u32 = 2_000_000;
/// Triangle cap for one SafeScene blob (D3).
pub const SPECIAL_MAX_TRIANGLES: u32 = 4_000_000;
/// Objects (nodes) cap in one scene.
pub const SPECIAL_MAX_OBJECTS: u32 = 10_000;
/// Scene-graph depth cap.
pub const SPECIAL_MAX_DEPTH: u32 = 64;
/// Textures referenced by one model.
pub const SPECIAL_MAX_TEXTURES: usize = 32;
/// One decoded texture may not exceed 16 megapixels.
pub const SPECIAL_MAX_TEXTURE_PIXELS: u64 = 16_000_000;
/// All decoded textures of one model together.
pub const SPECIAL_MAX_TEXTURE_BYTES: u64 = 128 * 1024 * 1024;
/// A texture edge used by the helper when it rasterizes uploads.
pub const SPECIAL_MAX_TEXTURE_EDGE: u32 = 16_384;
/// Largest edge accepted by `fullRawPreview` (E3).
pub const SPECIAL_MAX_EDGE: u32 = 16_384;
/// Largest encoded preview the app leases to the UI (full RAW frames).
pub const SPECIAL_MAX_PREVIEW_BYTES: u64 = 64 * 1024 * 1024;
/// Largest decoded raw frame accepted from WIC.
pub const SPECIAL_MAX_DECODED_PIXELS: u64 = 100_000_000;
/// PSD dimension cap (D7): 100 megapixels.
pub const PSD_MAX_PIXELS: u64 = 100_000_000;
/// PSD layer cap.
pub const PSD_MAX_LAYERS: u32 = 1_000;
/// `readPsd` total memory limit (D7).
pub const PSD_MEMORY_LIMIT: u64 = 268_435_456;
/// One layer page.
pub const PSD_LAYER_PAGE: u32 = 256;
/// Serialized layer page cap.
pub const PSD_LAYER_PAGE_BYTES: usize = 768 * 1024;
/// Live special-view sessions in the parent.
pub const MAX_SPECIAL_SESSIONS: usize = 8;
/// Helpers (model + PSD) active at the same time before PDF/book accounting.
pub const MAX_SPECIAL_HELPERS: usize = 2;

/// Which special viewer owns a session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpecialKind {
    Model,
    Raw,
    CodecImage,
    Psd,
}

impl SpecialKind {
    /// Parse the exact wire values; anything else is a bad request.
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "model" => Ok(Self::Model),
            "raw" => Ok(Self::Raw),
            "codec_image" => Ok(Self::CodecImage),
            "psd" => Ok(Self::Psd),
            _ => Err("special_view.bad_request".to_string()),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Model => "model",
            Self::Raw => "raw",
            Self::CodecImage => "codec_image",
            Self::Psd => "psd",
        }
    }

    /// RAWs and codec images produce a picture preview.
    pub fn is_image(self) -> bool {
        matches!(self, Self::Raw | Self::CodecImage)
    }
}

/// Unit a model declares, or none when it declares nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SceneUnit {
    None,
    Mm,
    Cm,
    M,
}

impl SceneUnit {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "none" => Ok(Self::None),
            "mm" => Ok(Self::Mm),
            "cm" => Ok(Self::Cm),
            "m" => Ok(Self::M),
            _ => Err("special_view.bad_request".to_string()),
        }
    }
}

/// A live special-view session (E1). `preview` is a leased PNG only.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecialSession {
    pub session_id: String,
    pub source: SourceStamp,
    pub kind: SpecialKind,
    pub preview: Option<CacheLease>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// The installed codec needed for this file is missing.
    pub codec_required: bool,
    /// Some resources could not be shown; the session is still usable.
    pub partial: bool,
}

/// What `special_view_scene` returns (E2). The geometry blob is owned by
/// the session until `closeSpecialView`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneInfo {
    pub session_id: String,
    pub geometry: CacheLease,
    pub object_count: u32,
    pub vertex_count: u32,
    pub triangle_count: u32,
    /// `[min_x, min_y, min_z, max_x, max_y, max_z]` in source units.
    pub bounds: [f64; 6],
    pub unit: SceneUnit,
    pub textures: Vec<CacheLease>,
    pub partial: bool,
}

/// App-owned material parameters. No shader source ever crosses the wire.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SceneMaterial {
    pub id: u32,
    /// Red, green, blue, alpha in 0..1.
    pub rgba: [f64; 4],
    pub metallic: f64,
    pub roughness: f64,
    pub texture_index: Option<u32>,
    pub double_sided: bool,
}

/// One directory row of a SafeScene1 file. Rust and TypeScript parse the
/// same bytes; no native-layout struct is written to disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SceneSection {
    pub kind: u32,
    pub byte_offset: u64,
    pub byte_len: u64,
    pub count: u32,
    pub stride: u32,
}

/// One node in the flattened scene graph.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SceneNode {
    pub id: u32,
    pub parent: Option<u32>,
    pub primitive_id: Option<u32>,
    /// Column-major local affine matrix; last row is 0, 0, 0, 1.
    pub matrix: [f32; 16],
    pub name: String,
}

/// One draw range over the global vertex/index arrays.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScenePrimitive {
    pub id: u32,
    pub first_vertex: u32,
    pub vertex_count: u32,
    pub first_index: u32,
    pub index_count: u32,
    pub material_id: u32,
}

/// One PSD layer row. No pixel bytes ever travel in this JSON page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PsdLayerInfo {
    /// Stable traversal index.
    pub id: u32,
    pub parent: Option<u32>,
    pub name: String,
    pub visible: bool,
    /// 0..1
    pub opacity: f64,
    pub children_count: u32,
}

/// One bounded page of PSD layer names (E4).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PsdInfo {
    pub session: SpecialSession,
    pub layers: Vec<PsdLayerInfo>,
    pub next_cursor: Option<String>,
    pub complete: bool,
}

/// Saved per-tab model view (D4). Not persisted in settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelViewState {
    pub yaw: f64,
    pub pitch: f64,
    pub distance: f64,
    pub target: [f64; 3],
    pub wireframe: bool,
    pub unit: SceneUnit,
}

/// Saved per-tab image view (D4).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecialImageState {
    pub zoom: u16,
    pub rotation: u16,
    pub layers_open: bool,
    pub full_resolution: bool,
}

/// Validate the exact source-size bound before any parser sees bytes.
pub fn validate_source_size(size: u64) -> Result<(), String> {
    if size == 0 || size > SPECIAL_MAX_SOURCE_BYTES {
        return Err("special_view.too_large".to_string());
    }
    Ok(())
}

/// Validate the six finite bounds and their order.
pub fn validate_bounds(bounds: &[f64; 6]) -> Result<(), String> {
    for value in bounds {
        if !value.is_finite() {
            return Err("special_view.corrupt".to_string());
        }
    }
    if bounds[0] > bounds[3] || bounds[1] > bounds[4] || bounds[2] > bounds[5] {
        return Err("special_view.corrupt".to_string());
    }
    Ok(())
}

/// Validate a column-major local affine matrix from a node record.
pub fn validate_node_matrix(matrix: &[f32; 16]) -> Result<(), String> {
    if !matrix.iter().all(|value| value.is_finite()) {
        return Err("special_view.corrupt".to_string());
    }
    if matrix[3] != 0.0 || matrix[7] != 0.0 || matrix[11] != 0.0 || matrix[15] != 1.0 {
        return Err("special_view.corrupt".to_string());
    }
    Ok(())
}

/// Validate a material record.
pub fn validate_material(material: &SceneMaterial) -> Result<(), String> {
    if material
        .rgba
        .iter()
        .any(|v| !v.is_finite() || *v < 0.0 || *v > 1.0)
        || !material.metallic.is_finite()
        || material.metallic < 0.0
        || material.metallic > 1.0
        || !material.roughness.is_finite()
        || material.roughness < 0.0
        || material.roughness > 1.0
    {
        return Err("special_view.corrupt".to_string());
    }
    if material
        .texture_index
        .is_some_and(|index| index as usize >= SPECIAL_MAX_TEXTURES)
    {
        return Err("special_view.corrupt".to_string());
    }
    Ok(())
}

/// Validate a primitive draw range against the global arrays.
pub fn validate_primitive(
    primitive: &ScenePrimitive,
    vertex_count: u32,
    index_count: u32,
    material_count: u32,
) -> Result<(), String> {
    if primitive.vertex_count == 0
        || primitive.index_count == 0
        || !primitive.index_count.is_multiple_of(3)
        || primitive
            .first_vertex
            .checked_add(primitive.vertex_count)
            .is_none_or(|end| end > vertex_count)
        || primitive
            .first_index
            .checked_add(primitive.index_count)
            .is_none_or(|end| end > index_count)
        || primitive.material_id >= material_count
    {
        return Err("special_view.corrupt".to_string());
    }
    Ok(())
}

/// Validate a saved model view; null/absent state means "fit bounds".
pub fn validate_model_view_state(state: &ModelViewState) -> Result<(), String> {
    if !state.yaw.is_finite()
        || !state.pitch.is_finite()
        || !state.distance.is_finite()
        || state.distance <= 0.0
        || state.distance > 1e9
        || state.target.iter().any(|value| !value.is_finite())
    {
        return Err("special_view.bad_request".to_string());
    }
    Ok(())
}

/// Validate a saved image view.
pub fn validate_special_image_state(state: &SpecialImageState) -> Result<(), String> {
    if !(10..=400).contains(&state.zoom) || !matches!(state.rotation, 0 | 90 | 180 | 270) {
        return Err("special_view.bad_request".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_are_exact_wire_values() {
        for (text, kind) in [
            ("model", SpecialKind::Model),
            ("raw", SpecialKind::Raw),
            ("codec_image", SpecialKind::CodecImage),
            ("psd", SpecialKind::Psd),
        ] {
            assert_eq!(SpecialKind::parse(text), Ok(kind));
        }
        assert_eq!(
            SpecialKind::parse("Model"),
            Err("special_view.bad_request".to_string())
        );
    }

    #[test]
    fn non_finite_bounds_and_matrices_are_refused() {
        assert!(validate_bounds(&[0.0, 0.0, 0.0, f64::NAN, 1.0, 1.0]).is_err());
        assert!(validate_bounds(&[2.0, 0.0, 0.0, 1.0, 1.0, 1.0]).is_err());
        let mut matrix = [0.0f32; 16];
        matrix[0] = 1.0;
        matrix[5] = 1.0;
        matrix[10] = 1.0;
        matrix[15] = 1.0;
        assert!(validate_node_matrix(&matrix).is_ok());
        matrix[3] = f32::INFINITY;
        assert!(validate_node_matrix(&matrix).is_err());
    }

    #[test]
    fn source_and_material_caps_hold() {
        assert!(validate_source_size(0).is_err());
        assert!(validate_source_size(SPECIAL_MAX_SOURCE_BYTES + 1).is_err());
        assert!(validate_source_size(SPECIAL_MAX_SOURCE_BYTES).is_ok());
        let material = SceneMaterial {
            id: 0,
            rgba: [0.0, 0.0, 0.0, 1.0],
            metallic: 0.0,
            roughness: 1.0,
            texture_index: Some(32),
            double_sided: false,
        };
        assert!(validate_material(&material).is_err());
    }
}
