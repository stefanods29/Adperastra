/**
 * Explicit destination suggestions (Step 17c T6/D8).
 *
 * History is local Laplace counts from successful ordinary moves. A model may
 * reorder eligible destinations but can never create one, and a Move always
 * goes through the ordinary 09f transfer with fresh conflict preview.
 */

import type { SourceStamp } from "../services/cache";
import type { JobHandle } from "../services/jobs";
import { startTransfer, type TransferReport } from "../services/transferJobs";
import type {
  AiDestination,
  AiSortSuggestion,
  SortHistory,
} from "../services/aiSearchTypes";

export const MIN_SORT_EXAMPLES = 3;
export const MIN_SORT_SCORE = 0.6;
export const MAX_SORT_COUNTS = 3200;

export interface ScoreRow {
  extension: string;
  destination_id: string;
  count: number;
}

export function canonicalExtension(value: string): string | null {
  const canonical = value.trim().toLowerCase().replace(/^\./, "");
  return /^[a-z0-9_+-]{1,32}$/.test(canonical) ? canonical : null;
}

export function destinationScore(
  counts: readonly ScoreRow[],
  extension: string,
  destinationId: string,
  destinationCount: number,
): number | null {
  const canonical = canonicalExtension(extension);
  if (!canonical || destinationCount <= 0) return null;
  const matching = counts.filter((row) => row.extension === canonical);
  const total = matching.reduce((sum, row) => sum + row.count, 0);
  if (total < MIN_SORT_EXAMPLES) return null;
  const own = matching.find((row) => row.destination_id === destinationId)?.count ?? 0;
  return (own + 1) / (total + destinationCount);
}

export function rankedDestinations(
  history: SortHistory,
  extension: string,
  destinations: readonly AiDestination[],
): Array<{ destination: AiDestination; score: number }> {
  const canonical = canonicalExtension(extension);
  if (!canonical || history.disabled.includes(canonical)) return [];
  return destinations
    .map((destination) => ({
      destination,
      score: destinationScore(history.counts, canonical, destination.id, destinations.length),
    }))
    .filter((entry): entry is { destination: AiDestination; score: number } => entry.score !== null)
    .filter((entry) => entry.score >= MIN_SORT_SCORE)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.destination.id < right.destination.id ? -1 : 1;
    });
}

export function suggestDestinationFromHistory(
  history: SortHistory,
  extension: string,
  destinations: readonly AiDestination[],
): AiDestination | null {
  return rankedDestinations(history, extension, destinations)[0]?.destination ?? null;
}

export function neverForKind(history: SortHistory, extension: string): SortHistory {
  const canonical = canonicalExtension(extension);
  if (!canonical || history.disabled.includes(canonical) || history.disabled.length >= 100) {
    return history;
  }
  return {
    ...history,
    revision: history.revision + 1,
    disabled: [...history.disabled, canonical],
  };
}

export function resetSortHistory(history: SortHistory): SortHistory {
  return { ...history, revision: history.revision + 1, counts: [], disabled: [] };
}

export function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function chipVisible(
  suggestion: AiSortSuggestion | null,
  onlineOnly: boolean,
  sensitive: boolean,
): suggestion is AiSortSuggestion {
  return suggestion !== null && !onlineOnly && !sensitive;
}

export interface MoveSuggestionInput {
  suggestion: AiSortSuggestion;
  sourcePath: string;
  sourceStamp: SourceStamp;
  destinations: readonly AiDestination[];
}

/**
 * The explicit Move click. This is the only function that can start a
 * transfer; a suggestion, mount or watch event never calls it.
 */
export async function moveWithSuggestion(
  input: MoveSuggestionInput,
): Promise<JobHandle<TransferReport>> {
  const destination = input.destinations.find(
    (entry) => entry.id === input.suggestion.destination_id,
  );
  if (!destination) throw new Error("ai_search.denied");
  return startTransfer({
    kind: "move",
    sources: [input.sourcePath],
    expected_sources: [input.sourceStamp],
    dest_dir: destination.path,
    conflict: "skip",
    verify: true,
    allow_system: false,
    priority: "normal",
  });
}

/** A failed, cancelled, skipped or sensitive move is never learned. */
export function receiptCanTeach(
  receipt: { done: number; failed: number; skipped: number; cancelled: boolean; items: Array<{ status: string }> },
  sensitive: boolean,
): boolean {
  return (
    !sensitive &&
    !receipt.cancelled &&
    receipt.failed === 0 &&
    receipt.skipped === 0 &&
    receipt.done > 0 &&
    receipt.items.length > 0 &&
    receipt.items.every((item) => item.status === "done")
  );
}
