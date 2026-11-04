import { describe, expect, it } from "vitest";
import type { ExplorerItem } from "../services/explorer";
import type { GalleryItem } from "../services/gallery";
import {
  GALLERY_UNDATED,
  galleryEffectiveUnix,
  galleryMonthKey,
  galleryMonthLabel,
  groupGalleryItems,
  sortGalleryItems,
} from "../views/gallery/galleryDates";

const explorerItem = (name: string, modified: number): ExplorerItem => ({
  path: `C:\\Pictures\\${name}`,
  name,
  kind: "file",
  size: 1,
  modified_unix: modified,
  hidden: false,
  system: false,
  is_link: false,
  online_only: false,
  file_id: null,
  file_id_stable: false,
});

const photo = (
  name: string,
  modified: number,
  taken: string | null = null,
): GalleryItem => ({
  item: explorerItem(name, modified),
  identity: `path:c:\\pictures\\${name.toLowerCase()}`,
  taken_utc: taken,
  group_key: "undated",
  source_ids: ["00000000-0000-4000-8000-000000000001"],
});

const MAY_2024 = Date.UTC(2024, 4, 1) / 1000;
/** Mid-month, so a UTC-5 local month is still May. */
const MAY_15_2024 = Date.UTC(2024, 4, 15) / 1000;

describe("galleryMonthKey", () => {
  it("uses the local month of the taken date (Lima is UTC-5)", () => {
    expect(
      galleryMonthKey(
        "2026-01-01T00:30:00Z",
        MAY_2024,
        "taken",
        "America/Lima",
      ),
    ).toBe("2025-12");
  });

  it("falls back to the modified date when no taken date exists", () => {
    expect(galleryMonthKey(null, MAY_2024, "taken", "UTC")).toBe("2024-05");
    expect(
      galleryMonthKey("not a date", MAY_2024, "taken", "UTC"),
    ).toBe("2024-05");
  });

  it("shows an undated group for zero dates", () => {
    expect(galleryMonthKey(null, 0, "modified", "UTC")).toBe(GALLERY_UNDATED);
    expect(galleryMonthKey(null, 0, "taken", "UTC")).toBe(GALLERY_UNDATED);
  });

  it("ignores the taken date in Modified mode", () => {
    expect(
      galleryMonthKey(
        "2026-01-01T00:30:00Z",
        MAY_2024,
        "modified",
        "UTC",
      ),
    ).toBe("2024-05");
  });

  it("formats a month label for the active locale", () => {
    expect(galleryMonthLabel("2025-12", "en")).toContain("December");
    expect(galleryMonthLabel("2025-12", "es")).toContain("diciembre");
    expect(galleryMonthLabel(GALLERY_UNDATED, "en")).toBe("");
  });
});

describe("gallery ordering", () => {
  it("treats a missing taken date as modified seconds", () => {
    expect(galleryEffectiveUnix(null, MAY_2024, "taken")).toBe(MAY_2024);
    expect(
      galleryEffectiveUnix("2026-01-01T00:30:00Z", MAY_2024, "taken"),
    ).toBe(1_767_227_400);
  });

  it("sorts newest first with a path tie-break", () => {
    const items = [
      photo("b.png", 100),
      photo("a.png", 100),
      photo("new.png", 200),
    ];
    expect(sortGalleryItems(items, "modified").map((item) => item.item.name)).toEqual([
      "new.png",
      "a.png",
      "b.png",
    ]);
  });

  it("groups months newest first and undated last", () => {
    const items = [
      photo("a.png", MAY_15_2024),
      photo("b.png", MAY_15_2024, "2026-02-01T10:00:00Z"),
      photo("c.png", MAY_15_2024, "2026-01-01T00:30:00Z"),
      photo("d.png", 0),
    ];
    const groups = groupGalleryItems(items, "taken", "America/Lima", "en");
    expect(groups.map((group) => group.key)).toEqual([
      "2026-02",
      "2025-12",
      "2024-05",
      GALLERY_UNDATED,
    ]);
    expect(groups[1].items.map((item) => item.item.name)).toEqual(["c.png"]);
  });
});
