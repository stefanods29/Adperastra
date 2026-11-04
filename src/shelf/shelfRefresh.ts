import { useEffect } from "react";
import { parentPathOf, samePath } from "../services/explorer";
import {
  watchSubscribe,
  watchUnsubscribe,
  type FsWatchEvent,
} from "../services/watcherMultiplexer";
import {
  projectMovedPaths,
  shelfSourceKey,
} from "./shelfValidation";
import type { ShelfItem } from "../services/shelf";
import type { CompletedItem } from "../services/fileops";
import type { TransferReport } from "../services/transferJobs";

/** Shelf refresh and watch routing (Step 09g T4). The native refresh does
 * the attribute-only checks; this module only decides which ids to ask
 * about and turns a real transfer report into exact completed moves. */

const MAX_REPORT_PAGES = 1000;

/** Read every bounded report page (09f). The first page is already in
 * hand; `page` fetches one cursor at a time. */
export async function collectTransferPages(
  first: TransferReport,
  page: (cursor: string) => Promise<TransferReport>,
): Promise<TransferReport[]> {
  const pages = [first];
  let cursor = first.next_cursor;
  while (cursor && pages.length < MAX_REPORT_PAGES) {
    const next = await page(cursor);
    pages.push(next);
    cursor = next.next_cursor;
  }
  return pages;
}

/** Only a transfer requested as move, with a done item, a destination and
 * `source_removed`, may update a shelf path. */
export function projectTransferMoves(
  kind: "copy" | "move",
  pages: readonly TransferReport[],
): CompletedItem[] {
  return pages.flatMap((report) =>
    projectMovedPaths(
      kind,
      report.items.map((item) => ({
        from: item.from,
        to: item.to ?? undefined,
        status: item.status,
        source_removed: item.source_removed,
      })),
    ),
  );
}

function parentKey(path: string): string {
  return parentPathOf(path.replace(/\//g, "\\")) ?? path;
}

function sameWatchPath(a: string, b: string): boolean {
  return samePath(a.replace(/\//g, "\\"), b.replace(/\//g, "\\"));
}

/** Watch the folders that hold shelf references while the panel is shown.
 * Events mark the affected references for a bounded refresh; nothing is
 * read or hydrated here. Every subscription is released on hide/unmount
 * (plan/pitfalls.md P-28). */
export function useShelfWatcher(
  items: readonly ShelfItem[],
  active: boolean,
  onExternalChange: (ids: readonly string[]) => void,
): void {
  useEffect(() => {
    if (!active || items.length === 0) return;
    let disposed = false;
    const subscriptions: string[] = [];
    const folders = new Map<string, { ids: Set<string>; paths: string[] }>();
    for (const item of items) {
      if (item.source.kind !== "disk") continue;
      const folder = parentKey(item.source.path);
      const entry = folders.get(folder) ?? { ids: new Set<string>(), paths: [] };
      entry.ids.add(item.id);
      entry.paths.push(item.source.path);
      folders.set(folder, entry);
    }
    const listenerFor = (entry: { ids: Set<string>; paths: string[] }) => (event: FsWatchEvent) => {
      if (event.kind === "overflow" || event.kind === "error") {
        onExternalChange([...entry.ids]);
        return;
      }
      const hit =
        (event.path && entry.paths.some((path) => sameWatchPath(path, event.path!))) ||
        (event.old_path && entry.paths.some((path) => sameWatchPath(path, event.old_path!)));
      if (hit) onExternalChange([...entry.ids]);
    };
    void (async () => {
      for (const [folder, entry] of folders) {
        try {
          const subscription = await watchSubscribe(folder, listenerFor(entry));
          if (disposed) {
            await watchUnsubscribe(subscription.subscription_id);
          } else {
            subscriptions.push(subscription.subscription_id);
          }
        } catch {
          // A folder that cannot be watched simply waits for the next
          // manual refresh; it never fails the whole shelf.
        }
      }
    })();
    return () => {
      disposed = true;
      for (const id of subscriptions) void watchUnsubscribe(id);
    };
  }, [active, items, onExternalChange]);
}

/** Stable keys for a drop or selection list (tests and diagnostics). */
export function shelfKeys(items: readonly ShelfItem[]): string[] {
  return items.map((item) => shelfSourceKey(item.source));
}
