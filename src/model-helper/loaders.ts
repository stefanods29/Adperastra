/** Isolated model loaders (Step 07g T2/D2).
 *
 * Every parser here runs in the trusted model helper process, never in the
 * main window. The helper receives only application-issued grants. A glTF
 * is checked before GLTFLoader exists: every buffer/image URI must resolve
 * to a grant, otherwise the model is refused with zero fetches. */

import { gltfResourceReferences, isGlb, ModelResourceError, ModelResourcePolicy } from "./resources";
import type { GroupSource, MaterialSource, MeshSource, SceneSourceNode, SceneUnit } from "./safeSceneWriter";

export type ModelFormat = "stl" | "obj" | "gltf" | "glb" | "3mf";

export interface TextureSlot {
  index: number;
  width: number;
  height: number;
  /** PNG bytes uploaded through a helper output reservation. */
  png: Uint8Array;
}

export interface TextureSink {
  /** Register one texture; returns its slot index, or null when the image
   * cannot be represented safely (the scene becomes partial). */
  add(image: unknown): number | null;
}

export interface LoadedModel {
  source: SceneSourceNode[];
  /** Helper-local Three object; never sent to the main window. */
  root: ObjectLike;
  unit: SceneUnit;
  partial: boolean;
}

export function detectModelFormat(extension: string, bytes: Uint8Array): ModelFormat | null {
  const ext = extension.toLowerCase();
  if (ext === "glb" || (bytes.length >= 12 && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === "glTF")) return "glb";
  if (ext === "gltf") return "gltf";
  if (ext === "3mf" || (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) return "3mf";
  if (ext === "obj") return "obj";
  if (ext === "stl") return "stl";
  return null;
}

/** STL has no magic. Binary files are exactly 84 + 50 * triangles bytes;
 * ASCII files begin with `solid` and contain a facet. */
export function looksLikeBinaryStl(bytes: Uint8Array): boolean {
  if (bytes.length < 84) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangles = view.getUint32(80, true);
  return triangles > 0 && 84 + 50 * triangles === bytes.length;
}

export function looksLikeAsciiStl(bytes: Uint8Array): boolean {
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
  return /^\s*solid\b/i.test(head) && /facet\s+normal/i.test(head);
}

function defaultMaterial(): MaterialSource {
  return {
    color: [0.7, 0.7, 0.7],
    opacity: 1,
    metallic: 0,
    roughness: 0.8,
    doubleSided: false,
    textureIndex: null,
  };
}

function toArray(value: { array?: ArrayLike<number> } | undefined | null): ArrayLike<number> | undefined {
  return value && value.array ? value.array : undefined;
}

function materialFrom(value: unknown, textureSink: TextureSink, partial: { value: boolean }): MaterialSource {
  const material = (value ?? {}) as {
    color?: { r?: number; g?: number; b?: number };
    opacity?: number;
    metalness?: number;
    roughness?: number;
    side?: number;
    map?: unknown;
    transparent?: boolean;
  };
  const color = material.color;
  const rgba: [number, number, number] = [
    typeof color?.r === "number" && Number.isFinite(color.r) ? color.r : 0.7,
    typeof color?.g === "number" && Number.isFinite(color.g) ? color.g : 0.7,
    typeof color?.b === "number" && Number.isFinite(color.b) ? color.b : 0.7,
  ];
  const textureIndex = material.map ? textureSink.add((material.map as { image?: unknown }).image) : null;
  if (material.map && textureIndex === null) partial.value = true;
  return {
    color: rgba,
    opacity: typeof material.opacity === "number" && Number.isFinite(material.opacity) ? Math.min(1, Math.max(0, material.opacity)) : 1,
    metallic: typeof material.metalness === "number" && Number.isFinite(material.metalness) ? Math.min(1, Math.max(0, material.metalness)) : 0,
    roughness: typeof material.roughness === "number" && Number.isFinite(material.roughness) ? Math.min(1, Math.max(0, material.roughness)) : 0.8,
    doubleSided: material.side === 2,
    textureIndex,
  };
}

interface ObjectLike {
  name?: string;
  matrix?: { elements?: ArrayLike<number> };
  updateMatrix?: () => void;
  isMesh?: boolean;
  geometry?: {
    attributes?: Record<string, { array?: ArrayLike<number> } | undefined>;
    index?: { array?: ArrayLike<number> } | null;
  };
  material?: unknown;
  children?: ObjectLike[];
}

/** Convert a Three.js object graph into the structural values the bounded
 * SafeScene writer accepts. No Three type escapes this function. */
export function flattenThreeObject(root: ObjectLike, textureSink: TextureSink, partial: { value: boolean }): SceneSourceNode[] {
  const nodes: SceneSourceNode[] = [];
  const visit = (object: ObjectLike): SceneSourceNode => {
    object.updateMatrix?.();
    const elements = Array.from(object.matrix?.elements ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    if (object.isMesh && object.geometry) {
      const attributes = object.geometry.attributes ?? {};
      const positions = toArray(attributes.position);
      if (!positions || positions.length < 3) {
        // A mesh without positions contributes no draw range.
        return { kind: "group", name: object.name ?? "", matrix: elements, children: [] };
      }
      const materialValue = Array.isArray(object.material) ? object.material[0] : object.material;
      if (Array.isArray(object.material) && object.material.length > 1) partial.value = true;
      const mesh: MeshSource = {
        kind: "mesh",
        name: object.name ?? "",
        matrix: elements,
        positions,
        normals: toArray(attributes.normal),
        uv: toArray(attributes.uv),
        indices: object.geometry.index?.array,
        material: materialFrom(materialValue, textureSink, partial),
      };
      return mesh;
    }
    const children = (object.children ?? []).map(visit);
    const group: GroupSource = { kind: "group", name: object.name ?? "", matrix: elements, children };
    return group;
  };
  for (const child of root.children ?? [root]) nodes.push(visit(child));
  return nodes;
}

const TRANSPARENT_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

interface ThreeModules {
  STLLoader: new () => { parse: (data: ArrayBuffer) => unknown };
  OBJLoader: new () => { parse: (text: string) => unknown };
  GLTFLoader: new () => {
    parse: (data: ArrayBuffer, path: string, onLoad: (gltf: { scene: ObjectLike }) => void, onError: (error: unknown) => void) => void;
  };
  ThreeMFLoader: new (manager?: unknown) => { parse: (data: ArrayBuffer) => unknown };
  LoadingManager: new () => { setURLModifier: (fn: (url: string) => string) => void };
  Group: new () => ObjectLike;
  Mesh: new (geometry: unknown, material: unknown) => ObjectLike;
  MeshStandardMaterial: new (parameters?: Record<string, unknown>) => unknown;
}

/** Real Three modules are loaded only when a helper request arrives. */
async function threeModules(): Promise<ThreeModules> {
  const [stl, obj, gltf, mf, core] = await Promise.all([
    import("three/examples/jsm/loaders/STLLoader.js"),
    import("three/examples/jsm/loaders/OBJLoader.js"),
    import("three/examples/jsm/loaders/GLTFLoader.js"),
    import("three/examples/jsm/loaders/3MFLoader.js"),
    import("three"),
  ]);
  return {
    STLLoader: stl.STLLoader as ThreeModules["STLLoader"],
    OBJLoader: obj.OBJLoader as ThreeModules["OBJLoader"],
    GLTFLoader: gltf.GLTFLoader as ThreeModules["GLTFLoader"],
    ThreeMFLoader: mf.ThreeMFLoader as ThreeModules["ThreeMFLoader"],
    LoadingManager: core.LoadingManager as ThreeModules["LoadingManager"],
    Group: core.Group as ThreeModules["Group"],
    Mesh: core.Mesh as ThreeModules["Mesh"],
    MeshStandardMaterial: core.MeshStandardMaterial as ThreeModules["MeshStandardMaterial"],
  };
}

/** Check every external glTF resource before a loader exists. */
export function validateGltfDocument(bytes: Uint8Array, policy: ModelResourcePolicy): void {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ModelResourceError("special_view.unsupported");
  }
  policy.requireAll(gltfResourceReferences(json).map((reference) => reference.uri));
}

export interface LoaderDependencies {
  modules?: ThreeModules;
  /** Test seam: called exactly once when a parser is about to run. */
  onParse?: (format: ModelFormat) => void;
}

export async function loadModel(
  bytes: Uint8Array,
  extension: string,
  policy: ModelResourcePolicy,
  textureSink: TextureSink,
  dependencies: LoaderDependencies = {},
): Promise<LoadedModel> {
  const format = detectModelFormat(extension, bytes);
  if (!format) throw new ModelResourceError("special_view.unsupported");
  if (format === "glb" && !isGlb(new Uint8Array(bytes).buffer)) {
    throw new ModelResourceError("special_view.unsupported");
  }
  if (format === "gltf") validateGltfDocument(bytes, policy);
  dependencies.onParse?.(format);
  const modules = dependencies.modules ?? (await threeModules());
  const partial = { value: false };
  let root: ObjectLike;

  if (format === "stl") {
    if (!looksLikeBinaryStl(bytes) && !looksLikeAsciiStl(bytes)) throw new ModelResourceError("special_view.unsupported");
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const geometry = new modules.STLLoader().parse(buffer as ArrayBuffer) as unknown as { isBufferGeometry?: boolean };
    const group = new modules.Group();
    group.children = [new modules.Mesh(geometry, new modules.MeshStandardMaterial({ color: 0xb3b3b3 }))];
    root = group;
  } else if (format === "obj") {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // OBJ material libraries are sibling resources; without an explicit
    // grant the geometry is shown with app-owned default materials.
    if (/^\s*mtllib\s+/m.test(text)) partial.value = true;
    root = new modules.OBJLoader().parse(text) as ObjectLike;
  } else if (format === "3mf") {
    const manager = new modules.LoadingManager();
    manager.setURLModifier((url) => policy.resolveArchive(url) ?? TRANSPARENT_PNG);
    root = new modules.ThreeMFLoader(manager).parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    ) as ObjectLike;
  } else {
    const manager = new modules.LoadingManager();
    manager.setURLModifier((url) => policy.resolve(url) ?? TRANSPARENT_PNG);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    root = await new Promise<ObjectLike>((resolve, reject) => {
      new modules.GLTFLoader().parse(buffer, "", (gltf) => resolve(gltf.scene), reject);
    });
  }

  return { source: flattenThreeObject(root, textureSink, partial), root, unit: "none", partial: partial.value };
}
