import { isUuid } from "../documents/types";
import {
  TRANSFER_ACTION_IDS,
  TRANSFER_KINDS,
  TRANSFER_LOSS_KEYS,
  transferError,
} from "./types";
import type {
  TransferAction,
  TransferActionId,
  TransferEnvelope,
  TransferKind,
  TransferLossKey,
  TransferReceipt,
  TransferTarget,
} from "./types";

/** Static destination registry (Step 09c E2). Targets register when their
 * view mounts and unregister when it is disposed. `describe` never mutates
 * anything; `accept` re-reads the target's current offer, so an action that
 * disappeared while a menu was open is refused instead of applied.
 *
 * The action/receipt validators live here as well: the registry is the one
 * place that turns a target's claim into a value the app trusts. */

export const MAX_PENDING_ACCEPTS = 16;
export const MAX_TRANSFER_TARGET_ID = 128;
export const MAX_TRANSFER_LOSSES = 16;
export const MAX_TRANSFER_LABEL_KEY = 128;

const U32_MAX = 4_294_967_295;

type Obj = Record<string, unknown>;

function shape(value: unknown, keys: readonly string[]): Obj | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const object = value as Obj;
  return Object.keys(object).every((key) => keys.includes(key)) ? object : null;
}

function int(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) freeze(inner);
  }
  return value;
}

export function isTransferActionId(value: unknown): value is TransferActionId {
  return typeof value === "string" && (TRANSFER_ACTION_IDS as readonly string[]).includes(value);
}

export function isTransferLossKey(value: unknown): value is TransferLossKey {
  return typeof value === "string" && (TRANSFER_LOSS_KEYS as readonly string[]).includes(value);
}

function validLabelKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_TRANSFER_LABEL_KEY &&
    /^transfer\.[A-Za-z][A-Za-z0-9]*$/.test(value)
  );
}

function losses(value: unknown): TransferLossKey[] | null {
  if (!Array.isArray(value) || value.length > MAX_TRANSFER_LOSSES) return null;
  const result: TransferLossKey[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isTransferLossKey(entry) || seen.has(entry)) return null;
    seen.add(entry);
    result.push(entry);
  }
  return result;
}

export function validateTransferAction(value: unknown): TransferAction | null {
  const source = shape(value, ["id", "label_key", "losses", "mutates"]);
  if (!source || !isTransferActionId(source.id) || typeof source.mutates !== "boolean") return null;
  if (!validLabelKey(source.label_key)) return null;
  const lossKeys = losses(source.losses);
  if (!lossKeys) return null;
  return freeze({
    id: source.id as TransferActionId,
    label_key: source.label_key as string,
    losses: lossKeys,
    mutates: source.mutates === true,
  });
}

/** Known ids only, at most one entry per id. */
export function validateTransferActions(value: unknown): TransferAction[] | null {
  if (!Array.isArray(value) || value.length > TRANSFER_ACTION_IDS.length) return null;
  const actions: TransferAction[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const action = validateTransferAction(entry);
    if (!action || seen.has(action.id)) return null;
    seen.add(action.id);
    actions.push(action);
  }
  return actions;
}

export function validateTransferReceipt(value: unknown): TransferReceipt | null {
  const source = shape(value, [
    "transaction_id",
    "target_document_id",
    "revision",
    "inserted_count",
    "losses",
    "complete",
  ]);
  if (!source || !isUuid(source.transaction_id) || typeof source.complete !== "boolean") return null;
  if (!int(source.inserted_count, 0, U32_MAX)) return null;
  if (source.target_document_id !== undefined && !isUuid(source.target_document_id)) return null;
  if (source.revision !== undefined && !int(source.revision, 1)) return null;
  const lossKeys = losses(source.losses);
  if (!lossKeys) return null;
  const targetDocumentId = source.target_document_id as string | undefined;
  const revision = source.revision as number | undefined;
  return freeze({
    transaction_id: source.transaction_id as string,
    ...(targetDocumentId === undefined ? {} : { target_document_id: targetDocumentId }),
    ...(revision === undefined ? {} : { revision }),
    inserted_count: source.inserted_count as number,
    losses: lossKeys,
    complete: source.complete === true,
  });
}

interface PendingAccept {
  reject: (error: Error) => void;
}

interface Registration {
  target: TransferTarget;
  pending: Map<string, PendingAccept>;
}

export type TransferActionChooser = (
  actions: readonly TransferAction[],
) => string | null | Promise<string | null>;

function validKind(value: unknown): value is TransferKind {
  return typeof value === "string" && (TRANSFER_KINDS as readonly string[]).includes(value);
}

function validTargetId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_TRANSFER_TARGET_ID &&
    !/[\u0000-\u001f]/.test(value)
  );
}

function validTarget(target: TransferTarget | null | undefined): target is TransferTarget {
  if (target === null || target === undefined || typeof target !== "object") return false;
  if (!validTargetId(target.target_id)) return false;
  if (target.document_id !== undefined && !isUuid(target.document_id)) return false;
  if (!Array.isArray(target.accepted_kinds) || target.accepted_kinds.length === 0) return false;
  if (!target.accepted_kinds.every(validKind)) return false;
  if (new Set(target.accepted_kinds).size !== target.accepted_kinds.length) return false;
  return typeof target.describe === "function" && typeof target.accept === "function";
}

