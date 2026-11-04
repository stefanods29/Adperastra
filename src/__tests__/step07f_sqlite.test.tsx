import { describe, expect, it } from "vitest";
import { SQLITE_ALLOWED_ACTIONS, cellText } from "../handlers/sqlite/SqliteView";

describe("SQLite cell display", () => {
  it("integer 9007199254740993 remains an exact string", () => {
    expect(cellText({ kind: "integer", value: "9007199254740993" })).toBe(
      "9007199254740993",
    );
  });

  it("NULL and BLOB are explicit, not empty strings", () => {
    expect(cellText({ kind: "null" })).toBe("NULL");
    expect(cellText({ kind: "blob", blob_size: "3", preview_hex: "000102" })).toBe(
      "BLOB (3) 000102",
    );
  });

  it("offers no SQL or write action", () => {
    expect(SQLITE_ALLOWED_ACTIONS).not.toContain("sql");
    expect(SQLITE_ALLOWED_ACTIONS).not.toContain("write");
    expect(SQLITE_ALLOWED_ACTIONS).not.toContain("delete");
  });
});
