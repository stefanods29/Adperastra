/** Setup part adapters and the UI-side transaction order (Step 10e T6, E6).
 *
 * The native transaction is the authoritative writer gate; this module gives
 * the UI one place to validate a part, stage/commit in the canonical order,
 * roll back in reverse and publish exactly one new configuration after every
 * commit succeeded (D9-D10).
 */
import type { SerializableViewState } from "../documents/types";
import type { SetupPart } from "../services/setups";

export const SETUP_APPLY_ORDER: readonly SetupPart[] = [
  "theme",
  "layout",
  "keyboard",
  "toolbars",
  "menus",
  "navigation",
  "home",
  "status",
];

export interface SetupPartAdapter {
  read(): Promise<SerializableViewState>;
  validate(state: SerializableViewState): boolean;
  stage(state: SerializableViewState, transactionId: string): Promise<void>;
  commit(transactionId: string): Promise<void>;
  rollback(transactionId: string): Promise<void>;
}

export class SetupPartRegistry {
  private adapters = new Map<SetupPart, SetupPartAdapter>();

  register(id: SetupPart, adapter: SetupPartAdapter): void {
    if (this.adapters.has(id)) throw new Error("catalog.invalid");
    this.adapters.set(id, adapter);
  }

  get(id: SetupPart): SetupPartAdapter | undefined {
    return this.adapters.get(id);
  }

  list(): readonly SetupPart[] {
    return [...this.adapters.keys()];
  }
}

export interface SetupPartRun {
  id: SetupPart;
  state: SerializableViewState;
}

export interface SetupRunHooks {
  /** Reserve the one history record before any part is staged. It may throw
   * `ui_history.limit`; in that case nothing is written. */
  reserveHistory(plan: readonly SetupPartRun[]): void;
  /** Called exactly once, after every part committed. */
  publish(applied: readonly SetupPart[]): void;
}

function newTransactionId(): string {
  const fromCrypto = globalThis.crypto?.randomUUID?.();
  if (fromCrypto) return fromCrypto;
  return `00000000-0000-4000-a000-${String(Date.now()).slice(-12).padStart(12, "0")}`;
}

function ordered(plan: readonly SetupPartRun[]): SetupPartRun[] {
  if (plan.length === 0 || plan.length > SETUP_APPLY_ORDER.length) throw new Error("setup.invalid");
  const seen = new Set<SetupPart>();
  const result: SetupPartRun[] = [];
  for (const id of SETUP_APPLY_ORDER) {
    const entry = plan.find((candidate) => candidate.id === id);
    if (!entry) continue;
    if (seen.has(entry.id)) throw new Error("setup.invalid");
    seen.add(entry.id);
    result.push(entry);
  }
  if (result.length !== plan.length) throw new Error("setup.invalid");
  return result;
}

async function rollback(
  registry: SetupPartRegistry,
  attempted: readonly SetupPart[],
  transactionId: string,
): Promise<boolean> {
  for (const id of [...attempted].reverse()) {
    const adapter = registry.get(id);
    if (!adapter) return false;
    try {
      await adapter.rollback(transactionId);
    } catch {
      return false;
    }
  }
  return true;
}

/** Apply a bounded set of validated parts. Reserves history before the first
 * write; publishes once after the last commit; a rollback that cannot prove
 * ownership fails as `setup.recovery_required` and keeps the journal. */
export async function runSetupParts(
  registry: SetupPartRegistry,
  plan: readonly SetupPartRun[],
  hooks: SetupRunHooks,
): Promise<readonly SetupPart[]> {
  const orderedPlan = ordered(plan);
  for (const entry of orderedPlan) {
    const adapter = registry.get(entry.id);
    if (!adapter || !adapter.validate(entry.state)) throw new Error("setup.invalid");
  }

  hooks.reserveHistory(orderedPlan);
  const transactionId = newTransactionId();
  const attempted: SetupPart[] = [];
  for (const entry of orderedPlan) {
    const adapter = registry.get(entry.id)!;
    attempted.push(entry.id);
    try {
      await adapter.stage(entry.state, transactionId);
      await adapter.commit(transactionId);
    } catch (failure) {
      if (!(await rollback(registry, attempted, transactionId))) {
        throw new Error("setup.recovery_required");
      }
      throw failure;
    }
  }

  const applied = orderedPlan.map((entry) => entry.id);
  hooks.publish(applied);
  return applied;
}
