import { describe, expect, it, vi } from "vitest";
import {
  guardSpecialSource,
  parseSpecialKind,
  resolveModelResource,
  SPECIAL_MAX_SOURCE_BYTES,
  validateSceneBounds,
  validateTextureCount,
} from "../services/specialViews";
import { decodeSafeScene } from "../handlers/model/safeScene";

describe("special viewer contracts", () => {
  it("refuses an unknown kind instead of guessing one", () => {
    expect(parseSpecialKind("model")).toBe("model");
    expect(parseSpecialKind("raw")).toBe("raw");
    expect(parseSpecialKind("codec_image")).toBe("codec_image");
    expect(parseSpecialKind("psd")).toBe("psd");
    expect(() => parseSpecialKind("dvd")).toThrow("special_view.bad_request");
    expect(() => parseSpecialKind(undefined)).toThrow("special_view.bad_request");
  });

  it("refuses a non-finite scene bound", () => {
    expect(validateSceneBounds([0, 0, 0, 1, 1, 1])).toEqual([0, 0, 0, 1, 1, 1]);
    expect(() => validateSceneBounds([0, 0, 0, Number.NaN, 1, 1])).toThrow("special_view.corrupt");
    expect(() => validateSceneBounds([0, 0, 0, Number.POSITIVE_INFINITY, 1, 1])).toThrow("special_view.corrupt");
    expect(() => validateSceneBounds([2, 0, 0, 1, 1, 1])).toThrow("special_view.corrupt");
  });

  it("refuses a resource whose referrer is outside the allowed parent", () => {
    const parent = "C:\\Models\\cube";
    expect(resolveModelResource("C:\\Models\\cube\\cube.gltf", "textures/wood.png", parent)).toBe("textures/wood.png");
    expect(resolveModelResource("C:\\Models\\other\\cube.gltf", "textures/wood.png", parent)).toBeNull();
    expect(resolveModelResource("C:\\Models\\cube\\cube.gltf", "../secret.png", parent)).toBeNull();
    expect(resolveModelResource("C:\\Models\\cube\\cube.gltf", "C:\\Windows\\win.ini", parent)).toBeNull();
    expect(resolveModelResource("C:\\Models\\cube\\cube.gltf", "https://example.test/a.png", parent)).toBeNull();
    expect(resolveModelResource("C:\\Models\\cube\\cube.gltf", "%2e%2e/secret.png", parent)).toBeNull();
  });

  it("refuses a 512 MiB source before any parser runs", () => {
    const parse = vi.fn(() => "parsed");
    expect(() => guardSpecialSource(512 * 1024 * 1024, parse)).toThrow("special_view.too_large");
    expect(parse).not.toHaveBeenCalled();
    expect(guardSpecialSource(SPECIAL_MAX_SOURCE_BYTES, parse)).toBe("parsed");
  });

  it("bounds the texture list before textures exist", () => {
    expect(() => validateTextureCount(32)).not.toThrow();
    expect(() => validateTextureCount(33)).toThrow("special_view.too_large");
    expect(() => validateTextureCount(-1)).toThrow("special_view.too_large");
  });

  it("does not decode an empty scene blob", () => {
    expect(() => decodeSafeScene(new ArrayBuffer(0), 2_000_000, 4_000_000)).toThrow("special_view.corrupt");
  });
});
