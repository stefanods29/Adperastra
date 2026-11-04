import { newTabId, type TabState } from "./tabs";
import { SPLIT_ERROR_INVALID } from "./splitValidation";
import {
  recoverSerializedSplit,
  splitTabTitle,
  type SavedSplitDescriptor,
  type SplitLeaf,
} from "./splitViews";

/** Restoring a split tab (Step 09i T5, Decisions 3 and 7).
 *
 * A restore never opens a file by itself: the host opens every leaf
 * through the normal 04a/09a pipeline (planOpen, protected view, grants,
 * default apps), and this module only assembles the outer tab. Missing
 * sources and unknown handlers become their own placeholder leaf; one bad
 * side never drops the other, and no tab at all is created when neither
 * side is usable. */

/** At most two sources are opened at once for the whole restore pass —
 * two in total, not two per split (Decision 7). */
export const MAX_SPLIT_OPEN_CONCURRENCY = 2;

/** The shared open budget of one restore pass. The coordinator passes the
 * same instance to the normal session restore and to every split, so the
 * limit is global. */
export class SplitOpenBudget {
  private activeCount = 0;
  private peakCount = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(readonly limit: number = MAX_SPLIT_OPEN_CONCURRENCY) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error(SPLIT_ERROR_INVALID);
  }

  get active(): number {
    return this.activeCount;
  }

  /** The highest concurrency this pass ever reached (reported, never
   * assumed). */
  get peak(): number {
    return this.peakCount;
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.activeCount < this.limit) {
      this.takeSlot();
      return Promise.resolve();
    }
    // Wait for a slot to be handed over; queued callers are served first.
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Hand the slot over atomically: the count never dips below the
      // number of running opens plus the one being handed over.
      next();
      return;
    }
    this.activeCount -= 1;
  }

  private takeSlot(): void {
    this.activeCount += 1;
    this.peakCount = Math.max(this.peakCount, this.activeCount);
  }
}

export interface SplitRestoreHost {
  /** Open one leaf's source through the normal pipeline and acquire its
   * view reference under `leaf.view_id`. A missing, locked or unreadable
   * source returns the leaf with `missing` set (it does not throw); only a
   * programming error rejects. */
  openLeaf(leaf: SplitLeaf): Promise<SplitLeaf>;
}

export interface SplitRestoreOptions {
  /** The restore pass's shared budget; a private one is created when the
   * caller has none (still limited to two). */
  budget?: SplitOpenBudget;
  /** Group membership belongs to the outer tab only (Step 09b D1). */
  group_id?: string;
  /** The saved group's active tab; only used for tab-level activation. */
  active_side?: "first" | "second";
}

export interface SplitRestoreResult {
  tab: TabState;
  /** Leaves that opened as placeholders (missing source or handler). */
  missing: number;
}

function promotedTab(leaf: SplitLeaf): TabState {
  const tab: TabState = {
    id: newTabId(leaf.kind),
    kind: leaf.kind,
    content_view_id: leaf.view_id,
  };
  if (leaf.kind === "folder") {
    if (!leaf.folder) throw new Error(SPLIT_ERROR_INVALID);
    tab.folder = { ...leaf.folder, sort: { ...leaf.folder.sort } };
    tab.path = leaf.folder.path;
  } else {
    if (!leaf.source || !leaf.handler) throw new Error(SPLIT_ERROR_INVALID);
    tab.source = leaf.source;
    tab.handler = leaf.handler;
    if (leaf.source.kind === "disk") tab.path = leaf.source.path;
  }
  if (leaf.title !== undefined) tab.title = leaf.title;
  if (leaf.view !== undefined) tab.view = leaf.view;
  if (leaf.view_version !== undefined) tab.view_version = leaf.view_version;
  if (leaf.missing !== undefined) tab.missing = { ...leaf.missing };
  return tab;
}

/** Rebuild one split tab from a session or saved-group descriptor.
 * Returns `null` for a descriptor that is not a split or has no usable
 * side; the caller then drops only this tab. */
export async function restoreSplitTab(
  descriptor: SavedSplitDescriptor,
  host: SplitRestoreHost,
  options: SplitRestoreOptions = {},
): Promise<SplitRestoreResult | null> {
  if (!descriptor || descriptor.kind !== "split") return null;
  const budget = options.budget ?? new SplitOpenBudget();
  const recovery = recoverSerializedSplit(descriptor.split);
  const split = recovery.state;

  if (!split) {
    const survivor = recovery.survivor;
    if (!survivor) return null;
    const opened = await budget.run(() => host.openLeaf(survivor));
    const tab = promotedTab(opened);
    if (options.group_id !== undefined) tab.group_id = options.group_id;
    return { tab, missing: opened.missing ? 1 : 0 };
  }
  const [first, second] = await Promise.all([
    budget.run(() => host.openLeaf(split.first)),
    budget.run(() => host.openLeaf(split.second)),
  ]);
  const state = {
    ...split,
    first,
    second,
    active_side: options.active_side ?? split.active_side,
  };
  const tab: TabState = {
    id: newTabId("split"),
    kind: "split",
    title: splitTabTitle(state),
    split: state,
  };
  if (options.group_id !== undefined) tab.group_id = options.group_id;
  return { tab, missing: [first, second].filter((leaf) => leaf.missing !== undefined).length };
}
