import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dedupeShelfSources,
  isPersistedShelfSource,
  shelfDropPaths,
  shelfSourceKey,
  validateShelfCatalog,
} from "../shelf/shelfValidation";
import {
  patchShelf,
  type ShelfCatalog,
  type ShelfItem,
} from "../services/shelf";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../services/settings", () => ({ isTauriRuntime: () => true }));

const invokeMock = vi.mocked(invoke);

const disk = (path: string) => ({ kind: "disk" as const, path });

function item(id: string, path: string, state: ShelfItem["state"] = "available"): ShelfItem {
  return {
    id,
    source: disk(path),
    display_name: path.split("\\").pop() ?? path,
    added_unix: 1,
    state,
    last_checked_unix: 1,
    runtime_sensitive: false,
  };
}

function catalog(revision = 2, items: ShelfItem[] = [item("00000000-0000-4000-8000-000000000001", "C:\\Shelf\\a.txt")]): ShelfCatalog {
  return { schema_version: 1, revision, items };
}

beforeEach(() => invokeMock.mockReset());

describe("shelf references", () => {
  it("deduplicates normalized disk paths and rejects drafts", () => {
    const sources = dedupeShelfSources([
      disk("C:\\Shelf\\A.TXT"),
      disk("c:/shelf/a.txt"),
      disk("\\\\?\\C:\\Shelf\\B.txt"),
    ]);
    expect(sources).toHaveLength(2);
    expect(shelfSourceKey(disk("C:\\Shelf\\A.TXT"))).toBe(
      shelfSourceKey(disk("c:/shelf/a.txt")),
    );
    expect(() =>
      dedupeShelfSources([
        { kind: "draft", draft_id: "00000000-0000-4000-8000-000000000002" },
      ]),
    ).toThrow("shelf.invalid");
    expect(isPersistedShelfSource(sources[0])).toBe(true);
  });

  it("refuses 1,001 sources before any invoke", async () => {
    const sources = Array.from({ length: 1001 }, (_, index) =>
      disk(`C:\\Shelf\\f${index}.txt`),
    );
    await expect(patchShelf({ kind: "add", sources }, 1)).rejects.toThrow("shelf.limit");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("clear is a reference-only change with the exact revision", async () => {
    invokeMock.mockResolvedValueOnce(catalog(4, []));
    await patchShelf({ kind: "clear" }, 3);
    expect(invokeMock).toHaveBeenCalledWith("shelf_patch", {
      patch: { kind: "clear" },
      expectedRevision: 3,
    });
  });

  it("virtual references stay memory-only and keep the sensitive flag", () => {
    const virtual = {
      kind: "virtual" as const,
      provider: "locked" as const,
      container_path: "C:\\Sealed",
      entry_id: "00000000-0000-4000-8000-000000000003",
    };
    expect(isPersistedShelfSource(virtual)).toBe(false);
    const runtime: ShelfItem = {
      id: "00000000-0000-4000-8000-000000000004",
      source: virtual,
      display_name: "00000000-0000-4000-8000-000000000003",
      added_unix: 1,
      state: "available",
      runtime_sensitive: true,
    };
    expect(validateShelfCatalog(catalog(2, [runtime])).items[0].runtime_sensitive).toBe(true);
    expect(() =>
      validateShelfCatalog(catalog(2, [{ ...runtime, runtime_sensitive: false }])),
    ).toThrow("shelf.invalid");
  });

  it("a revision race rejects with shelf.changed and keeps the response untouched", async () => {
    invokeMock.mockRejectedValueOnce("shelf.changed");
    await expect(patchShelf({ kind: "remove", ids: [catalog().items[0].id] }, 2)).rejects.toBe(
      "shelf.changed",
    );
    expect(invokeMock).toHaveBeenCalledWith("shelf_patch", {
      patch: { kind: "remove", ids: ["00000000-0000-4000-8000-000000000001"] },
      expectedRevision: 2,
    });
  });

  it("drops only absolute unique paths", () => {
    expect(
      shelfDropPaths([
        "C:\\Shelf\\a.txt",
        "c:\\shelf\\A.txt",
        "relative.txt",
        "\\\\server\\share\\b.txt",
      ]),
    ).toEqual(["C:\\Shelf\\a.txt", "\\\\server\\share\\b.txt"]);
  });
});
