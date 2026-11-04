import { beforeEach, describe, expect, it } from "vitest";
import {
  APP_CONVERTERS,
  getConverters,
  registerAppConverters,
  registerConverter,
  resetConverters,
  resolveConverter,
} from "../convert/registry";
import type { ConverterSpec } from "../convert/types";
import { optionsMatchConverter } from "../convert/types";

function spec(overrides: Partial<ConverterSpec> = {}): ConverterSpec {
  return {
    id: "image/png",
    inputs: ["png"],
    output: "png",
    options: [],
    input_mode: "each",
    max_input_bytes: 1024,
    max_output_bytes: 2048,
    lossy: false,
    preserves: [],
    engine_id: "test-1",
    available: true,
    help_slug: "converting-files",
    ...overrides,
  };
}

beforeEach(() => {
  resetConverters();
});

describe("converter registry", () => {
  it("refuses a duplicate converter id", () => {
    registerConverter(spec());
    expect(() => registerConverter(spec())).toThrow(/duplicate converter/);
  });

  it("returns the common intersection for mixed inputs", () => {
    registerAppConverters();
    const all = getConverters(["png", "jpeg"]);
    expect(all.some((item) => item.id === "image/png")).toBe(true);
    expect(all.some((item) => item.id === "image/jpeg")).toBe(true);
    expect(all.some((item) => item.id === "svg/png")).toBe(false);
    expect(getConverters(["png", "svg"])).toHaveLength(0);
  });

  it("never advertises AVIF output", () => {
    registerAppConverters();
    const outputs = APP_CONVERTERS.map((item) => item.output);
    expect(outputs).not.toContain("avif");
    expect(APP_CONVERTERS.some((item) => item.id === "image/avif")).toBe(false);
    expect(resolveConverter("image/avif")).toBeNull();
    expect(APP_CONVERTERS.every((item) => item.available)).toBe(true);
  });

  it("refuses a typed options family that does not match the adapter", () => {
    const image = spec();
    expect(optionsMatchConverter(image, { kind: "image", value: {
      quality: 90,
      keep_aspect: true,
      allow_upscale: false,
      background_rgba: [255, 255, 255, 255],
      first_frame: false,
      metadata_keep: true,
    } })).toBe(true);
    expect(optionsMatchConverter(image, { kind: "pdf", value: {
      ranges: [],
      dpi: 150,
      image_format: "png",
      quality: 90,
      combine: true,
    } })).toBe(false);
    const imagesPdf = spec({ id: "images/pdf", inputs: ["png"], output: "pdf", input_mode: "combine" });
    expect(optionsMatchConverter(imagesPdf, { kind: "document", value: {
      include_images: true,
      page_size: "source",
      margin_mm: 20,
      sanitize: true,
      encoding: "utf8",
    } })).toBe(true);
    expect(optionsMatchConverter(imagesPdf, { kind: "image", value: {
      quality: 90,
      keep_aspect: true,
      allow_upscale: false,
      background_rgba: [255, 255, 255, 255],
      first_frame: false,
      metadata_keep: true,
    } })).toBe(false);
  });

  it("resolves a registered adapter and forgets it after reset", () => {
    registerConverter(spec());
    expect(resolveConverter("image/png")?.engine_id).toBe("test-1");
    resetConverters();
    expect(resolveConverter("image/png")).toBeNull();
  });
});
