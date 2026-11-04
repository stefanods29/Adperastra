//! SafeScene1 validation and hash stamping (Step 07g T2).
//!
//! The model helper writes a bounded draft with a zero BLAKE3 field. Only
//! this native module stamps and validates it before the cache receives a
//! byte. The main window validates the structure again in
//! `src/handlers/model/safeScene.ts`; neither side trusts the other.

use crate::special_view_types::{
    validate_bounds, validate_material, validate_node_matrix, validate_primitive, SceneMaterial,
    SceneNode, ScenePrimitive, SceneUnit, SPECIAL_MAX_OBJECTS, SPECIAL_MAX_SOURCE_BYTES,
    SPECIAL_MAX_TEXTURES, SPECIAL_MAX_TRIANGLES, SPECIAL_MAX_VERTICES,
};

pub const MAGIC: &[u8; 7] = b"ADPSCN1";
pub const VERSION: u8 = 1;
pub const HEADER_LEN: usize = 44;
pub const DIRECTORY_ENTRY: usize = 28;
pub const MAX_SCENE_BYTES: u64 = SPECIAL_MAX_SOURCE_BYTES;

const REQUIRED: [u32; 6] = [1, 4, 5, 6, 7, 8];
const OPTIONAL: [u32; 2] = [3, 2];

#[derive(Debug, Clone, Copy)]
pub struct Section {
    pub kind: u32,
    pub offset: u64,
    pub length: u64,
    pub count: u32,
    pub stride: u32,
}

#[derive(Debug, Clone)]
pub struct SafeSceneSummary {
    pub object_count: u32,
    pub vertex_count: u32,
    pub triangle_count: u32,
    pub bounds: [f64; 6],
    pub materials: Vec<SceneMaterial>,
    pub primitives: Vec<ScenePrimitive>,
    pub nodes: Vec<SceneNode>,
    pub unit: SceneUnit,
}

fn corrupt<T>() -> Result<T, String> {
    Err("special_view.corrupt".to_string())
}

fn too_large<T>() -> Result<T, String> {
    Err("special_view.too_large".to_string())
}

fn align4(value: u64) -> u64 {
    (value + 3) & !3
}

fn u32_at(bytes: &[u8], offset: usize) -> Result<u32, String> {
    let slice = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| "special_view.corrupt".to_string())?;
    Ok(u32::from_le_bytes(slice.try_into().unwrap()))
}

fn u64_at(bytes: &[u8], offset: usize) -> Result<u64, String> {
    let slice = bytes
        .get(offset..offset + 8)
        .ok_or_else(|| "special_view.corrupt".to_string())?;
    Ok(u64::from_le_bytes(slice.try_into().unwrap()))
}

fn f32_at(bytes: &[u8], offset: usize) -> Result<f32, String> {
    let slice = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| "special_view.corrupt".to_string())?;
    Ok(f32::from_le_bytes(slice.try_into().unwrap()))
}

fn read_sections(bytes: &[u8]) -> Result<(Vec<Section>, usize), String> {
    if bytes.len() < HEADER_LEN || bytes.len() as u64 > MAX_SCENE_BYTES {
        return corrupt();
    }
    if bytes[0..7] != MAGIC[..] || bytes[7] != VERSION {
        return corrupt();
    }
    let count = u32_at(bytes, 8)?;
    if !(6..=8).contains(&count) {
        return corrupt();
    }
    let directory_end = HEADER_LEN + DIRECTORY_ENTRY * count as usize;
    if directory_end > bytes.len() {
        return corrupt();
    }
    let mut sections: Vec<Section> = Vec::with_capacity(count as usize);
    for index in 0..count as usize {
        let at = HEADER_LEN + index * DIRECTORY_ENTRY;
        let section = Section {
            kind: u32_at(bytes, at)?,
            offset: u64_at(bytes, at + 4)?,
            length: u64_at(bytes, at + 12)?,
            count: u32_at(bytes, at + 20)?,
            stride: u32_at(bytes, at + 24)?,
        };
        if sections
            .iter()
            .any(|existing| existing.kind == section.kind)
            || (!REQUIRED.contains(&section.kind) && !OPTIONAL.contains(&section.kind))
        {
            return corrupt();
        }
        if section.offset < align4(directory_end as u64) || !section.offset.is_multiple_of(4) {
            return corrupt();
        }
        let expected = u64::from(section.count)
            .checked_mul(u64::from(section.stride))
            .ok_or_else(|| "special_view.corrupt".to_string())?;
        if section.length != expected {
            return corrupt();
        }
        if section.count != 0 && section.stride == 0 {
            return corrupt();
        }
        if section.offset + section.length > bytes.len() as u64 {
            return corrupt();
        }
        sections.push(section);
    }
    for kind in REQUIRED {
        if !sections.iter().any(|section| section.kind == kind) {
            return corrupt();
        }
    }
    let mut ordered = sections.clone();
    ordered.sort_by_key(|section| section.offset);
    let mut cursor = align4(directory_end as u64);
    for section in &ordered {
        if section.offset < cursor {
            return corrupt();
        }
        if bytes[cursor as usize..section.offset as usize]
            .iter()
            .any(|byte| *byte != 0)
        {
            return corrupt();
        }
        cursor = section.offset + section.length;
    }
    if cursor != bytes.len() as u64 {
        return corrupt();
    }
    Ok((sections, directory_end))
}

