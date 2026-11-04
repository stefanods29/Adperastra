use super::{finalize_safe_scene, validate_safe_scene};

fn put_u32(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn put_u64(bytes: &mut [u8], offset: usize, value: u64) {
    bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}

fn put_f32(bytes: &mut [u8], offset: usize, value: f32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn entry(
    bytes: &mut [u8],
    index: usize,
    kind: u32,
    offset: u64,
    length: u64,
    count: u32,
    stride: u32,
) {
    let at = 44 + index * 28;
    put_u32(bytes, at, kind);
    put_u64(bytes, at + 4, offset);
    put_u64(bytes, at + 12, length);
    put_u32(bytes, at + 20, count);
    put_u32(bytes, at + 24, stride);
}

/// One triangle, one material, one primitive, one node, strings "tri".
fn valid_scene() -> Vec<u8> {
    let mut bytes = vec![0u8; 407];
    bytes[0..7].copy_from_slice(b"ADPSCN1");
    bytes[7] = 1;
    put_u32(&mut bytes, 8, 6);
    entry(&mut bytes, 0, 1, 212, 36, 3, 12);
    entry(&mut bytes, 1, 4, 248, 12, 3, 4);
    entry(&mut bytes, 2, 5, 260, 36, 1, 36);
    entry(&mut bytes, 3, 6, 296, 24, 1, 24);
    entry(&mut bytes, 4, 7, 320, 84, 1, 84);
    entry(&mut bytes, 5, 8, 404, 3, 3, 1);
    for (index, value) in [0.0f32, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0]
        .iter()
        .enumerate()
    {
        put_f32(&mut bytes, 212 + index * 4, *value);
    }
    for (index, value) in [0u32, 1, 2].iter().enumerate() {
        put_u32(&mut bytes, 248 + index * 4, *value);
    }
    put_u32(&mut bytes, 260, 0);
    for (index, value) in [0.5f32, 0.5, 0.5, 1.0, 0.0, 0.8].iter().enumerate() {
        put_f32(&mut bytes, 264 + index * 4, *value);
    }
    put_u32(&mut bytes, 288, u32::MAX);
    put_u32(&mut bytes, 292, 0);
    put_u32(&mut bytes, 296, 0);
    put_u32(&mut bytes, 300, 0);
    put_u32(&mut bytes, 304, 3);
    put_u32(&mut bytes, 308, 0);
    put_u32(&mut bytes, 312, 3);
    put_u32(&mut bytes, 316, 0);
    put_u32(&mut bytes, 320, 0);
    put_u32(&mut bytes, 324, u32::MAX);
    put_u32(&mut bytes, 328, 0);
    put_u32(&mut bytes, 332, 0);
    put_u32(&mut bytes, 336, 3);
    for index in 0..16 {
        put_f32(
            &mut bytes,
            340 + index * 4,
            if index % 5 == 0 { 1.0 } else { 0.0 },
        );
    }
    bytes[404..407].copy_from_slice(b"tri");
    // The finalize step writes the BLAKE3 field.
    finalize_safe_scene(&mut bytes).expect("fixture is valid");
    bytes
}

#[test]
fn finalize_and_validate_round_trip() {
    let mut bytes = valid_scene();
    let summary = validate_safe_scene(&bytes).expect("stamped scene validates");
    assert_eq!(summary.vertex_count, 3);
    assert_eq!(summary.triangle_count, 1);
    assert_eq!(summary.object_count, 1);
    assert_eq!(summary.bounds, [0.0, 0.0, 0.0, 1.0, 1.0, 0.0]);
    let before = bytes.clone();
    finalize_safe_scene(&mut bytes).expect("a stamped scene is stable");
    assert_eq!(before, bytes);
}

#[test]
fn hash_mismatch_is_refused() {
    let mut bytes = valid_scene();
    bytes[212] ^= 0x01;
    assert_eq!(
        validate_safe_scene(&bytes).err().as_deref(),
        Some("special_view.corrupt")
    );
}

#[test]
fn overlapping_section_offsets_are_corrupt() {
    let mut bytes = valid_scene();
    put_u64(&mut bytes, 44 + 3 * 28 + 4, 260);
    assert_eq!(
        validate_safe_scene(&bytes).err().as_deref(),
        Some("special_view.corrupt")
    );
}

#[test]
fn non_finite_node_transform_is_refused() {
    let mut bytes = valid_scene();
    put_f32(&mut bytes, 340, f32::NAN);
    assert_eq!(
        finalize_safe_scene(&mut bytes).err().as_deref(),
        Some("special_view.corrupt")
    );
}

#[test]
fn primitive_index_outside_its_vertex_range_is_refused() {
    let mut bytes = valid_scene();
    put_u32(&mut bytes, 300, 1);
    put_u32(&mut bytes, 304, 2);
    put_u32(&mut bytes, 308, 0);
    put_u32(&mut bytes, 312, 3);
    assert_eq!(
        finalize_safe_scene(&mut bytes).err().as_deref(),
        Some("special_view.corrupt")
    );
}

#[test]
fn translated_scene_bounds_follow_column_major_nodes() {
    let mut bytes = valid_scene();
    put_f32(&mut bytes, 340 + 12 * 4, 10.0);
    put_f32(&mut bytes, 340 + 13 * 4, 20.0);
    put_f32(&mut bytes, 340 + 14 * 4, 30.0);
    let summary = finalize_safe_scene(&mut bytes).unwrap();
    assert_eq!(summary.bounds, [10.0, 20.0, 30.0, 11.0, 21.0, 30.0]);
    assert_eq!(validate_safe_scene(&bytes).unwrap().bounds, summary.bounds);
}
