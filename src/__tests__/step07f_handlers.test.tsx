import { describe, expect, it } from "vitest";
import { handlers } from "../handlers";
import { decideOpen } from "../handlers/openPipeline";
import type { FileTypeInfo } from "../services/files";

function info(ext: string, mime: string): FileTypeInfo {
  return {
    path: `C:\\Files\\sample.${ext}`,
    name: `sample.${ext}`,
    ext,
    mime,
    size: 100,
    modified_unix: 1,
    online_only: false,
    read_only: false,
    from_internet: false,
  };
}

function picked(ext: string, mime: string) {
  const decision = decideOpen(info(ext, mime), handlers);
  return decision.kind === "tab" ? decision.handler.id : "windows";
}

describe("extra viewer handlers", () => {
  it("unsupported MSG and drawio stay in the chosen app", () => {
    expect(picked("msg", "application/vnd.ms-outlook")).toBe("windows");
    expect(picked("drawio", "application/xml")).toBe("windows");
  });

  it(".db is SQLite only when the content says so", () => {
    expect(picked("db", "application/octet-stream")).toBe("windows");
    expect(picked("db", "application/vnd.sqlite3")).toBe("sqlite");
  });

  it("registers the six extra viewers before the generic handlers", () => {
    expect(picked("epub", "application/epub+zip")).toBe("book");
    expect(picked("ipynb", "application/json")).toBe("notebook");
    expect(picked("eml", "message/rfc822")).toBe("email");
    expect(picked("srt", "text/plain")).toBe("subtitle");
    expect(picked("log", "text/plain")).toBe("log");
    expect(picked("sqlite", "application/vnd.sqlite3")).toBe("sqlite");
  });

  it("keeps the older handler choices and their assertions", () => {
    expect(picked("md", "text/markdown")).toBe("markdown");
    expect(picked("csv", "text/csv")).toBe("table");
    expect(picked("json", "application/json")).toBe("json");
    expect(picked("txt", "text/plain")).toBe("text");
    expect(picked("png", "image/png")).toBe("image");
  });

  it("previewOnly never registers a save handle because every extra handler is read-only", () => {
    for (const id of ["book", "notebook", "email", "subtitle", "log", "sqlite"]) {
      const handler = handlers.get(id);
      expect(handler, `handler ${id}`).toBeTruthy();
      expect(handler?.editable ?? false, `handler ${id} editable`).toBe(false);
    }
  });
});
