/** One folder listing for a side column in Column view (Step 05b): all
 * batches collected, then returned at once. */

import { isTauriRuntime } from "./settings";
import { startListDir, type ExplorerItem, type ListDirHandle, type SortSpec } from "./explorer";

export interface FolderListing {
  items: ExplorerItem[];
  /** Some items in the folder could not be read (P-12). */
  partial: boolean;
}

export interface FolderRequest {
  done: Promise<FolderListing>;
  /** No arguments, returns nothing; stops the listing when it starts. */
  cancel: () => void;
}

/** List a folder for a column: every batch collected, then one answer. */
export function listFolder(path: string, sort: SortSpec): FolderRequest {
  let cancelled = false;
  let handle: ListDirHandle | null = null;
  const done = (async (): Promise<FolderListing> => {
    if (!isTauriRuntime()) return { items: [], partial: false };
    const items: ExplorerItem[] = [];
    handle = await startListDir(path, sort, (batch) => {
      items.push(...batch);
    });
    if (cancelled) {
      void handle.cancel();
      throw new Error("cancelled");
    }
    const outcome = await handle.completion;
    return { items, partial: outcome.skipped.length > 0 };
  })();
  const cancel = () => {
    cancelled = true;
    if (handle) void handle.cancel();
  };
  return { done, cancel };
}