fn section(sections: &[Section], kind: u32) -> Result<&Section, String> {
    sections
        .iter()
        .find(|section| section.kind == kind)
        .ok_or_else(|| "special_view.corrupt".to_string())
}

/// Validate the whole file, including the BLAKE3 field, against the bounds
/// in D3. Returns the summary the session stores.
pub fn validate_safe_scene(bytes: &[u8]) -> Result<SafeSceneSummary, String> {
    let (sections, _) = read_sections(bytes)?;
    let expected = blake3::hash(&bytes[HEADER_LEN..]);
    let stored = bytes
        .get(12..44)
        .ok_or_else(|| "special_view.corrupt".to_string())?;
    if stored != &expected.as_bytes()[..] {
        return corrupt();
    }
    validate_sections(bytes, &sections)
}

/// Validate every section except the hash, then write the BLAKE3 field.
/// The helper draft is the only input allowed to carry a zero hash.
pub fn finalize_safe_scene(bytes: &mut [u8]) -> Result<SafeSceneSummary, String> {
    let (sections, _) = read_sections(bytes)?;
    let summary = validate_sections(bytes, &sections)?;
    let hash = blake3::hash(&bytes[HEADER_LEN..]);
    bytes[12..44].copy_from_slice(hash.as_bytes());
    Ok(summary)
}

#[path = "special_scene_bounds.rs"]
mod scene_bounds;

