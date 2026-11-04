/** Cached listings of the side columns (Step 05b). The open folder is
 * listed by the Explorer itself. */

import { useEffect, useRef, useState } from "react";
import { listFolder } from "../../../services/columnListing";
import type { ExplorerItem, SortSpec } from "../../../services/explorer";
import { folderViewKey } from "../../../services/folderViews";
import { CHILD_LOAD_DELAY_MS, COLUMN_CACHE_LIMIT } from "./columnTrail";

export interface ColumnListing {
  status: "loading" | "ready" | "error";
  items: ExplorerItem[];
  partial: boolean;
  version: string;
}

interface Inflight {
  version: string;
  cancel: () => void;
}

/** False while `active` is false; true `delayMs` after it becomes true,
 * and false again at once when it turns off (P-28). */
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [value, setValue] = useState(false);
  useEffect(() => {
    if (!active) {
      setValue(false);
      return;
    }
    const timer = window.setTimeout(() => setValue(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, delayMs]);
  return value;
}

/** The listings of the columns left of the open folder, and of the
 * selected folder's column (one cache, oldest unused dropped). */
export function useColumnListings(
  folders: readonly string[],
  child: string | null,
  active: string,
  sort: SortSpec,
  refreshKey: number,
): (path: string) => ColumnListing | null {
  const key = (path: string) => folderViewKey(path);
  const version = `${sort.key}|${sort.direction}|${refreshKey}`;

  const [listings, setListings] = useState<Map<string, ColumnListing>>(() => new Map());
  const [readyChild, setReadyChild] = useState<string | null>(null);
  const listingsRef = useRef(listings);
  listingsRef.current = listings;

  const inflight = useRef(new Map<string, Inflight>());
  const staleKeys = useRef(new Set<string>());
  const previousActive = useRef<string | null>(null);
  const wantedKeys = useRef(new Set<string>());
  const wantedPaths = useRef<readonly string[]>(folders);

  const writeListing = (k: string, listing: ColumnListing) => {
    const map = new Map(listingsRef.current);
    map.delete(k);
    map.set(k, listing);
    while (map.size > COLUMN_CACHE_LIMIT) {
      let dropped = false;
      for (const old of map.keys()) {
        if (!wantedKeys.current.has(old)) {
          map.delete(old);
          dropped = true;
          break;
        }
      }
      if (!dropped) break;
    }
    listingsRef.current = map;
    setListings(map);
  };

  const activeKey = key(active);
  // A folder that was open may have changed; it reloads when it becomes a
  // side column again.
  useEffect(() => {
    if (previousActive.current !== null && previousActive.current !== activeKey) {
      staleKeys.current.add(previousActive.current);
    }
    previousActive.current = activeKey;
  }, [activeKey]);

  const childKey = child !== null ? key(child) : null;
  useEffect(() => {
    if (child === null) {
      setReadyChild(null);
      return;
    }
    if (listingsRef.current.has(key(child))) {
      setReadyChild(child);
      return;
    }
    setReadyChild(null);
    const timer = window.setTimeout(() => setReadyChild(child), CHILD_LOAD_DELAY_MS);
    return () => window.clearTimeout(timer);
    // The cache is a ref; only a new folder or a new version matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childKey, version]);

  const wanted = [...folders];
  if (readyChild !== null && childKey !== null && key(readyChild) === childKey) wanted.push(readyChild);
  wantedPaths.current = wanted;
  const wantedJoin = wanted.map((path) => key(path)).join("|");

  useEffect(() => {
    const paths = wantedPaths.current;
    const needed = new Set(paths.map((path) => key(path)));
    wantedKeys.current = needed;

    // Never keep a request after its folder stops being wanted, and drop
    // one that answers for an older sort or refresh.
    for (const [k, entry] of [...inflight.current]) {
      if (!needed.has(k) || entry.version !== version) {
        entry.cancel();
        inflight.current.delete(k);
      }
    }

    for (const path of paths) {
      const k = key(path);
      const cached = listingsRef.current.get(k);
      if (cached && cached.version === version && cached.status !== "loading" && !staleKeys.current.has(k)) {
        continue;
      }
      if (inflight.current.has(k)) continue;
      staleKeys.current.delete(k);
      const request = listFolder(path, sort);
      const entry: Inflight = { version, cancel: request.cancel };
      inflight.current.set(k, entry);
      if (!listingsRef.current.has(k)) {
        writeListing(k, { status: "loading", items: [], partial: false, version: "" });
      }
      request.done
        .then((result) => {
          if (inflight.current.get(k) !== entry) return;
          inflight.current.delete(k);
          writeListing(k, { status: "ready", items: result.items, partial: result.partial, version });
        })
        .catch(() => {
          if (inflight.current.get(k) !== entry) return;
          inflight.current.delete(k);
          writeListing(k, { status: "error", items: [], partial: false, version });
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedJoin, version, activeKey]);

  // Leaving the view cancels every request (P-28).
  useEffect(
    () => () => {
      for (const entry of inflight.current.values()) entry.cancel();
      inflight.current.clear();
    },
    [],
  );

  return (path: string) => listings.get(key(path)) ?? null;
}
