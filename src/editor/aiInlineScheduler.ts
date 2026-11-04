import type { JobHandle } from "../services/jobs";
import {
  INLINE_PAUSE_MS,
  validateInlineCompletion,
  type InlineCompletion,
  type InlineCompletionRequest,
  type InlineFileType,
} from "./aiInlineTypes";

/** One pending inline suggestion per editor (Step 17d T6, decision D8).
 *
 * The scheduler only waits for a real typing pause, cancels immediately on a
 * new key, cursor move, blur, IME composition or lock, and drops every result
 * whose generation, revision, content identity or cursor no longer matches.
 * It never runs inference inside the input handler.
 */

export interface InlineContext {
  document_id: string;
  revision: number;
  content_id: string;
  cursor_utf16: number;
  before: string;
  after: string;
  file_type: InlineFileType;
  language: string;
}

export type InlineCancelReason = "typing" | "cursor" | "blur" | "lock" | "ime" | "dispose";

export interface InlineSchedulerOptions {
  delay_ms?: number;
  start: (request: InlineCompletionRequest) => Promise<JobHandle<InlineCompletion>>;
  onAvailable?: (completion: InlineCompletion, context: InlineContext) => void;
  onCancelled?: (reason: InlineCancelReason) => void;
  setTimer?: (callback: () => void, ms: number) => number;
  clearTimer?: (timer: number) => void;
}

function currentContext(context: InlineContext | null, request: InlineCompletionRequest): boolean {
  return (
    context !== null &&
    context.document_id === request.document_id &&
    context.revision === request.revision &&
    context.content_id === request.content_id &&
    context.cursor_utf16 === request.cursor_utf16 &&
    context.before === request.before &&
    context.after === request.after
  );
}

export class InlineScheduler {
  private readonly delay: number;
  private readonly start: InlineSchedulerOptions["start"];
  private readonly onAvailable?: InlineSchedulerOptions["onAvailable"];
  private readonly onCancelled?: InlineSchedulerOptions["onCancelled"];
  private readonly setTimer: NonNullable<InlineSchedulerOptions["setTimer"]>;
  private readonly clearTimer: NonNullable<InlineSchedulerOptions["clearTimer"]>;
  private context: InlineContext | null = null;
  private generation = 0;
  private timer: number | null = null;
  private pending: JobHandle<InlineCompletion> | null = null;
  private composing = false;
  private disposed = false;

  constructor(options: InlineSchedulerOptions) {
    this.delay = options.delay_ms ?? INLINE_PAUSE_MS;
    this.start = options.start;
    this.onAvailable = options.onAvailable;
    this.onCancelled = options.onCancelled;
    this.setTimer =
      options.setTimer ??
      ((callback, ms) => {
        if (typeof window === "undefined") throw new Error("ai_inline.unavailable");
        return window.setTimeout(callback, ms);
      });
    this.clearTimer =
      options.clearTimer ??
      ((timer) => {
        if (typeof window !== "undefined") window.clearTimeout(timer);
      });
  }

  /** A normal insertion: a new key cancels the pending suggestion and starts
   * one fresh pause. Composition never schedules. */
  noteInsertion(context: InlineContext): void {
    if (this.disposed || this.composing) return;
    this.cancel("typing");
    this.context = context;
    this.schedule();
  }

  /** The cursor moved without typing: cancel and do not reschedule. */
  noteCursor(context: InlineContext): void {
    if (this.disposed) return;
    this.cancel("cursor");
    this.context = context;
  }

  noteCompositionStart(): void {
    this.composing = true;
    this.cancel("ime");
  }

  noteCompositionEnd(): void {
    this.composing = false;
  }

  noteBlur(): void {
    this.cancel("blur");
  }

  noteLock(): void {
    this.cancel("lock");
  }

  /** Test/observer view of the last request count. */
  get currentGeneration(): number {
    return this.generation;
  }

  private schedule(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    const generation = this.generation + 1;
    this.generation = generation;
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.request(generation);
    }, this.delay);
  }

  private async request(generation: number): Promise<void> {
    const context = this.context;
    if (!context || this.disposed) return;
    const request: InlineCompletionRequest = {
      document_id: context.document_id,
      revision: context.revision,
      content_id: context.content_id,
      cursor_utf16: context.cursor_utf16,
      before: context.before,
      after: context.after,
      file_type: context.file_type,
      language: context.language,
      generation,
    };
    let job: JobHandle<InlineCompletion>;
    try {
      job = await this.start(request);
    } catch {
      return;
    }
    if (generation !== this.generation) {
      void job.cancel();
      return;
    }
    this.pending = job;
    try {
      const completion = await job.completion;
      // Drop late results: a new key, cursor, blur, lock or revision.
      if (generation !== this.generation || !currentContext(this.context, request)) return;
      const checked = validateInlineCompletion(completion, request);
      this.onAvailable?.(checked, context);
    } catch {
      // A cancelled or failed job has no visible effect.
    } finally {
      if (this.pending === job) this.pending = null;
    }
  }

  /** Cancel everything pending and bump the generation. */
  cancel(reason: InlineCancelReason): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    this.generation += 1;
    const pending = this.pending;
    this.pending = null;
    if (pending) void pending.cancel();
    this.onCancelled?.(reason);
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancel("dispose");
    this.disposed = true;
  }
}
