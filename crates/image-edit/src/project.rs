//! Guarded editable image projects (Step 18b T5, `image-project-1`).
//!
//! `.adimage` is a ZIP with a strict entry allowlist:
//!
//! - `document.json` (required, bounded),
//! - `tiles/<uuid>.rgba.zst` (RGBA8, row-major),
//! - `masks/<uuid>.alpha.zst` (alpha8, row-major),
//! - `metadata/<category>.bin` (optional, validated category),
//! - `extensions/<name>.bin` (opaque, namespaced, never executed).
//!
//! No staging unpack, no symlinks, no traversal, no duplicate entries and no
//! unreferenced entries. ZIP stores already-compressed tile entries without a
//! second compression layer. The manifest never contains a path, a grant, a
//! token or an `ExportSnapshot`.

use std::collections::{HashMap, HashSet};
use std::fmt;
use std::io::{Cursor, Read, Write};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::project_tiles::{compress_tile, decompress_tile, MAX_TILE_COMPRESSED_BYTES};
use crate::types::{
    Affine2D, ImageAdjustments, ImageGeometry, ImageOverlay, ImageSize, Rect, TileRef,
};

pub const PROJECT_SCHEMA_VERSION: u32 = 1;
pub const MAX_ARCHIVE_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_DECODED_TILE_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_ENTRIES: usize = 100_000;
pub const MAX_LAYERS: usize = 256;
pub const MAX_GUIDES: usize = 1_000;
pub const MAX_EXTENSIONS: usize = 64;
pub const MAX_EXTENSION_BYTES: u64 = 1024 * 1024;
pub const MAX_EXTENSIONS_BYTES: u64 = 16 * 1024 * 1024;
pub const MAX_METADATA_BYTES: u64 = 16 * 1024 * 1024;
pub const MAX_JSON_BYTES: usize = 16 * 1024 * 1024;
/// Every decoded payload one project may deliver through a bounded channel:
/// all tile bytes plus the total metadata and extension budgets.
pub const MAX_PROJECT_PAYLOAD_BYTES: u64 =
    MAX_DECODED_TILE_BYTES + MAX_METADATA_BYTES + MAX_EXTENSIONS_BYTES;
pub const MAX_ZIP_RATIO: u64 = 1_000;
pub const MAX_PIXELS: u64 = 100_000_000;
pub const MAX_EDGE: u32 = 32_768;

pub const METADATA_CATEGORIES: &[&str] = &[
    "exif",
    "gps",
    "camera",
    "date",
    "icc",
    "xmp",
    "iptc",
    "author",
    "comments",
    "attachments",
    "forms",
    "annotations",
    "scripts",
    "timestamps",
];

const BLEND_MODES: &[&str] = &[
    "normal",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "difference",
    "add",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectError {
    BadRequest,
    UnsupportedSchema,
    UnknownRequired,
    TooLarge,
    Corrupt,
    Changed,
    Failed,
}

impl ProjectError {
    pub fn code(self) -> &'static str {
        match self {
            ProjectError::BadRequest => "image_project.bad_request",
            ProjectError::UnsupportedSchema => "image_project.unsupported_schema",
            ProjectError::UnknownRequired => "image_project.unknown_required",
            ProjectError::TooLarge => "image_project.too_large",
            ProjectError::Corrupt => "image_project.corrupt",
            ProjectError::Changed => "image_project.changed",
            ProjectError::Failed => "image_project.failed",
        }
    }
}

impl fmt::Display for ProjectError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code())
    }
}

