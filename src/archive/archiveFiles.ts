import { parentPathOf } from "../services/explorer";
import type { ArchiveExtractRequest } from "../services/archive";

/** Archive files (Step 06d, Step 06e): which names are archives, what a new
 * folder is called, and the extraction request the Explorer sends. Pure
 * helpers. */

/** The extensions the archive handler opens (lower case, no dot). Office
 * containers (.docx, .xlsx, .pptx) belong to their own viewers: they are a
 * zip by content, but their extension is claimed elsewhere. */
export const ARCHIVE_EXTENSIONS = [
  "zip",
  "7z",
  "tar",
  "gz",
  "tgz",
  "xz",
  "txz",
  "bz2",
  "tbz",
  "tbz2",
  "rar",
] as const;

/** Where "Extract" puts the files. */
export type ExtractMode = "newFolder" | "here" | "to";

function lastNamePart(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

/** True when the name ends with one of the archive extensions. */
export function isArchivePath(path: string): boolean {
  const name = lastNamePart(path);
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return false;
  const extension = name.slice(dot + 1).toLowerCase();
  return (ARCHIVE_EXTENSIONS as readonly string[]).includes(extension);
}

/** The suffix that belongs to the archive format: the whole `.tar.bz2` is
 * one suffix, so `photos.tar.bz2` gives `photos`, not `photos.tar`. */
function archiveSuffix(name: string): string {
  const lower = name.toLowerCase();
  for (const suffix of [".tar.bz2", ".tar.gz", ".tar.xz"]) {
    if (lower.endsWith(suffix)) return name.slice(name.length - suffix.length);
  }
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot);
}

/** The archive's own name without its archive extension: `photos.tar.bz2`,
 * `photos.tbz2` and `photos.zip` all give `photos`. */
export function archiveBaseName(name: string): string {
  const suffix = archiveSuffix(name);
  return suffix ? name.slice(0, name.length - suffix.length) : name;
}

/** The name of the folder a new extraction makes; the translated default
 * when the archive's name has nothing left. */
export function extractedFolderName(name: string, fallback: string): string {
  return archiveBaseName(name) || fallback;
}

/** The request for extracting one archive from the Explorer. */
export function extractRequestFor(
  item: { path: string; size: number; modified_unix: number },
  mode: ExtractMode,
  destDir: string | null,
  fallback: string,
): ArchiveExtractRequest {
  const name = lastNamePart(item.path);
  const dest = mode === "to" ? (destDir ?? "") : (parentPathOf(item.path) ?? "");
  return {
    archive: item.path,
    paths: [],
    base: "",
    dest_dir: dest,
    new_folder: mode === "here" ? null : extractedFolderName(name, fallback),
    expected_size: item.size,
    expected_modified: item.modified_unix,
  };
}
