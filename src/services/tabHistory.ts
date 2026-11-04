import type { SerializableViewState } from "../documents/types";
import type { SessionData } from "./tabs";
import type { UndoEntryInput } from "./undo";
import { UiHistoryRegistry } from "./uiHistory";

/** Tab actions in the shared Undo history (Step 09a E10). Records tab
 * descriptors only, never dirty contents or tokens. Applying a record
 * delegates to the `tabs` UI-history adapter, which the host registers to
 * validate and restore through the normal 09a tab host; a failed restore
 * leaves the Undo cursor unchanged (the stack confirms only on success). */

export const TAB_HISTORY_ADAPTER_ID = "tabs";

/** One plain-JSON copy: session descriptors can carry optional fields set
 * to `undefined`, which are not serializable view state themselves. */
function plainSession(data: SessionData): SerializableViewState {
  return JSON.parse(JSON.stringify(data)) as SerializableViewState;
}

export class TabHistory {
  static record(
    before: SessionData,
    after: SessionData,
    labelKey: string,
    labelArgs?: Record<string, string | number>,
  ): UndoEntryInput {
    const id = UiHistoryRegistry.record(
      TAB_HISTORY_ADAPTER_ID,
      plainSession(before),
      plainSession(after),
    );
    return {
      labelKey,
      labelArgs,
      undo: { type: "uiState", id, reverse: true },
      redo: { type: "uiState", id, reverse: false },
    };
  }

  static async apply(id: string, reverse: boolean): Promise<void> {
    await UiHistoryRegistry.apply(id, reverse);
  }

  static releaseUnreferenced(ids: readonly string[]): void {
    UiHistoryRegistry.releaseUnreferenced(ids);
  }
}
