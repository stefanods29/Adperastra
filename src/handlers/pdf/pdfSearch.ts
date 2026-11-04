import type { JobHandle } from "../../services/jobs";
import { PDF_MAX_SEARCH_QUERY, type PdfSearchMatch, type PdfSearchPage } from "../../services/pdf";

/** Searching inside one PDF (Step 07d T5, E4).
 *
 * The helper scans pages in order and answers with bounded chunks (at most
 * 128 matches). This controller keeps the cursor, throws away answers that
 * belong to an older query or an older document, and cancels the previous
 * job the moment the user types something else. A cursor is valid only for
 * the exact query, case rule and source it was made for; nothing else can
 * resume it. */

/** How many answers one query reads before it waits for "next". */
export const PDF_SEARCH_MAX_ANSWERS = 32;

export interface PdfSearchApi {
  search: (sessionId: string, query: string, matchCase: boolean, cursor?: string) => Promise<JobHandle<PdfSearchPage>>;
}

export interface PdfSearchSnapshot {
  query: string;
  matches: PdfSearchMatch[];
  complete: boolean;
  scanning: boolean;
  /** Index in `matches` of the shown match, or -1. */
  current: number;
  /** Error code (`pdf.corrupt`, ...) or null. */
  error: string | null;
}

const EMPTY: PdfSearchSnapshot = {
  query: "",
  matches: [],
  complete: true,
  scanning: false,
  current: -1,
  error: null,
};

/** The exact key a cursor belongs to: changing any part invalidates it. */
export function pdfSearchKey(sessionId: string, sourceKey: string, query: string, matchCase: boolean): string {
  return `${sessionId}\u0000${sourceKey}\u0000${matchCase ? "1" : "0"}\u0000${query}`;
}

/** Trim a match excerpt to the bounded length the wire allows. */
export function boundedExcerpt(text: string, limit = 256): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, Math.max(0, limit - 1))}…`;
}

/** A stable identity for one match (used to avoid double counting). */
export function matchKey(match: PdfSearchMatch): string {
  return `${match.page}:${match.run}:${match.offset}:${match.length}`;
}

export class PdfSearchController {
  private api: PdfSearchApi;
  private onChange: (snapshot: PdfSearchSnapshot) => void;
  private snapshot: PdfSearchSnapshot = EMPTY;
  private key = "";
  private sessionId = "";
  private query = "";
  private matchCase = false;
  private cursor: string | null = null;
  private answers = 0;
  private generation = 0;
  private job: JobHandle<PdfSearchPage> | null = null;

  constructor(api: PdfSearchApi, onChange: (snapshot: PdfSearchSnapshot) => void) {
    this.api = api;
    this.onChange = onChange;
  }

  get current(): PdfSearchSnapshot {
    return this.snapshot;
  }

  /** Start (or restart) a search. A different query clears the old matches
   * in the same tick, so the UI never shows results of another query. */
  start(sessionId: string, sourceKey: string, query: string, matchCase: boolean): void {
    const trimmed = query.length > PDF_MAX_SEARCH_QUERY ? query.slice(0, PDF_MAX_SEARCH_QUERY) : query;
    const key = pdfSearchKey(sessionId, sourceKey, trimmed, matchCase);
    if (trimmed === "") {
      this.cancel();
      this.key = "";
      this.set({ ...EMPTY });
      return;
    }
    if (key === this.key && (this.snapshot.scanning || this.snapshot.complete)) return;
    this.cancel();
    this.key = key;
    this.sessionId = sessionId;
    this.query = trimmed;
    this.matchCase = matchCase;
    this.cursor = null;
    this.answers = 0;
    this.generation += 1;
    this.set({ ...EMPTY, query: trimmed, complete: false, scanning: true });
    void this.fetch(sessionId, trimmed, matchCase, this.generation);
  }

  /** Move to the next match, asking for another chunk at the end. */
  next(): void {
    if (this.snapshot.matches.length === 0) return;
    if (this.snapshot.current < this.snapshot.matches.length - 1) {
      this.set({ ...this.snapshot, current: this.snapshot.current + 1 });
      return;
    }
    if (!this.snapshot.complete && !this.snapshot.scanning) {
      void this.fetchMore();
      return;
    }
    this.set({ ...this.snapshot, current: 0 });
  }

  /** Move to the previous match (staying inside what is loaded). */
  previous(): void {
    if (this.snapshot.matches.length === 0) return;
    const index = this.snapshot.current <= 0 ? this.snapshot.matches.length - 1 : this.snapshot.current - 1;
    this.set({ ...this.snapshot, current: index });
  }

  cancel(): void {
    this.generation += 1;
    const job = this.job;
    this.job = null;
    if (job) void job.cancel();
    if (this.snapshot.scanning) this.set({ ...this.snapshot, scanning: false });
  }

  private async fetch(sessionId: string, query: string, matchCase: boolean, generation: number, cursor?: string): Promise<void> {
    try {
      const job = await this.api.search(sessionId, query, matchCase, cursor);
      if (generation !== this.generation) {
        void job.cancel();
        return;
      }
      this.job = job;
      const answer = await job.completion;
      this.job = null;
      if (generation !== this.generation) return;
      this.answers += 1;
      this.cursor = answer.next_cursor ?? null;
      const matches = mergeMatches(this.snapshot.matches, answer.matches);
      const complete = answer.complete || this.cursor === null || this.answers >= PDF_SEARCH_MAX_ANSWERS;
      this.set({
        ...this.snapshot,
        matches,
        complete,
        scanning: false,
        current: matches.length > 0 ? Math.max(0, this.snapshot.current) : -1,
      });
    } catch (error) {
      if (generation !== this.generation) return;
      this.job = null;
      this.set({ ...this.snapshot, scanning: false, error: error instanceof Error ? error.message : "pdf.corrupt" });
    }
  }

  private async fetchMore(): Promise<void> {
    if (!this.cursor || !this.key) return;
    const generation = this.generation;
    this.set({ ...this.snapshot, scanning: true });
    await this.fetch(this.sessionId, this.query, this.matchCase, generation, this.cursor);
  }

  private set(snapshot: PdfSearchSnapshot): void {
    this.snapshot = snapshot;
    this.onChange(snapshot);
  }
}

/** Append an answer's matches, skipping exact repeats (a page overlap). */
export function mergeMatches(existing: readonly PdfSearchMatch[], next: readonly PdfSearchMatch[]): PdfSearchMatch[] {
  const seen = new Set(existing.map(matchKey));
  const merged = [...existing];
  for (const match of next) {
    const key = matchKey(match);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(match);
  }
  return merged;
}
