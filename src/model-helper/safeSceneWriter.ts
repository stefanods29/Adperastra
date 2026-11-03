/** SafeScene1 writer (Step 07g T2), isolated helper only. The BLAKE3 field
 * is left zero: the native parent stamps the draft before publication. No
 * loader value here can execute model content. */
export const SAFE_SCENE_MAGIC = "ADPSCN1";
export const SAFE_SCENE_VERSION = 1;
export const SAFE_SCENE_MAX_BYTES = 256 * 1024 * 1024;
export const SAFE_SCENE_MAX_VERTICES = 2_000_000;
export const SAFE_SCENE_MAX_TRIANGLES = 4_000_000;
export const SAFE_SCENE_MAX_OBJECTS = 10_000;
export const SAFE_SCENE_MAX_DEPTH = 64;
export const SAFE_SCENE_MAX_MATERIALS = 4_096;
export const SAFE_SCENE_MAX_TEXTURES = 32;
export type SceneUnit = "none" | "mm" | "cm" | "m";
export interface MaterialSource {
  /** Linear RGB in 0..1. */
  color: readonly [number, number, number];
  opacity: number;
  metallic: number;
  roughness: number;
  doubleSided: boolean;
  /** Index into the helper's uploaded texture list, or null. */
  textureIndex: number | null;
}
export interface MeshSource {
  kind: "mesh";
  name: string;
  /** Column-major local affine matrix. */
  matrix: readonly number[];
  positions: ArrayLike<number>;
  normals?: ArrayLike<number>;
  uv?: ArrayLike<number>;
  indices?: ArrayLike<number>;
  material: MaterialSource;
}
export interface GroupSource {
  kind: "group";
  name: string;
  matrix: readonly number[];
  children: readonly SceneSourceNode[];
}
export type SceneSourceNode = MeshSource | GroupSource;
export interface SceneSource {
  roots: readonly SceneSourceNode[];
  unit: SceneUnit;
}
export interface SceneSummary {
  objectCount: number;
  vertexCount: number;
  triangleCount: number;
  bounds: [number, number, number, number, number, number];
  partial: boolean;
}
export interface WrittenScene {
  bytes: Uint8Array;
  summary: SceneSummary;
}
interface Counts {
  vertices: number;
  indices: number;
  nodes: number;
  meshes: number;
  strings: number;
}
const utf8 = new TextEncoder();
function fail(): never {
  throw new Error("special_view.corrupt");
}
function tooLarge(): never {
  throw new Error("special_view.too_large");
}
export function validateMatrix(matrix: readonly number[]): asserts matrix is readonly number[] {
  if (!Array.isArray(matrix) || matrix.length !== 16) fail();
  for (let index = 0; index < 16; index += 1) {
    const value = matrix[index];
    if (typeof value !== "number" || !Number.isFinite(value)) fail();
  }
  if (matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0 || matrix[15] !== 1) fail();
}
function truncateUtf8(text: string, maxBytes: number): Uint8Array {
  const bounded = text.length > 1024 ? text.slice(0, 1024) : text;
  const bytes = utf8.encode(bounded);
  if (bytes.length <= maxBytes) return bytes;
  let end = maxBytes;
  // Do not split a multi-byte sequence: move back to a UTF-8 start byte.
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.slice(0, end);
}
function materialKey(material: MaterialSource): string {
  return [
    material.color.map((value) => value.toFixed(6)).join(","),
    material.opacity.toFixed(6),
    material.metallic.toFixed(6),
    material.roughness.toFixed(6),
    material.doubleSided ? "1" : "0",
    material.textureIndex === null ? "n" : String(material.textureIndex),
  ].join("|");
}
function countScene(source: SceneSource): Counts {
  const counts: Counts = { vertices: 0, indices: 0, nodes: 0, meshes: 0, strings: 0 };
  const visit = (node: SceneSourceNode, depth: number) => {
    if (depth > SAFE_SCENE_MAX_DEPTH) tooLarge();
    if (node.kind !== "mesh" && node.kind !== "group") fail();
    validateMatrix(node.matrix);
    counts.nodes += 1;
    if (counts.nodes > SAFE_SCENE_MAX_OBJECTS) tooLarge();
    if (node.kind === "mesh") {
      counts.meshes += 1;
      if (node.positions.length === 0 || node.positions.length % 3 !== 0) fail();
      const vertices = node.positions.length / 3;
      if (!Number.isInteger(vertices)) fail();
      counts.vertices += vertices;
      if (counts.vertices > SAFE_SCENE_MAX_VERTICES) tooLarge();
      if (node.normals && node.normals.length !== node.positions.length) fail();
      if (node.uv && node.uv.length !== vertices * 2) fail();
      const indexCount = node.indices ? node.indices.length : vertices;
      if (indexCount === 0 || indexCount % 3 !== 0) fail();
      if (indexCount / 3 > SAFE_SCENE_MAX_TRIANGLES || counts.indices / 3 + indexCount / 3 > SAFE_SCENE_MAX_TRIANGLES) tooLarge();
      for (const value of Array.from(node.indices ?? [], (item) => Number(item))) {
        if (!Number.isInteger(value) || value < 0 || value >= vertices) fail();
      }
      counts.indices += indexCount;
      if (counts.indices / 3 > SAFE_SCENE_MAX_TRIANGLES) tooLarge();
    } else {
      for (const child of node.children) visit(child, depth + 1);
    }
    counts.strings += truncateUtf8(node.name, 512).length;
    if (counts.strings > 4 * 1024 * 1024) tooLarge();
  };
  for (const root of source.roots) visit(root, 0);
  if (counts.nodes === 0 || counts.meshes === 0 || counts.vertices === 0) {
    throw new Error("special_view.unsupported");
  }
  return counts;
}
class ByteWriter {
  private offset = 0;
  constructor(readonly bytes: Uint8Array) {}
  u8(value: number): void {
    this.bytes[this.offset] = value & 0xff;
    this.offset += 1;
  }
  u32(value: number): void {
    new DataView(this.bytes.buffer, this.bytes.byteOffset).setUint32(this.offset, value >>> 0, true);
    this.offset += 4;
  }
  u64(value: number): void {
    new DataView(this.bytes.buffer, this.bytes.byteOffset).setBigUint64(this.offset, BigInt(value), true);
    this.offset += 8;
  }
  f32(value: number): void {
    new DataView(this.bytes.buffer, this.bytes.byteOffset).setFloat32(this.offset, value, true);
    this.offset += 4;
  }
  skip(count: number): void {
    this.offset += count;
  }
  get position(): number {
    return this.offset;
  }
}
function align4(value: number): number {
  return (value + 3) & ~3;
}
/** Flatten and serialize. Throws `special_view.corrupt`/`too_large`/
 * `unsupported` with no partial output. */
