import type { OcrWord } from "../services/ocr";
import { ocrBoxToSource, isFiniteOcrBox, type OcrBox } from "./ocrCoordinates";

/** Reading-order text and find matching for OCR overlays (Step 07e D7).
 *
 * The order is always line first, then the word's own `order`. Selected and
 * copied text is rebuilt from words in that order, never from the DOM order
 * the browser happens to use.
 */

/** Stable reading order: line, then the producer's word order. */
export function orderedWords(words: readonly OcrWord[]): OcrWord[] {
  return words
    .map((word, index) => ({ word, index }))
    .sort((left, right) => left.word.line - right.word.line || left.word.order - right.word.order)
    .map((entry) => entry.word);
}

function joinLines(entries: readonly { word: OcrWord }[]): string {
  let text = "";
  let line: number | null = null;
  for (const entry of entries) {
    if (line === entry.word.line) {
      text += ` ${entry.word.text}`;
    } else {
      if (line !== null) text += "\n";
      line = entry.word.line;
      text += entry.word.text;
    }
  }
  return text;
}

/** The exact page text (same rule as Rust `reading_text`). */
export function pageText(words: readonly OcrWord[]): string {
  return joinLines(orderedWords(words).map((word) => ({ word })));
}

/** The text of the selected ordered indexes, in reading order. */
export function selectionText(
  words: readonly OcrWord[],
  selected: ReadonlySet<number>,
): string {
  const ordered = orderedWords(words);
  const picked = ordered
    .map((word, index) => ({ word, index }))
    .filter((entry) => selected.has(entry.index));
  return joinLines(picked);
}

export interface OcrMatch {
  /** Ordered index of the match's first and last word. */
  first: number;
  last: number;
  /** Ordered indexes of every word the match touches. */
  words: number[];
  line: number;
}

interface LineSpan {
  line: number;
  text: string;
  /** Ordered index of each word, with its character range in `text`. */
  words: { index: number; start: number; end: number }[];
}

function lineSpans(words: readonly OcrWord[]): LineSpan[] {
  const ordered = orderedWords(words);
  const spans: LineSpan[] = [];
  let current: LineSpan | null = null;
  ordered.forEach((word, index) => {
    if (!current || current.line !== word.line) {
      current = { line: word.line, text: "", words: [] };
      spans.push(current);
    }
    const span = current;
    if (!span) return;
    if (span.text.length > 0) span.text += " ";
    const start = span.text.length;
    span.text += word.text;
    span.words.push({ index, start, end: span.text.length });
  });
  return spans;
}

/** Every occurrence of `query`, mapped to the words it covers. */
export function findMatches(
  words: readonly OcrWord[],
  query: string,
  caseSensitive = false,
): OcrMatch[] {
  if (query.length === 0) return [];
  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  const matches: OcrMatch[] = [];
  for (const span of lineSpans(words)) {
    const haystack = caseSensitive ? span.text : span.text.toLocaleLowerCase();
    let from = 0;
    for (;;) {
      const start = haystack.indexOf(needle, from);
      if (start < 0) break;
      const end = start + needle.length;
      const covered = span.words.filter(
        (word) => word.start < end && word.end > start,
      );
      if (covered.length > 0) {
        matches.push({
          first: covered[0].index,
          last: covered[covered.length - 1].index,
          words: covered.map((word) => word.index),
          line: span.line,
        });
      }
      from = start + Math.max(1, needle.length);
    }
  }
  return matches;
}

/** The union source box of a match, for scrolling/highlight adapters. */
export function matchSourceBox(
  words: readonly OcrWord[],
  match: OcrMatch,
  recognizedWidth: number,
  recognizedHeight: number,
  originalWidth: number,
  originalHeight: number,
): OcrBox | null {
  const ordered = orderedWords(words);
  const boxes: OcrBox[] = [];
  for (const index of match.words) {
    const word = ordered[index];
    if (!word) continue;
    const box = ocrBoxToSource(
      { x: word.x, y: word.y, width: word.width, height: word.height },
      recognizedWidth,
      recognizedHeight,
      originalWidth,
      originalHeight,
    );
    if (isFiniteOcrBox(box)) boxes.push(box);
  }
  if (boxes.length === 0) return null;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Next match position, wrapping like the app's find rows do. */
export function nextMatchIndex(current: number, count: number, backwards = false): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return backwards ? count - 1 : 0;
  return (current + (backwards ? -1 : 1) + count) % count;
}

/**
 * The selected overlay words, read from a DOM selection. Every word span
 * carries `data-adp-ocr-index` (its ordered index); nothing here reads text
 * from the DOM, so a hostile word cannot become markup.
 */
export function collectSelectedText(
  container: HTMLElement,
  words: readonly OcrWord[],
  selection: Selection | null,
): string {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return "";
  const range = selection.getRangeAt(0);
  const selected = new Set<number>();
  for (const element of container.querySelectorAll<HTMLElement>("[data-adp-ocr-index]")) {
    const index = Number(element.dataset.adpOcrIndex);
    if (!Number.isInteger(index) || index < 0) continue;
    if (range.intersectsNode(element)) selected.add(index);
  }
  return selectionText(words, selected);
}
