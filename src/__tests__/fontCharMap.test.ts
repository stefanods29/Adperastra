import { describe, expect, it } from "vitest";
import { charMapRows, codePointAt, formatCodePoint } from "../handlers/font/charMap";

describe("character map", () => {
  it("codePointAt walks the ranges", () => {
    const ranges: [number, number][] = [
      [65, 67],
      [70, 70],
    ];
    expect(codePointAt(ranges, 0)).toBe(65);
    expect(codePointAt(ranges, 2)).toBe(67);
    expect(codePointAt(ranges, 3)).toBe(70);
    expect(codePointAt(ranges, 4)).toBeNull();
  });

  it("formatCodePoint pads to four digits", () => {
    expect(formatCodePoint(65)).toBe("U+0041");
    expect(formatCodePoint(0x1f600)).toBe("U+1F600");
  });

  it("charMapRows divides the cells", () => {
    expect(charMapRows(10, 4)).toBe(3);
  });
});