export function writeSafeScene(source: SceneSource): WrittenScene {
  const counts = countScene(source);
  const materials: MaterialSource[] = [];
  const materialIds = new Map<string, number>();
  const materialIdFor = (material: MaterialSource): number => {
    if (
      material.color.some((value) => !Number.isFinite(value) || value < 0 || value > 1) ||
      !Number.isFinite(material.opacity) || material.opacity < 0 || material.opacity > 1 ||
      !Number.isFinite(material.metallic) || material.metallic < 0 || material.metallic > 1 ||
      !Number.isFinite(material.roughness) || material.roughness < 0 || material.roughness > 1 ||
      (material.textureIndex !== null &&
        (!Number.isInteger(material.textureIndex) || material.textureIndex < 0 || material.textureIndex >= SAFE_SCENE_MAX_TEXTURES))
    ) {
      fail();
    }
    const key = materialKey(material);
    const existing = materialIds.get(key);
    if (existing !== undefined) return existing;
    if (materials.length >= SAFE_SCENE_MAX_MATERIALS) tooLarge();
    const id = materials.length;
    materials.push(material);
    materialIds.set(key, id);
    return id;
  };
  interface PlannedNode {
    id: number;
    parent: number | null;
    primitiveId: number | null;
    matrix: readonly number[];
    name: string;
    mesh?: MeshSource;
    firstVertex: number;
    vertexCount: number;
    firstIndex: number;
    indexCount: number;
    materialId: number;
  }
  const planned: PlannedNode[] = [];
  const plan = (node: SceneSourceNode, parent: number | null) => {
    const id = planned.length;
    if (node.kind === "mesh") {
      const vertexCount = node.positions.length / 3;
      const indexCount = node.indices ? node.indices.length : vertexCount;
      planned.push({
        id,
        parent,
        primitiveId: id,
        matrix: node.matrix,
        name: node.name,
        mesh: node,
        firstVertex: 0,
        vertexCount,
        firstIndex: 0,
        indexCount,
        materialId: materialIdFor(node.material),
      });
    } else {
      planned.push({
        id,
        parent,
        primitiveId: null,
        matrix: node.matrix,
        name: node.name,
        firstVertex: 0,
        vertexCount: 0,
        firstIndex: 0,
        indexCount: 0,
        materialId: 0,
      });
    }
    if (node.kind === "group") {
      for (const child of node.children) plan(child, id);
    }
  };
  for (const root of source.roots) plan(root, null);
  let vertexCursor = 0;
  let indexCursor = 0;
  const meshes = planned.filter((node) => node.mesh);
  for (const node of meshes) {
    node.firstVertex = vertexCursor;
    vertexCursor += node.vertexCount;
    node.firstIndex = indexCursor;
    indexCursor += node.indexCount;
  }
  const hasNormals = meshes.every((node) => node.mesh?.normals !== undefined);
  const hasUv = meshes.every((node) => node.mesh?.uv !== undefined);
  const partial = !hasUv && materials.some((material) => material.textureIndex !== null);
  const sectionCount = 6 + (hasNormals ? 1 : 0) + (hasUv ? 1 : 0);
  const directoryEnd = 44 + sectionCount * 28;
  let cursor = align4(directoryEnd);
  const layout: { kind: number; offset: number; count: number; stride: number }[] = [];
  const place = (kind: number, count: number, stride: number) => {
    const offset = cursor;
    const length = count * stride;
    if (!Number.isSafeInteger(length) || offset + length > SAFE_SCENE_MAX_BYTES) tooLarge();
    layout.push({ kind, offset, count, stride });
    cursor = align4(offset + length);
    if (cursor > SAFE_SCENE_MAX_BYTES) tooLarge();
  };
  place(1, vertexCursor, 12);
  if (hasNormals) place(2, vertexCursor, 12);
  if (hasUv) place(3, vertexCursor, 8);
  place(4, indexCursor, 4);
  place(5, materials.length, 36);
  place(6, meshes.length, 24);
  place(7, planned.length, 84);
  const stringBytes: number[] = [];
  const stringOffsets = new Map<string, { offset: number; length: number }>();
  for (const node of planned) {
    const bytes = truncateUtf8(node.name, 512);
    const key = `${node.name}`;
    const existing = stringOffsets.get(key);
    if (existing && existing.length === bytes.length) continue;
    const entry = { offset: stringBytes.length, length: bytes.length };
    stringOffsets.set(key, entry);
    for (const byte of bytes) stringBytes.push(byte);
    if (stringBytes.length > 4 * 1024 * 1024) tooLarge();
  }
  place(8, stringBytes.length, 1);
  const total = layout[layout.length - 1].offset + layout[layout.length - 1].count * layout[layout.length - 1].stride;
  if (total > SAFE_SCENE_MAX_BYTES) tooLarge();
  const bytes = new Uint8Array(total);
  const writer = new ByteWriter(bytes);
  for (const byte of SAFE_SCENE_MAGIC) writer.u8(byte.charCodeAt(0));
  writer.u8(SAFE_SCENE_VERSION);
  writer.u32(sectionCount);
  writer.skip(32); // native BLAKE3
  for (const entry of layout) {
    writer.u32(entry.kind);
    writer.u64(entry.offset);
    writer.u64(entry.count * entry.stride);
    writer.u32(entry.count);
    writer.u32(entry.stride);
  }
  const section = (kind: number) => layout.find((entry) => entry.kind === kind)!;
  const positions = section(1);
  {
    const view = new ByteWriter(bytes.subarray(positions.offset, positions.offset + positions.count * 12));
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const node of meshes) {
      const sourceMesh = node.mesh!;
      for (let index = 0; index < sourceMesh.positions.length; index += 1) {
        const value = Number(sourceMesh.positions[index]);
        if (!Number.isFinite(value)) fail();
        view.f32(value);
        const axis = index % 3;
        if (axis === 0) { minX = Math.min(minX, value); maxX = Math.max(maxX, value); }
        if (axis === 1) { minY = Math.min(minY, value); maxY = Math.max(maxY, value); }
        if (axis === 2) { minZ = Math.min(minZ, value); maxZ = Math.max(maxZ, value); }
      }
    }
    if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) fail();
    if (hasNormals) {
      const normals = section(2);
      const viewNormals = new ByteWriter(bytes.subarray(normals.offset, normals.offset + normals.count * 12));
      for (const node of meshes) {
        for (const value of Array.from(node.mesh!.normals!)) {
          if (!Number.isFinite(value)) fail();
          viewNormals.f32(Number(value));
        }
      }
    }
    if (hasUv) {
      const uv = section(3);
      const viewUv = new ByteWriter(bytes.subarray(uv.offset, uv.offset + uv.count * 8));
      for (const node of meshes) {
        for (const value of Array.from(node.mesh!.uv!)) {
          if (!Number.isFinite(value)) fail();
          viewUv.f32(Number(value));
        }
      }
    }
    const indices = section(4);
    const viewIndices = new ByteWriter(bytes.subarray(indices.offset, indices.offset + indices.count * 4));
    for (const node of meshes) {
      const sourceMesh = node.mesh!;
      if (sourceMesh.indices) {
        for (const value of Array.from(sourceMesh.indices)) {
          const local = Number(value);
          if (!Number.isInteger(local) || local < 0 || local >= node.vertexCount) fail();
          viewIndices.u32(node.firstVertex + local);
        }
      } else {
        for (let local = 0; local < node.vertexCount; local += 1) viewIndices.u32(node.firstVertex + local);
      }
    }
    const materialsSection = section(5);
    const viewMaterials = new ByteWriter(bytes.subarray(materialsSection.offset, materialsSection.offset + materials.length * 36));
    materials.forEach((material, id) => {
      viewMaterials.u32(id);
      viewMaterials.f32(material.color[0]);
      viewMaterials.f32(material.color[1]);
      viewMaterials.f32(material.color[2]);
      viewMaterials.f32(material.opacity);
      viewMaterials.f32(material.metallic);
      viewMaterials.f32(material.roughness);
      viewMaterials.u32(material.textureIndex === null ? 0xffff_ffff : material.textureIndex);
      viewMaterials.u32(material.doubleSided ? 1 : 0);
    });
    const primitivesSection = section(6);
    const viewPrimitives = new ByteWriter(bytes.subarray(primitivesSection.offset, primitivesSection.offset + meshes.length * 24));
    for (const node of meshes) {
      viewPrimitives.u32(node.id);
      viewPrimitives.u32(node.firstVertex);
      viewPrimitives.u32(node.vertexCount);
      viewPrimitives.u32(node.firstIndex);
      viewPrimitives.u32(node.indexCount);
      viewPrimitives.u32(node.materialId);
    }
    const nodesSection = section(7);
    const viewNodes = new ByteWriter(bytes.subarray(nodesSection.offset, nodesSection.offset + planned.length * 84));
    for (const node of planned) {
      const name = stringOffsets.get(node.name)!;
      viewNodes.u32(node.id);
      viewNodes.u32(node.parent === null ? 0xffff_ffff : node.parent);
      viewNodes.u32(node.primitiveId === null ? 0xffff_ffff : node.primitiveId);
      viewNodes.u32(name.offset);
      viewNodes.u32(name.length);
      for (const value of node.matrix) viewNodes.f32(Number(value));
    }
    const stringsSection = section(8);
    bytes.set(stringBytes, stringsSection.offset);
    return {
      bytes,
      summary: {
        objectCount: planned.length,
        vertexCount: vertexCursor,
        triangleCount: indexCursor / 3,
        bounds: [minX, minY, minZ, maxX, maxY, maxZ],
        partial,
      },
    };
  }
}
