/** Selection helpers for the photo grid (Step 07c). Selection itself is the
 * existing path-based `SelectionState` from Step 03a; these helpers only map
 * Gallery items to it and keep only items that really exist after a refresh. */

import { displayPath } from "../../services/explorer";
import type { GalleryItem } from "../../services/gallery";
import { pruneSelection, type SelectionState } from "../../services/selection";
import type { GalleryGroup } from "./galleryDates";

/** Stable item key: the volume/file identity, or the normalized path. */
export function galleryKey(item: GalleryItem): string {
  if (item.identity !== "") return item.identity;
  return displayPath(item.item.path).toLowerCase();
}

/** The display order of a grouped Gallery. */
export function galleryOrder(groups: readonly GalleryGroup[]): GalleryItem[] {
  const order: GalleryItem[] = [];
  for (const group of groups) order.push(...group.items);
  return order;
}

/** Drops selected/focused paths that are no longer present. A source removal
 * therefore clears a vanished selection instead of selecting a neighbour. */
export function keepGallerySelection(
  selection: SelectionState,
  items: readonly GalleryItem[],
): SelectionState {
  return pruneSelection(
    selection,
    items.map((item) => item.item.path),
  );
}

/** The one selected picture, for Details; null for zero or several. */
export function singleGallerySelection(
  items: readonly GalleryItem[],
  selection: SelectionState,
): GalleryItem | null {
  if (selection.selected.size !== 1) return null;
  const [path] = selection.selected;
  return items.find((item) => item.item.path === path) ?? null;
}

/** Adds pages, replacing an item with the same stable key instead of showing
 * it twice when a later page starts earlier in the sort order. */
export function mergeGalleryItems(
  existing: readonly GalleryItem[],
  incoming: readonly GalleryItem[],
): GalleryItem[] {
  const byKey = new Map<string, GalleryItem>();
  for (const item of existing) byKey.set(galleryKey(item), item);
  for (const item of incoming) byKey.set(galleryKey(item), item);
  return [...byKey.values()];
}
