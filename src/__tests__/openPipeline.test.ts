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
});

describe("open pipeline (Step 04b)", () => {
  const registry = createHandlerRegistry();

  it("opens text, code, logs and Markdown in the app", () => {
    expect(decideOpen(info("notes.txt", "text/plain"), registry)).toMatchObject({ kind: "tab", handler: { id: "text" } });
    expect(decideOpen(info("main.rs", "application/octet-stream"), registry)).toMatchObject({ kind: "tab", handler: { id: "text" } });
    expect(decideOpen(info("README", "text/plain"), registry)).toMatchObject({ kind: "tab", handler: { id: "text" } });
    expect(decideOpen(info("guide.md", "text/markdown"), registry)).toMatchObject({ kind: "tab", handler: { id: "markdown" } });
  });

  it("sends big Markdown files to the text viewer", () => {
    expect(decideOpen(info("huge.md", "text/markdown", 6 * 1024 * 1024), registry)).toMatchObject({ kind: "tab", handler: { id: "text" } });
  });

  it("always opens programs, shortcuts and web pages in Windows", () => {
    for (const name of ["setup.exe", "link.url", "page.html", "install.msi", "app.lnk"]) {
      expect(decideOpen(info(name, "text/plain"), registry).kind).toBe("windows");
    }
  });
});
