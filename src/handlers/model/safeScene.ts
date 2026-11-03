/** SafeScene1 decoder (Step 07g E6), main window only.
 *
 * The native parent has already checked the BLAKE3 hash and file bounds.
 * This decoder checks every structural and numeric bound again before it
 * creates typed-array views or lets Three.js see a single number. It never
 * calls a format loader and accepts no path or URL. */

import type { SceneMaterial, SceneNode, ScenePrimitive, SafeSceneData } from "../../services/specialViews";

export const SAFE_SCENE_MAX_BYTES = 256 * 1024 * 1024;
export const SAFE_SCENE_MAX_VERTICES = 2_000_000;
export const SAFE_SCENE_MAX_TRIANGLES = 4_000_000;
export const SAFE_SCENE_MAX_OBJECTS = 10_000;
export const SAFE_SCENE_MAX_TEXTURE_INDEX = 32;

const REQUIRED = new Set([1, 4, 5, 6, 7, 8]);
const OPTIONAL = new Set([2, 3]);
const utf8 = new TextDecoder("utf-8", { fatal: true });

interface Section {
  kind: number;
  offset: number;
  length: number;
  count: number;
  stride: number;
}

function corrupt(): never {
  throw new Error("special_view.corrupt");
}

function tooLarge(): never {
  throw new Error("special_view.too_large");
}

function readU64(view: DataView, offset: number): number {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) corrupt();
  return Number(value);
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

