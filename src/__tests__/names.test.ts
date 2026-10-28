import { describe, expect, it } from "vitest";
import { cleanTypedName, displayName, nameProblem, nameSelectionEnd, splitExtension } from "../services/names";
import { dateBucket, groupItems, sizeBucket } from "../services/grouping";

describe("names", () => {
  it("finds problems the way Windows does", () => {
    expect(nameProblem("report.docx")).toBeNull();
    expect(nameProblem("  spaced  ")).toBeNull();
    expect(nameProblem("")).toBe("empty");
    expect(nameProblem("...")).toBe("empty");
    expect(nameProblem("a/b")).toBe("invalidChars");
    expect(nameProblem("what?")).toBe("invalidChars");
    expect(nameProblem("CON")).toBe("reserved");
    expect(nameProblem("lpt1.txt")).toBe("reserved");
    expect(nameProblem("COM10")).toBeNull();
    expect(nameProblem("a".repeat(256))).toBe("tooLong");
    expect(cleanTypedName(" notes.txt.. ")).toBe("notes.txt");
  });

  it("selects only the name part of files", () => {
    expect(nameSelectionEnd("Q4 Budget.xlsx", "file")).toBe(9);
    expect(nameSelectionEnd("archive.tar.gz", "file")).toBe(11);
    expect(nameSelectionEnd(".gitignore", "file")).toBe(10);
    expect(nameSelectionEnd("v1.2 folder", "folder")).toBe(11);
    expect(splitExtension("photo.JPG", "file")).toEqual({ base: "photo", extension: ".JPG" });
    expect(displayName("photo.JPG", "file", false)).toBe("photo");
    expect(displayName("photo.JPG", "file", true)).toBe("photo.JPG");
    expect(displayName("my.folder", "folder", false)).toBe("my.folder");
  });
});

describe("grouping", () => {
  const now = new Date(2026, 9, 28, 15, 0, 0); // Wednesday 28 Oct 2026
  const unix = (y: number, m: number, d: number) => Math.floor(new Date(y, m, d, 12).getTime() / 1000);

  it("puts dates in Windows-style buckets", () => {
    expect(dateBucket(unix(2026, 9, 28), now)).toBe("today");
    expect(dateBucket(unix(2026, 9, 27), now)).toBe("yesterday");
    expect(dateBucket(unix(2026, 9, 26), now)).toBe("earlierThisWeek");
    expect(dateBucket(unix(2026, 9, 21), now)).toBe("lastWeek");
    expect(dateBucket(unix(2026, 9, 2), now)).toBe("earlierThisMonth");
    expect(dateBucket(unix(2026, 8, 15), now)).toBe("lastMonth");
    expect(dateBucket(unix(2026, 1, 1), now)).toBe("earlierThisYear");
    expect(dateBucket(unix(2020, 1, 1), now)).toBe("longAgo");
    expect(dateBucket(0, now)).toBe("unknownDate");
  });

  it("sizes and names fall into fixed groups in a fixed order", () => {
    expect(sizeBucket("folder", 0)).toBe("folders");
    expect(sizeBucket("file", 0)).toBe("empty");
    expect(sizeBucket("file", 2048)).toBe("tiny");
    expect(sizeBucket("file", 5 * 1024 ** 3)).toBe("gigantic");
    const items = [
      { name: "zebra.txt", kind: "file", size: 10, modified_unix: 0 },
      { name: "Árbol.txt", kind: "file", size: 10, modified_unix: 0 },
      { name: "7 days.txt", kind: "file", size: 10, modified_unix: 0 },
      { name: "_notes", kind: "folder", size: 0, modified_unix: 0 },
    ];
    const groups = groupItems(items, "name", now, () => "");
    expect(groups.map((g) => g.id)).toEqual(["digits", "aToH", "qToZ", "other"]);
    const byType = groupItems(items, "type", now, (i) => (i.kind === "folder" ? "Folder" : "TXT file"));
    expect(byType.map((g) => g.label)).toEqual(["Folder", "TXT file"]);
    expect(groupItems(items, "none", now, () => "")[0].items).toHaveLength(4);
  });
});
