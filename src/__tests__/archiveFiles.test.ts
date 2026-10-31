import { describe, expect, it } from "vitest";
import { archiveBaseName, extractRequestFor, extractedFolderName, isArchivePath } from "../archive/archiveFiles";

const item = { path: "C:\\Users\\Ana\\Downloads\\photos.zip", size: 1234, modified_unix: 1700000000 };

describe("archive names", () => {
  it("recognizes the archive extensions", () => {
    for (const path of [
      "C:\\a\\b.zip",
      "C:\\a\\B.ZIP",
      "C:\\a\\x.tar.gz",
      "C:\\a\\x.tgz",
      "C:\\a\\x.7z",
      "\\\\?\\C:\\a\\b.xz",
      "C:\\a\\x.bz2",
      "C:\\a\\x.tbz",
      "C:\\a\\x.tbz2",
      "C:\\a\\x.tar.bz2",
      "C:\\a\\x.rar",
    ]) {
      expect(isArchivePath(path), path).toBe(true);
    }
    for (const path of ["C:\\a\\x.lz4", "C:\\a\\x.iso", "C:\\a\\x.txt", "C:\\a\\zip"]) {
      expect(isArchivePath(path), path).toBe(false);
    }
  });

  it("new archive extensions preserve office handlers", () => {
    // Office containers are a zip by content, but their own viewers claim
    // their names; the archive handler never steals them.
    for (const path of ["C:\\a\\report.docx", "C:\\a\\sheet.xlsx", "C:\\a\\deck.pptx"]) {
      expect(isArchivePath(path), path).toBe(false);
    }
  });

  it("unknown formats still use Windows", () => {
    for (const path of ["C:\\a\\photo.cr3", "C:\\a\\data.sqlite", "C:\\a\\setup.exe"]) {
      expect(isArchivePath(path), path).toBe(false);
    }
  });

  it("drops the archive extension, not the name's own one", () => {
    const cases: [string, string][] = [
      ["photos.zip", "photos"],
      ["photos.tar.gz", "photos"],
      ["Photos.TAR.XZ", "Photos"],
      ["notes.txt.gz", "notes.txt"],
      ["backup.tgz", "backup"],
      ["backup.tar.bz2", "backup"],
      ["backup.tbz2", "backup"],
      ["backup.tbz", "backup"],
      [".zip", ""],
      ["archive", "archive"],
    ];
    for (const [name, expected] of cases) {
      expect(archiveBaseName(name), name).toBe(expected);
    }
  });

  it("compound bzip2 name loses the whole suffix", () => {
    expect(archiveBaseName("photos.tar.bz2")).toBe("photos");
    expect(extractedFolderName("photos.tar.bz2", "Fallback")).toBe("photos");
  });

  it("falls back when the name has nothing left", () => {
    expect(extractedFolderName(".zip", "Extracted files")).toBe("Extracted files");
    expect(extractedFolderName("photos.zip", "Extracted files")).toBe("photos");
  });

  it("builds the extraction request for each mode", () => {
    const created = extractRequestFor(item, "newFolder", null, "Extracted files");
    expect(created).toEqual({
      archive: item.path,
      paths: [],
      base: "",
      dest_dir: "C:\\Users\\Ana\\Downloads",
      new_folder: "photos",
      expected_size: 1234,
      expected_modified: 1700000000,
    });
    expect(extractRequestFor(item, "here", null, "Extracted files").new_folder).toBeNull();
    const to = extractRequestFor(item, "to", "D:\\Out", "Extracted files");
    expect(to.dest_dir).toBe("D:\\Out");
    expect(to.new_folder).toBe("photos");
  });
});
