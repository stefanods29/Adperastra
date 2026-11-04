import { describe, expect, it, vi } from "vitest";
import {
  PSD_MEMORY_LIMIT,
  escapeLayerName,
  flattenPsdLayers,
  inspectPsdHeader,
  readPsdDocument,
} from "../psd-helper/psdAdapter";

function header(width: number, height: number, depth = 8, version = 1): Uint8Array {
  const bytes = new Uint8Array(26);
  bytes.set([0x38, 0x42, 0x50, 0x53], 0);
  bytes[4] = version >> 8;
  bytes[5] = version & 0xff;
  bytes[12] = 0;
  bytes[13] = 3;
  bytes[14] = (height >>> 24) & 0xff;
  bytes[15] = (height >>> 16) & 0xff;
  bytes[16] = (height >>> 8) & 0xff;
  bytes[17] = height & 0xff;
  bytes[18] = (width >>> 24) & 0xff;
  bytes[19] = (width >>> 16) & 0xff;
  bytes[20] = (width >>> 8) & 0xff;
  bytes[21] = width & 0xff;
  bytes[22] = 0;
  bytes[23] = depth;
  bytes[24] = 0;
  bytes[25] = 3;
  return bytes;
}

function withLayerCount(count: number): Uint8Array {
  const bytes = new Uint8Array(44);
  bytes.set(header(2, 2), 0);
  // color mode length 0, image resources length 0.
  // layer-and-mask length 10, layer-info length 2, count.
  bytes[34] = 0;
  bytes[35] = 0;
  bytes[36] = 0;
  bytes[37] = 10;
  bytes[38] = 0;
  bytes[39] = 0;
  bytes[40] = 0;
  bytes[41] = 2;
  bytes[42] = (count >> 8) & 0xff;
  bytes[43] = count & 0xff;
  return bytes;
}

describe("PSD preflight", () => {
  it("refuses zero and 100,000,001 pixels before the library", () => {
    const readPsd = vi.fn();
    expect(() => readPsdDocument(header(0, 1), { readPsd })).toThrow("special_view.corrupt");
    expect(() => readPsdDocument(header(10_001, 10_000), { readPsd })).toThrow("special_view.too_large");
    expect(readPsd).not.toHaveBeenCalled();
  });

  it("refuses version 2 and depth 33 before the library", () => {
    const readPsd = vi.fn();
    expect(() => readPsdDocument(header(1, 1, 8, 2), { readPsd })).toThrow("special_view.unsupported");
    expect(() => readPsdDocument(header(1, 1, 33), { readPsd })).toThrow("special_view.unsupported");
    expect(readPsd).not.toHaveBeenCalled();
  });

  it("bounds the layer count before the library", () => {
    const readPsd = vi.fn();
    expect(() => readPsdDocument(withLayerCount(1001), { readPsd })).toThrow("special_view.too_large");
    expect(readPsd).not.toHaveBeenCalled();
  });

  it("never asks for linked files and uses the exact bounded options", () => {
    const readPsd = vi.fn().mockReturnValue({ width: 2, height: 2, children: [] });
    readPsdDocument(withLayerCount(0), { readPsd });
    expect(readPsd).toHaveBeenCalledTimes(1);
    expect(readPsd.mock.calls[0][1]).toEqual({
      skipLayerImageData: true,
      skipCompositeImageData: false,
      skipLinkedFilesData: true,
      useImageData: true,
      totalMemoryLimit: PSD_MEMORY_LIMIT,
    });
  });

  it("reports a missing composite instead of fabricating one", () => {
    const readPsd = vi.fn().mockReturnValue({ width: 2, height: 2, children: [] });
    const document = readPsdDocument(withLayerCount(0), { readPsd });
    expect(document.composite).toBeNull();
    expect(document.layers).toEqual([]);
  });

  it("keeps escaped layer names as text and bounds depth", () => {
    const layers = flattenPsdLayers([
      { name: "<img src=x onerror=alert(1)>", hidden: true, opacity: 0.5 },
    ]);
    expect(layers[0].name).toBe("<img src=x onerror=alert(1)>");
    expect(layers[0].visible).toBe(false);
    expect(escapeLayerName("a\u0000b")).toBe("a b");
    let deep: { name: string; children: unknown[] } = { name: "leaf", children: [] };
    for (let index = 0; index < 33; index += 1) deep = { name: `n${index}`, children: [deep] };
    expect(() => flattenPsdLayers([deep as never])).toThrow("special_view.too_large");
  });

  it("accepts a valid bounded header", () => {
    expect(inspectPsdHeader(withLayerCount(2))).toEqual({ width: 2, height: 2, depth: 8, layers: 2 });
  });
});
