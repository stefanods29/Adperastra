import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import DropdownMenu from "../../components/DropdownMenu";
import { setOfficeMode } from "../../services/officeEdit";
import type { OfficeController } from "../OfficeController";
import type { OfficeMode, OfficeSessionState } from "../types";
import { canOfficeCommand } from "../officeCompatibility";

export function DocumentHeader({ controller, state, previewOnly, autosave, onAutosave, onComments, onShare }: {
  controller: OfficeController; state: OfficeSessionState; previewOnly: boolean; autosave: boolean;
  onAutosave: (enabled: boolean) => void; onComments: () => void;
  onShare: (action: "copyPath" | "saveCopy" | "exportPdf") => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const writable = !previewOnly && state.mode !== "viewing" && state.ready && !state.busy;
  const saveEnabled = !previewOnly && controller.document.getState().can_save_existing && canOfficeCommand(state, "save_existing", false).enabled;
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError(false);
    try { await action(); } catch { setError(true); } finally { setBusy(false); }
  };
  return <header className="adp-office-document-header">
    <label><input type="checkbox" checked={autosave} disabled={busy || !saveEnabled}
      onChange={(event) => onAutosave(event.target.checked)} />{t("office.autosave")}</label>
    <Button disabled={busy || !saveEnabled} onClick={() => void run(async () => {
      if (!await controller.document.save()) throw new Error("office_edit.failed");
    })}>{t("officeDoc.save")}</Button>
    <Button disabled={busy || !writable || !state.can_undo} onClick={() => void run(() => controller.undo())}>{t("office.undo")}</Button>
    <Button disabled={busy || !writable || !state.can_redo} onClick={() => void run(() => controller.redo())}>{t("office.redo")}</Button>
    <strong>{controller.document.info.name}</strong>
    <span role="status">{t(busy ? "officeEdit.loading" : state.dirty ? "office.unsaved" : "office.saved")}</span>
    <Button onClick={onComments}>{t("office.comments")}</Button>
    <DropdownMenu ariaLabel={t("office.share")} label={t("office.share")}
      items={[
        { id: "copyPath", label: t("officeDeck.copyFilePath") },
        { id: "saveCopy", label: t("office.saveCopy"), disabled: previewOnly || !canOfficeCommand(state, "save_copy", false).enabled },
        { id: "exportPdf", label: t("office.exportPdf") },
      ]}
      onSelect={(id) => {
        if (id === "copyPath" || id === "saveCopy" || id === "exportPdf") onShare(id);
      }} />
    <select aria-label={t("office.mode")} disabled={busy || previewOnly || !state.ready}
      value={state.mode} onChange={(event) => {
        const mode = event.target.value;
        if (mode === "viewing" || mode === "editing" || mode === "reviewing") {
          void run(() => mode === "reviewing"
            ? setOfficeMode(controller.session_id, mode as OfficeMode)
            : controller.setEditingEnabled(mode === "editing"));
        }
      }}>
      <option value="viewing">{t("office.viewing")}</option>
      <option value="reviewing" disabled={!state.capabilities.includes("document_review")}>{t("office.reviewing")}</option>
      <option value="editing" disabled={!state.capabilities.includes("document_text")}>{t("office.editing")}</option>
    </select>
    {error ? <span role="alert">{t("errors.office_edit.failed")}</span> : null}
  </header>;
}
