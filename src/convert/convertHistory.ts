import type { UndoEntryInput } from "../services/undo";
import type { ConversionReport } from "./types";

/** Conversion history is unavailable until native exact-object receipts exist.
 * Path-only recycle/restore cannot prove that the current file is the output
 * this conversion created, or that Redo restores the same bytes. */

export function mergeConversionPages(pages: readonly ConversionReport[]): ConversionReport {
  const first = pages[0];
  if (!first) throw new Error("convert.bad_request");
  return {
    ...first,
    items: pages.flatMap((page) => page.items),
    outputs: pages.flatMap((page) => page.outputs),
    created_paths: pages.flatMap((page) => page.created_paths),
    next_cursor: undefined,
    complete: true,
  };
}

/** Every distinct path a page set really published, in order. */
export function createdPathsOf(report: ConversionReport): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const path of report.created_paths) {
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

/** Fail closed: no mutable path-only action enters the shared Undo stack. */
export function conversionHistoryEntry(_report: ConversionReport): UndoEntryInput | null {
  return null;
}

/** Items that did not finish are reported but are never part of Undo. */
export function finishedPaths(report: ConversionReport): string[] {
  return report.outputs.map((output) => output.path);
}