function bytesOf(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

export function decodeSafeScene(
  input: ArrayBuffer | Uint8Array,
  maxVertices: number,
  maxTriangles: number,
): SafeSceneData {
  const bytes = bytesOf(input);
  if (bytes.byteLength < 44 || bytes.byteLength > SAFE_SCENE_MAX_BYTES || bytes.byteOffset % 4 !== 0) corrupt();
  const magic = new TextDecoder("ascii").decode(bytes.subarray(0, 7));
  if (magic !== "ADPSCN1") corrupt();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(7) !== 1) corrupt();
  const sectionCount = view.getUint32(8, true);
  if (sectionCount < 6 || sectionCount > 8) corrupt();
  const directoryEnd = 44 + sectionCount * 28;
  if (directoryEnd > bytes.byteLength) corrupt();

  const sections = new Map<number, Section>();
  for (let index = 0; index < sectionCount; index += 1) {
    const at = 44 + index * 28;
    const kind = view.getUint32(at, true);
    const offset = readU64(view, at + 4);
    const length = readU64(view, at + 12);
    const count = view.getUint32(at + 20, true);
    const stride = view.getUint32(at + 24, true);
    if (sections.has(kind)) corrupt();
    if (!REQUIRED.has(kind) && !OPTIONAL.has(kind)) corrupt();
    if (offset < align4(directoryEnd) || offset % 4 !== 0) corrupt();
    if (length !== count * stride || !Number.isSafeInteger(length)) corrupt();
    if (count !== 0 && stride === 0) corrupt();
    if (offset + length > bytes.byteLength) corrupt();
    sections.set(kind, { kind, offset, length, count, stride });
  }
  for (const kind of REQUIRED) if (!sections.has(kind)) corrupt();

  // No overlapping sections and only zero padding between them.
  const ordered = [...sections.values()].sort((a, b) => a.offset - b.offset);
  let cursor = align4(directoryEnd);
  for (const section of ordered) {
    if (section.offset < cursor) corrupt();
    for (let index = cursor; index < section.offset; index += 1) {
      if (bytes[index] !== 0) corrupt();
    }
    cursor = section.offset + section.length;
  }
  if (cursor !== bytes.byteLength) corrupt();

  const positions = sections.get(1)!;
  if (positions.stride !== 12 || positions.count === 0 || positions.count > maxVertices) tooLarge();
  if (positions.count > SAFE_SCENE_MAX_VERTICES) tooLarge();
  const vertexCount = positions.count;

  const normals = sections.get(2);
  if (normals && (normals.stride !== 12 || normals.count !== vertexCount)) corrupt();
  const uv = sections.get(3);
  if (uv && (uv.stride !== 8 || uv.count !== vertexCount)) corrupt();

  const indexSection = sections.get(4)!;
  if (indexSection.stride !== 4 || indexSection.count === 0 || indexSection.count % 3 !== 0) corrupt();
  if (indexSection.count / 3 > maxTriangles || indexSection.count / 3 > SAFE_SCENE_MAX_TRIANGLES) tooLarge();

  const positionsArray = new Float32Array(bytes.buffer, bytes.byteOffset + positions.offset, vertexCount * 3);
  for (let index = 0; index < positionsArray.length; index += 1) {
    if (!Number.isFinite(positionsArray[index])) corrupt();
  }
  const indices = new Uint32Array(bytes.buffer, bytes.byteOffset + indexSection.offset, indexSection.count);
  for (let index = 0; index < indices.length; index += 1) {
    if (indices[index] >= vertexCount) corrupt();
  }

  const materialSection = sections.get(5)!;
  if (materialSection.stride !== 36 || materialSection.count === 0 || materialSection.count > 4_096) corrupt();
  const materials: SceneMaterial[] = [];
  for (let record = 0; record < materialSection.count; record += 1) {
    const at = materialSection.offset + record * 36;
    if (view.getUint32(at, true) !== record) corrupt();
    const rgba = [view.getFloat32(at + 4, true), view.getFloat32(at + 8, true), view.getFloat32(at + 12, true), view.getFloat32(at + 16, true)] as [number, number, number, number];
    const metallic = view.getFloat32(at + 20, true);
    const roughness = view.getFloat32(at + 24, true);
    const texture = view.getUint32(at + 28, true);
    const doubleSided = view.getUint32(at + 32, true);
    if (rgba.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) corrupt();
    if (!Number.isFinite(metallic) || metallic < 0 || metallic > 1) corrupt();
    if (!Number.isFinite(roughness) || roughness < 0 || roughness > 1) corrupt();
    if (texture !== 0xffff_ffff && texture >= SAFE_SCENE_MAX_TEXTURE_INDEX) corrupt();
    if (doubleSided !== 0 && doubleSided !== 1) corrupt();
    materials.push({
      id: record,
      rgba,
      metallic,
      roughness,
      texture_index: texture === 0xffff_ffff ? null : texture,
      double_sided: doubleSided === 1,
    });
  }

  const primitiveSection = sections.get(6)!;
  if (primitiveSection.stride !== 24 || primitiveSection.count === 0 || primitiveSection.count > 10_000) corrupt();
  const primitives: ScenePrimitive[] = [];
  const primitiveIds = new Set<number>();
  for (let record = 0; record < primitiveSection.count; record += 1) {
    const at = primitiveSection.offset + record * 24;
    const primitive: ScenePrimitive = {
      id: view.getUint32(at, true),
      first_vertex: view.getUint32(at + 4, true),
      vertex_count: view.getUint32(at + 8, true),
      first_index: view.getUint32(at + 12, true),
      index_count: view.getUint32(at + 16, true),
      material_id: view.getUint32(at + 20, true),
    };
    if (primitiveIds.has(primitive.id)) corrupt();
    primitiveIds.add(primitive.id);
    if (
      primitive.vertex_count === 0 ||
      primitive.index_count === 0 ||
      primitive.index_count % 3 !== 0 ||
      primitive.first_vertex + primitive.vertex_count > vertexCount ||
      primitive.first_index + primitive.index_count > indices.length ||
      primitive.material_id >= materials.length
    ) {
      corrupt();
    }
    for (let index = primitive.first_index; index < primitive.first_index + primitive.index_count; index += 1) {
      if (indices[index] < primitive.first_vertex || indices[index] >= primitive.first_vertex + primitive.vertex_count) corrupt();
    }
    primitives.push(primitive);
  }

  const strings = sections.get(8)!;
  if (strings.stride !== 1 || strings.count > 4 * 1024 * 1024) corrupt();
  const nodeSection = sections.get(7)!;
  if (nodeSection.stride !== 84 || nodeSection.count === 0 || nodeSection.count > SAFE_SCENE_MAX_OBJECTS) corrupt();
  const nodes: SceneNode[] = [];
  for (let record = 0; record < nodeSection.count; record += 1) {
    if (record > 0xffff_fffe) corrupt();
    const at = nodeSection.offset + record * 84;
    const id = view.getUint32(at, true);
    if (id !== record) corrupt();
    const parentRaw = view.getUint32(at + 4, true);
    if (parentRaw !== 0xffff_ffff && parentRaw >= id) corrupt();
    const primitiveRaw = view.getUint32(at + 8, true);
    if (primitiveRaw !== 0xffff_ffff && !primitiveIds.has(primitiveRaw)) corrupt();
    const nameOffset = view.getUint32(at + 12, true);
    const nameLength = view.getUint32(at + 16, true);
    if (nameLength > 512 || nameOffset + nameLength > strings.count) corrupt();
    const matrix = new Array<number>(16);
    for (let index = 0; index < 16; index += 1) {
      const value = view.getFloat32(at + 20 + index * 4, true);
      if (!Number.isFinite(value)) corrupt();
      matrix[index] = value;
    }
    if (matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0 || matrix[15] !== 1) corrupt();
    let name: string;
    try {
      name = utf8.decode(bytes.subarray(strings.offset + nameOffset, strings.offset + nameOffset + nameLength));
    } catch {
      corrupt();
    }
    nodes.push({
      id,
      parent: parentRaw === 0xffff_ffff ? null : parentRaw,
      primitive_id: primitiveRaw === 0xffff_ffff ? null : primitiveRaw,
      matrix: matrix as SceneNode["matrix"],
      name,
    });
  }

  return {
    positions: positionsArray,
    normals: normals ? new Float32Array(bytes.buffer, bytes.byteOffset + normals.offset, vertexCount * 3) : undefined,
    uv: uv ? new Float32Array(bytes.buffer, bytes.byteOffset + uv.offset, vertexCount * 2) : undefined,
    indices,
    materials,
    primitives,
    nodes,
  };
}

/** Finite scene bounds from the validated positions, for Fit. */
export function sceneBounds(scene: SafeSceneData): [number, number, number, number, number, number] {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let index = 0; index < scene.positions.length; index += 3) {
    const x = scene.positions[index];
    const y = scene.positions[index + 1];
    const z = scene.positions[index + 2];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  return [minX, minY, minZ, maxX, maxY, maxZ];
}
