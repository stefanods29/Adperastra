/** Polite/assertive announcement queue (Step 10f E5). Screen-reader output
 * is throttled here, not at each call site: ordinary progress speaks at most
 * once per two seconds, the same key coalesces while pending, and assertive
 * final errors are never dropped to make room. */

export type AnnouncementPriority = "polite" | "assertive";

export interface Announcement {
  key: string;
  args: Record<string, string | number>;
  priority: AnnouncementPriority;
}

export type AnnouncementSink = (announcement: Announcement) => void;

export const MAX_PENDING_ANNOUNCEMENTS = 32;
export const POLITE_INTERVAL_MS = 2000;
/** Selection-count updates debounce by this much before speaking (D2). */
export const SELECTION_DEBOUNCE_MS = 250;

interface PendingEntry extends Announcement {
  finalError: boolean;
}

export class AnnouncementQueue {
  private readonly sink: AnnouncementSink | null;
  private readonly listeners = new Set<AnnouncementSink>();
  private readonly now: () => number;
  private pending: PendingEntry[] = [];
  private lastPoliteAt = Number.NEGATIVE_INFINITY;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(sink: AnnouncementSink | null = null, now: () => number = () => Date.now()) {
    this.sink = sink;
    this.now = now;
  }

  /** Adds a delivery listener (the live-region component). */
  subscribe(listener: AnnouncementSink): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private deliver(announcement: Announcement): void {
    this.sink?.(announcement);
    for (const listener of this.listeners) listener(announcement);
  }

  /** Queues one message. `finalError` marks an assertive end-of-work error
   * that must survive queue pressure. Text is rendered by React, which
   * escapes it; this queue never builds markup. */
  announce(
    key: string,
    args: Record<string, string | number>,
    priority: AnnouncementPriority,
    finalError = false,
  ): void {
    if (this.disposed) return;
    if (typeof key !== "string" || key.length === 0) return;
    const entry: PendingEntry = { key, args: { ...args }, priority, finalError };
    const same = this.pending.findIndex((item) => item.key === key);
    if (same >= 0) {
      this.pending[same] = entry;
    } else {
      if (this.pending.length >= MAX_PENDING_ANNOUNCEMENTS) {
        const dropAt = this.pending.findIndex((item) => !item.finalError);
        if (dropAt >= 0) this.pending.splice(dropAt, 1);
        else if (!finalError) return;
        // A final error is never dropped for space; the cap yields for it.
      }
      this.pending.push(entry);
    }
    this.flush();
  }

  /** Number of messages still waiting (tests and diagnostics). */
  pendingCount(): number {
    return this.pending.length;
  }

  dispose(): void {
    this.disposed = true;
    this.pending = [];
    this.listeners.clear();
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private flush(): void {
    if (this.disposed) return;
    const assertiveAt = this.pending.findIndex((item) => item.priority === "assertive");
    if (assertiveAt >= 0) {
      const [entry] = this.pending.splice(assertiveAt, 1);
      this.deliver({ key: entry.key, args: entry.args, priority: entry.priority });
      this.flush();
      return;
    }
    if (this.pending.length === 0) return;
    const wait = POLITE_INTERVAL_MS - (this.now() - this.lastPoliteAt);
    if (wait > 0) {
      this.schedule(wait);
      return;
    }
    const entry = this.pending.shift();
    if (!entry) return;
    this.lastPoliteAt = this.now();
    this.deliver({ key: entry.key, args: entry.args, priority: entry.priority });
    if (this.pending.length > 0) this.schedule(POLITE_INTERVAL_MS);
  }

  private schedule(ms: number): void {
    if (this.timer !== null || this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, ms);
  }
}

/** Debounces a repeated polite update (selection counts, D2). Returns a
 * cancel function; cancelling after dispose is a no-op. */
export function debounceAnnouncement(
  queue: AnnouncementQueue,
  key: string,
  args: () => Record<string, string | number>,
  ms: number = SELECTION_DEBOUNCE_MS,
): () => void {
  const timer = setTimeout(() => queue.announce(key, args(), "polite"), ms);
  return () => clearTimeout(timer);
}
