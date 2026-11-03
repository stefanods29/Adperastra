//! Bounded world-space bounds for the validated column-major scene graph.
use super::*;
use std::collections::HashMap;

pub(super) fn world_bounds(
    bytes: &[u8],
    position_offset: usize,
    primitives: &[ScenePrimitive],
    nodes: &[SceneNode],
) -> Result<[f64; 6], String> {
    let mut local = HashMap::new();
    let mut visits = 0u64;
    for primitive in primitives {
        visits += u64::from(primitive.vertex_count);
        if visits > u64::from(SPECIAL_MAX_VERTICES) {
            return too_large();
        }
        let mut bounds = empty_bounds();
        for vertex in primitive.first_vertex..primitive.first_vertex + primitive.vertex_count {
            for axis in 0..3 {
                let value = f64::from(f32_at(
                    bytes,
                    position_offset + vertex as usize * 12 + axis * 4,
                )?);
                bounds[axis] = bounds[axis].min(value);
                bounds[axis + 3] = bounds[axis + 3].max(value);
            }
        }
        validate_bounds(&bounds)?;
        local.insert(primitive.id, bounds);
    }
    let mut worlds: Vec<[f64; 16]> = Vec::with_capacity(nodes.len());
    let mut depths: Vec<u32> = Vec::with_capacity(nodes.len());
    let mut result = empty_bounds();
    for node in nodes {
        let mut world = node.matrix.map(f64::from);
        let depth = if let Some(parent) = node.parent {
            let parent = parent as usize;
            let matrix = worlds
                .get(parent)
                .ok_or_else(|| "special_view.corrupt".to_string())?;
            let mut product = [0f64; 16];
            for column in 0..4 {
                for row in 0..4 {
                    product[column * 4 + row] = (0..4)
                        .map(|k| matrix[k * 4 + row] * world[column * 4 + k])
                        .sum();
                }
            }
            world = product;
            depths[parent] + 1
        } else {
            1
        };
        if depth > crate::special_view_types::SPECIAL_MAX_DEPTH
            || world.iter().any(|value| !value.is_finite())
        {
            return too_large();
        }
        if let Some(id) = node.primitive_id {
            let bounds = local
                .get(&id)
                .ok_or_else(|| "special_view.corrupt".to_string())?;
            for corner in 0..8 {
                let point = [
                    bounds[if corner & 1 == 0 { 0 } else { 3 }],
                    bounds[if corner & 2 == 0 { 1 } else { 4 }],
                    bounds[if corner & 4 == 0 { 2 } else { 5 }],
                ];
                for axis in 0..3 {
                    let value = world[axis] * point[0]
                        + world[4 + axis] * point[1]
                        + world[8 + axis] * point[2]
                        + world[12 + axis];
                    if !value.is_finite() {
                        return corrupt();
                    }
                    result[axis] = result[axis].min(value);
                    result[axis + 3] = result[axis + 3].max(value);
                }
            }
        }
        worlds.push(world);
        depths.push(depth);
    }
    validate_bounds(&result)?;
    Ok(result)
}

fn empty_bounds() -> [f64; 6] {
    [
        f64::INFINITY,
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ]
}
