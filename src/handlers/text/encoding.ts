/** Text encodings for the text viewer (Step 04b). Pure, unit-tested. The
 * browser's TextDecoder does the decoding; we only choose the encoding. */

/** Encodings the user can pick (WHATWG names TextDecoder understands). */
export const ENCODINGS = [
  "utf-8",
  "utf-16le",
  "utf-16be",
  "windows-1252",
  "iso-8859-1",
  "iso-8859-15",
  "windows-1250",
  "windows-1251",
  "shift_jis",
  "gbk",
  "big5",
  "euc-kr",
] as const;
export type EncodingName = (typeof ENCODINGS)[number];

/** How each encoding is named in the status bar and the Encoding list
 * (technical names, the same in every language). */
export const ENCODING_LABELS: Record<EncodingName, string> = {
  "utf-8": "UTF-8",
  "utf-16le": "UTF-16 LE",
  "utf-16be": "UTF-16 BE",
  "windows-1252": "Windows-1252",
  "iso-8859-1": "ISO-8859-1",
  "iso-8859-15": "ISO-8859-15",
  "windows-1250": "Windows-1250",
  "windows-1251": "Windows-1251",
  shift_jis: "Shift-JIS",
  gbk: "GBK",
  big5: "Big5",
  "euc-kr": "EUC-KR",
};

export interface DetectedEncoding {
  encoding: EncodingName;
  /** Bytes to skip at the start (a byte-order mark). */
  bomLength: number;
}

/** Choose an encoding from the first bytes: a byte-order mark wins; else
 * valid UTF-8; else Windows-1252 (the usual Windows "ANSI" text). */
export function detectEncoding(bytes: Uint8Array): DetectedEncoding {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { encoding: "utf-8", bomLength: 3 };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: "utf-16le", bomLength: 2 };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: "utf-16be", bomLength: 2 };
  // `stream: true` lets a character cut at the end of the sample wait for
  // more bytes instead of counting as an error; any other bad byte throws.
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true });
    return { encoding: "utf-8", bomLength: 0 };
  } catch {
    return { encoding: "windows-1252", bomLength: 0 };
  }
}

/** Decode bytes, skipping a byte-order mark of the chosen encoding. */
export function decodeText(bytes: Uint8Array, encoding: EncodingName): string {
  let start = 0;
  if (encoding === "utf-8" && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  if (encoding === "utf-16le" && bytes[0] === 0xff && bytes[1] === 0xfe) start = 2;
  if (encoding === "utf-16be" && bytes[0] === 0xfe && bytes[1] === 0xff) start = 2;
  return new TextDecoder(encoding).decode(bytes.subarray(start));
}

/** "Windows (CRLF)", "Unix (LF)", or "Mixed" line endings in a text. */
export function lineEndingOf(text: string): "crlf" | "lf" | "mixed" | "none" {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  if (crlf === 0 && lf === 0) return "none";
  if (crlf > 0 && lf > 0) return "mixed";
  return crlf > 0 ? "crlf" : "lf";
}
