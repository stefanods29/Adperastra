/** App-owned treemap layout (Step 11c T3 D4).
 *
 * Alternating horizontal/vertical slice-and-dice. The proportional axis is
 * floored; the final positive child receives the exact remaining pixels, so
 * a row of tiles never ends one pixel short. A 1 px visual gap shrinks the
 * drawn rectangle only; the hit rectangle stays the full allocation. No
 * library is used and a zero-sized child never produces NaN or a negative
 * rectangle.
 */

export interface TreemapItem {
  id: string;
  path: string;
  name: string;
  kind: "file" | "folder";
  logical_bytes: number;
  children_count: number;
  online_only?: boolean;
  /** Number of smaller items folded into this "Other" tile. */
  other_count?: number;
}

export interface TreemapRect extends TreemapItem {
  /** Hit bounds. Pointer hit-testing uses exactly these values. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Painted bounds: 1 px smaller on the advancing axis. */
  draw_x: number;
  draw_y: number;
  draw_width: number;
  draw_height: number;
}

export interface TreemapBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MAX_VISIBLE_TILES = 2000;
export const VISUAL_GAP_PX = 1;

export function isHorizontalDepth(depth: number): boolean {
  return depth % 2 === 0;
}

function safeBytes(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function sortTreemapItems(items: readonly TreemapItem[]): TreemapItem[] {
  return [...items].sort((left, right) => {
    const bytes = safeBytes(right.logical_bytes) - safeBytes(left.logical_bytes);
    if (bytes !== 0) return bytes;
    return left.path.toLowerCase() < right.path.toLowerCase() ? -1 : 1;
  });
}

/** Fold everything beyond the 1999th tile into one "Other" tile. */
export function capTreemapItems(items: readonly TreemapItem[]): TreemapItem[] {
  if (items.length <= MAX_VISIBLE_TILES) return [...items];
  const visible = items.slice(0, MAX_VISIBLE_TILES - 1);
  const rest = items.slice(MAX_VISIBLE_TILES - 1);
  const bytes = rest.reduce((sum, item) => sum + safeBytes(item.logical_bytes), 0);
  visible.push({
    id: "other",
    path: "",
    name: "other",
    kind: "file",
    logical_bytes: bytes,
    children_count: rest.length,
    other_count: rest.length,
  });
  return visible;
}

/**
 * Lay out direct children inside a content rectangle. The caller applies
 * the parent's 2 px inset and 20 px header before calling this function.
 */
export function layoutTreemap(
  box: TreemapBox,
  items: readonly TreemapItem[],
  depth = 0,
): TreemapRect[] {
  const width = Number.isFinite(box.width) ? Math.max(0, box.width) : 0;
  const height = Number.isFinite(box.height) ? Math.max(0, box.height) : 0;
  const sorted = capTreemapItems(sortTreemapItems(items));
  const total = sorted.reduce((sum, item) => sum + safeBytes(item.logical_bytes), 0);
  if (total <= 0 || width <= 0 || height <= 0) {
    return sorted.map((item) => ({
      ...item,
      x: box.x,
      y: box.y,
      width: 0,
      height: 0,
      draw_x: box.x,
      draw_y: box.y,
      draw_width: 0,
      draw_height: 0,
    }));
  }

  const horizontal = isHorizontalDepth(depth);
  const axis = horizontal ? width : height;
  const positive = sorted.filter((item) => safeBytes(item.logical_bytes) > 0);
  const lastPositive = positive[positive.length - 1]?.id;
  let allocated = 0;
  let cursor = 0;
  return sorted.map((item) => {
    const bytes = safeBytes(item.logical_bytes);
    let length: number;
    if (bytes <= 0) {
      length = 0;
    } else if (item.id === lastPositive) {
      length = Math.max(0, axis - allocated);
    } else {
      length = Math.max(0, Math.floor((axis * bytes) / total));
    }
    if (bytes > 0 && item.id !== lastPositive) allocated += length;
    const hit = horizontal
      ? { x: box.x + cursor, y: box.y, width: length, height }
      : { x: box.x, y: box.y + cursor, width, height: length };
    cursor += length;
    return {
      ...item,
      ...hit,
      draw_x: hit.x,
      draw_y: hit.y,
      draw_width: horizontal ? Math.max(0, hit.width - VISUAL_GAP_PX) : hit.width,
      draw_height: horizontal ? hit.height : Math.max(0, hit.height - VISUAL_GAP_PX),
    };
  });
}

/** Nested tiles use the parent content inset of 2 px and header of 20 px. */
export function contentBox(rect: TreemapRect): TreemapBox {
  return {
    x: rect.x + 2,
    y: rect.y + 20,
    width: Math.max(0, rect.width - 4),
    height: Math.max(0, rect.height - 22),
  };
}

export function hitTest(
  rects: readonly TreemapRect[],
  x: number,
  y: number,
): TreemapRect | null {
  for (const rect of rects) {
    if (
      x >= rect.x &&
      y >= rect.y &&
      x < rect.x + rect.width &&
      y < rect.y + rect.height
    ) {
      return rect;
    }
  }
  return null;
}
