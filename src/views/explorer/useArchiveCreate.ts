import type { TFunction } from "i18next";
import {
  archiveCreate,
  type ArchiveCreateReport,
  type ArchiveCreateRequest,
} from "../../services/archiveCreate";
import { displayPath, samePath } from "../../services/explorer";
import type { UndoEntry, UndoStack } from "../../services/undo";
import type { TrackJob } from "./JobsPanel";

/** Creating archives from the Explorer (Step 06e T11): one job in the panel,
 * one Undo entry for the archive that was really created. */

export interface ArchiveCreateDeps {
  t: TFunction;
  trackJob: TrackJob;
  undoStack: UndoStack;
  touchUndo: () => void;
  notify: (message: string) => void;
  notifyAction: (message: string, entry: UndoEntry | null) => void;
  notifyError: (error: unknown, area: string) => void;
  showResult: (destDir: string, select: string | null, navigate: boolean) => void;
  currentFolder: () => string | null;
}

export interface ArchiveCreate {
  /** Runs one creation. A start error is rethrown so the dialog stays open;
   * a started job ends in the jobs panel with its honest report. */
  create: (request: ArchiveCreateRequest) => Promise<void>;
}

function baseName(path: string): string {
  return displayPath(path).split("\\").filter(Boolean).pop() ?? path;
}

export function useArchiveCreate(deps: ArchiveCreateDeps): ArchiveCreate {
  const {
    t,
    trackJob,
    undoStack,
    touchUndo,
    notify,
    notifyAction,
    notifyError,
    showResult,
    currentFolder,
  } = deps;

  const create = async (request: ArchiveCreateRequest): Promise<void> => {
    let report: ArchiveCreateReport;
    try {
      report = await trackJob<ArchiveCreateReport>({
        verbKey: "compressing",
        count: 1,
        reasonArea: "archive",
        start: (onProgress) => archiveCreate(request, onProgress),
        outcome: (result) => ({ cancelled: result.cancelled, skipped: result.skipped }),
      });
    } catch (error) {
      // The dialog stays open; nothing was created.
      notifyError(error, "archive");
      throw error;
    }

    let entry: UndoEntry | null = null;
    if (report.created.length > 0) {
      undoStack.push({
        labelKey: "toast.archiveCreated",
        labelArgs: { name: baseName(report.created[0]) },
        // Undo recycles the new archive; Redo restores that exact file.
        undo: { type: "recycle", paths: report.created },
        redo: { type: "restore", originals: report.created },
      });
      touchUndo();
      entry = undoStack.peekUndo();
    }
    if (report.error) notifyError(new Error(report.error), "archive");
    const skipped = report.skipped.length + report.skipped_more;
    if (skipped > 0) notify(t("jobs.skippedItems", { count: skipped }));
    if (report.cancelled) notify(t("jobs.cancelled"));

    const select = report.created[0] ?? null;
    const here = currentFolder();
    // An already open destination is refreshed and selected, not navigated
    // again (KI-033).
    showResult(request.dest_dir, select, !here || !samePath(here, request.dest_dir));
    if (entry) {
      notifyAction(
        t("toast.archiveCreated", { name: baseName(select ?? request.file_name) }),
        entry,
      );
    }
  };

  return { create };
}
