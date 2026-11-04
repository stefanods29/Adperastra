import type { JobHandle } from "../../../services/jobs";

/** Per-document owner, instantiated by the eventual service. No content logging,
 * persistence, hidden retries, queue, or independent job runner. */
export class DocumentAiLifetime {
  private generation = 0;
  private job: JobHandle<unknown> | null = null;
  private releases = new Set<() => Promise<void>>();
  private closed = false;
  private releasing: Promise<void> | null = null;

  current(): number { return this.generation; }
  isCurrent(generation: number): boolean { return !this.closed && generation === this.generation; }

  async invalidate(): Promise<number> {
    const generation = ++this.generation;
    const job = this.job;
    if (job) {
      await job.cancel();
      if (this.job === job) this.job = null;
    }
    return generation;
  }

  /** Handles may arrive after cancellation; never install them as current. */
  async retainJob<T>(generation: number, job: JobHandle<T>): Promise<boolean> {
    if (!this.isCurrent(generation) || this.job !== null) {
      await job.cancel();
      return false;
    }
    this.job = job;
    return true;
  }

  async retainRelease(release: () => Promise<void>): Promise<void> {
    let completed = false;
    let pending: Promise<void> | null = null;
    const owned = (): Promise<void> => {
      if (completed) return Promise.resolve();
      if (pending) return pending;
      pending = release().then(() => {
        completed = true;
        this.releases.delete(owned);
      }).finally(() => { pending = null; });
      return pending;
    };
    this.releases.add(owned);
    if (this.closed) await owned();
  }

  /** Retry explicit cleanup failures on a later release call. Successful
   * release callbacks are removed; no rejected cleanup pretends to be success. */
  release(): Promise<void> {
    if (this.releasing) return this.releasing;
    this.releasing = this.releaseOwned().finally(() => { this.releasing = null; });
    return this.releasing;
  }

  private async releaseOwned(): Promise<void> {
    this.closed = true;
    this.generation++;
    const failures: unknown[] = [];
    if (this.job) {
      try { await this.job.cancel(); this.job = null; } catch (error) { failures.push(error); }
    }
    for (const release of [...this.releases]) {
      try { await release(); this.releases.delete(release); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new Error("document_ai.failed");
  }
}
