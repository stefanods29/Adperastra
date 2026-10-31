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
    ]) {
      expect(isArchivePath(path), path).toBe(true);
    }
    for (const path of ["C:\\a\\x.rar", "C:\\a\\x.bz2", "C:\\a\\x.docx", "C:\\a\\zip"]) {
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
      [".zip", ""],
      ["archive", "archive"],
    ];
    for (const [name, expected] of cases) {
      expect(archiveBaseName(name), name).toBe(expected);
    }
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
