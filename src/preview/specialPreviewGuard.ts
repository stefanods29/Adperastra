/** Late results from a closed special preview are ignored (Step 07g T6).
 *
 * A preview may finish after the user closed the tab or switched files.
 * Every request takes a token; only the newest live token may commit. */

export class SpecialPreviewGuard {
  private generation = 0;
  private closed = false;

  begin(): number {
    this.closed = false;
    this.generation += 1;
    return this.generation;
  }

  isCurrent(token: number): boolean {
    return !this.closed && token === this.generation;
  }

  close(): void {
    this.closed = true;
    this.generation += 1;
  }

  reopen(): void {
    this.closed = false;
  }
}

export interface SpecialPreviewLease {
  lease_id: string;
  release: () => Promise<void>;
}

/** Tracks every open preview lease so closing a tab (or all tabs) releases
 * exactly once, including previews that finished late. */
export class SpecialPreviewRegistry {
  private readonly leases = new Map<string, SpecialPreviewLease>();
  private closed = false;

  register(lease: SpecialPreviewLease): void {
    if (this.closed) {
      void lease.release().catch(() => undefined);
      return;
    }
    const existing = this.leases.get(lease.lease_id);
    if (existing) {
      void lease.release().catch(() => undefined);
      return;
    }
    this.leases.set(lease.lease_id, lease);
  }

  drop(leaseId: string): void {
    this.leases.delete(leaseId);
  }

  async closeAll(): Promise<void> {
    this.closed = true;
    const leases = [...this.leases.values()];
    this.leases.clear();
    await Promise.all(leases.map((lease) => lease.release().catch(() => undefined)));
  }

  get size(): number {
    return this.leases.size;
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
