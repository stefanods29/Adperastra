import { createTransfer, releaseTransfer } from "../services/contentTransfer";
import type { TransferRegistry } from "../transfer/TransferRegistry";
import type {
  TransferAction,
  TransferEnvelope,
  TransferPayload,
  TransferReceipt,
} from "../transfer/types";

/** Pick-up / drop for pointer-free transfer (Step 10f E4). Picking creates
 * one ordinary 09c transfer lease; dropping reuses the same target
 * negotiation and atomic accept as a drag. No file changes happen until a
 * target action is accepted, and Esc/cancel only releases the lease. */

/** The one folder target the Explorer registers while a pick is active. */
export const PICK_DROP_TARGET_ID = "explorer-folder-pick";

export interface ClickPickDropDeps {
  registry: TransferRegistry;
  /** Currently eligible drop targets, most specific first. */
  targetIds: () => readonly string[];
  create?: typeof createTransfer;
  release?: typeof releaseTransfer;
}

export class ClickPickDropController {
  private readonly registry: TransferRegistry;
  private readonly targetIds: () => readonly string[];
  private readonly create: typeof createTransfer;
  private readonly release: typeof releaseTransfer;
  private envelope: TransferEnvelope | null = null;
  private disposed = false;

  constructor(deps: ClickPickDropDeps) {
    this.registry = deps.registry;
    this.targetIds = deps.targetIds;
    this.create = deps.create ?? createTransfer;
    this.release = deps.release ?? releaseTransfer;
  }

  /** Picks up a payload snapshot. Picking again replaces the old lease. */
  async pick(payload: TransferPayload, sourceDocumentId: string | null): Promise<void> {
    if (this.disposed) throw new Error("transfer.failed");
    await this.releaseCurrent();
    this.envelope = await this.create(sourceDocumentId, payload);
  }

  /** The live lease, for the choice dialog's sensitive warning. */
  getEnvelope(): TransferEnvelope | null {
    return this.disposed ? null : this.envelope;
  }

  /** Actions the eligible targets offer for the picked content, in target
   * order, without changing anything. */
  targets(): readonly TransferAction[] {
    if (!this.envelope || this.disposed) return [];
    const seen = new Set<string>();
    const actions: TransferAction[] = [];
    for (const targetId of this.targetIds()) {
      for (const action of this.registry.describe(targetId, this.envelope)) {
        if (seen.has(action.id)) continue;
        seen.add(action.id);
        actions.push(action);
      }
    }
    return actions;
  }

  /** Runs the one accepted action through normal 09c negotiation, then
   * releases the lease whether the insertion committed or failed. */
  async drop(targetId: string, actionId: string): Promise<TransferReceipt> {
    if (!this.envelope || this.disposed) throw new Error("transfer.failed");
    const envelope = this.envelope;
    try {
      return await this.registry.accept(targetId, envelope, actionId);
    } finally {
      if (this.envelope === envelope) this.envelope = null;
      await this.release(envelope.transfer_id).catch(() => undefined);
    }
  }

  /** Cancels the pick. Nothing was mutated, so this only frees the lease. */
  async cancel(): Promise<void> {
    await this.releaseCurrent();
  }

  dispose(): void {
    this.disposed = true;
    const envelope = this.envelope;
    this.envelope = null;
    if (envelope) void this.release(envelope.transfer_id).catch(() => undefined);
  }

  private async releaseCurrent(): Promise<void> {
    const envelope = this.envelope;
    this.envelope = null;
    if (envelope) await this.release(envelope.transfer_id).catch(() => undefined);
  }
}

export default ClickPickDropController;
