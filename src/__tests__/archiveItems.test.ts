import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import {
  archiveTypeLabel,
  breadcrumbSegments,
  parentFolder,
  toExplorerItem,
} from "../handlers/archive/archiveItems";
import type { ArchiveItem } from "../services/archive";

const t = i18n.t.bind(i18n) as TFunction;

const file: ArchiveItem = {
  path: "docs/plan.md",
  name: "plan.md",
  kind: "file",
  size: 7,
  packed_size: 4,
  modified_unix: 100,
  encrypted: false,
};

describe("items inside an archive", () => {
  it("draws a file as an Explorer item", () => {
    const item = toExplorerItem(file);
    expect(item.path).toBe("docs/plan.md");
    expect(item.name).toBe("plan.md");
    expect(item.size).toBe(7);
    expect(item.modified_unix).toBe(100);
    expect(item.kind).toBe("file");
    expect(item.is_link).toBe(false);
    expect(item.file_id).toBeNull();
  });

  it("marks links and folders", () => {
    const link = toExplorerItem({ ...file, path: "link", name: "link", kind: "link", size: 0 });
    expect(link.kind).toBe("file");
    expect(link.is_link).toBe(true);
    const folder = toExplorerItem({ ...file, path: "docs", name: "docs", kind: "folder" });
    expect(folder.kind).toBe("folder");
  });

  it("names the type of each row", () => {
    expect(archiveTypeLabel(t, { name: "docs", kind: "folder" })).toBe("Folder");
    expect(archiveTypeLabel(t, { name: "link", kind: "link" })).toBe("Link");
    expect(archiveTypeLabel(t, { name: "plan.md", kind: "file" })).toBe("MD file");
    expect(archiveTypeLabel(t, { name: "notes", kind: "file" })).toBe("File");
  });

  it("builds the path bar and finds the parent folder", () => {
    expect(breadcrumbSegments("Project files.zip", "docs/old")).toEqual([
      { id: "", label: "Project files.zip" },
      { id: "docs", label: "docs" },
      { id: "docs/old", label: "old" },
    ]);
    expect(breadcrumbSegments("Project files.zip", "")).toEqual([
      { id: "", label: "Project files.zip" },
    ]);
    expect(parentFolder("docs/old")).toBe("docs");
    expect(parentFolder("docs")).toBe("");
    expect(parentFolder("")).toBe("");
  });
});
