import { describe, expect, it, vi } from "vitest";
import { codecImageHandler } from "../handlers/codecImage";
import { imageHandler } from "../handlers/image";
import { modelHandler } from "../handlers/model";
import { psdHandler } from "../handlers/psd";
import { rawHandler } from "../handlers/raw";
import { HandlerRegistry } from "../handlers/registry";
import { textHandler } from "../handlers/text";
import { SpecialPreviewGuard, SpecialPreviewRegistry } from "../preview/specialPreviewGuard";
import type { FileTypeInfo } from "../services/files";

function info(ext: string, mime: string): FileTypeInfo {
  return {
    path: `C:\\Files\\sample.${ext}`,
    name: `sample.${ext}`,
    ext,
    mime,
    size: 1,
    modified_unix: 1,
    online_only: false,
    read_only: true,
    from_internet: false,
  };
}

describe("special preview lifecycle", () => {
  it("ignores a preview that finishes after it was closed", () => {
    const guard = new SpecialPreviewGuard();
    const token = guard.begin();
    expect(guard.isCurrent(token)).toBe(true);
    guard.close();
    expect(guard.isCurrent(token)).toBe(false);
    const reopened = guard.begin();
    expect(guard.isCurrent(reopened)).toBe(true);
    expect(guard.isCurrent(token)).toBe(false);
  });

  it("closes every lease exactly once", async () => {
    const release = vi.fn(async () => undefined);
    const registry = new SpecialPreviewRegistry();
    registry.register({ lease_id: "a", release });
    registry.register({ lease_id: "b", release });
    registry.register({ lease_id: "a", release });
    expect(registry.size).toBe(2);
    await registry.closeAll();
    expect(release).toHaveBeenCalledTimes(3);
    expect(registry.size).toBe(0);
    registry.register({ lease_id: "late", release });
    expect(release).toHaveBeenCalledTimes(4);
  });

  it("keeps the existing type fallback and AVIF priority", () => {
    const registry = new HandlerRegistry();
    for (const handler of [imageHandler, modelHandler, psdHandler, rawHandler, codecImageHandler, textHandler]) {
      registry.register(handler);
    }
    expect(registry.pick(info("avif", "image/avif"))?.id).toBe("image");
    expect(registry.pick(info("stl", "model/stl"))?.id).toBe("model");
    expect(registry.pick(info("cr2", "application/octet-stream"))?.id).toBe("raw");
    expect(registry.pick(info("psd", "application/octet-stream"))?.id).toBe("psd");
    expect(registry.pick(info("txt", "text/plain"))?.id).toBe("text");
    expect(registry.pick(info("xyz", "application/octet-stream"))).toBeNull();
  });
});