impl std::error::Error for ProjectError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GuideAxis {
    X,
    Y,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Guide {
    pub x_or_y: GuideAxis,
    pub position: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectTileKind {
    Rgba,
    Alpha,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectTile {
    pub id: Uuid,
    pub path: String,
    pub kind: ProjectTileKind,
    pub width: u32,
    pub height: u32,
    pub raw_bytes: u64,
    pub compressed_bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectMetadataEntry {
    pub category: String,
    pub path: String,
    pub byte_len: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectExtension {
    pub name: String,
    pub required: bool,
    pub path: String,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImageProjectManifest {
    pub schema_version: u32,
    pub project_id: Uuid,
    pub width: u32,
    pub height: u32,
    pub dpi: u32,
    pub layers: Vec<Value>,
    pub masks: Vec<Value>,
    pub geometry: ImageGeometry,
    pub adjustments: ImageAdjustments,
    pub overlays: Vec<ImageOverlay>,
    pub tiles: Vec<ProjectTile>,
    pub original_tile_ids: Vec<Uuid>,
    pub guides: Vec<Guide>,
    pub metadata_entries: Vec<ProjectMetadataEntry>,
    pub extensions: Vec<ProjectExtension>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImageProjectInfo {
    pub project_id: Uuid,
    pub width: u32,
    pub height: u32,
    pub layer_count: u32,
    pub unsupported_features: Vec<String>,
    pub editable: bool,
}

#[derive(Debug, Default)]
pub struct ProjectPayloads {
    pub tiles: Vec<(Uuid, Vec<u8>)>,
    pub metadata: Vec<(String, Vec<u8>)>,
    pub extensions: Vec<(String, Vec<u8>)>,
}

#[derive(Debug)]
pub struct OpenedProject {
    pub manifest: ImageProjectManifest,
    pub info: ImageProjectInfo,
    pub payloads: ProjectPayloads,
}

type TileReferenceList = Vec<(Uuid, u32, u32)>;

fn bad<T>() -> Result<T, ProjectError> {
    Err(ProjectError::BadRequest)
}

fn corrupt<T>() -> Result<T, ProjectError> {
    Err(ProjectError::Corrupt)
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut output = String::with_capacity(64);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(&mut output, "{byte:02x}");
    }
    output
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

fn is_extension_name(value: &str) -> bool {
    if value.len() < 3
        || value.len() > 128
        || !value.starts_with(|first: char| first.is_ascii_lowercase())
    {
        return false;
    }
    let parts: Vec<&str> = value.split('.').collect();
    if parts.len() < 2 {
        return false;
    }
    parts.iter().all(|part| {
        !part.is_empty()
            && part.starts_with(|first: char| first.is_ascii_lowercase())
            && part
                .bytes()
                .all(|byte| matches!(byte, b'a'..=b'z' | b'0'..=b'9' | b'-'))
    })
}

fn is_category(value: &str) -> bool {
    METADATA_CATEGORIES.contains(&value)
}

fn tile_path(id: Uuid, kind: ProjectTileKind) -> String {
    match kind {
        ProjectTileKind::Rgba => format!("tiles/{}.rgba.zst", id),
        ProjectTileKind::Alpha => format!("masks/{}.alpha.zst", id),
    }
}

fn metadata_path(category: &str) -> String {
    format!("metadata/{category}.bin")
}

fn extension_path(name: &str) -> String {
    format!("extensions/{name}.bin")
}

fn get<'a>(
    object: &'a serde_json::Map<String, Value>,
    key: &str,
) -> Result<&'a Value, ProjectError> {
    object.get(key).ok_or(ProjectError::BadRequest)
}

fn get_str<'a>(
    object: &'a serde_json::Map<String, Value>,
    key: &str,
) -> Result<&'a str, ProjectError> {
    get(object, key)?.as_str().ok_or(ProjectError::BadRequest)
}

fn get_uuid(object: &serde_json::Map<String, Value>, key: &str) -> Result<Uuid, ProjectError> {
    let raw = get_str(object, key)?;
    Uuid::parse_str(raw).map_err(|_| ProjectError::BadRequest)
}

fn get_bool(object: &serde_json::Map<String, Value>, key: &str) -> Result<bool, ProjectError> {
    get(object, key)?.as_bool().ok_or(ProjectError::BadRequest)
}

fn get_f64(object: &serde_json::Map<String, Value>, key: &str) -> Result<f64, ProjectError> {
    let value = get(object, key)?.as_f64().ok_or(ProjectError::BadRequest)?;
    if value.is_finite() {
        Ok(value)
    } else {
        bad()
    }
}

fn get_u32(object: &serde_json::Map<String, Value>, key: &str) -> Result<u32, ProjectError> {
    let value = get(object, key)?.as_u64().ok_or(ProjectError::BadRequest)?;
    u32::try_from(value).map_err(|_| ProjectError::BadRequest)
}

fn validate_color(value: &Value) -> Result<(), ProjectError> {
    let array = value.as_array().ok_or(ProjectError::BadRequest)?;
    if array.len() != 4 {
        return bad();
    }
    for channel in array {
        let value = channel.as_u64().ok_or(ProjectError::BadRequest)?;
        if value > 255 {
            return bad();
        }
    }
    Ok(())
}

fn validate_curves(points: &Value) -> Result<(), ProjectError> {
    let array = points.as_array().ok_or(ProjectError::BadRequest)?;
    if array.len() < 2 || array.len() > 32 {
        return bad();
    }
    let mut previous = f64::NEG_INFINITY;
    for point in array {
        let object = point.as_object().ok_or(ProjectError::BadRequest)?;
        let x = get_f64(object, "x")?;
        let y = get_f64(object, "y")?;
        if !(0.0..=1.0).contains(&x) || !(0.0..=1.0).contains(&y) || x <= previous {
            return bad();
        }
        previous = x;
    }
    let first = array[0].as_object().ok_or(ProjectError::BadRequest)?;
    let last = array[array.len() - 1]
        .as_object()
        .ok_or(ProjectError::BadRequest)?;
    if get_f64(first, "x")?.abs() > 1e-9 || (get_f64(last, "x")? - 1.0).abs() > 1e-9 {
        return bad();
    }
    Ok(())
}

fn validate_adjustment(value: &Value) -> Result<(), ProjectError> {
    let object = value.as_object().ok_or(ProjectError::BadRequest)?;
    match get_str(object, "kind")? {
        "curves" => validate_curves(get(object, "points")?),
        "levels" => {
            let black = get_f64(object, "black")?;
            let white = get_f64(object, "white")?;
            let gamma = get_f64(object, "gamma")?;
            if !(0.0..=1.0).contains(&black) || !(0.0..=1.0).contains(&white) || white <= black {
                return bad();
            }
            if !(0.1..=10.0).contains(&gamma) {
                return bad();
            }
            Ok(())
        }
        "hue_saturation" => {
            let hue = get_f64(object, "hue_degrees")?;
            let saturation = get_f64(object, "saturation")?;
            let lightness = get_f64(object, "lightness")?;
            if !(-180.0..=180.0).contains(&hue)
                || !(-1.0..=1.0).contains(&saturation)
                || !(-1.0..=1.0).contains(&lightness)
            {
                return bad();
            }
            Ok(())
        }
        "color_balance" => {
            for key in ["shadows", "midtones", "highlights"] {
                let array = get(object, key)?
                    .as_array()
                    .ok_or(ProjectError::BadRequest)?;
                if array.len() != 3 {
                    return bad();
                }
                for channel in array {
                    let value = channel.as_f64().ok_or(ProjectError::BadRequest)?;
                    if !(-1.0..=1.0).contains(&value) {
                        return bad();
                    }
                }
            }
            Ok(())
        }
        "gaussian" => {
            let radius = get_f64(object, "radius")?;
            if !(0.0..=64.0).contains(&radius) {
                return bad();
            }
            Ok(())
        }
        "unsharp" => {
            let radius = get_f64(object, "radius")?;
            let amount = get_f64(object, "amount")?;
            if !(0.0..=64.0).contains(&radius) || !(0.0..=2.0).contains(&amount) {
                return bad();
            }
            Ok(())
        }
        "noise_reduce" => {
            let radius = get_u32(object, "radius")?;
            let strength = get_f64(object, "strength")?;
            if !(1..=8).contains(&radius) || !(0.0..=1.0).contains(&strength) {
                return bad();
            }
            Ok(())
        }
        "artistic" => {
            let mode = get_str(object, "mode")?;
            let amount = get_f64(object, "amount")?;
            if !["posterize", "emboss", "pixelate"].contains(&mode)
                || !(1.0..=64.0).contains(&amount)
            {
                return bad();
            }
            Ok(())
        }
        _ => bad(),
    }
}

fn validate_layer(
    value: &Value,
    canvas: ImageSize,
) -> Result<(Uuid, TileReferenceList), ProjectError> {
    let object = value.as_object().ok_or(ProjectError::BadRequest)?;
    let kind = get_str(object, "kind")?;
    let id = get_uuid(object, "id")?;
    let name = get_str(object, "name")?;
    let name_len = name.chars().count();
    if !(1..=128).contains(&name_len) {
        return bad();
    }
    get_bool(object, "visible")?;
    get_bool(object, "locked")?;
    let opacity = get_f64(object, "opacity")?;
    if !(0.0..=1.0).contains(&opacity) {
        return bad();
    }
    let blend = get_str(object, "blend")?;
    if !BLEND_MODES.contains(&blend) {
        return bad();
    }
    let transform: Affine2D = serde_json::from_value(get(object, "transform")?.clone())
        .map_err(|_| ProjectError::BadRequest)?;
    transform
        .validate(true)
        .map_err(|_| ProjectError::BadRequest)?;
    match get(object, "mask_id")? {
        Value::Null => {}
        Value::String(raw) => {
            Uuid::parse_str(raw).map_err(|_| ProjectError::BadRequest)?;
        }
        _ => return bad(),
    }
    match kind {
        "raster" => {
            let array = get(object, "tiles")?
                .as_array()
                .ok_or(ProjectError::BadRequest)?;
            let mut ids = Vec::with_capacity(array.len());
            for tile in array {
                let reference: TileRef =
                    serde_json::from_value(tile.clone()).map_err(|_| ProjectError::BadRequest)?;
                reference.validate().map_err(|_| ProjectError::BadRequest)?;
                ids.push((
                    Uuid::parse_str(&reference.id).map_err(|_| ProjectError::BadRequest)?,
                    reference.width,
                    reference.height,
                ));
            }
            Ok((id, ids))
        }
        "text" => {
            let text = get_str(object, "text")?;
            if text.chars().count() > 10_000 {
                return bad();
            }
            let font = get_str(object, "font_asset_id")?;
            if font.is_empty() || font.len() > 128 {
                return bad();
            }
            let size = get_f64(object, "font_size")?;
            if !(1.0..=512.0).contains(&size) {
                return bad();
            }
            validate_color(get(object, "color")?)?;
            let bounds: Rect = serde_json::from_value(get(object, "bounds")?.clone())
                .map_err(|_| ProjectError::BadRequest)?;
            bounds.validate().map_err(|_| ProjectError::BadRequest)?;
            if !["left", "center", "right"].contains(&get_str(object, "align")?) {
                return bad();
            }
            Ok((id, Vec::new()))
        }
        "shape" => {
            let overlay: ImageOverlay = serde_json::from_value(get(object, "overlay")?.clone())
                .map_err(|_| ProjectError::BadRequest)?;
            overlay
                .validate(canvas)
                .map_err(|_| ProjectError::BadRequest)?;
            Ok((id, Vec::new()))
        }
        "adjustment" => {
            validate_adjustment(get(object, "adjustment")?)?;
            Ok((id, Vec::new()))
        }
        _ => bad(),
    }
}

fn validate_mask(
    value: &Value,
    width: u32,
    height: u32,
) -> Result<(Uuid, TileReferenceList), ProjectError> {
    let object = value.as_object().ok_or(ProjectError::BadRequest)?;
    let id = get_uuid(object, "id")?;
    if get_u32(object, "width")? != width || get_u32(object, "height")? != height {
        return bad();
    }
    get_bool(object, "inverted")?;
    let array = get(object, "tiles")?
        .as_array()
        .ok_or(ProjectError::BadRequest)?;
    let mut ids = Vec::with_capacity(array.len());
    for tile in array {
        let tile = tile.as_object().ok_or(ProjectError::BadRequest)?;
        let tile_id = get_uuid(tile, "id")?;
        let tile_x = get_u32(tile, "tile_x")?;
        let tile_y = get_u32(tile, "tile_y")?;
        let tile_width = get_u32(tile, "width")?;
        let tile_height = get_u32(tile, "height")?;
        let generation = get_u32(tile, "generation")?;
        if tile_width == 0 || tile_height == 0 || tile_width > 256 || tile_height > 256 {
            return bad();
        }
        if tile_x
            .checked_add(tile_width)
            .is_none_or(|right| right > width)
            || tile_y
                .checked_add(tile_height)
                .is_none_or(|bottom| bottom > height)
            || generation == 0
        {
            return bad();
        }
        ids.push((tile_id, tile_width, tile_height));
    }
    Ok((id, ids))
}

fn validate_tile(tile: &ProjectTile) -> Result<(), ProjectError> {
    if tile.kind == ProjectTileKind::Rgba {
        if tile.width == 0 || tile.height == 0 || tile.width > 256 || tile.height > 256 {
            return bad();
        }
        if tile.raw_bytes != u64::from(tile.width) * u64::from(tile.height) * 4 {
            return bad();
        }
    } else {
        if tile.width == 0 || tile.height == 0 || tile.width > 256 || tile.height > 256 {
            return bad();
        }
        if tile.raw_bytes != u64::from(tile.width) * u64::from(tile.height) {
            return bad();
        }
    }
    if tile.compressed_bytes == 0 || tile.compressed_bytes > MAX_TILE_COMPRESSED_BYTES {
        return Err(ProjectError::TooLarge);
    }
    if tile.path != tile_path(tile.id, tile.kind) {
        return bad();
    }
    if !is_sha256(&tile.sha256) {
        return bad();
    }
    Ok(())
}

fn validate_manifest(manifest: &ImageProjectManifest) -> Result<(), ProjectError> {
    if manifest.schema_version != PROJECT_SCHEMA_VERSION {
        return if manifest.schema_version > PROJECT_SCHEMA_VERSION {
            Err(ProjectError::UnsupportedSchema)
        } else {
            bad()
        };
    }
    if manifest.width == 0
        || manifest.height == 0
        || manifest.width > MAX_EDGE
        || manifest.height > MAX_EDGE
    {
        return bad();
    }
    if u64::from(manifest.width) * u64::from(manifest.height) > MAX_PIXELS {
        return Err(ProjectError::TooLarge);
    }
    if !(1..=2400).contains(&manifest.dpi) {
        return bad();
    }
    let size = ImageSize {
        width: manifest.width,
        height: manifest.height,
    };
    manifest
        .geometry
        .validate(size)
        .map_err(|_| ProjectError::BadRequest)?;
    manifest
        .adjustments
        .validate()
        .map_err(|_| ProjectError::BadRequest)?;
    if manifest.layers.is_empty() || manifest.layers.len() > MAX_LAYERS {
        return bad();
    }
    let mut layer_ids = HashSet::new();
    let mut referenced_tiles = HashSet::new();
    let mut tile_refs = Vec::new();
    for layer in &manifest.layers {
        let (id, tiles) = validate_layer(layer, manifest.geometry.output_size)?;
        if !layer_ids.insert(id) {
            return bad();
        }
        for (tile_id, width, height) in tiles {
            referenced_tiles.insert(tile_id);
            tile_refs.push((tile_id, width, height));
        }
    }
    if manifest.masks.len() > MAX_LAYERS {
        return bad();
    }
    let mut mask_ids = HashSet::new();
    let mut referenced_masks = HashSet::new();
    let mut mask_refs = Vec::new();
    for mask in &manifest.masks {
        let (id, tiles) = validate_mask(mask, manifest.width, manifest.height)?;
        if !mask_ids.insert(id) {
            return bad();
        }
        for (tile_id, width, height) in tiles {
            referenced_masks.insert(tile_id);
            mask_refs.push((tile_id, width, height));
        }
    }
    for layer in &manifest.layers {
        let object = layer.as_object().ok_or(ProjectError::BadRequest)?;
        if let Some(Value::String(raw)) = object.get("mask_id") {
            let id = Uuid::parse_str(raw).map_err(|_| ProjectError::BadRequest)?;
            if !mask_ids.contains(&id) {
                return bad();
            }
        }
    }
    if manifest.overlays.len() > 10_000 {
        return bad();
    }
    for overlay in &manifest.overlays {
        overlay
            .validate(manifest.geometry.output_size)
            .map_err(|_| ProjectError::BadRequest)?;
    }
    if manifest.guides.len() > MAX_GUIDES {
        return Err(ProjectError::TooLarge);
    }
    for guide in &manifest.guides {
        if !guide.position.is_finite() {
            return bad();
        }
        let maximum = match guide.x_or_y {
            GuideAxis::X => manifest.width,
            GuideAxis::Y => manifest.height,
        };
        if guide.position < 0.0 || guide.position > f64::from(maximum) {
            return bad();
        }
    }
    let mut tile_ids = HashSet::new();
    let mut decoded = 0u64;
    for tile in &manifest.tiles {
        validate_tile(tile)?;
        if !tile_ids.insert(tile.id) {
            return bad();
        }
        decoded = decoded.saturating_add(tile.raw_bytes);
        if decoded > MAX_DECODED_TILE_BYTES {
            return Err(ProjectError::TooLarge);
        }
    }
    let tile_by_id: HashMap<Uuid, &ProjectTile> =
        manifest.tiles.iter().map(|tile| (tile.id, tile)).collect();
    if manifest.original_tile_ids.is_empty() {
        return bad();
    }
    let mut originals = HashSet::new();
    for id in &manifest.original_tile_ids {
        if !originals.insert(*id) {
            return bad();
        }
        let tile = tile_by_id.get(id);
        match tile {
            Some(tile) if tile.kind == ProjectTileKind::Rgba => {}
            _ => return bad(),
        }
    }
    for (id, width, height) in &tile_refs {
        let tile = tile_by_id.get(id);
        match tile {
            Some(tile)
                if tile.kind == ProjectTileKind::Rgba
                    && tile.width == *width
                    && tile.height == *height => {}
            _ => return bad(),
        }
    }
    for (id, width, height) in &mask_refs {
        let tile = tile_by_id.get(id);
        match tile {
            Some(tile)
                if tile.kind == ProjectTileKind::Alpha
                    && tile.width == *width
                    && tile.height == *height => {}
            _ => return bad(),
        }
    }
    let referenced: HashSet<Uuid> = referenced_tiles
        .iter()
        .chain(referenced_masks.iter())
        .chain(originals.iter())
        .copied()
        .collect();
    if referenced.len() != tile_ids.len() {
        return bad();
    }
    let mut metadata = 0u64;
    let mut metadata_paths = HashSet::new();
    for entry in &manifest.metadata_entries {
        if !is_category(&entry.category) {
            return bad();
        }
        if entry.path != metadata_path(&entry.category)
            || !metadata_paths.insert(entry.path.clone())
        {
            return bad();
        }
        if entry.byte_len == 0 || entry.byte_len > MAX_METADATA_BYTES {
            return Err(ProjectError::TooLarge);
        }
        if !is_sha256(&entry.sha256) {
            return bad();
        }
        metadata = metadata.saturating_add(entry.byte_len);
        if metadata > MAX_METADATA_BYTES {
            return Err(ProjectError::TooLarge);
        }
    }
    if manifest.extensions.len() > MAX_EXTENSIONS {
        return Err(ProjectError::TooLarge);
    }
    let mut extension_names = HashSet::new();
    for extension in &manifest.extensions {
        if !is_extension_name(&extension.name) {
            return bad();
        }
        if extension.path != extension_path(&extension.name)
            || !extension_names.insert(extension.name.clone())
        {
            return bad();
        }
        if !is_sha256(&extension.sha256) {
            return bad();
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EntryKind {
    Document,
    Tile,
    Metadata,
    Extension,
}

fn classify_entry(name: &str) -> Result<EntryKind, ProjectError> {
    if name == "document.json" {
        return Ok(EntryKind::Document);
    }
    if let Some(rest) = name.strip_prefix("tiles/") {
        let raw = rest
            .strip_suffix(".rgba.zst")
            .ok_or(ProjectError::Corrupt)?;
        let id = Uuid::parse_str(raw).map_err(|_| ProjectError::Corrupt)?;
        if id.to_string() != raw {
            return corrupt();
        }
        return Ok(EntryKind::Tile);
    }
    if let Some(rest) = name.strip_prefix("masks/") {
        let raw = rest
            .strip_suffix(".alpha.zst")
            .ok_or(ProjectError::Corrupt)?;
        let id = Uuid::parse_str(raw).map_err(|_| ProjectError::Corrupt)?;
        if id.to_string() != raw {
            return corrupt();
        }
        return Ok(EntryKind::Tile);
    }
    if let Some(rest) = name.strip_prefix("metadata/") {
        let category = rest.strip_suffix(".bin").ok_or(ProjectError::Corrupt)?;
        if !is_category(category) {
            return corrupt();
        }
        return Ok(EntryKind::Metadata);
    }
    if let Some(rest) = name.strip_prefix("extensions/") {
        let extension = rest.strip_suffix(".bin").ok_or(ProjectError::Corrupt)?;
        if !is_extension_name(extension) {
            return corrupt();
        }
        return Ok(EntryKind::Extension);
    }
    corrupt()
}

fn read_entry(
    archive: &mut zip::ZipArchive<Cursor<&[u8]>>,
    index: usize,
    limit: u64,
) -> Result<Vec<u8>, ProjectError> {
    let mut entry = archive.by_index(index).map_err(|_| ProjectError::Corrupt)?;
    let size = entry.size();
    if size > limit {
        return Err(ProjectError::TooLarge);
    }
    if size > 0 {
        let compressed = entry.compressed_size();
        if compressed == 0 {
            return corrupt();
        }
        // Stored entries have equal sizes; a deflated JSON/metadata entry must
        // stay within the bounded expansion ratio.
        if compressed != size && size / compressed > MAX_ZIP_RATIO {
            return Err(ProjectError::TooLarge);
        }
    }
    let mut bytes = Vec::with_capacity(size as usize);
    entry
        .read_to_end(&mut bytes)
        .map_err(|_| ProjectError::Corrupt)?;
    if bytes.len() as u64 != size {
        return corrupt();
    }
    Ok(bytes)
}

/// Reads and validates one guarded project. Every entry, hash, length and
/// dimension is checked before a payload is decoded or returned.
pub fn decode_project(bytes: &[u8]) -> Result<OpenedProject, ProjectError> {
    decode_project_with_payloads(bytes, true)
}

/// Validates one guarded project without retaining tile, metadata or
/// extension payload bytes. Each tile is still decoded to its declared exact
/// length, so a zstd bomb or a hash mismatch is refused; only the per-tile
/// buffer is live at a time.
pub fn inspect_project(bytes: &[u8]) -> Result<OpenedProject, ProjectError> {
    decode_project_with_payloads(bytes, false)
}

fn decode_project_with_payloads(
    bytes: &[u8],
    retain_payloads: bool,
) -> Result<OpenedProject, ProjectError> {
    if bytes.is_empty() {
        return bad();
    }
    if bytes.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err(ProjectError::TooLarge);
    }
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| ProjectError::Corrupt)?;
    if archive.len() > MAX_ENTRIES {
        return Err(ProjectError::TooLarge);
    }
    let mut by_name: HashMap<String, usize> = HashMap::new();
    let mut document_index = None;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|_| ProjectError::Corrupt)?;
        if entry.is_dir() || entry.is_symlink() {
            return corrupt();
        }
        let name = entry.name().map_err(|_| ProjectError::Corrupt)?;
        if name.contains('\\')
            || name.starts_with('/')
            || name.split('/').any(|part| part == ".." || part.is_empty())
        {
            return corrupt();
        }
        let kind = classify_entry(&name)?;
        if by_name.insert(name.to_string(), index).is_some() {
            return corrupt();
        }
        if matches!(kind, EntryKind::Document) && document_index.replace(index).is_some() {
            return corrupt();
        }
    }
    let document_index = document_index.ok_or(ProjectError::Corrupt)?;
    let document = read_entry(&mut archive, document_index, MAX_JSON_BYTES as u64)?;
    let manifest: ImageProjectManifest =
        serde_json::from_slice(&document).map_err(|_| ProjectError::Corrupt)?;
    validate_manifest(&manifest)?;

    let mut payload_tiles = HashMap::new();
    let mut used = HashSet::new();
    used.insert(document_index);
    for tile in &manifest.tiles {
        let expected = tile_path(tile.id, tile.kind);
        let index = *by_name.get(&expected).ok_or(ProjectError::Corrupt)?;
        if !used.insert(index) {
            return corrupt();
        }
        let (size, compressed_size) = {
            let entry = archive.by_index(index).map_err(|_| ProjectError::Corrupt)?;
            (entry.size(), entry.compressed_size())
        };
        if size != tile.compressed_bytes || compressed_size != tile.compressed_bytes {
            return corrupt();
        }
        let compressed = read_entry(&mut archive, index, tile.compressed_bytes)?;
        if sha256_hex(&compressed) != tile.sha256 {
            return corrupt();
        }
        let raw = decompress_tile(&compressed, tile.raw_bytes)?;
        if retain_payloads {
            payload_tiles.insert(tile.id, raw);
        }
    }
    let mut payload_metadata = Vec::new();
    for entry in &manifest.metadata_entries {
        let index = *by_name.get(&entry.path).ok_or(ProjectError::Corrupt)?;
        if !used.insert(index) {
            return corrupt();
        }
        let bytes = read_entry(&mut archive, index, entry.byte_len)?;
        if bytes.len() as u64 != entry.byte_len || sha256_hex(&bytes) != entry.sha256 {
            return corrupt();
        }
        if retain_payloads {
            payload_metadata.push((entry.category.clone(), bytes));
        }
    }
    let mut payload_extensions = Vec::new();
    let mut extension_bytes = 0u64;
    for extension in &manifest.extensions {
        let index = *by_name.get(&extension.path).ok_or(ProjectError::Corrupt)?;
        if !used.insert(index) {
            return corrupt();
        }
        let bytes = read_entry(&mut archive, index, MAX_EXTENSION_BYTES)?;
        extension_bytes = extension_bytes.saturating_add(bytes.len() as u64);
        if extension_bytes > MAX_EXTENSIONS_BYTES {
            return Err(ProjectError::TooLarge);
        }
        if sha256_hex(&bytes) != extension.sha256 {
            return corrupt();
        }
        if retain_payloads {
            payload_extensions.push((extension.name.clone(), bytes));
        }
    }
    if used.len() != archive.len() {
        return corrupt();
    }
    let mut payloads = ProjectPayloads::default();
    if retain_payloads {
        for tile in &manifest.tiles {
            let raw = payload_tiles
                .remove(&tile.id)
                .ok_or(ProjectError::Corrupt)?;
            payloads.tiles.push((tile.id, raw));
        }
        payloads.metadata = payload_metadata;
        payloads.extensions = payload_extensions;
    }
    let required = manifest
        .extensions
        .iter()
        .any(|extension| extension.required);
    let mut unsupported = Vec::new();
    if required {
        unsupported.push("required_extension".to_string());
    }
    let info = ImageProjectInfo {
        project_id: manifest.project_id,
        width: manifest.width,
        height: manifest.height,
        layer_count: manifest.layers.len() as u32,
        unsupported_features: unsupported,
        editable: !required,
    };
    Ok(OpenedProject {
        manifest,
        info,
        payloads,
    })
}

fn fixed_options() -> Result<zip::write::SimpleFileOptions, ProjectError> {
    let date =
        zip::DateTime::from_date_and_time(1980, 1, 1, 0, 0, 0).map_err(|_| ProjectError::Failed)?;
    Ok(zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored)
        .last_modified_time(date))
}

/// Writes one guarded project. Tile descriptors are recomputed from the
/// supplied payloads, then the whole manifest is revalidated before writing.
pub fn encode_project(
    manifest: &ImageProjectManifest,
    payloads: &ProjectPayloads,
) -> Result<Vec<u8>, ProjectError> {
    if manifest.schema_version != PROJECT_SCHEMA_VERSION {
        return Err(ProjectError::UnsupportedSchema);
    }
    let mut tile_payloads: HashMap<Uuid, &[u8]> = HashMap::new();
    for (id, bytes) in &payloads.tiles {
        if tile_payloads.insert(*id, bytes.as_slice()).is_some() {
            return bad();
        }
    }
    if tile_payloads.len() != manifest.tiles.len() {
        return bad();
    }
    let mut tiles = manifest.tiles.clone();
    for tile in &mut tiles {
        let raw = tile_payloads
            .get(&tile.id)
            .ok_or(ProjectError::BadRequest)?;
        let expected_kind = match tile.kind {
            ProjectTileKind::Rgba => u64::from(tile.width) * u64::from(tile.height) * 4,
            ProjectTileKind::Alpha => u64::from(tile.width) * u64::from(tile.height),
        };
        if raw.len() as u64 != expected_kind {
            return bad();
        }
        let compressed = compress_tile(raw)?;
        tile.raw_bytes = raw.len() as u64;
        tile.compressed_bytes = compressed.len() as u64;
        tile.sha256 = sha256_hex(&compressed);
        tile.path = tile_path(tile.id, tile.kind);
    }
    let mut metadata_payloads: HashMap<String, &[u8]> = HashMap::new();
    for (category, bytes) in &payloads.metadata {
        if metadata_payloads
            .insert(category.clone(), bytes.as_slice())
            .is_some()
        {
            return bad();
        }
    }
    if metadata_payloads.len() != manifest.metadata_entries.len() {
        return bad();
    }
    for entry in &manifest.metadata_entries {
        let bytes = metadata_payloads
            .get(&entry.category)
            .ok_or(ProjectError::BadRequest)?;
        if bytes.len() as u64 != entry.byte_len || sha256_hex(bytes) != entry.sha256 {
            return Err(ProjectError::Changed);
        }
    }
    let mut extension_payloads: HashMap<String, &[u8]> = HashMap::new();
    for (name, bytes) in &payloads.extensions {
        if extension_payloads
            .insert(name.clone(), bytes.as_slice())
            .is_some()
        {
            return bad();
        }
    }
    if extension_payloads.len() != manifest.extensions.len() {
        return bad();
    }
    let mut extension_bytes = 0u64;
    for extension in &manifest.extensions {
        let bytes = extension_payloads
            .get(&extension.name)
            .ok_or(ProjectError::BadRequest)?;
        if bytes.len() as u64 > MAX_EXTENSION_BYTES {
            return Err(ProjectError::TooLarge);
        }
        if sha256_hex(bytes) != extension.sha256 {
            return Err(ProjectError::Changed);
        }
        extension_bytes = extension_bytes.saturating_add(bytes.len() as u64);
        if extension_bytes > MAX_EXTENSIONS_BYTES {
            return Err(ProjectError::TooLarge);
        }
    }
    let final_manifest = ImageProjectManifest {
        tiles,
        ..manifest.clone()
    };
    validate_manifest(&final_manifest)?;
    let document = serde_json::to_vec(&final_manifest).map_err(|_| ProjectError::Failed)?;
    if document.len() > MAX_JSON_BYTES {
        return Err(ProjectError::TooLarge);
    }
    let mut output = Cursor::new(Vec::new());
    {
        let mut writer = zip::ZipWriter::new(&mut output);
        for (name, bytes) in build_entries(&final_manifest, &document, payloads)? {
            writer
                .start_file(name, fixed_options()?)
                .map_err(|_| ProjectError::Failed)?;
            writer.write_all(&bytes).map_err(|_| ProjectError::Failed)?;
        }
        writer.finish().map_err(|_| ProjectError::Failed)?;
    }
    let bytes = output.into_inner();
    if bytes.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err(ProjectError::TooLarge);
    }
    Ok(bytes)
}

