import type { TFunction } from "i18next";
import type { AskArchivePassword } from "../../handlers/archive/useArchiveSession";
import { extractRequestFor, isArchivePath, type ExtractMode } from "../../archive/archiveFiles";
import {
  archiveExtract,
  archivePickFolder,
  type ArchiveAuth,
  type ArchiveExtractReport,
  type ArchiveExtractRequest,
} from "../../services/archive";
import { errorCode } from "../../services/errors";
import { displayPath, type ExplorerItem } from "../../services/explorer";
import type { UndoEntry, UndoStack } from "../../services/undo";
import type { TrackJob } from "./JobsPanel";

/** Extracting archives from the Explorer (Step 06d D5): every extraction is
 * a job in the jobs panel, never replaces anything, and can be undone.
 * Several archives at once become one grouped Undo entry. */

/** A request from an archive tab, with a counter that runs it again. */
export interface ExplorerExtractRequest {
  request: ArchiveExtractRequest;
  nonce: number;
}

export interface ArchiveExtractDeps {
  t: TFunction;
  trackJob: TrackJob;
  undoStack: UndoStack;
  touchUndo: () => void;
  notify: (message: string) => void;
  notifyAction: (message: string, entry: UndoEntry | null) => void;
  notifyError: (error: unknown, area: string) => void;
  currentFolder: () => string | null;
  /** Select the new items, and go to the destination when asked. */
  showResult: (destDir: string, select: string | null, navigate: boolean) => void;
  itemFor: (path: string) => ExplorerItem | undefined;
  /** Asks for a password and retries once per submitted value. */
  askPassword?: AskArchivePassword;
}

export interface ArchiveExtract {
  /** Extract the selected archives from the Explorer. */
  extractItems: (paths: string[], mode: ExtractMode) => Promise<void>;
  /** Extract what an archive tab asked for (the App shows the folder). */
  runRequest: (request: ArchiveExtractRequest) => Promise<void>;
}

/** At most this many archives are extracted in one go (Windows' own limit
 * for a command is near it and the jobs get long). */
export const MAX_EXTRACT_AT_ONCE = 20;

function baseName(path: string): string {
  return displayPath(path).split("\\").filter(Boolean).pop() ?? path;
}

export function useArchiveExtract(deps: ArchiveExtractDeps): ArchiveExtract {
  const { t, trackJob, undoStack, touchUndo, notify, notifyAction, notifyError, showResult, itemFor, askPassword } = deps;

  const runOne = async (request: ArchiveExtractRequest, navigate: boolean): Promise<UndoEntry | null> => {
    const start = (auth?: ArchiveAuth) =>
      trackJob<ArchiveExtractReport>({
        verbKey: "extracting",
        count: 1,
        reasonArea: "archive",
        start: (onProgress) => archiveExtract(request, onProgress, auth),
        outcome: (result) => ({ cancelled: result.cancelled, skipped: result.skipped }),
      });
    let report: ArchiveExtractReport | null = null;
    try {
      report = await start();
    } catch (error) {
      const code = errorCode(error);
      const asksForPassword = code === "archive.password_required" || code === "archive.bad_password";
      if (!asksForPassword || !askPassword) {
        notifyError(error, "archive");
        return null;
      }
      // Nothing was published: the user may supply a password and retry.
      const done = await askPassword(baseName(request.archive), code, async (auth) => {
        report = await start(auth);
      });
      if (!done || !report) return null;
    }
    if (!report) return null;
    let entry: UndoEntry | null = null;
    if (report.created.length > 0) {
      undoStack.push({
        labelKey: "toast.extracted",
        labelArgs: { name: baseName(request.archive) },
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
    showResult(request.dest_dir, report.created[0] ?? null, navigate);
    return entry;
  };

  const extractItems = async (paths: string[], mode: ExtractMode) => {
    const archives = paths
      .map((path) => itemFor(path))
      .filter((item): item is ExplorerItem => item !== undefined && isArchivePath(item.path));
    if (archives.length === 0) return;
    let chosen = archives;
    if (chosen.length > MAX_EXTRACT_AT_ONCE) {
      chosen = chosen.slice(0, MAX_EXTRACT_AT_ONCE);
      notify(t("explorer.extractFirst", { count: MAX_EXTRACT_AT_ONCE }));
    }
    let folder: string | null = null;
    if (mode === "to") {
      folder = await archivePickFolder(t("archive.pickFolderTitle"));
      if (!folder) return;
    }
    const requests = chosen.map((item) =>
      extractRequestFor(
        { path: item.path, size: item.size, modified_unix: item.modified_unix },
        mode,
        folder,
        t("files.extractedFolderName"),
      ),
    );
    if (requests.length === 1) {
      const entry = await runOne(requests[0], mode === "to");
      if (entry) notifyAction(t("toast.extracted", { name: baseName(requests[0].archive) }), entry);
      return;
    }
    undoStack.beginGroup("toast.extractedMany", { count: requests.length });
    let madeSomething = false;
    try {
      for (const request of requests) {
        const entry = await runOne(request, mode === "to");
        if (entry) madeSomething = true;
      }
    } finally {
      undoStack.endGroup();
      touchUndo();
    }
    if (madeSomething) {
      notifyAction(
        t("toast.extractedMany", { count: requests.length }),
        undoStack.peekUndo(),
      );
    }
  };

  const runRequest = async (request: ArchiveExtractRequest) => {
    const entry = await runOne(request, false);
    if (entry) notifyAction(t("toast.extracted", { name: baseName(request.archive) }), entry);
  };

  return { extractItems, runRequest };
}
