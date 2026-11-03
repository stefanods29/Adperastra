import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RenderLoop, setWireframe, type FrameScheduler } from "../handlers/model/modelRenderer";

function fakeScheduler() {
  let now = 0;
  let next = 1;
  const callbacks = new Map<number, (time: number) => void>();
  const scheduler: FrameScheduler = {
    request: (callback) => {
      const handle = next++;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel: (handle) => callbacks.delete(handle),
    now: () => now,
  };
  return {
    scheduler,
    advance(ms: number) {
      now += ms;
      const pending = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of pending) callback(now);
    },
    pending: () => callbacks.size,
    setNow(value: number) {
      now = value;
    },
  };
}

describe("model renderer", () => {
  it("stops the render loop when the view is hidden", () => {
    const fake = fakeScheduler();
    let renders = 0;
    const loop = new RenderLoop(() => {
      renders += 1;
    }, fake.scheduler, 500);
    loop.request();
    expect(fake.pending()).toBe(1);
    fake.advance(16);
    expect(renders).toBe(1);
    fake.setNow(600);
    fake.advance(16);
    expect(fake.pending()).toBe(0);
    loop.setActive(false);
    loop.request();
    expect(fake.pending()).toBe(0);
    expect(renders).toBe(2);
    loop.dispose();
  });

  it("keeps the geometry when wireframe is toggled", () => {
    const geometry = { id: "geometry" };
    const built = {
      root: {},
      geometries: [geometry],
      materials: [{ wireframe: false, needsUpdate: false }, { wireframe: false, needsUpdate: false }],
      textures: [],
      dispose: () => undefined,
    } as never;
    setWireframe(built, true);
    expect((built as { geometries: unknown[] }).geometries[0]).toBe(geometry);
    expect((built as { materials: Array<{ wireframe: boolean }> }).materials.every((material) => material.wireframe)).toBe(true);
    setWireframe(built, false);
    expect((built as { geometries: unknown[] }).geometries[0]).toBe(geometry);
  });

  it("gives the main renderer no file loader", () => {
    const source = readFileSync(resolve(process.cwd(), "src/handlers/model/modelRenderer.ts"), "utf8");
    expect(source).not.toMatch(/from\s+"three\/examples\/jsm\/loaders/);
    expect(source).not.toMatch(/STLLoader|OBJLoader|GLTFLoader|ThreeMFLoader/);
    expect(source).toContain("new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false })");
  });
});
