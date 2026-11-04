import type { PdfSearchMatch, PdfTextRun } from "../services/pdf";
import { PDF_HELPER_LIMITS } from "./types";
import type { PdfHelperSearchPosition } from "./types";

/** Searching one page's runs inside the helper (Step 07d T5, E4).
 *
 * Offsets are Unicode scalar offsets (not UTF-16 units), so a match in a
 * name with an accent or an emoji is reported and highlighted at the right
 * place. A match never spans two runs: the wire shape names one run and one
 * offset, and a PDF splits a word across runs as often as its producer
 * liked. */

/** Unicode scalar offsets of `text` (code points, not UTF-16 units). */
export function scalarText(text: string): string[] {
  return Array.from(text);
}

/** Trim to the excerpt the wire allows. */
export function excerptOf(text: string, limit = PDF_HELPER_LIMITS.searchQuery): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const limitUse = Math.max(1, Math.min(limit, 256));
  return flat.length <= limitUse ? flat : `${flat.slice(0, limitUse - 1)}…`;
}

function normalize(text: string, matchCase: boolean): string {
  return matchCase ? text : text.toLocaleLowerCase();
}

/**
 * Find matches in one page's runs, starting at `start` (inclusive) and
 * stopping at `limit`. Returns the matches, the exact position after the
 * last one, and whether the page was fully scanned.
 */
export function findMatchesInRuns(
  runs: readonly PdfTextRun[],
  query: string,
  matchCase: boolean,
  start: { run: number; offset: number },
  limit: number = PDF_HELPER_LIMITS.searchMatches,
): { matches: PdfSearchMatch[]; next: PdfHelperSearchPosition | null; complete: boolean } {
  const matches: PdfSearchMatch[] = [];
  if (query === "" || runs.length === 0) return { matches, next: null, complete: true };
  const needle = Array.from(normalize(query, matchCase));
  const firstRun = Math.max(0, Math.min(runs.length, Math.floor(start.run)));
  for (let runIndex = firstRun; runIndex < runs.length; runIndex += 1) {
    const run = runs[runIndex];
    const haystack = Array.from(normalize(run.text, matchCase));
    let from = runIndex === firstRun ? Math.max(0, Math.floor(start.offset)) : 0;
    for (;;) {
      let found = -1;
      for (let index = from; index + needle.length <= haystack.length; index += 1) {
        let same = true;
        for (let part = 0; part < needle.length; part += 1) {
          if (haystack[index + part] !== needle[part]) {
            same = false;
            break;
          }
        }
        if (same) {
          found = index;
          break;
        }
      }
      if (found === -1) break;
      matches.push({
        // The caller fills the page number: it is the one that knows it.
        page: 0,
        run: runIndex,
        offset: found,
        length: needle.length,
        excerpt: excerptOf(run.text),
      });
      if (matches.length >= limit) {
        return {
          matches,
          next: { page: 0, run: runIndex, offset: found + Math.max(1, needle.length) },
          complete: false,
        };
      }
      from = found + Math.max(1, needle.length);
    }
  }
  return { matches, next: null, complete: true };
}

/** Fill the page number of matches found on that page. */
export function withPage(matches: readonly PdfSearchMatch[], page: number): PdfSearchMatch[] {
  return matches.map((match) => ({ ...match, page }));
}
