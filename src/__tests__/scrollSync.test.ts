import { afterEach, describe, expect, it } from "vitest";
import {
  clearScrollSyncPorts,
  createScrollSyncPort,
  linkScrollPorts,
  normalizedScrollProgress,
  pdfScrollProgress,
  pdfScrollTarget,
  registerScrollSyncPort,
  resolveScrollSyncPort,
  type ScrollSyncPort,
  type ScrollSyncPortKind,
  type ScrollSyncOrigin,
  type ScrollSyncScheduler,
  type ScrollSyncState,
} from "../views/split/scrollSync";

class FakePort implements ScrollSyncPort {
  readonly applied: { progress: number; generation: number }[] = [];
  readonly listeners = new Set<(state: ScrollSyncState) => void>();
  progress = 0;
  generation = 0;
  disposed = false;

  constructor(
    readonly view_id: string,
    readonly kind: ScrollSyncPortKind = "text",
  ) {}

  getProgress(): number {
    return this.progress;
  }

  setProgress(progress: number, generation: number): void {
    this.applied.push({ progress, generation });
    this.progress = progress;
  }

  subscribe(listener: (state: ScrollSyncState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  emit(progress: number, origin: ScrollSyncOrigin = "user"): void {
    this.progress = progress;
    this.generation += 1;
    for (const listener of this.listeners) {
      listener({ progress, origin, generation: this.generation });
    }
  }
}

function fakeScheduler() {
  let next = 1;
  const pending = new Map<number, () => void>();
  const cancelled: number[] = [];
  const scheduler: ScrollSyncScheduler = {
    request(callback) {
      const handle = next;
      next += 1;
      pending.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      cancelled.push(handle);
      pending.delete(handle);
    },
  };
  return {
    scheduler,
    run() {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback();
    },
    get pendingCount() {
      return pending.size;
    },
    cancelled,
  };
}

afterEach(() => {
  clearScrollSyncPorts();
});

describe("split scroll sync", () => {
  it("PDF2of4within.5=>0.375: a 4-page PDF on page 2 at half a page is 0.375", () => {
    expect(pdfScrollProgress(2, 0.5, 4)).toBeCloseTo(0.375, 6);
    expect(pdfScrollProgress(1, 0, 4)).toBe(0);
    expect(pdfScrollProgress(4, 1, 4)).toBe(1);
  });

  it("target2page=>page1within.75: 0.375 on a 2-page document is page 1, three quarters in", () => {
    const target = pdfScrollTarget(0.375, 2);
    expect(target.page).toBe(1);
    expect(target.within).toBeCloseTo(0.75, 6);
    const last = pdfScrollTarget(1, 2);
    expect(last.page).toBe(2);
    expect(last.within).toBeCloseTo(1, 6);
  });

  it("syncnotreemit: progress applied by the link is never re-emitted as user motion", () => {
    const first = new FakePort("view-a", "pdf");
    const second = new FakePort("view-b", "text");
    const frames = fakeScheduler();
    const dispose = linkScrollPorts(first, second, frames.scheduler);

    first.emit(0.5);
    frames.run();
    expect(second.applied).toEqual([{ progress: 0.5, generation: 1 }]);

    // The target reports the applied progress as sync motion (as a real
    // port does); the link must not send it back.
    second.emit(0.5, "sync");
    frames.run();
    expect(first.applied).toEqual([]);
    dispose();
  });

  it("disposecancelsRAF: disposing cancels the pending frame and unsubscribes", () => {
    const first = new FakePort("view-a");
    const second = new FakePort("view-b");
    const frames = fakeScheduler();
    const dispose = linkScrollPorts(first, second, frames.scheduler);

    first.emit(0.4);
    expect(frames.pendingCount).toBe(1);
    dispose();
    expect(frames.pendingCount).toBe(0);
    expect(frames.cancelled).toHaveLength(1);

    frames.run();
    expect(second.applied).toEqual([]);
    first.emit(0.9);
    frames.run();
    expect(second.applied).toEqual([]);
  });

  it("extent0=>0: a zero or unknown scroll extent is progress 0, never a division by zero", () => {
    expect(normalizedScrollProgress(120, 0)).toBe(0);
    expect(normalizedScrollProgress(120, Number.NaN)).toBe(0);
    expect(normalizedScrollProgress(Number.POSITIVE_INFINITY, 400)).toBe(1);
    expect(normalizedScrollProgress(100, 400)).toBe(0.25);
  });

  it("latestRAFwins: two events before the frame apply the latest value once", () => {
    const first = new FakePort("view-a");
    const second = new FakePort("view-b");
    const frames = fakeScheduler();
    const dispose = linkScrollPorts(first, second, frames.scheduler);

    first.emit(0.2);
    first.emit(0.6);
    expect(frames.pendingCount).toBe(1);
    frames.run();
    expect(second.applied).toEqual([{ progress: 0.6, generation: 2 }]);

    // Generation is monotonic: an older value never overwrites a newer one.
    first.emit(0.8);
    frames.run();
    expect(second.applied).toEqual([
      { progress: 0.6, generation: 2 },
      { progress: 0.8, generation: 3 },
    ]);
    dispose();
  });

  it("a created port reports user motion and applies sync motion without reporting it as user", () => {
    let offset = 0;
    const extent = 400;
    const created = createScrollSyncPort({
      view_id: "view-a",
      kind: "text",
      getProgress: () => offset / extent,
      applyProgress: (progress) => {
        offset = progress * extent;
      },
    });
    const events: ScrollSyncState[] = [];
    created.port.subscribe((state) => events.push(state));

    offset = 100;
    created.reportUserProgress();
    expect(events[0]).toMatchObject({ progress: 0.25, origin: "user", generation: 1 });

    created.port.setProgress(0.5, 7);
    expect(offset).toBe(200);
    expect(events[1]).toMatchObject({ progress: 0.5, origin: "sync" });
    expect(events[1].generation).toBeGreaterThan(7);

    created.dispose();
    created.reportUserProgress();
    expect(events).toHaveLength(2);
  });

  it("registers one port per view and revokes it when the view closes", () => {
    const port = new FakePort("view-a");
    const unsubscribe = registerScrollSyncPort(port);
    expect(resolveScrollSyncPort("view-a")).toBe(port);
    expect(() => registerScrollSyncPort(new FakePort("view-a"))).toThrowError("splits.invalid");
    unsubscribe();
    expect(resolveScrollSyncPort("view-a")).toBeNull();
  });
});
