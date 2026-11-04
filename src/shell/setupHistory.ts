/** Setup import in the shared UI history (Step 10e T6, U5/D10).
 *
 * One Apply is one history record with bounded before/after typed part data.
 * Undo and Redo hand the whole record back to one validated transaction, so
 * a partial restore is impossible. Files the user exported are never deleted
 * by Undo.
 */
import type { SerializableViewState } from "../documents/types";
import type { SetupPart } from "../services/setups";
import { isSerializableViewState } from "../services/viewState";
import { UiHistoryRegistry } from "../services/uiHistory";
import { SETUP_APPLY_ORDER } from "./SetupPartRegistry";

export const SETUP_HISTORY_ADAPTER = "setup-import";
export const MAX_SETUP_HISTORY_PART_BYTES = 1024 * 1024;
export const MAX_SETUP_HISTORY_STATE_BYTES = 4 * 1024 * 1024;

/** Type aliases (not interfaces) so TypeScript gives them the implicit
 * index signature `SerializableViewState` requires. */
export type SetupHistoryPartState = {
  id: SetupPart;
  state: SerializableViewState;
};

export type SetupHistoryState = {
  kind: "setup-import";
  phase: "before" | "after";
  parts: SetupHistoryPartState[];
};

export interface SetupHistoryInput {
  id: SetupPart;
  before: SerializableViewState;
  after: SerializableViewState;
}

/** The static shape `UiHistoryRegistry` already provides (09a E9). */
export interface SetupHistoryRegistry {
  registerAdapter(
    id: string,
    adapter: { validate(state: SerializableViewState): boolean; apply(state: SerializableViewState): Promise<void> },
  ): void;
  record(adapterId: string, before: SerializableViewState, after: SerializableViewState): string;
  apply(id: string, reverse: boolean): Promise<void>;
  releaseUnreferenced(ids: readonly string[]): void;
}

export const setupHistoryRegistry: SetupHistoryRegistry = UiHistoryRegistry;

function stateBytes(value: SerializableViewState): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? "").length;
}

function orderOf(parts: readonly { id: SetupPart }[]): SetupPart[] {
  return SETUP_APPLY_ORDER.filter((id) => parts.some((part) => part.id === id));
}

/** Bounded, ordered, validated state for one side of the record. */
export function buildSetupHistoryState(
  phase: "before" | "after",
  parts: readonly { id: SetupPart; state: SerializableViewState }[],
): SetupHistoryState {
  if (parts.length === 0 || parts.length > SETUP_APPLY_ORDER.length) throw new Error("setup.invalid");
  const ordered = orderOf(parts);
  if (ordered.length !== parts.length) throw new Error("setup.invalid");
  let total = 0;
  const built: SetupHistoryPartState[] = [];
  for (const id of ordered) {
    const entry = parts.find((part) => part.id === id)!;
    if (!isSerializableViewState(entry.state)) throw new Error("setup.invalid");
    const bytes = stateBytes(entry.state);
    if (bytes > MAX_SETUP_HISTORY_PART_BYTES) throw new Error("ui_history.limit");
    total += bytes;
    built.push({ id, state: entry.state });
  }
  if (total > MAX_SETUP_HISTORY_STATE_BYTES) throw new Error("ui_history.limit");
  return { kind: "setup-import", phase, parts: built };
}

export function validateSetupHistoryState(value: SerializableViewState): SetupHistoryState | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.kind !== "setup-import" || (record.phase !== "before" && record.phase !== "after")) return null;
  if (!Array.isArray(record.parts) || record.parts.length === 0 || record.parts.length > SETUP_APPLY_ORDER.length) {
    return null;
  }
  const parts: SetupHistoryPartState[] = [];
  for (const entry of record.parts) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
    const part = entry as Record<string, unknown>;
    if (typeof part.id !== "string" || !SETUP_APPLY_ORDER.includes(part.id as SetupPart)) return null;
    if (!isSerializableViewState(part.state)) return null;
    parts.push({ id: part.id as SetupPart, state: part.state });
  }
  const ordered = orderOf(parts);
  if (ordered.length !== parts.length || new Set(ordered).size !== parts.length) return null;
  try {
    return buildSetupHistoryState(record.phase, parts);
  } catch {
    return null;
  }
}

/** Register the one `setup-import` adapter. `applyState` runs the same
 * validated, all-or-nothing transaction as Apply. */
export function registerSetupHistory(
  applyState: (state: SetupHistoryState) => Promise<void>,
  registry: SetupHistoryRegistry = setupHistoryRegistry,
): void {
  registry.registerAdapter(SETUP_HISTORY_ADAPTER, {
    validate: (state) => validateSetupHistoryState(state) !== null,
    apply: async (state) => {
      const parsed = validateSetupHistoryState(state);
      if (!parsed) throw new Error("setup.invalid");
      await applyState(parsed);
    },
  });
}

/** Reserve and record one import before the transaction publishes. A full
 * history throws `ui_history.limit` and no part is written. */
export function recordSetupImport(
  inputs: readonly SetupHistoryInput[],
  registry: SetupHistoryRegistry = setupHistoryRegistry,
): string {
  const before = buildSetupHistoryState(
    "before",
    inputs.map((entry) => ({ id: entry.id, state: entry.before })),
  );
  const after = buildSetupHistoryState(
    "after",
    inputs.map((entry) => ({ id: entry.id, state: entry.after })),
  );
  return registry.record(SETUP_HISTORY_ADAPTER, before, after);
}
