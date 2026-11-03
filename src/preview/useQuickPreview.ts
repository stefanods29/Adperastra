import { useCallback, useRef, useState } from "react";
import type { ExplorerItem } from "../services/explorer";

/** One quick-preview modal per Explorer tab (Step 07b D1/E4). */

export interface PreviewSelection {
  /** The display order at the moment the preview opened. */
  items: readonly ExplorerItem[];
  path: string;
  /** The element that had focus when Space was pressed, if any. */
  origin: HTMLElement | null;
  originList?: HTMLElement | null;
}

export interface QuickPreviewController {
  preview: PreviewSelection | null;
  /** Space on a focused item: open, or close when the preview is open. */
  toggle: (item: ExplorerItem, items: readonly ExplorerItem[]) => void;
  close: () => void;
}

/** Restore the exact invoking element when it still exists; otherwise the
 * originating file list. Focus is never dropped on a detached element. */
export function restorePreviewFocus(origin: HTMLElement | null, originList?: HTMLElement | null): void {
  if (origin && origin.isConnected) {
    origin.focus();
    return;
  }
  if (originList?.isConnected) originList.focus();
}

export function useQuickPreview(): QuickPreviewController {
  const [preview, setPreview] = useState<PreviewSelection | null>(null);
  const current = useRef<PreviewSelection | null>(null);

  const open = useCallback((item: ExplorerItem, items: readonly ExplorerItem[]) => {
    const origin =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const originList = origin?.closest<HTMLElement>('[role="listbox"]') ?? origin?.closest(".adp-explorer")?.querySelector<HTMLElement>('[role="listbox"]') ?? null;
    const next: PreviewSelection = { items: [...items], path: item.path, origin, originList };
    current.current = next;
    setPreview(next);
  }, []);

  const close = useCallback(() => {
    const closing = current.current;
    current.current = null;
    setPreview(null);
    queueMicrotask(() => restorePreviewFocus(closing?.origin ?? null, closing?.originList));
  }, []);

  const toggle = useCallback(
    (item: ExplorerItem, items: readonly ExplorerItem[]) => {
      // Repeated Space closes, whatever item the list thinks is focused.
      if (current.current !== null) {
        close();
        return;
      }
      open(item, items);
    },
    [close, open],
  );

  return { preview, toggle, close };
}
