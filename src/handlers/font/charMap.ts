/** The font viewer's character map (Step 06f). Pure, unit-tested. */

/** An inclusive code point range, as the font helper sends it. */
export type CodeRange = [number, number];

/** The code point at an index across the ranges, or null past the end. */
export function codePointAt(ranges: readonly CodeRange[], index: number): number | null {
  let remaining = index;
  for (const [first, last] of ranges) {
    const size = last - first + 1;
    if (remaining < size) return first + remaining;
    remaining -= size;
  }
  return null;
}

/** "U+0041" or "U+1F600". */
export function formatCodePoint(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** How many rows a grid of `perRow` cells needs. */
export function charMapRows(cells: number, perRow: number): number {
  if (perRow <= 0) return 0;
  return Math.ceil(cells / perRow);
}
