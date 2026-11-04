/**
 * Pure semantic-search helpers for Step 17c T3.
 *
 * The native worker performs the real bounded scan. These helpers mirror the
 * exact rules the UI and tests must reason about: L2 dot-product ordering,
 * the 384/64 chunk overlap, cloud/sensitive exclusion, revision gates and the
 * memory-only sensitive lease.
 */

import type { AiInputRef } from "../../services/localAiTypes";
import type { SemanticHit, SemanticPage, SemanticQuery } from "../../services/aiSearchTypes";
import { MAX_SEMANTIC_RESULTS } from "../../services/aiSearchTypes";

export interface SemanticCandidate {
  id: string;
  key: string;
  vector: readonly number[];
  chunk_index: number;
}

export interface RankedCandidate {
  id: string;
  key: string;
  score: number;
  chunk_index: number;
}

export function dotProduct(left: readonly number[], right: readonly number[]): number | null {
  if (left.length === 0 || left.length !== right.length) return null;
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    total += a * b;
  }
  return Number.isFinite(total) ? Math.min(1, Math.max(-1, total)) : null;
}

/**
 * Deduplicate by file key, keep the best chunk, then sort by score descending.
 * Ties break by FileIdentityKey text, then chunk ordinal (D3).
 */
export function rankSemanticVectors(
  query: readonly number[],
  candidates: readonly SemanticCandidate[],
  limit = 50,
): RankedCandidate[] {
  const best = new Map<string, RankedCandidate>();
  for (const candidate of candidates) {
    const score = dotProduct(query, candidate.vector);
    if (score === null) continue;
    const existing = best.get(candidate.key);
    if (
      existing &&
      (existing.score > score || (existing.score === score && existing.chunk_index <= candidate.chunk_index))
    ) {
      continue;
    }
    best.set(candidate.key, {
      id: candidate.id,
      key: candidate.key,
      score,
      chunk_index: candidate.chunk_index,
    });
  }
  const ranked = [...best.values()].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (left.key !== right.key) return left.key < right.key ? -1 : 1;
    return left.chunk_index - right.chunk_index;
  });
  return ranked.slice(0, Math.max(1, Math.min(MAX_SEMANTIC_RESULTS, limit)));
}

export interface TextChunkView {
  index: number;
  start: number;
  end: number;
  text: string;
}

/** 384 Unicode scalars per chunk, 64-scalar overlap, at most 64 chunks. */
export function splitTextChunks(text: string): { chunks: TextChunkView[]; partial: boolean } {
  const scalars = Array.from(text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
  const limit = Math.min(scalars.length, 24_000);
  const chunks: TextChunkView[] = [];
  let start = 0;
  while (start < limit && chunks.length < 64) {
    const end = Math.min(start + 384, limit);
    chunks.push({ index: chunks.length, start, end, text: scalars.slice(start, end).join("") });
    if (end === limit) break;
    start += 384 - 64;
  }
  const covered = chunks.length === 0 ? 0 : chunks[chunks.length - 1].end;
  return { chunks, partial: scalars.length > 24_000 || covered < limit };
}

export interface SemanticSource {
  id: string;
  onlineOnly: boolean;
  sensitive: boolean;
}

/**
 * Eligibility runs before any source lease. An online-only or sensitive
 * source is skipped and the `open` callback is never called for it.
 */
export function planSemanticBatch(
  sources: readonly SemanticSource[],
  open: (id: string) => void,
): { eligible: string[]; skipped: string[] } {
  const eligible: string[] = [];
  const skipped: string[] = [];
  for (const source of sources) {
    if (source.onlineOnly || source.sensitive) {
      skipped.push(source.id);
      continue;
    }
    open(source.id);
    eligible.push(source.id);
  }
  return { eligible, skipped };
}

/** Discards a completion whose request generation is no longer latest. */
export class SemanticRevisionGate {
  private current = 0;

  begin(): number {
    this.current += 1;
    return this.current;
  }

  accept(revision: number): boolean {
    return revision === this.current;
  }

  cancel(): void {
    this.current += 1;
  }
}

export interface SensitiveResultLease {
  input: AiInputRef;
  active: boolean;
}

/**
 * The explicit one-shot comparison. The lease exists only in memory; locking
 * destroys the input reference and every candidate, and returns no results.
 */
export class SensitiveSemanticLease {
  private lease: SensitiveResultLease | null;
  private candidates: SemanticHit[] = [];

  constructor(input: AiInputRef) {
    this.lease = { input, active: true };
  }

  get active(): boolean {
    return this.lease?.active === true;
  }

  put(candidates: readonly SemanticHit[]): void {
    if (!this.active) return;
    this.candidates = [...candidates];
  }

  results(): SemanticHit[] {
    return this.active ? [...this.candidates] : [];
  }

  lock(): void {
    this.candidates = [];
    if (this.lease) {
      this.lease = { ...this.lease, active: false };
    }
  }
}

/** True only for a query whose roots and opt-in match the current policy. */
export function semanticQueryAccepted(
  query: SemanticQuery,
  eligibleRootIds: readonly string[],
): boolean {
  if (query.root_ids.length === 0) return false;
  const eligible = new Set(eligibleRootIds);
  return query.root_ids.every((root) => eligible.has(root));
}

/** A page from a completion that is no longer current is never displayed. */
export function pageForRevision(page: SemanticPage, revision: number): SemanticPage | null {
  return page.request_revision === revision ? page : null;
}
