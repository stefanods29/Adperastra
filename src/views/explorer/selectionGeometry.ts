export interface SelectionRect { x: number; y: number; width: number; height: number }
export interface ItemRect extends SelectionRect { id: string }
export interface RubberBandState {
  pointer_id: number;
  origin: { x: number; y: number };
  current: { x: number; y: number };
  initial_selection: readonly string[];
  mode: "replace" | "toggle" | "add";
}
export function intersectSelection(layoutRects: readonly ItemRect[], rect: SelectionRect, initial: readonly string[], mode: RubberBandState["mode"]): string[] {
  const selected = new Set(initial);
  return layoutRects.filter((item) => {
    const hit = item.width > 0 && item.height > 0 && rect.width > 0 && rect.height > 0 &&
      item.x < rect.x + rect.width && item.x + item.width > rect.x &&
      item.y < rect.y + rect.height && item.y + item.height > rect.y;
    return mode === "replace" ? hit : mode === "add" ? hit || selected.has(item.id) : hit !== selected.has(item.id);
  }).map((item) => item.id);
}
/** Converts viewport coordinates to the scroll root's unscaled content space. */
export function contentPoint(root: HTMLElement, clientX: number, clientY: number) {
  const box = root.getBoundingClientRect();
  const sx = root.offsetWidth ? box.width / root.offsetWidth : 1;
  const sy = root.offsetHeight ? box.height / root.offsetHeight : 1;
  return { x: (clientX - box.left) / (sx || 1) - root.clientLeft + root.scrollLeft,
    y: (clientY - box.top) / (sy || 1) - root.clientTop + root.scrollTop };
}
