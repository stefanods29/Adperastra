/** Hex viewer search helpers (Step 06f D12, D13). Pure, unit-tested. */

import { BYTES_PER_ROW, HEX_PART_BYTES } from "./format";

/** The longest pattern the search accepts. */
export const MAX_PATTERN_BYTES = 1024;

/** A to Z ignore case; every other byte stays as it is. */
export function foldAscii(byte: number): number {
  return byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte;
}

/** The first match at or after `from` (or the last at or before it, going
 * backwards), or -1. An empty needle finds nothing. */
export function searchBytes(
  haystack: Uint8Array,
  needle: Uint8Array,
  from: number,
  backwards: boolean,
  fold = false,
): number {
  if (needle.length === 0 || needle.length > haystack.length) return -1;
  const same = (index: number): boolean => {
    for (let offset = 0; offset < needle.length; offset += 1) {
      const left = haystack[index + offset];
      const right = needle[offset];
      if (fold ? foldAscii(left) !== foldAscii(right) : left !== right) return false;
    }
    return true;
  };
  if (backwards) {
    const start = Math.min(haystack.length - needle.length, from);
    for (let index = start; index >= 0; index -= 1) {
      if (same(index)) return index;
    }
    return -1;
  }
  for (let index = Math.max(0, from); index + needle.length <= haystack.length; index += 1) {
    if (same(index)) return index;
  }
  return -1;
}

/** Pairs of hex digits, with or without spaces, as bytes. */
export function parseHexPattern(text: string): Uint8Array | null {
  const cleaned = text.replace(/\s+/g, "");
  if (cleaned === "" || cleaned.length % 2 !== 0) return null;
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) return null;
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(cleaned.slice(index * 2, index * 2 + 2), 16);
  }
  if (bytes.length > MAX_PATTERN_BYTES) return null;
  return bytes;
}

/** Text as UTF-8 bytes, at most 1,024 of them. */
export function encodeTextPattern(text: string): Uint8Array | null {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length === 0 || bytes.length > MAX_PATTERN_BYTES) return null;
  return bytes;
}

/** An offset as the user typed it: hexadecimal by default, decimal after
 * `#`. Null when it is not a number inside the file. */
export function parseOffset(text: string, size: number): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  let value: number;
  if (trimmed.startsWith("#")) {
    const digits = trimmed.slice(1);
    if (!/^\d+$/.test(digits)) return null;
    value = Number(digits);
  } else {
    const digits = trimmed.toLowerCase().startsWith("0x") ? trimmed.slice(2) : trimmed;
    if (!/^[0-9a-fA-F]+$/.test(digits)) return null;
    value = Number.parseInt(digits, 16);
  }
  if (!Number.isSafeInteger(value) || value < 0 || value >= size) return null;
  return value;
}

/** The part and row an offset lives in. */
export function offsetLocation(offset: number): { part: number; row: number } {
  return {
    part: Math.floor(offset / HEX_PART_BYTES),
    row: Math.floor((offset % HEX_PART_BYTES) / BYTES_PER_ROW),
  };
}

/** Where bytes `first` to `last` of a row sit in its hex string: three
 * characters a pair, plus the wider gap after the eighth byte. */
export function hexCharRange(first: number, last: number): [number, number] {
  const position = (index: number) => 3 * index + (index >= 8 ? 1 : 0);
  return [position(first), position(last) + 2];
}
