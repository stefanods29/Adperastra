import { describe, expect, it } from "vitest";
import "../i18n";
import type { ExplorerItem } from "../services/explorer";
import {
  isPreviewNeighbor,
  previewItemAt,
  previewNeighbors,
} from "../preview/previewNavigation";

const item = (
  name: string,
  kind: ExplorerItem["kind"] = "file",
  onlineOnly = false,
): ExplorerItem => ({
  path: `C:\\F\\${name}`,
  name,
  kind,
  size: 100,
  modified_unix: 1700000000,
  hidden: false,
  system: false,
  is_link: false,
  online_only: onlineOnly,
  file_id: null,
  file_id_stable: false,
});

describe("quick preview navigation", () => {
  it("keeps non-folder entries and drops formats without a handler", () => {
    expect(isPreviewNeighbor(item("notes.txt"))).toBe(true);
    expect(isPreviewNeighbor(item("picture.png"))).toBe(true);
    expect(isPreviewNeighbor(item("unknown.zzz"))).toBe(false);
    expect(isPreviewNeighbor(item("folder", "folder"))).toBe(false);
    expect(isPreviewNeighbor(item("drive", "drive"))).toBe(false);
  });

  it("retains an online-only item as a cloud state", () => {
    expect(isPreviewNeighbor(item("cloud.zzz", "file", true))).toBe(true);
  });

  it("has no previous item at the first eligible position", () => {
    const items = [item("folder", "folder"), item("a.txt"), item("b.txt")];
    const neighbors = previewNeighbors(items, "C:\\F\\a.txt");
    expect(neighbors.index).toBe(0);
    expect(neighbors.previous).toBeNull();
    expect(neighbors.next).toBe("C:\\F\\b.txt");
  });

  it("has no next item at the last eligible position and never wraps", () => {
    const items = [item("a.txt"), item("unknown.zzz"), item("b.txt"), item("folder", "folder")];
    const neighbors = previewNeighbors(items, "C:\\F\\b.txt");
    expect(neighbors.index).toBe(1);
    expect(neighbors.previous).toBe("C:\\F\\a.txt");
    expect(neighbors.next).toBeNull();
  });

  it("matches paths case-insensitively, as Windows does", () => {
    const itemAt = previewItemAt([item("Photo.PNG")], "c:\\f\\photo.png");
    expect(itemAt?.name).toBe("Photo.PNG");
  });

  it("an unsupported focused file uses its nearest eligible neighbours", () => {
    const neighbors = previewNeighbors([item("a.txt"), item("x.zzz")], "C:\\F\\x.zzz");
    expect(neighbors).toEqual({ index: -1, previous: "C:\\F\\a.txt", next: null });
  });
});
