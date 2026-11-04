import type { SerializableViewState } from "../documents/types";
import { isSerializableViewState } from "./viewState";

/** UI-state history (Step 09a E9). Session-only undo for view-state
 * changes (tabs today, later groups and splits): adapters validate and
 * apply serialized states; nothing here keeps closures or live objects.
 * Bounds: 100 records, 16 MiB in total, 4 MiB per state. */

export interface UiHistoryAdapter {
  validate(state: SerializableViewState): boolean;
  apply(state: SerializableViewState): Promise<void>;
}

export const MAX_UI_HISTORY_RECORDS = 100;
export const MAX_UI_HISTORY_BYTES = 16 * 1024 * 1024;
export const MAX_UI_HISTORY_STATE_BYTES = 4 * 1024 * 1024;

interface UiHistoryRecord {
  id: string;
  adapterId: string;
  before: SerializableViewState;
  after: SerializableViewState;
  bytes: number;
}

const adapters = new Map<string, UiHistoryAdapter>();
const records = new Map<string, UiHistoryRecord>();
let totalBytes = 0;
let counter = 0;

function stateBytes(state: SerializableViewState): number {
  return new TextEncoder().encode(JSON.stringify(state)).length;
}

function newRecordId(): string {
  counter += 1;
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${counter}`;
  return random;
}

export class UiHistoryRegistry {
  static registerAdapter(id: string, adapter: UiHistoryAdapter): void {
    if (!id || adapters.has(id)) throw new Error("ui_history.limit");
    adapters.set(id, adapter);
  }

  /** True when the host already registered this adapter (idempotent
   * coordinator wiring across StrictMode effect runs). */
  static hasAdapter(id: string): boolean {
    return adapters.has(id);
  }

  /** Store one before/after pair and return its record id. Validation and
   * the capacity reservation happen before anything is recorded; a full
   * history fails with `ui_history.limit` and keeps every retained entry. */
  static record(adapterId: string, before: SerializableViewState, after: SerializableViewState): string {
    const adapter = adapters.get(adapterId);
    if (!adapter) throw new Error("ui_history.limit");
    if (!isSerializableViewState(before) || !isSerializableViewState(after)) throw new Error("ui_history.limit");
    if (!adapter.validate(before) || !adapter.validate(after)) throw new Error("ui_history.limit");
    const bytes = stateBytes(before) + stateBytes(after);
    if (bytes > MAX_UI_HISTORY_STATE_BYTES) throw new Error("ui_history.limit");
    if (records.size >= MAX_UI_HISTORY_RECORDS || totalBytes + bytes > MAX_UI_HISTORY_BYTES) {
      throw new Error("ui_history.limit");
    }
    const id = newRecordId();
    records.set(id, { id, adapterId, before, after, bytes });
    totalBytes += bytes;
    return id;
  }

  /** Apply the `before` state (reverse) or the `after` state. The caller
   * (the shared Undo stack) confirms its cursor only after this resolves. */
  static async apply(id: string, reverse: boolean): Promise<void> {
    const record = records.get(id);
    if (!record) throw new Error("ui_history.limit");
    const adapter = adapters.get(record.adapterId);
    if (!adapter) throw new Error("ui_history.limit");
    await adapter.apply(reverse ? record.before : record.after);
  }

  /** Drop every record whose id is not in `ids` (no longer referenced by
   * the Undo stack). */
  static releaseUnreferenced(ids: readonly string[]): void {
    const keep = new Set(ids);
    for (const [id, record] of records) {
      if (keep.has(id)) continue;
      records.delete(id);
      totalBytes -= record.bytes;
    }
  }

  /** Registered record count (tests and diagnostics). */
  static get size(): number {
    return records.size;
  }

  /** Forget adapters and records (tests). */
  static clear(): void {
    adapters.clear();
    records.clear();
    totalBytes = 0;
  }
}