fn build_entries(
    manifest: &ImageProjectManifest,
    document: &[u8],
    payloads: &ProjectPayloads,
) -> Result<Vec<(String, Vec<u8>)>, ProjectError> {
    let mut entries = vec![("document.json".to_string(), document.to_vec())];
    let mut tile_payloads: HashMap<Uuid, &[u8]> = payloads
        .tiles
        .iter()
        .map(|(id, bytes)| (*id, bytes.as_slice()))
        .collect();
    let mut tiles = manifest.tiles.clone();
    tiles.sort_by(|left, right| left.path.cmp(&right.path));
    for tile in tiles {
        let raw = tile_payloads
            .remove(&tile.id)
            .ok_or(ProjectError::BadRequest)?;
        let compressed = compress_tile(raw)?;
        if compressed.len() as u64 != tile.compressed_bytes
            || sha256_hex(&compressed) != tile.sha256
        {
            return Err(ProjectError::Failed);
        }
        entries.push((tile.path.clone(), compressed));
    }
    if !tile_payloads.is_empty() {
        return bad();
    }
    let mut metadata = payloads.metadata.clone();
    metadata.sort_by(|left, right| left.0.cmp(&right.0));
    for (category, bytes) in metadata {
        entries.push((metadata_path(&category), bytes));
    }
    let mut extensions = payloads.extensions.clone();
    extensions.sort_by(|left, right| left.0.cmp(&right.0));
    for (name, bytes) in extensions {
        entries.push((extension_path(&name), bytes));
    }
    entries.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(entries)
}

