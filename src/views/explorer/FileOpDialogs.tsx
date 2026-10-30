import { useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "../../components/Dialog";
import HelpButton from "../../components/HelpButton";
import type { ConflictPolicy } from "../../services/fileops";
import { formatShortcut } from "../../services/shortcuts";
import type { UndoEntry } from "../../services/undo";

export interface ConflictAnswer {
  policy: ConflictPolicy;
  forAll: boolean;
}

export interface ConflictDialogProps {
  /** First conflicting file name. */
  name: string;
  /** How many more conflicts are waiting after this one. */
  moreCount: number;
  onAnswer: (answer: ConflictAnswer | null) => void;
}

/** Simple conflict dialog (the full conflict window arrives in 09c). */
export function ConflictDialog({ name, moreCount, onAnswer }: ConflictDialogProps) {
  const { t } = useTranslation();
  const [forAll, setForAll] = useState(true);
  const answer = (policy: ConflictPolicy) => onAnswer({ policy, forAll });
  return (
    <Dialog title={t("dialogs.conflictTitle")} onClose={() => onAnswer(null)}>
      <p className="adp-dialog-text">{t("dialogs.conflictBody", { name })}</p>
      {moreCount > 0 ? <p className="adp-dialog-text">{t("dialogs.conflictMore", { count: moreCount })}</p> : null}
      <label className="adp-dialog-check">
        <input type="checkbox" checked={forAll} onChange={(event) => setForAll(event.target.checked)} />
        <span>{t("dialogs.forAll")}</span>
      </label>
      <div className="adp-dialog-actions">
        <button type="button" className="adp-btn" onClick={() => onAnswer(null)}>
          {t("common.cancel")}
        </button>
        <span className="adp-cmd-spacer" />
        <button type="button" className="adp-btn" onClick={() => answer("skip")}>
          {t("dialogs.skip")}
        </button>
        <button type="button" className="adp-btn" onClick={() => answer("keepBoth")}>
          {t("dialogs.keepBoth")}
        </button>
        <button type="button" className="adp-btn adp-btn--primary" onClick={() => answer("replace")}>
          {t("dialogs.replace")}
        </button>
      </div>
    </Dialog>
  );
}

export interface PermanentDialogProps {
  count: number;
  onAnswer: (confirmed: boolean) => void;
}

/** Shift+Delete is irreversible, so it always warns first (risk level). */
export function PermanentDialog({ count, onAnswer }: PermanentDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog title={t("dialogs.permanentTitle")} onClose={() => onAnswer(false)}>
      <p className="adp-dialog-text">{t("dialogs.permanentBody", { count })}</p>
      <div className="adp-dialog-actions">
        <button type="button" className="adp-btn adp-btn--primary" autoFocus onClick={() => onAnswer(false)}>
          {t("common.cancel")}
        </button>
        <span className="adp-cmd-spacer" />
        <button type="button" className="adp-btn adp-btn--danger" onClick={() => onAnswer(true)}>
          {t("commands.deletePermanently")}
        </button>
      </div>
    </Dialog>
  );
}

export interface SystemItemsDialogProps {
  onAnswer: (confirmed: boolean) => void;
  onOpenHelp: () => void;
}

/** System items need a separate, explicit warning before they change. */
export function SystemItemsDialog({ onAnswer, onOpenHelp }: SystemItemsDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog title={t("dialogs.systemTitle")} onClose={() => onAnswer(false)}>
      <p className="adp-dialog-text">{t("dialogs.systemBody")}</p>
      <div className="adp-dialog-actions">
        <HelpButton onOpenHelp={onOpenHelp} />
        <button type="button" className="adp-btn adp-btn--primary" autoFocus onClick={() => onAnswer(false)}>
          {t("common.cancel")}
        </button>
        <span className="adp-cmd-spacer" />
        <button type="button" className="adp-btn adp-btn--danger" onClick={() => onAnswer(true)}>
          {t("dialogs.continue")}
        </button>
      </div>
    </Dialog>
  );
}

export interface RecentActionsDialogProps {
  items: { entry: UndoEntry; canUndo: boolean; canRedo: boolean }[];
  onUndo: (entry: UndoEntry) => void;
  onRedo: (entry: UndoEntry) => void;
  onClose: () => void;
}

/** The Recent actions list: the same undo stack as Ctrl+Z and the toasts. */
export function RecentActionsDialog({ items, onUndo, onRedo, onClose }: RecentActionsDialogProps) {
  const { t, i18n } = useTranslation();
  return (
    <Dialog title={t("dialogs.recentTitle")} onClose={onClose}>
      {items.length === 0 ? (
        <p className="adp-dialog-text">{t("dialogs.recentEmpty")}</p>
      ) : (
        <ul className="adp-recent-list">
          {items.map(({ entry, canUndo, canRedo }) => (
            <li key={entry.id} className="adp-recent-row">
              <span className="adp-recent-label">{t(entry.labelKey, entry.labelArgs)}</span>
              <span className="adp-recent-time">
                {new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(
                  new Date(entry.at),
                )}
              </span>
              {canUndo ? (
                <button type="button" className="adp-btn adp-btn--subtle" onClick={() => onUndo(entry)}>
                  <span>{t("commands.undo")}</span>
                  <span className="adp-toast-hint">{formatShortcut("Ctrl+Z", t)}</span>
                </button>
              ) : null}
              {canRedo ? (
                <button type="button" className="adp-btn adp-btn--subtle" onClick={() => onRedo(entry)}>
                  <span>{t("commands.redo")}</span>
                  <span className="adp-toast-hint">{formatShortcut("Ctrl+Y", t)}</span>
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
