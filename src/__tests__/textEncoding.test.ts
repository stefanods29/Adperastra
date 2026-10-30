import { describe, expect, it } from "vitest";
import { decodeText, detectEncoding, lineEndingOf } from "../handlers/text/encoding";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("text encodings", () => {
  it("recognizes byte-order marks", () => {
    expect(detectEncoding(bytes(0xef, 0xbb, 0xbf, 0x41))).toEqual({ encoding: "utf-8", bomLength: 3 });
    expect(detectEncoding(bytes(0xff, 0xfe, 0x41, 0x00))).toEqual({ encoding: "utf-16le", bomLength: 2 });
    expect(detectEncoding(bytes(0xfe, 0xff, 0x00, 0x41))).toEqual({ encoding: "utf-16be", bomLength: 2 });
  });

  it("accepts UTF-8 even when the sample ends inside a character", () => {
    const text = new TextEncoder().encode("año ñandú €");
    expect(detectEncoding(text).encoding).toBe("utf-8");
    expect(detectEncoding(text.subarray(0, text.length - 1)).encoding).toBe("utf-8");
  });

  it("falls back to Windows-1252 for other bytes", () => {
    expect(detectEncoding(bytes(0x61, 0xf1, 0x6f)).encoding).toBe("windows-1252");
    expect(decodeText(bytes(0x61, 0xf1, 0x6f), "windows-1252")).toBe("año");
  });

  it("skips the byte-order mark when decoding", () => {
    expect(decodeText(bytes(0xef, 0xbb, 0xbf, 0x68, 0x69), "utf-8")).toBe("hi");
    expect(decodeText(bytes(0xff, 0xfe, 0x68, 0x00, 0x69, 0x00), "utf-16le")).toBe("hi");
  });

  it("names line endings", () => {
    expect(lineEndingOf("a\r\nb\r\n")).toBe("crlf");
    expect(lineEndingOf("a\nb\n")).toBe("lf");
    expect(lineEndingOf("a\r\nb\n")).toBe("mixed");
    expect(lineEndingOf("abc")).toBe("none");
  });
});
