import type { CreateFormatId } from "../services/archiveCreate";

/** The archive name rules of the Compress dialog (Step 06e T11). Pure, so
 * the format/extension behavior is tested without a window. */

export const FORMAT_EXTENSION: Record<CreateFormatId, string> = {
  zip: "zip",
  seven_z: "7z",
};

/** Windows accepts at most this many UTF-16 units in one name component. */
export const MAX_NAME_UNITS = 255;

/** The last part of a path. */
export function lastNamePart(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

/** The usable stem: a file loses its last extension, a folder keeps its
 * name (`notes.txt` gives `notes`, `photos` stays `photos`). */
export function nameStem(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot > 0) return name.slice(0, dot);
  return name;
}

/** The default name: one selected root keeps its stem; several use the
 * translated "Archive" label. */
export function defaultCreateName(
  sources: readonly string[],
  format: CreateFormatId,
  severalLabel: string,
): string {
  const extension = FORMAT_EXTENSION[format];
  if (sources.length === 1) {
    const stem = nameStem(lastNamePart(sources[0]));
    return `${stem || severalLabel}.${extension}`;
  }
  return `${severalLabel}.${extension}`;
}

export function hasFormatExtension(name: string, format: CreateFormatId): boolean {
  return name.toLowerCase().endsWith(`.${FORMAT_EXTENSION[format]}`);
}

/** Switching formats swaps the previous extension and keeps every other
 * character the user typed. */
export function withFormatExtension(
  name: string,
  from: CreateFormatId,
  to: CreateFormatId,
): string {
  if (from === to) return name;
  const previous = `.${FORMAT_EXTENSION[from]}`;
  const next = `.${FORMAT_EXTENSION[to]}`;
  if (name.toLowerCase().endsWith(previous)) {
    return `${name.slice(0, name.length - previous.length)}${next}`;
  }
  return name;
}

export type NameProblem = "empty" | "invalid" | "extension";

/** What stops Create for this name, or null. */
export function nameProblem(name: string, format: CreateFormatId): NameProblem | null {
  if (!name) return "empty";
  if (name.length > MAX_NAME_UNITS) return "invalid";
  if (name.includes("/") || name.includes("\\")) return "invalid";
  if (/[\u0000-\u001f<>:"|?*]/.test(name)) return "invalid";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)) return "invalid";
  if (/[. ]$/.test(name)) return "invalid";
  if (!hasFormatExtension(name, format)) return "extension";
  return null;
}
