import { sessionFromTabs, type SessionData, type TabsState } from "./tabs";
import { TabHistory } from "./tabHistory";
import type { UndoEntryInput } from "./undo";

/** Undo for group changes (Step 09b T2, D9): every group transaction is
 * recorded through the 09a TabHistory as bounded session descriptors.
 * Only descriptors travel: never closures, live file tokens, document
 * IDs or unsaved content. Applying an entry restores through the 09a
 * host, which reopens tabs through the normal open pipeline, so an
 * undone close never resurrects an old grant or token. */

export interface TabHistoryPort {
  record: (
    before: SessionData,
    after: SessionData,
    labelKey: string,
    labelArgs?: Record<string, string | number>,
  ) => UndoEntryInput;
  apply: (id: string, reverse: boolean) => Promise<void>;
  releaseUnreferenced: (ids: readonly string[]) => void;
}

/** The 09a E10 singleton, with exactly the U6 signatures. */
export const tabHistoryPort: TabHistoryPort = TabHistory;

export function recordGroupChange(
  before: TabsState,
  after: TabsState,
  labelKey: string,
  labelArgs?: Record<string, string | number>,
  nowUnix: number = Math.floor(Date.now() / 1000),
  port: TabHistoryPort = tabHistoryPort,
): UndoEntryInput {
  return port.record(
    sessionFromTabs(before, nowUnix),
    sessionFromTabs(after, nowUnix),
    labelKey,
    labelArgs,
  );
}

/** A rejected apply propagates, so the global Undo caller confirms its
 * cursor only after a successful restore (history failure does not
 * confirm the cursor). */
export async function applyGroupHistory(
  id: string,
  reverse: boolean,
  port: TabHistoryPort = tabHistoryPort,
): Promise<void> {
  await port.apply(id, reverse);
}

export function releaseGroupHistory(
  ids: readonly string[],
  port: TabHistoryPort = tabHistoryPort,
): void {
  port.releaseUnreferenced(ids);
}
