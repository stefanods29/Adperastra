import { describe, expect, it } from "vitest";
import { createHandlerRegistry } from "../handlers";
import { decideOpen } from "../handlers/openPipeline";
import type { FileTypeInfo } from "../services/files";

const info = (name: string, mime: string, size = 1000): FileTypeInfo => ({
  path: `C:\\${name}`,
  name,
  ext: name.includes(".") ? name.split(".").pop()!.toLowerCase() : "",
  mime,
  size,
  modified_unix: 0,
  online_only: false,
  read_only: false,
  from_internet: false,
});

describe("handler registry", () => {
  const registry = createHandlerRegistry();

  it("opens images in the image handler", () => {
    expect(registry.pick(info("a.png", "image/png"))?.id).toBe("image");
    expect(registry.pick(info("b.JPG".toLowerCase(), "image/jpeg"))?.id).toBe("image");
    expect(registry.pick(info("c.svg", "image/svg+xml"))?.id).toBe("image");
  });

  it("recognizes an image by its content even with another extension", () => {
    expect(registry.pick(info("photo.dat", "image/png"))?.id).toBe("image");
  });

  it("leaves unknown types to the Windows app", () => {
    expect(registry.pick(info("setup.exe", "application/vnd.microsoft.portable-executable"))).toBeNull();
    expect(decideOpen(info("setup.exe", "application/octet-stream"), registry).kind).toBe("windows");
  });

  it("sends files over the size limit to the Windows app", () => {
    expect(decideOpen(info("huge.png", "image/png", 300 * 1024 * 1024), registry).kind).toBe("windows");
  });

  it("follows a 'windows' preference", () => {
    expect(decideOpen(info("a.png", "image/png"), registry, "windows").kind).toBe("windows");
  });

  it("ties go to the table and JSON viewers, and big files fall back to text", () => {
    expect(registry.pick(info("a.csv", "text/csv"))?.id).toBe("table");
    expect(registry.pick(info("a.csv", "text/csv", 134_217_729))?.id).toBe("text");
    expect(registry.pick(info("a.json", "application/json"))?.id).toBe("json");
    expect(registry.pick(info("a.json", "application/json", 33_554_433))?.id).toBe("text");
  });

  it("refuses duplicate handler ids", () => {
    const fresh = createHandlerRegistry();
    expect(() => fresh.register(fresh.get("image")!)).toThrow();
  });
});
