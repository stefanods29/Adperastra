import { describe, expect, it, vi } from "vitest";
import { decodeSafeScene } from "../handlers/model/safeScene";
import { loadModel, validateGltfDocument } from "../model-helper/loaders";
import { resolveModelResource } from "../services/specialViews";
import { ModelResourceError, ModelResourcePolicy, gltfResourceReferences, normalizeModelResourcePath } from "../model-helper/resources";
import { writeSafeScene, type MeshSource } from "../model-helper/safeSceneWriter";
import { Sha256 } from "../model-helper/upload";

function triangle(): MeshSource {
  return {
    kind: "mesh",
    name: "triangle",
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
    uv: [0, 0, 1, 0, 0, 1],
    material: { color: [0.5, 0.5, 0.5], opacity: 1, metallic: 0, roughness: 0.8, doubleSided: false, textureIndex: null },
  };
}

function sectionOffset(bytes: Uint8Array, kind: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(8, true);
  for (let index = 0; index < count; index += 1) {
    const at = 44 + index * 28;
    if (view.getUint32(at, true) === kind) return Number(view.getBigUint64(at + 4, true));
  }
  throw new Error(`missing section ${kind}`);
}

describe("isolated model helper", () => {
  it("round trips translated column-major nodes and refuses perspective terms", () => {
    const translated = { ...triangle(), matrix: [1,0,0,0, 0,1,0,0, 0,0,1,0, 10,20,30,1] };
    const written = writeSafeScene({ unit: "cm", roots: [translated] });
    expect(decodeSafeScene(written.bytes, 2_000_000, 4_000_000).nodes[0].matrix).toEqual(translated.matrix);
    const perspective = [...translated.matrix]; perspective[3] = 1;
    expect(() => writeSafeScene({ unit: "cm", roots: [{ ...translated, matrix: perspective }] })).toThrow("special_view.corrupt");
  });

  it("refuses a remote texture before any parser or HTTP request", async () => {
    const gltf = new TextEncoder().encode(JSON.stringify({
      asset: { version: "2.0" },
      buffers: [{ uri: "https://example.test/secret.bin" }],
      images: [{ uri: "https://example.test/texture.png" }],
    }));
    const policy = new ModelResourcePolicy([]);
    expect(gltfResourceReferences(JSON.parse(new TextDecoder().decode(gltf)))).toEqual([
      { kind: "buffer", uri: "https://example.test/secret.bin" },
      { kind: "image", uri: "https://example.test/texture.png" },
    ]);
    expect(() => validateGltfDocument(gltf, policy)).toThrow(ModelResourceError);
    const parse = vi.fn();
    await expect(loadModel(gltf, "gltf", policy, { add: () => null }, { onParse: parse })).rejects.toThrow("special_view.unsupported");
    expect(parse).not.toHaveBeenCalled();
  });

  it("refuses traversal and absolute resource names", () => {
    expect(normalizeModelResourcePath("../secret.png")).toBeNull();
    expect(normalizeModelResourcePath("textures/../../secret.png")).toBeNull();
    expect(normalizeModelResourcePath("C:\\Windows\\win.ini")).toBeNull();
    expect(normalizeModelResourcePath("\\\\server\\share\\a.png")).toBeNull();
    expect(normalizeModelResourcePath("/etc/passwd")).toBeNull();
    expect(normalizeModelResourcePath("textures/wood.png")).toBe("textures/wood.png");
    expect(resolveModelResource("C:\\Other\\a.gltf", "textures/a.png", "C:\\Models")).toBeNull();
  });

  it("refuses 2,000,001 vertices before allocating arrays", () => {
    const fake = { length: 2_000_001 * 3 } as ArrayLike<number>;
    expect(() => writeSafeScene({
      unit: "none",
      roots: [{ ...triangle(), positions: fake }],
    })).toThrow("special_view.too_large");
  });

  it("writes and decodes one valid scene", () => {
    const written = writeSafeScene({ unit: "cm", roots: [triangle()] });
    expect(Array.from(written.bytes.subarray(0, 7))).toEqual(Array.from(new TextEncoder().encode("ADPSCN1")));
    const scene = decodeSafeScene(written.bytes, 2_000_000, 4_000_000);
    expect(scene.positions.length).toBe(9);
    expect(scene.indices.length).toBe(3);
    expect(scene.materials).toHaveLength(1);
    expect(scene.primitives[0].index_count).toBe(3);
    expect(scene.nodes[0].name).toBe("triangle");
    expect(written.summary.bounds).toEqual([0, 0, 0, 1, 1, 0]);
  });

  it("refuses overlapping section offsets", () => {
    const written = writeSafeScene({ unit: "none", roots: [triangle()] });
    const bytes = written.bytes.slice();
    const view = new DataView(bytes.buffer);
    const count = view.getUint32(8, true);
    let primitivesAt = -1;
    let materialsAt = -1;
    for (let index = 0; index < count; index += 1) {
      const at = 44 + index * 28;
      if (view.getUint32(at, true) === 6) primitivesAt = at;
      if (view.getUint32(at, true) === 5) materialsAt = at;
    }
    view.setBigUint64(primitivesAt + 4, BigInt(Number(view.getBigUint64(materialsAt + 4, true))), true);
    expect(() => decodeSafeScene(bytes, 2_000_000, 4_000_000)).toThrow("special_view.corrupt");
  });

  it("refuses a non-finite node transform", () => {
    const written = writeSafeScene({ unit: "none", roots: [triangle()] });
    const bytes = written.bytes.slice();
    const view = new DataView(bytes.buffer);
    const nodeAt = sectionOffset(bytes, 7);
    view.setFloat32(nodeAt + 20, Number.NaN, true);
    expect(() => decodeSafeScene(bytes, 2_000_000, 4_000_000)).toThrow("special_view.corrupt");
  });

  it("hashes helper output with SHA-256", () => {
    const hash = new Sha256();
    hash.update(new TextEncoder().encode("abc"));
    expect(hash.hex()).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
