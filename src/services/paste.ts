/** Paste-as-file helpers (Step 03b): what kind of file clipboard text
 * becomes, and the timestamp used in default pasted names. Pure, so the
 * heuristics are unit-tested; the name itself comes from the locale
 * files with this stamp filled in. */

export type PastedTextKind = "md" | "csv" | "txt";

const MARKDOWN_PATTERNS: RegExp[] = [
  /^#{1,6}\s+\S/m, // heading
  /^```/m, // fenced code
  /^\s*[-*+]\s+\[[ xX]\]\s/m, // task list
  /\[[^\]]+\]\([^)\s]+\)/, // link
  /^\|.*\|\s*$/m, // table row (needs the separator check below too)
];

function looksLikeMarkdown(text: string): boolean {
  if (/^\|[\s:|-]+\|\s*$/m.test(text) && /^\|.*\|/m.test(text)) return true; // table
  return MARKDOWN_PATTERNS.slice(0, 4).some((pattern) => pattern.test(text));
}

function delimiterCount(line: string, delimiter: string): number {
  return line.split(delimiter).length - 1;
}

function looksLikeTable(lines: string[]): boolean {
  if (lines.length < 2) return false;
  for (const delimiter of [",", ";", "\t"]) {
    const counts = lines.map((line) => delimiterCount(line, delimiter));
    if (counts[0] >= 1 && counts.every((count) => count === counts[0])) return true;
  }
  return false;
}

export function classifyClipboardText(text: string): PastedTextKind {
  const trimmed = text.trim();
  if (!trimmed) return "txt";
  if (looksLikeMarkdown(trimmed)) return "md";
  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (looksLikeTable(lines)) return "csv";
  return "txt";
}

export function pastedTextExtension(kind: PastedTextKind): string {
  return kind === "md" ? ".md" : kind === "csv" ? ".csv" : ".txt";
}

/** `2026-10-28 14-05` in local time, the shape Windows uses in names
 * like "Pasted image 2026-10-28 14-05.png" (colons are not allowed in
 * file names, so the time uses a dash). */
export function pastedStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}`;
}
