import { describe, expect, it } from "vitest";
import { fileTile } from "../views/explorer/fileTile";
import { formatDate, formatSize } from "../services/format";
import { mergeRecentItems, type RecentItem } from "../services/explorer";

describe("fileTile", () => {
  it("maps folders and known extensions to tones", () => {
    expect(fileTile("Docs", "folder").tone).toBe("folder");
    expect(fileTile("book.xlsx", "file").tone).toBe("sheet");
    expect(fileTile("paper.DOCX", "file").tone).toBe("doc");
    expect(fileTile("slides.pdf", "file").tone).toBe("pdf");
    expect(fileTile("photo.png", "file").tone).toBe("image");
    expect(fileTile("clip.mp4", "file").tone).toBe("video");
    expect(fileTile("song.mp3", "file").tone).toBe("audio");
    expect(fileTile("pack.zip", "file").tone).toBe("archive");
    expect(fileTile("main.ts", "file").tone).toBe("code");
    expect(fileTile("mystery.xyz", "file").tone).toBe("generic");
  });
});

describe("format helpers", () => {
  it("formats sizes with locale numbers and binary units", () => {
    expect(formatSize(0, "en")).toBe("0 B");
    expect(formatSize(1536, "en")).toBe("1.5 KB");
    expect(formatSize(2 * 1024 * 1024, "en")).toBe("2 MB");
    expect(formatSize(1536, "es")).toContain(",");
  });

  it("formats unix seconds as a locale date-time and survives zero", () => {
    expect(formatDate(0, "en")).toBe("");
    const text = formatDate(1761696000, "en-US");
    expect(text).toContain("2025");
  });
});

describe("mergeRecentItems", () => {
  const item = (name: string, path: string, modified: number): RecentItem => ({ name, path, kind: "file", modified_unix: modified });
  it("puts our own visited folders first and dedupes by path", () => {
    const windows = [item("a.txt", "C:\\Docs\\a.txt", 50), item("docs", "C:\\Docs", 40)];
    const merged = mergeRecentItems(windows, ["C:\\Docs", "D:\\Projects"]);
    expect(merged.map((i) => i.path)).toEqual(["C:\\Docs", "D:\\Projects", "C:\\Docs\\a.txt"]);
    expect(merged[1].kind).toBe("folder");
    expect(merged[1].name).toBe("Projects");
  });
});
