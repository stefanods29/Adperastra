import { describe, expect, it } from "vitest";
import {
  defaultLineEnding,
  defaultSaveEncoding,
  firstUnmappable,
  joinLines,
  readOnlyReason,
  singleByteTable,
  spellcheckDefault,
} from "../editor/saveEncoding";

describe("save encodings", () => {
  it("default save encodings keep the file's own", () => {
    expect(defaultSaveEncoding("utf-8", true)).toBe("utf-8-bom");
    expect(defaultSaveEncoding("utf-8", false)).toBe("utf-8");
    expect(defaultSaveEncoding("iso-8859-1", false)).toBe("windows-1252");
    expect(defaultSaveEncoding("windows-1251", false)).toBe("windows-1251");
    expect(defaultSaveEncoding("gbk", false)).toBe("utf-8");
  });

  it("single-byte tables come from the browser", () => {
    const table = singleByteTable("windows-1252")!;
    expect(table).toHaveLength(256);
    expect(table[233]).toBe("é");
    // Chromium, which the app runs on, gives "€". Node 22's decoder treats this
    // encoding as Latin-1 and gives U+0080, so the test accepts both.
    expect(["€", "\u0080"]).toContain(table[128]);
    expect(singleByteTable("utf-8")).toBeNull();
  });

  it("firstUnmappable names the line and column", () => {
    const cyrillic = singleByteTable("windows-1251")!;
    expect(firstUnmappable("ab\ncdé", cyrillic)).toEqual({ char: "é", line: 2, column: 3 });
    expect(firstUnmappable("abc", singleByteTable("windows-1252")!)).toBeNull();
  });

  it("defaultLineEnding picks the most common", () => {
    expect(defaultLineEnding("a\r\nb\r\nc\nd")).toBe("crlf");
    expect(defaultLineEnding("a\nb\nc\r\nd")).toBe("lf");
    expect(defaultLineEnding("a\r\nb\nc")).toBe("crlf");
    expect(defaultLineEnding("abc")).toBe("crlf");
  });

  it("joinLines uses the chosen ending", () => {
    expect(joinLines(["a", "b", ""], "crlf")).toBe("a\r\nb\r\n");
    expect(joinLines(["a", "b", ""], "lf")).toBe("a\nb\n");
  });

  it("readOnlyReason checks in order", () => {
    const base = { paged: false, protectedView: false, readOnly: false, encoding: "utf-8" as const };
    expect(readOnlyReason(base)).toBeNull();
    expect(readOnlyReason({ ...base, paged: true, protectedView: true })).toBe("large");
    expect(readOnlyReason({ ...base, protectedView: true, readOnly: true })).toBe("protected");
    expect(readOnlyReason({ ...base, readOnly: true, encoding: "shift_jis" })).toBe("attribute");
    expect(readOnlyReason({ ...base, encoding: "big5" })).toBe("encoding");
  });

  it("spelling is on for prose", () => {
    expect(spellcheckDefault("txt")).toBe(true);
    expect(spellcheckDefault("md")).toBe(true);
    expect(spellcheckDefault("js")).toBe(false);
  });
});
