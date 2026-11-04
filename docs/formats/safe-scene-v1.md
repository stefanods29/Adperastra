# SafeScene1 (Step 07g)

SafeScene1 is the app-owned binary scene format the isolated model helper
produces and the main view consumes. It is little-endian everywhere, uses
IEEE 754 binary32 floats, and never contains shader source, script text,
URLs or native-layout Rust/JS structs.

The native parent hashes and validates the bytes before publishing them to
the cache. The main view validates every structural and numeric bound again
before creating a typed array view. A malformed file never allocates beyond
the budgets written in its own (validated) directory.

## Header (44 bytes)

| Offset | Size | Value |
|---|---|---|
| 0 | 7 | ASCII `ADPSCN1` |
| 7 | 1 | version, exactly `1` |
| 8 | 4 | `section_count`, u32 |
| 12 | 32 | BLAKE3 of bytes `44..EOF` |

## Directory

The directory starts at byte 44. Every entry is 28 bytes:

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | `kind`, u32 |
| 4 | 8 | `byte_offset`, u64 |
| 12 | 8 | `byte_len`, u64 |
| 20 | 4 | `count`, u32 |
| 24 | 4 | `stride`, u32 |

Rules:

- Exactly one section each of kinds 1, 4, 5, 6, 7 and 8. Kinds 2 and 3 are
  optional. Unknown or duplicate kinds are refused.
- `byte_offset >= align4(44 + 28 * section_count)`, is 4-aligned, and is
  inside the file.
- Sections never overlap. `byte_len = count * stride` with checked
  arithmetic. Bytes between sections are zero padding only.
- The file ends exactly after the last section; unexplained trailing bytes
  are refused. Total length is at most 256 MiB.
- The BLAKE3 field must match bytes `44..EOF`. A draft with a zero hash is
  only accepted from the app-owned helper and is finalized by the native
  parent before publication.

## Sections

| Kind | Stride | Count | Record |
|---|---|---|---|
| 1 positions | 12 | 1..2,000,000 | `x,y,z` f32 at 0/4/8 |
| 2 normals | 12 | same as vertices | `x,y,z` f32 at 0/4/8 |
| 3 uv | 8 | same as vertices | `u,v` f32 at 0/4 |
| 4 indices | 4 | 1.., divisible by 3 | u32 index into the global vertex array |
| 5 materials | 36 | 1..4,096 | see below |
| 6 primitives | 24 | 1..10,000 | see below |
| 7 nodes | 84 | 1..10,000 | see below |
| 8 strings | 1 | 0..4 MiB | UTF-8 node-name pool |

### Materials (kind 5)

`id` u32 at 0 (equals the record index); RGBA f32 at 4/8/12/16; `metallic`
f32 at 20; `roughness` f32 at 24; `texture_index` u32 at 28 (`0xFFFFFFFF`
means none, otherwise below 32); `double_sided` u32 at 32 (`0` or `1`).
Every float is finite; RGBA, metallic and roughness are in `0..1`.

### Primitives (kind 6)

`id` u32 at 0; `first_vertex` at 4; `vertex_count` at 8; `first_index` at
12; `index_count` at 16; `material_id` at 20. `index_count` is a positive
multiple of 3. `first_vertex + vertex_count` stays inside the global
vertex array, `first_index + index_count` inside the global index array,
and every referenced index is below the global vertex count. A primitive's
indices address the global vertex array but must fall inside that
primitive's own vertex range. Aggregate instanced triangles stay at or
below 4,000,000.

### Nodes (kind 7)

`id` u32 at 0; `parent` u32 at 4 (`0xFFFFFFFF` for a root; otherwise
`parent < id`, so no cycles); `primitive_id` u32 at 8 (`0xFFFFFFFF` for
none); `name_offset` u32 at 12 and `name_len` u32 at 16, relative to the
strings pool (length at most 512 UTF-8 bytes); `matrix` 16 f32 at 20,
column-major, finite, with last row `0,0,0,1`.

## Bounds

The scene bounds are computed from section 1: the minimum and maximum of
every position, in source units. They are finite and min <= max. A scene
with no positions is unsupported, not an empty success.
