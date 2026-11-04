import { splitLeavesOf } from "../services/splitViews";
import type { TabsState } from "../services/tabs";
import { newGroupId, type TabGroup } from "../services/tabGroups";
import {
  validateSavedTabGroup,
  type GroupRestoreReport,
  type SavedTabDescriptor,
  type SavedTabGroup,
} from "../services/savedGroups";

/** Reopening a saved group (Step 09b T4, E6/D8). The coordinator owns
 * the host: it reserves live-tab capacity, opens descriptors through
 * the normal 09a source/handler/protected-view pipeline (missing files
 * become Locate placeholders), and commits or rolls back the reserved
 * runtime state atomically. This module only orchestrates: fresh IDs,
 * the saved active member first, at most two opens at a time, and a
 * per-member failure never aborting the others. */

export interface GroupRestoreHost {
  getState: () => TabsState;
  reserve: (count: number) => Promise<string>;
  /** Open one saved position. A split descriptor opens through the split
   * restore service as one outer tab (fresh leaf view ids, its own
   * placeholders for missing sides), counted once against the reservation
   * and the two-open budget (Step 09i D7). */
  open: (
    descriptor: SavedTabDescriptor,
    background: boolean,
    reservationId: string,
  ) => Promise<string>;
  commit: (group: TabGroup, activeId: string, reservationId: string) => Promise<void>;
  rollback: (reservationId: string) => Promise<void>;
}

const MAX_TOTAL_TABS = 200;
const MAX_CONCURRENT_OPENS = 2;

function errorCode(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "";
}

export async function restoreSavedGroup(
  savedInput: SavedTabGroup,
  host: GroupRestoreHost,
): Promise<GroupRestoreReport> {
  const saved = validateSavedTabGroup(savedInput);
  const state = host.getState();
  // Capacity is checked before any reservation or open (D6).
  if (state.tabs.length + saved.tabs.length > MAX_TOTAL_TABS) {
    throw new Error("groups.limit");
  }
  const reservationId = await host.reserve(saved.tabs.length);

  const openedByIndex = new Map<number, string>();
  let missingCount = 0;
  let unsupportedCount = 0;

  const openOne = async (index: number, background: boolean): Promise<void> => {
    const descriptor = saved.tabs[index];
    let tabId: string;
    try {
      tabId = await host.open(descriptor, background, reservationId);
    } catch (error) {
      const code = errorCode(error);
      if (code === "files.not_found" || code === "tabs.missing") {
        missingCount += 1;
        return;
      }
      if (code === "tabs.handler_missing" || code === "groups.unsupported_version") {
        unsupportedCount += 1;
        return;
      }
      throw error;
    }
    openedByIndex.set(index, tabId);
    // A created tab may be a 09a missing placeholder; classify it from
    // its tab state so the report counts it without aborting others.
    const tab = host.getState().tabs.find((candidate) => candidate.id === tabId);
    const leaves = tab ? splitLeavesOf(tab) : [];
    if (tab?.missing?.reason === "not_found" || tab?.missing?.reason === "locked") {
      missingCount += 1;
    } else if (tab?.missing?.reason === "handler_missing") {
      unsupportedCount += 1;
    } else if (leaves.some((leaf) => leaf.missing?.reason === "handler_missing")) {
      // A split with one unsupported side still opens; report the member
      // once instead of aborting the other side (Step 09i D7).
      unsupportedCount += 1;
    } else if (leaves.some((leaf) => leaf.missing !== undefined)) {
      missingCount += 1;
    }
  };

  try {
    // The saved active member opens first, in the foreground (D8).
    await openOne(saved.active_index, false);
    const rest: number[] = [];
    for (let index = 0; index < saved.tabs.length; index += 1) {
      if (index !== saved.active_index) rest.push(index);
    }
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < rest.length) {
        const index = rest[cursor];
        cursor += 1;
        await openOne(index, true);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT_OPENS, rest.length) }, () => worker()),
    );

    const tabIds: string[] = [];
    for (let index = 0; index < saved.tabs.length; index += 1) {
      const tabId = openedByIndex.get(index);
      if (tabId !== undefined) tabIds.push(tabId);
    }
    if (tabIds.length === 0) throw new Error("groups.io");

    const group: TabGroup = {
      id: newGroupId(),
      name: saved.name,
      color: saved.color,
      collapsed: false,
      tab_ids: tabIds,
    };
    const activeId = openedByIndex.get(saved.active_index) ?? tabIds[0];
    await host.commit(group, activeId, reservationId);
    return {
      group_id: group.id,
      tab_ids: tabIds,
      missing_count: missingCount,
      unsupported_count: unsupportedCount,
    };
  } catch (error) {
    // Roll back only the runtime state this restore created.
    await host.rollback(reservationId).catch(() => undefined);
    throw error;
  }
}
