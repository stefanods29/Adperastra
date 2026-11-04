import type { RenameReport } from "./bulkRename";
import type { UndoEntryInput } from "./undo";

/** Requires the coordinator's additive FileAction.bulkRename declaration.
 * All pages have the same exact native receipt; source paths are never replayed.
 * Recovery-required reports must be resolved before offering ordinary history.
 */
export function renameHistoryEntry(report: RenameReport): UndoEntryInput | null {
  if (report.recovery_required || report.done === 0) return null;
  return {
    labelKey: "rename.title",
    undo: { type: "bulkRename", id: report.receipt_id, reverse: true },
    redo: { type: "bulkRename", id: report.receipt_id, reverse: false },
  };
}
