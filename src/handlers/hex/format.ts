/** Hex viewer helpers (Step 04c). Pure, unit-tested. */

export const BYTES_PER_ROW = 16;
/** Bytes shown at a time ("part"), like the text viewer's large files. */
export const HEX_PART_BYTES = 1024 * 1024;

/** Number of parts of a file (at least 1, also for an empty file). */
export function hexPartCount(size: number): number {
  return Math.max(1, Math.ceil(size / HEX_PART_BYTES));
}

/** Hex digits of the offset column: 8, or 12 for files over 4 GB. */
export function offsetDigits(size: number): number {
  return size > 0xffffffff ? 12 : 8;
}

export interface HexRow {
  offset: string;
  hex: string;
  text: string;
}

/** One row: the offset in the file, up to 16 bytes in hex (a wider gap
 * after the 8th), and the same bytes as text (printable ASCII, "." for
 * anything else). `start` is the row's first index in `bytes`; `offset`
 * is that byte's position in the whole file. */
export function formatHexRow(bytes: Uint8Array, start: number, offset: number, digits: number): HexRow {
  const pairs: string[] = [];
  let text = "";
  for (let i = start; i < Math.min(bytes.length, start + BYTES_PER_ROW); i += 1) {
    const byte = bytes[i];
    pairs.push(byte.toString(16).toUpperCase().padStart(2, "0"));
    text += byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : ".";
  }
  const hex = pairs.length > 8 ? `${pairs.slice(0, 8).join(" ")}  ${pairs.slice(8).join(" ")}` : pairs.join(" ");
  return { offset: offset.toString(16).toUpperCase().padStart(digits, "0"), hex, text };
}
