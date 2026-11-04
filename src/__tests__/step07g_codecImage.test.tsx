import { describe, expect, it } from "vitest";
import { codecImageHandler } from "../handlers/codecImage";
import { imageHandler } from "../handlers/image";
import { HandlerRegistry } from "../handlers/registry";
import type { FileTypeInfo } from "../services/files";

function info(ext: string, mime: string): FileTypeInfo {
  return {
    path: `C:\\Pictures\\sample.${ext}`,
    name: `sample.${ext}`,
    ext,
    mime,
    size: 1024,
    modified_unix: 1_700_000_000,
    online_only: false,
    read_only: true,
    from_internet: false,
  };
}

describe("HEIC/AVIF handler split", () => {
  it("keeps the existing AVIF image handler and never duplicates it", () => {
    const registry = new HandlerRegistry();
    registry.register(imageHandler);
    registry.register(codecImageHandler);
    expect(registry.pick(info("avif", "image/avif"))?.id).toBe("image");
    expect(registry.list().filter((handler) => handler.extensions.includes("avif"))).toHaveLength(1);
  });

  it("routes HEIC and HEIF to the codec image handler", () => {
    const registry = new HandlerRegistry();
    registry.register(imageHandler);
    registry.register(codecImageHandler);
    expect(registry.pick(info("heic", "image/heic"))?.id).toBe("codecImage");
    expect(registry.pick(info("heif", "image/heif"))?.id).toBe("codecImage");
  });

  it("does not claim a raw MIME fallback as octet-stream", () => {
    expect(codecImageHandler.mimeTypes).not.toContain("application/octet-stream");
    expect(codecImageHandler.maxBytes).toBe(256 * 1024 * 1024);
    expect(codecImageHandler.supportsFind).toBe(false);
  });
});
