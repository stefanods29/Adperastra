import type { TFunction } from "i18next";
import { useCallback } from "react";
import { collectReportPages } from "../services/convert";
import type { UndoEntry } from "../services/undo";
import type { ConversionEnvironment } from "./ConversionContext";
import { conversionHistoryEntry, createdPathsOf, mergeConversionPages } from "./convertHistory";
import type { ConversionReport } from "./types";

/** Completion handoff (Step 08a T7): actual created paths, one grouped
 * Undo entry, and the Explorer refresh. The existing Undo framework is the
 * only owner of the cursor; a failed undo leaves it unchanged. */

export interface ConversionActions {
  record: (report: ConversionReport, destDir: string) => Promise<UndoEntry | null>;
}

export function useConversionActions(
  environment: ConversionEnvironment,
  t: TFunction,
): ConversionActions {
  const record = useCallback(
    async (report: ConversionReport, destDir: string) => {
      const pages = report.next_cursor ? await collectReportPages(report) : [report];
      const all = mergeConversionPages(pages);
      const input = conversionHistoryEntry(all);
      if (!input) {
        if (all.outputs.length > 0) {
          environment.notify(t("convert.undoUnavailable"));
          environment.showResult(destDir, all.outputs[0]?.path ?? null, false);
        }
        return null;
      }
      environment.undoStack.beginGroup("toast.converted", {
        count: createdPathsOf(all).length,
      });
      try {
        environment.undoStack.push(input);
      } finally {
        environment.undoStack.endGroup();
      }
      environment.touchUndo();
      const entry = environment.undoStack.peekUndo();
      environment.notifyAction(
        t("toast.converted", { count: createdPathsOf(all).length }),
        entry,
      );
      environment.showResult(destDir, all.created_paths[0] ?? null, false);
      return entry;
    },
    [environment, t],
  );
  return { record };
}
