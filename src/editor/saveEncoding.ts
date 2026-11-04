import type { EncodingName } from "../handlers/text/encoding";

/** Save encodings, line endings and the read-only rules of the editor
 * (Step 06a). Pure. */

export const SAVE_ENCODINGS = [
  "utf-8",
  "utf-8-bom",
  "utf-16le",
  "utf-16be",
  "windows-1252",
  "iso-8859-15",
  "windows-1250",
  "windows-1251",
] as const;
export type SaveEncodingId = (typeof SAVE_ENCODINGS)[number];

/** Technical names, the same in every language. */
export const SAVE_ENCODING_LABELS: Record<SaveEncodingId, string> = {
  "utf-8": "UTF-8",
  "utf-8-bom": "UTF-8 with BOM",
  "utf-16le": "UTF-16 LE",
  "utf-16be": "UTF-16 BE",
  "windows-1252": "Windows-1252",
  "iso-8859-15": "ISO-8859-15",
  "windows-1250": "Windows-1250",
  "windows-1251": "Windows-1251",
};

export type LineEndingChoice = "crlf" | "lf";

export type ReadOnlyReason = "large" | "protected" | "attribute" | "encoding" | "preview";

const UNSAVABLE: readonly EncodingName[] = ["shift_jis", "gbk", "big5", "euc-kr"];
const SINGLE_BYTE: readonly SaveEncodingId[] = [
  "windows-1252",
  "iso-8859-15",
  "windows-1250",
  "windows-1251",
];

/** Files in these encodings open read-only: Save as makes a UTF-8 copy. */
export function canSaveEncoding(encoding: EncodingName): boolean {
  return !UNSAVABLE.includes(encoding);
}

/** The save encoding a file starts with: its own, when it can be saved. */
export function defaultSaveEncoding(encoding: EncodingName, hadBom: boolean): SaveEncodingId {
  switch (encoding) {
    case "utf-8":
      return hadBom ? "utf-8-bom" : "utf-8";
    case "utf-16le":
      return "utf-16le";
    case "utf-16be":
      return "utf-16be";
    case "windows-1252":
    case "iso-8859-1":
      return "windows-1252";
    case "iso-8859-15":
      return "iso-8859-15";
    case "windows-1250":
      return "windows-1250";
    case "windows-1251":
      return "windows-1251";
    default:
      return "utf-8";
  }
}

/** The 256 one-character entries of a single-byte encoding, as the browser
 * decodes them; `null` for the UTF encodings. */
export function singleByteTable(id: SaveEncodingId): string[] | null {
  if (!SINGLE_BYTE.includes(id)) return null;
  const decoder = new TextDecoder(id);
  return Array.from({ length: 256 }, (_, index) => decoder.decode(Uint8Array.of(index)));
}

/** The first character of the text the table cannot hold, with its
 * position (line and column start at 1). */
export function firstUnmappable(
  text: string,
  table: readonly string[],
): { char: string; line: number; column: number } | null {
  const known = new Set(table.filter((entry) => entry !== "\uFFFD"));
  let line = 1;
  let column = 1;
  for (const char of text) {
    if (!known.has(char)) return { char, line, column };
    if (char === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return null;
}

/** The most common line ending; CRLF on a tie and with no line breaks. */
export function defaultLineEnding(text: string): LineEndingChoice {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  return lf > crlf ? "lf" : "crlf";
}

export function joinLines(lines: readonly string[], ending: LineEndingChoice): string {
  return lines.join(ending === "crlf" ? "\r\n" : "\n");
}

/** Why editing is off, in the order the user sees it. */
export function readOnlyReason(input: {
  paged: boolean;
  protectedView: boolean;
  readOnly: boolean;
  encoding: EncodingName;
}): ReadOnlyReason | null {
  if (input.paged) return "large";
  if (input.protectedView) return "protected";
  if (input.readOnly) return "attribute";
  if (!canSaveEncoding(input.encoding)) return "encoding";
  return null;
}

/** Spelling is on for prose, off for code. */
export function spellcheckDefault(ext: string): boolean {
  return ext === "txt" || ext === "md" || ext === "markdown";
}
