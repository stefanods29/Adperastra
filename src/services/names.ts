/** Names the user types (Step 03a rename): the same rules as the Rust
 * `validate_new_name`, checked while typing so problems show instantly.
 * Rust still validates again before anything changes on disk. */

const RESERVED = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);
// eslint-disable-next-line no-control-regex
const INVALID_CHARS = /[\\/:*?"<>|\u0000-\u001f]/;

export type NameProblem = "empty" | "invalidChars" | "reserved" | "tooLong";

/** Like Windows: surrounding spaces and trailing dots are dropped. */
export function cleanTypedName(name: string): string {
  let cleaned = name.trim();
  while (cleaned.endsWith(".") || cleaned.endsWith(" ")) cleaned = cleaned.slice(0, -1);
  return cleaned;
}

export function nameProblem(rawName: string): NameProblem | null {
  const name = cleanTypedName(rawName);
  if (name.length === 0) return "empty";
  if (INVALID_CHARS.test(name)) return "invalidChars";
  // NTFS and ReFS allow 255 UTF-16 units; JS string length counts those.
  if (name.length > 255) return "tooLong";
  const base = name.split(".")[0].toUpperCase();
  if (RESERVED.has(base)) return "reserved";
  return null;
}

/** Where the extension starts, so rename selects only the name part.
 * Folders and names like ".gitignore" select everything. */
export function nameSelectionEnd(name: string, kind: string): number {
  if (kind !== "file") return name.length;
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name.length : dot;
}

export function splitExtension(name: string, kind: string): { base: string; extension: string } {
  const end = nameSelectionEnd(name, kind);
  return { base: name.slice(0, end), extension: name.slice(end) };
}

/** The name as shown when "File name extensions" is off. */
export function displayName(name: string, kind: string, showExtensions: boolean): string {
  return showExtensions ? name : splitExtension(name, kind).base;
}