fn validate_sections(bytes: &[u8], sections: &[Section]) -> Result<SafeSceneSummary, String> {
    let positions = section(sections, 1)?;
    if positions.stride != 12 || positions.count == 0 || positions.count > SPECIAL_MAX_VERTICES {
        return too_large();
    }
    let vertex_count = positions.count;
    let start = positions.offset as usize;
    let mut bounds = [
        f64::INFINITY,
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for index in 0..vertex_count as usize {
        for axis in 0..3 {
            let value = f64::from(f32_at(bytes, start + index * 12 + axis * 4)?);
            if !value.is_finite() {
                return corrupt();
            }
            bounds[axis] = bounds[axis].min(value);
            bounds[axis + 3] = bounds[axis + 3].max(value);
        }
    }
    validate_bounds(&bounds)?;

    if let Ok(normals) = section(sections, 2) {
        if normals.stride != 12 || normals.count != vertex_count {
            return corrupt();
        }
        for offset in
            (normals.offset as usize..(normals.offset + normals.length) as usize).step_by(4)
        {
            if !f32_at(bytes, offset)?.is_finite() {
                return corrupt();
            }
        }
    }
    if let Ok(uv) = section(sections, 3) {
        if uv.stride != 8 || uv.count != vertex_count {
            return corrupt();
        }
        for offset in (uv.offset as usize..(uv.offset + uv.length) as usize).step_by(4) {
            if !f32_at(bytes, offset)?.is_finite() {
                return corrupt();
            }
        }
    }

    let index_section = section(sections, 4)?;
    if index_section.stride != 4
        || index_section.count == 0
        || index_section.count % 3 != 0
        || index_section.count / 3 > SPECIAL_MAX_TRIANGLES
    {
        return too_large();
    }
    let mut indices = Vec::with_capacity(index_section.count as usize);
    for index in 0..index_section.count as usize {
        let value = u32_at(bytes, index_section.offset as usize + index * 4)?;
        if value >= vertex_count {
            return corrupt();
        }
        indices.push(value);
    }

    let material_section = section(sections, 5)?;
    if material_section.stride != 36 || material_section.count == 0 || material_section.count > 4096
    {
        return corrupt();
    }
    let mut materials = Vec::with_capacity(material_section.count as usize);
    for record in 0..material_section.count as usize {
        let at = material_section.offset as usize + record * 36;
        if u32_at(bytes, at)? != record as u32 {
            return corrupt();
        }
        let texture = u32_at(bytes, at + 28)?;
        let material = SceneMaterial {
            id: record as u32,
            rgba: [
                f64::from(f32_at(bytes, at + 4)?),
                f64::from(f32_at(bytes, at + 8)?),
                f64::from(f32_at(bytes, at + 12)?),
                f64::from(f32_at(bytes, at + 16)?),
            ],
            metallic: f64::from(f32_at(bytes, at + 20)?),
            roughness: f64::from(f32_at(bytes, at + 24)?),
            texture_index: if texture == u32::MAX {
                None
            } else if (texture as usize) < SPECIAL_MAX_TEXTURES {
                Some(texture)
            } else {
                return corrupt();
            },
            double_sided: match u32_at(bytes, at + 32)? {
                0 => false,
                1 => true,
                _ => return corrupt(),
            },
        };
        validate_material(&material)?;
        materials.push(material);
    }

    let primitive_section = section(sections, 6)?;
    if primitive_section.stride != 24
        || primitive_section.count == 0
        || primitive_section.count > SPECIAL_MAX_OBJECTS
    {
        return corrupt();
    }
    let mut primitives = Vec::with_capacity(primitive_section.count as usize);
    let mut visited_indices = 0u64;
    for record in 0..primitive_section.count as usize {
        let at = primitive_section.offset as usize + record * 24;
        let primitive = ScenePrimitive {
            id: u32_at(bytes, at)?,
            first_vertex: u32_at(bytes, at + 4)?,
            vertex_count: u32_at(bytes, at + 8)?,
            first_index: u32_at(bytes, at + 12)?,
            index_count: u32_at(bytes, at + 16)?,
            material_id: u32_at(bytes, at + 20)?,
        };
        if primitives
            .iter()
            .any(|existing: &ScenePrimitive| existing.id == primitive.id)
        {
            return corrupt();
        }
        validate_primitive(
            &primitive,
            vertex_count,
            index_section.count,
            material_section.count,
        )?;
        visited_indices += u64::from(primitive.index_count);
        if visited_indices > u64::from(SPECIAL_MAX_TRIANGLES) * 3 {
            return too_large();
        }
        for index in primitive.first_index..primitive.first_index + primitive.index_count {
            let value = indices[index as usize];
            if value < primitive.first_vertex
                || value >= primitive.first_vertex + primitive.vertex_count
            {
                return corrupt();
            }
        }
        primitives.push(primitive);
    }

    let strings = section(sections, 8)?;
    if strings.stride != 1 || strings.count > 4 * 1024 * 1024 {
        return corrupt();
    }
    let node_section = section(sections, 7)?;
    if node_section.stride != 84
        || node_section.count == 0
        || node_section.count > SPECIAL_MAX_OBJECTS
    {
        return corrupt();
    }
    let mut nodes = Vec::with_capacity(node_section.count as usize);
    for record in 0..node_section.count as usize {
        let at = node_section.offset as usize + record * 84;
        let id = u32_at(bytes, at)?;
        if id != record as u32 {
            return corrupt();
        }
        let parent_raw = u32_at(bytes, at + 4)?;
        if parent_raw != u32::MAX && parent_raw >= id {
            return corrupt();
        }
        let primitive_raw = u32_at(bytes, at + 8)?;
        if primitive_raw != u32::MAX
            && !primitives
                .iter()
                .any(|primitive| primitive.id == primitive_raw)
        {
            return corrupt();
        }
        let name_offset = u32_at(bytes, at + 12)? as usize;
        let name_length = u32_at(bytes, at + 16)? as usize;
        if name_length > 512 || name_offset + name_length > strings.count as usize {
            return corrupt();
        }
        let mut matrix = [0f32; 16];
        for (index, value) in matrix.iter_mut().enumerate() {
            *value = f32_at(bytes, at + 20 + index * 4)?;
        }
        validate_node_matrix(&matrix)?;
        let name_bytes = bytes
            .get(
                strings.offset as usize + name_offset
                    ..strings.offset as usize + name_offset + name_length,
            )
            .ok_or_else(|| "special_view.corrupt".to_string())?;
        let name = std::str::from_utf8(name_bytes)
            .map_err(|_| "special_view.corrupt".to_string())?
            .to_string();
        nodes.push(SceneNode {
            id,
            parent: if parent_raw == u32::MAX {
                None
            } else {
                Some(parent_raw)
            },
            primitive_id: if primitive_raw == u32::MAX {
                None
            } else {
                Some(primitive_raw)
            },
            matrix,
            name,
        });
    }

    let bounds = scene_bounds::world_bounds(bytes, start, &primitives, &nodes)?;
    Ok(SafeSceneSummary {
        object_count: node_section.count,
        vertex_count,
        triangle_count: index_section.count / 3,
        bounds,
        materials,
        primitives,
        nodes,
        unit: SceneUnit::None,
    })
}

#[cfg(test)]
#[path = "special_scene_tests.rs"]
mod tests;