function normalize(error: unknown): Error {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /^transfer\.[a-z_]+$/.test(message) ? new Error(message) : transferError("transfer.failed");
}

export class TransferRegistry {
  private readonly targets = new Map<string, Registration>();

  /** One registration per target id. The returned callback is idempotent
   * and, once called, makes every pending accept fail without applying a
   * late result. */
  register(target: TransferTarget): () => void {
    if (!validTarget(target)) throw transferError("transfer.invalid");
    if (this.targets.has(target.target_id)) throw transferError("transfer.invalid");
    const registration: Registration = { target, pending: new Map() };
    this.targets.set(target.target_id, registration);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.targets.get(target.target_id) !== registration) return;
      this.targets.delete(target.target_id);
      const pending = [...registration.pending.values()];
      registration.pending.clear();
      for (const entry of pending) entry.reject(transferError("transfer.failed"));
    };
  }

  get(targetId: string): TransferTarget | null {
    return this.targets.get(targetId)?.target ?? null;
  }

  /** The target's current offer, validated against the known action and
   * loss lists. An unknown, disposed or throwing target accepts nothing. */
  describe(targetId: string, envelope: TransferEnvelope): readonly TransferAction[] {
    const registration = this.targets.get(targetId);
    if (!registration) return [];
    const target = registration.target;
    if (!target.accepted_kinds.includes(envelope.payload.kind)) return [];
    try {
      return validateTransferActions(target.describe(envelope)) ?? [];
    } catch {
      return [];
    }
  }

  /** Revalidate the offer, then run exactly one advertised action. A
   * receipt is accepted only when it is complete and reports no loss the
   * action did not disclose. */
  async accept(
    targetId: string,
    envelope: TransferEnvelope,
    actionId: string,
  ): Promise<TransferReceipt> {
    const registration = this.targets.get(targetId);
    if (!registration) throw transferError("transfer.unsupported");
    const target = registration.target;
    if (!isTransferActionId(actionId)) throw transferError("transfer.invalid");
    if (!target.accepted_kinds.includes(envelope.payload.kind)) {
      throw transferError("transfer.unsupported");
    }
    let actions: readonly TransferAction[];
    try {
      actions = validateTransferActions(target.describe(envelope)) ?? [];
    } catch {
      throw transferError("transfer.failed");
    }
    const action = actions.find((entry) => entry.id === actionId);
    if (!action) throw transferError("transfer.unsupported");
    if (registration.pending.has(envelope.transfer_id)) throw transferError("transfer.failed");
    if (registration.pending.size >= MAX_PENDING_ACCEPTS) throw transferError("transfer.failed");

    let rejectPending!: (error: Error) => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectPending = reject;
    });
    registration.pending.set(envelope.transfer_id, { reject: rejectPending });
    try {
      const receipt = validateTransferReceipt(
        await Promise.race([target.accept(envelope, actionId), cancelled]),
      );
      if (!receipt || receipt.complete !== true) throw transferError("transfer.failed");
      if (target.document_id !== undefined && receipt.target_document_id !== undefined) {
        if (receipt.target_document_id !== target.document_id) {
          throw transferError("transfer.failed");
        }
      }
      const disclosed = new Set(action.losses);
      if (receipt.losses.some((loss) => !disclosed.has(loss))) {
        throw transferError("transfer.failed");
      }
      return receipt;
    } catch (error) {
      throw normalize(error);
    } finally {
      registration.pending.delete(envelope.transfer_id);
    }
  }

  /** E2 names `TransferRegistry` as the app-wide registry, so a view may
   * register on the class itself. These four calls are the same singleton
   * the app and editors share; `new TransferRegistry()` stays available
   * for isolated tests and per-surface instances. */
  static register(target: TransferTarget): () => void {
    return appTransferRegistry.register(target);
  }

  static get(targetId: string): TransferTarget | null {
    return appTransferRegistry.get(targetId);
  }

  static describe(targetId: string, envelope: TransferEnvelope): readonly TransferAction[] {
    return appTransferRegistry.describe(targetId, envelope);
  }

  static accept(
    targetId: string,
    envelope: TransferEnvelope,
    actionId: string,
  ): Promise<TransferReceipt> {
    return appTransferRegistry.accept(targetId, envelope, actionId);
  }
}

/** The running app's one registry. Views register their drop/paste target
 * while mounted; the instance is app composition, not test state. */
export const appTransferRegistry = new TransferRegistry();

/** Pick the action a user means before anything changes. Zero eligible
 * actions means no-drop; one is used without a menu; several ask the
 * caller's chooser and return null when the user cancels. */
export async function chooseTransferAction(
  registry: TransferRegistry,
  targetId: string,
  envelope: TransferEnvelope,
  choose: TransferActionChooser,
): Promise<string | null> {
  const actions = registry.describe(targetId, envelope);
  if (actions.length === 0) return null;
  if (actions.length === 1) return actions[0].id;
  const picked = await choose(actions);
  if (picked === null || !actions.some((action) => action.id === picked)) return null;
  return picked;
}
