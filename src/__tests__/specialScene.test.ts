import { describe, expect, it } from "vitest";
import { decodeSafeScene, sceneBounds } from "../handlers/model/safeScene";
import { writeSafeScene, type MeshSource } from "../model-helper/safeSceneWriter";

function mesh(): MeshSource {
  return {
    kind: "mesh",
    name: "tri",
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    positions: [0, 0, 0, 2, 0, 0, 0, 2, 0],
    indices: [0, 1, 2],
    material: { color: [0.2, 0.4, 0.6], opacity: 1, metallic: 0, roughness: 0.5, doubleSided: false, textureIndex: null },
  };
}

function entry(bytes: Uint8Array, kind: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(8, true);
  for (let index = 0; index < count; index += 1) {
    const at = 44 + index * 28;
    if (view.getUint32(at, true) === kind) return at;
  }
  throw new Error(`missing section ${kind}`);
}

describe("SafeScene1 decoder", () => {
  it("round-trips arrays, materials, primitives and nodes", () => {
    const written = writeSafeScene({ unit: "mm", roots: [mesh()] });
    const scene = decodeSafeScene(written.bytes, 2_000_000, 4_000_000);
    expect(Array.from(scene.positions)).toEqual([0, 0, 0, 2, 0, 0, 0, 2, 0]);
    expect(Array.from(scene.indices)).toEqual([0, 1, 2]);
    expect(scene.materials[0].rgba[0]).toBeCloseTo(0.2, 5);
    expect(scene.materials[0].rgba[1]).toBeCloseTo(0.4, 5);
    expect(scene.materials[0].rgba[2]).toBeCloseTo(0.6, 5);
    expect(scene.materials[0].rgba[3]).toBe(1);
    expect(scene.primitives[0]).toMatchObject({ first_vertex: 0, vertex_count: 3, first_index: 0, index_count: 3 });
    expect(scene.nodes[0]).toMatchObject({ id: 0, parent: null, primitive_id: 0, name: "tri" });
    expect(sceneBounds(scene)).toEqual([0, 0, 0, 2, 2, 0]);
  });

  it("refuses a truncated header and an unknown version", () => {
    expect(() => decodeSafeScene(new ArrayBuffer(10), 1, 1)).toThrow("special_view.corrupt");
    const written = writeSafeScene({ unit: "none", roots: [mesh()] }).bytes.slice();
    written[7] = 2;
    expect(() => decodeSafeScene(written, 1, 1)).toThrow("special_view.corrupt");
  });

  it("refuses overlapping directory ranges", () => {
    const written = writeSafeScene({ unit: "none", roots: [mesh()] }).bytes.slice();
    const view = new DataView(written.buffer);
    const primitives = entry(written, 6);
    const materials = entry(written, 5);
    view.setBigUint64(primitives + 4, BigInt(Number(view.getBigUint64(materials + 4, true))), true);
    expect(() => decodeSafeScene(written, 2_000_000, 4_000_000)).toThrow("special_view.corrupt");
  });

  it("refuses a non-finite node matrix", () => {
    const written = writeSafeScene({ unit: "none", roots: [mesh()] }).bytes.slice();
    const view = new DataView(written.buffer);
    const nodes = entry(written, 7);
    view.setFloat32(nodes + 20, Number.NaN, true);
    expect(() => decodeSafeScene(written, 2_000_000, 4_000_000)).toThrow("special_view.corrupt");
  });

  it("refuses an index outside the primitive vertex range", () => {
    const written = writeSafeScene({ unit: "none", roots: [mesh()] }).bytes.slice();
    const view = new DataView(written.buffer);
    const indices = entry(written, 4);
    view.setUint32(indices + 4 + 4, 2, true);
    const primitives = entry(written, 6);
    view.setUint32(primitives + 4, 2, true); // first_vertex = 2
    view.setUint32(primitives + 8, 1, true); // vertex_count = 1
    expect(() => decodeSafeScene(written, 2_000_000, 4_000_000)).toThrow("special_view.corrupt");
  });
});
