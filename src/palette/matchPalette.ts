import i18n from "../i18n";
import type { PaletteEntry, PaletteMatch } from "./types";

export function normalizePaletteText(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}
export function paletteLabel(entry: PaletteEntry, locale: string): string {
  return entry.label_key ? String(i18n.t(entry.label_key, { lng: locale })) : entry.runtime_label ?? entry.english_label;
}
interface IndexedText { text: string[]; offsets: number[] }
function indexText(value: string): IndexedText {
  const text: string[] = [], offsets: number[] = [];
  [...value].forEach((scalar, index) => {
    for (const char of normalizePaletteText(scalar)) { text.push(char); offsets.push(index); }
  });
  return { text, offsets };
}
interface Index { localized: IndexedText; english: IndexedText; keywords: string[][]; label: string }
const indexes = new WeakMap<PaletteEntry, Map<string, Index>>();
const alphabets = new WeakMap<string[], Set<string>>();
export function preindexPalette(entries: readonly PaletteEntry[], locale: string): void {
  for (const entry of entries) entryIndex(entry, locale);
}
function entryIndex(entry: PaletteEntry, locale: string): Index {
  let languages = indexes.get(entry);
  if (!languages) { languages = new Map(); indexes.set(entry, languages); }
  const label = paletteLabel(entry, locale);
  let index = languages.get(locale);
  if (!index || index.label !== label) {
    index = { localized: indexText(label), english: indexText(entry.english_label), keywords: entry.keywords.map((word) => [...normalizePaletteText(word)]), label };
    if (languages.size >= 3 && !languages.has(locale)) languages.clear();
    languages.set(locale, index);
  }
  return index;
}
function tokenScore(token: string[], text: string[], label = true): { score: number; positions: number[] } | null {
  if (!token.length || token.length > text.length) return null;
  let alphabet = alphabets.get(text);
  if (!alphabet) { alphabet = new Set(text); alphabets.set(text, alphabet); }
  if (token.some((char) => !alphabet.has(char))) return null;
  let contiguous: { score: number; positions: number[] } | null = null;
  // Best contiguous occurrence; both sequences are Unicode scalar arrays.
  for (let start = 0; start <= text.length - token.length; start += 1) {
    if (!token.every((char, i) => char === text[start + i])) continue;
    const score = 100 + (label && start === 0 ? 30 : 0) + (start === 0 || /\s/u.test(text[start - 1]) ? 20 : 0);
    if (!contiguous || score > contiguous.score) contiguous = { score, positions: token.map((_, i) => start + i) };
  }
  if (contiguous) return contiguous;
  // Latest prefix starts yield the shortest ordered span in O(text * token),
  // without repeatedly scanning the suffix for every possible first letter.
  const starts = new Int32Array(token.length).fill(-1);
  let bestStart = -1, bestEnd = -1, bestSpan = Infinity;
  for (let i = 0; i < text.length; i += 1) {
    for (let j = token.length - 1; j >= 0; j -= 1) {
      if (text[i] !== token[j]) continue;
      if (j === 0) starts[0] = i;
      else if (starts[j - 1] >= 0) starts[j] = starts[j - 1];
      else continue;
      if (j === token.length - 1 && i - starts[j] + 1 < bestSpan) {
        bestStart = starts[j]; bestEnd = i; bestSpan = i - starts[j] + 1;
      }
    }
  }
  if (bestStart < 0) return null;
  const positions: number[] = [];
  for (let i = bestStart; i <= bestEnd && positions.length < token.length; i += 1) if (text[i] === token[positions.length]) positions.push(i);
  return { score: Math.max(1, 40 - bestSpan + token.length), positions };
}
function languageScore(tokens: string[][], label: IndexedText, keywords: string[][]): { score: number; positions: number[] } | null {
  let score = 0;
  const positions: number[] = [];
  for (const token of tokens) {
    const labelMatch = tokenScore(token, label.text);
    let best = labelMatch?.score ?? 0;
    for (const keyword of keywords) best = Math.max(best, tokenScore(token, keyword, false)?.score ?? 0);
    if (!best) return null;
    score += best;
    if (labelMatch?.score === best) positions.push(...labelMatch.positions.map((index) => label.offsets[index]));
  }
  return { score, positions };
}
function ranges(positions: number[]): [number, number][] {
  const result: [number, number][] = [];
  for (const position of [...new Set(positions)].sort((a, b) => a - b)) {
    const last = result[result.length - 1];
    if (last && last[1] === position) last[1] += 1;
    else result.push([position, position + 1]);
  }
  return result;
}
/** Public pure matching API. Entries are immutable catalog snapshots. */
export function matchPalette(query: string, entries: readonly PaletteEntry[], recentIds: readonly string[], locale: string): readonly PaletteMatch[] {
  if ([...query].length > 256 || entries.length > 10000) throw new Error("palette.invalid");
  const tokens = normalizePaletteText(query).trim().split(/\s+/u).filter(Boolean).map((token) => [...token]);
  const recent = new Set(recentIds.slice(0, 50));
  if (!tokens.length) {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const mru = [...new Set(recentIds.slice(0, 50))].flatMap((id) => byId.has(id) ? [byId.get(id)!] : []).slice(0, 20);
    const used = new Set(mru.map((entry) => entry.id));
    const locations = entries.filter((entry) => (entry.kind === "folder" || entry.kind === "recent_file") && !used.has(entry.id)).slice(0, 20);
    return [...mru, ...locations].map((entry) => ({ entry, score: recent.has(entry.id) ? 5 : 0, matched_ranges: [] }));
  }
  const matches: { match: PaletteMatch; label: string }[] = [];
  for (const entry of entries) {
    const index = entryIndex(entry, locale);
    const local = languageScore(tokens, index.localized, index.keywords);
    const english = languageScore(tokens, index.english, index.keywords);
    if (!local && !english) continue;
    const score = Math.max(local?.score ?? 0, english?.score ?? 0) + (recent.has(entry.id) ? 5 : 0);
    const match = { entry, score, matched_ranges: ranges(local?.positions ?? []) };
    matches.push({ match, label: normalizePaletteText(index.label) });
  }
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  matches.sort((a, b) => b.match.score - a.match.score || compare(a.label, b.label) || compare(a.match.entry.id, b.match.entry.id));
  return matches.slice(0, 50).map(({ match }) => match);
}
