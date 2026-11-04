import { handlers } from "../handlers";
import type { ExplorerItem } from "../services/explorer";
import { samePath } from "../services/explorer";
import { extensionOf } from "../services/files";

/** Left/Right order inside quick preview (Step 07b D7).
 *
 * Only non-folder entries in the current display order take part. A file
 * whose type has no handler is skipped; an online-only file stays, because
 * the preview shows its cloud state. Boundaries clamp and never wrap. */

export function isPreviewNeighbor(item: ExplorerItem): boolean {
  if (item.kind !== "file") return false;
  if (item.online_only) return true;
  const extension = extensionOf(item.name);
  return handlers
    .list()
    .some((handler) => handler.extensions.includes(extension) && item.size <= handler.maxBytes);
}

export interface PreviewNeighbors {
  /** Position in the eligible order, or -1 when the path is not eligible. */
  index: number;
  previous: string | null;
  next: string | null;
}

export function previewNeighbors(
  items: readonly ExplorerItem[],
  path: string,
): PreviewNeighbors {
  const position = items.findIndex(item => samePath(item.path, path));
  if (position < 0) return { index: -1, previous: null, next: null };
  const eligible = items.filter(isPreviewNeighbor);
  const index = eligible.findIndex(item => samePath(item.path, path));
  return {
    index,
    previous: [...items.slice(0, position)].reverse().find(isPreviewNeighbor)?.path ?? null,
    next: items.slice(position + 1).find(isPreviewNeighbor)?.path ?? null,
  };
}

/** The item the preview shows, matched by path (never by row index). */
export function previewItemAt(
  items: readonly ExplorerItem[],
  path: string,
): ExplorerItem | null {
  return items.find((item) => samePath(item.path, path)) ?? null;
}
