/**
 * Content-based name suggestions through the canonical 09e preview (T5).
 *
 * The model proposes a stem only. The original extension is preserved, every
 * row is editable/excludable, and only `executeRename` on the resulting native
 * plan can change a file. There is no AI rename plan type.
 */

import type { AiNameSuggestion } from "../services/aiSearchTypes";
import type { RenamePlanPage, RenameRequest } from "../services/bulkRename";
import { previewRename } from "../services/bulkRename";
import type { SourceStamp } from "../services/cache";
import type { JobHandle } from "../services/jobs";
import { DocumentRegistry } from "../documents/DocumentRegistry";
import type { DocumentInfo } from "../documents/types";

const INVALID_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
export const MAX_STEM_SCALARS = 180;

export interface NormalizedStem {
  stem: string;
  changed: boolean;
  valid: boolean;
  reason: "empty" | "reserved" | "too_long" | null;
}

/** Replace invalid characters visibly, trim trailing spaces/dots, validate. */
export function normalizeProposedStem(value: string): NormalizedStem {
  const replaced = value.replace(INVALID_CHARACTERS, "_");
  const stem = replaced.replace(/[ .]+$/g, "");
  const changed = stem !== value;
  if (Array.from(stem).length === 0) {
    return { stem, changed, valid: false, reason: "empty" };
  }
  if (Array.from(stem).length > MAX_STEM_SCALARS) {
    return { stem: Array.from(stem).slice(0, MAX_STEM_SCALARS).join(""), changed: true, valid: false, reason: "too_long" };
  }
  if (RESERVED.test(stem)) {
    return { stem, changed, valid: false, reason: "reserved" };
  }
  return { stem, changed, valid: true, reason: null };
}

/** Split only at the last dot; leading-dot names have an empty extension. */
export function splitName(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, extension: "" };
  return { stem: name.slice(0, dot), extension: name.slice(dot) };
}

/** `scan001.PDF` + `Invoice` -> `Invoice.PDF`; the extension keeps its case. */
export function fileNameForStem(originalName: string, proposedStem: string): string {
  const normalized = normalizeProposedStem(proposedStem);
  const { extension } = splitName(originalName);
  return `${normalized.stem}${extension}`;
}

/** Windows 100 ns ticks to Unix seconds without losing precision. */
function ticksToUnixSeconds(ticks: string): number | null {
  try {
    const value = BigInt(ticks);
    const seconds = value / 10_000_000n - 11_644_473_600n;
    return Number(seconds);
  } catch {
    return null;
  }
}

/** The whole-second tick value the document info can prove exactly. */
function ticksForUnixSeconds(seconds: number): string | null {
  if (!Number.isSafeInteger(seconds) || seconds < 0) return null;
  const ticks = (BigInt(seconds) + 11_644_473_600n) * 10_000_000n;
  return ticks <= 18_446_744_073_709_551_615n ? ticks.toString() : null;
}

function normalizedPathKey(path: string): string {
  return path.replace(/^\\\\\?\\/, "").replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

/**
 * The fresh source check before a preview. The native 09e plan revalidates the
 * full stamp again; this catches a changed source without showing a stale
 * proposal as ready. `current` is the exact stamp captured when the document
 * was opened; without it (a hand-built handle) only the whole-second info is
 * available, so the stamp must still name exactly that second's tick value.
 */
export function assertFreshStamp(stamp: SourceStamp, info: DocumentInfo, current?: SourceStamp): void {
  if (!info.disk_path) throw new Error("ai_search.changed");
  if (normalizedPathKey(stamp.path_key) !== normalizedPathKey(info.disk_path)) {
    throw new Error("ai_search.changed");
  }
  if (stamp.size_bytes !== info.size) throw new Error("ai_search.changed");
  const seconds = ticksToUnixSeconds(stamp.modified_ticks);
  if (seconds === null || seconds !== info.modified_unix) {
    throw new Error("ai_search.changed");
  }
  const expectedTicks = current?.modified_ticks ?? ticksForUnixSeconds(info.modified_unix);
  if (expectedTicks === null || stamp.modified_ticks !== expectedTicks) {
    throw new Error("ai_search.changed");
  }
  if (
    current &&
    (stamp.volume_id !== current.volume_id ||
      stamp.file_id !== current.file_id ||
      normalizedPathKey(stamp.path_key) !== normalizedPathKey(current.path_key))
  ) {
    throw new Error("ai_search.changed");
  }
}

export interface ResolvedNameSource {
  path: string;
  name: string;
  stamp: SourceStamp;
}

/** Resolve authorized live documents to their disk source, never a path in model text. */
export function resolveNameSources(inputs: readonly AiNameSuggestion[]): ResolvedNameSource[] {
  return inputs.map((input) => {
    const handle = DocumentRegistry.get(input.source.id);
    if (!handle || handle.info.source.kind !== "disk") throw new Error("ai_search.changed");
    assertFreshStamp(input.source_stamp, handle.info, handle.sourceStamp);
    return {
      path: handle.info.disk_path as string,
      name: handle.info.name,
      stamp: input.source_stamp,
    };
  });
}

export interface ExplicitNamesBuild {
  request: RenameRequest;
  excluded: number[];
  invalid: Array<{ input_index: number; reason: string }>;
}

/** Build the canonical 09e `explicit_names` request with original extensions. */
export function buildExplicitNamesRequest(
  sources: readonly ResolvedNameSource[],
  editedStems: readonly string[],
  requestRevision: number,
): ExplicitNamesBuild {
  if (sources.length !== editedStems.length || sources.length === 0 || sources.length > 100) {
    throw new Error("ai_search.invalid");
  }
  const names: Array<{ input_index: number; new_name: string }> = [];
  const excluded: number[] = [];
  const invalid: Array<{ input_index: number; reason: string }> = [];
  sources.forEach((source, index) => {
    const normalized = normalizeProposedStem(editedStems[index]);
    if (!normalized.valid) {
      excluded.push(index);
      invalid.push({ input_index: index, reason: normalized.reason ?? "empty" });
      return;
    }
    names.push({ input_index: index, new_name: fileNameForStem(source.name, normalized.stem) });
  });
  if (names.length === 0) throw new Error("ai_search.invalid");
  return {
    request: {
      paths: sources.map((source) => source.path),
      operations: [{ kind: "explicit_names", names }],
      include_extension: false,
      excluded_indices: excluded,
      date_zone: "utc",
      request_revision: requestRevision,
    },
    excluded,
    invalid,
  };
}

/** E4: fresh native 09e preview only; never executes. */
export function previewSuggestedNames(
  inputs: readonly AiNameSuggestion[],
  editedStems: readonly string[],
  requestRevision: number,
): Promise<JobHandle<RenamePlanPage>> {
  const sources = resolveNameSources(inputs);
  const built = buildExplicitNamesRequest(sources, editedStems, requestRevision);
  return previewRename(built.request);
}

export type { AiNameSuggestion };
