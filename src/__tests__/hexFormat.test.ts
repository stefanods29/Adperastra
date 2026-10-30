import { describe, expect, it } from "vitest";
import { formatHexRow, HEX_PART_BYTES, hexPartCount, offsetDigits } from "../handlers/hex/format";

describe("hex viewer rows", () => {
  it("formats 16 bytes with a gap after the 8th and the bytes as text", () => {
    const bytes = new TextEncoder().encode("Hello, hex view!\u0001\u00ff");
    expect(formatHexRow(bytes, 0, 0, 8)).toEqual({
      offset: "00000000",
      hex: "48 65 6C 6C 6F 2C 20 68  65 78 20 76 69 65 77 21",
      text: "Hello, hex view!",
    });
    // The last row is short; bytes that are not printable show as ".".
    expect(formatHexRow(bytes, 16, 0x1000010, 8)).toEqual({ offset: "01000010", hex: "01 C3 BF", text: "..." });
  });

  it("counts parts and widens offsets for files over 4 GB", () => {
    expect(hexPartCount(0)).toBe(1);
    expect(hexPartCount(HEX_PART_BYTES)).toBe(1);
    expect(hexPartCount(HEX_PART_BYTES + 1)).toBe(2);
    expect(offsetDigits(1000)).toBe(8);
    expect(offsetDigits(5 * 1024 ** 3)).toBe(12);
  });
});
