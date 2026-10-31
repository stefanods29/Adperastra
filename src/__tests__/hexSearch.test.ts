import { describe, expect, it, vi } from "vitest";
import { findInFile } from "../handlers/hex/findInFile";
import {
  encodeTextPattern,
  hexCharRange,
  offsetLocation,
  parseHexPattern,
  parseOffset,
  searchBytes,
} from "../handlers/hex/search";

const haystack = new Uint8Array([1, 2, 3, 1, 2]);
const needle = new Uint8Array([1, 2]);

function fileWith(size: number, entries: { offset: number; bytes: number[] }[]) {
  const data = new Uint8Array(size);
  for (const entry of entries) data.set(entry.bytes, entry.offset);
  return (start: number, end: number) => Promise.resolve(data.slice(start, Math.min(end, size)));
}

describe("hex search", () => {
  it("searchBytes finds forward and backwards", () => {
    expect(searchBytes(haystack, needle, 0, false)).toBe(0);
    expect(searchBytes(haystack, needle, 1, false)).toBe(3);
    expect(searchBytes(haystack, needle, 4, true)).toBe(3);
    expect(searchBytes(haystack, needle, 2, true)).toBe(0);
    expect(searchBytes(haystack, new Uint8Array([9]), 0, false)).toBe(-1);
    expect(searchBytes(haystack, new Uint8Array(), 0, false)).toBe(-1);
  });

  it("searchBytes folds only when asked", () => {
    const text = new Uint8Array([0x61, 0x42]);
    const pattern = new Uint8Array([0x41, 0x62]);
    expect(searchBytes(text, pattern, 0, false, true)).toBe(0);
    expect(searchBytes(text, pattern, 0, false, false)).toBe(-1);
  });

  it("parseHexPattern takes pairs", () => {
    expect(parseHexPattern("4D 5a")).toEqual(new Uint8Array([77, 90]));
    expect(parseHexPattern("4d5a")).toEqual(new Uint8Array([77, 90]));
    expect(parseHexPattern("4D 5")).toBeNull();
    expect(parseHexPattern("GG")).toBeNull();
    expect(parseHexPattern("")).toBeNull();
    expect(parseHexPattern("4D ".repeat(1025))).toBeNull();
  });

  it("encodeTextPattern uses UTF-8", () => {
    expect(encodeTextPattern("ñ")).toEqual(new Uint8Array([195, 177]));
    expect(encodeTextPattern("x".repeat(1025))).toBeNull();
  });

  it("parseOffset reads hex and decimal", () => {
    expect(parseOffset("1F", 64)).toBe(31);
    expect(parseOffset("0x1F", 64)).toBe(31);
    expect(parseOffset("#31", 64)).toBe(31);
    expect(parseOffset("40", 64)).toBeNull();
    expect(parseOffset("", 64)).toBeNull();
    expect(parseOffset("-1", 64)).toBeNull();
    expect(parseOffset("#abc", 64)).toBeNull();
    expect(parseOffset("0x", 64)).toBeNull();
    expect(parseOffset("FFFFFFFFFFFFFFFF", Number.MAX_SAFE_INTEGER)).toBeNull();
  });

  it("offsetLocation names the part and row", () => {
    expect(offsetLocation(1_048_592)).toEqual({ part: 1, row: 1 });
  });

  it("hexCharRange follows the wider gap", () => {
    expect(hexCharRange(0, 0)).toEqual([0, 2]);
    expect(hexCharRange(7, 8)).toEqual([21, 27]);
    expect(hexCharRange(15, 15)).toEqual([46, 48]);
  });

  it("findInFile finds a match across two chunks", async () => {
    const read = fileWith(3 * 1024 * 1024, [
      { offset: 2_097_150, bytes: [0x41, 0x42, 0x43, 0x44] },
    ]);
    const found = await findInFile({
      size: 3 * 1024 * 1024,
      needle: new Uint8Array([0x41, 0x42, 0x43, 0x44]),
      from: 0,
      backwards: false,
      fold: false,
      read,
    });
    expect(found).toBe(2_097_150);
  });

  it("findInFile wraps once", async () => {
    const read = fileWith(3 * 1024 * 1024, [{ offset: 10, bytes: [0x41, 0x42] }]);
    const found = await findInFile({
      size: 3 * 1024 * 1024,
      needle: new Uint8Array([0x41, 0x42]),
      from: 2 * 1024 * 1024,
      backwards: false,
      fold: false,
      read,
    });
    expect(found).toBe(10);
  });

  it("findInFile says when nothing matches", async () => {
    const read = fileWith(3 * 1024 * 1024, []);
    const found = await findInFile({
      size: 3 * 1024 * 1024,
      needle: new Uint8Array([0x41, 0x42]),
      from: 0,
      backwards: false,
      fold: false,
      read,
    });
    expect(found).toBeNull();
  });

  it("findInFile stops when it is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const read = vi.fn(async () => new Uint8Array());
    await expect(
      findInFile({
        size: 10,
        needle: new Uint8Array([1]),
        from: 0,
        backwards: false,
        fold: false,
        read,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(read).not.toHaveBeenCalled();
  });

  it("findInFile goes backwards", async () => {
    const read = fileWith(3 * 1024 * 1024, [
      { offset: 10, bytes: [0x41, 0x42] },
      { offset: 1_048_570, bytes: [0x41, 0x42] },
    ]);
    const found = await findInFile({
      size: 3 * 1024 * 1024,
      needle: new Uint8Array([0x41, 0x42]),
      from: 1_048_576,
      backwards: true,
      fold: false,
      read,
    });
    expect(found).toBe(1_048_570);
  });
});