/// One immutable capture identity. The revision and content id are frozen at
/// capture start; a later edit cannot relabel old bytes as a newer revision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProjectCapture {
    pub document_id: Uuid,
    pub revision: u64,
    pub content_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapturedProject {
    pub document_id: Uuid,
    pub revision: u64,
    pub content_id: Uuid,
    pub mime: String,
    pub byte_len: u64,
}

impl ProjectCapture {
    pub fn new(document_id: Uuid, revision: u64, content_id: Uuid) -> Result<Self, ProjectError> {
        if revision < 1 {
            return bad();
        }
        Ok(Self {
            document_id,
            revision,
            content_id,
        })
    }

    pub fn validate_manifest(&self, manifest: &ImageProjectManifest) -> Result<(), ProjectError> {
        if manifest.project_id != self.document_id {
            return Err(ProjectError::Changed);
        }
        Ok(())
    }

    pub fn captured(&self, mime: &str, byte_len: u64) -> Result<CapturedProject, ProjectError> {
        if mime.is_empty() || mime.len() > 128 || byte_len == 0 || byte_len > MAX_ARCHIVE_BYTES {
            return bad();
        }
        Ok(CapturedProject {
            document_id: self.document_id,
            revision: self.revision,
            content_id: self.content_id,
            mime: mime.to_string(),
            byte_len,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_names_are_namespaced() {
        assert!(is_extension_name("com.example.layerdata"));
        assert!(!is_extension_name("example"));
        assert!(!is_extension_name("Com.example"));
        assert!(!is_extension_name("com..example"));
        assert!(!is_extension_name("../evil"));
    }

    #[test]
    fn entry_names_are_strict() {
        assert!(matches!(
            classify_entry("document.json"),
            Ok(EntryKind::Document)
        ));
        assert!(classify_entry("tiles/not-a-uuid.rgba.zst").is_err());
        assert!(classify_entry("../document.json").is_err());
        assert!(classify_entry("metadata/exif.bin").is_ok());
        assert!(classify_entry("metadata/unknown.bin").is_err());
    }

    #[test]
    fn capture_freezes_the_requested_revision() {
        let document = Uuid::new_v4();
        let content = Uuid::new_v4();
        let capture = ProjectCapture::new(document, 1, content).expect("capture");
        let current_revision = 2;
        let captured = capture.captured("application/x", 10).expect("captured");
        assert_eq!(captured.revision, 1);
        assert_ne!(captured.revision, current_revision);
        assert_eq!(captured.content_id, content);
    }
}
