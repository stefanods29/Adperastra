import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { DocumentOperation } from "../types";
import { documentParagraphOperation } from "./DocumentParagraphDialog";

/** 640 CSS px represents 595.28 document points at 100%; zoom does not alter the model. */
export function documentRulerPoints(deltaPx: number, pageWidthPt: number, zoomPercent: number): number {
  if (![deltaPx, pageWidthPt, zoomPercent].every(Number.isFinite) || pageWidthPt <= 0 || zoomPercent < 10 || zoomPercent > 400) {
    throw new Error("office_edit.invalid");
  }
  return deltaPx * pageWidthPt / (640 * zoomPercent / 100);
}

/** Keyboard counterpart to ruler dragging. Changing focus or zoom cannot write content. */
export function DocumentRuler({ indentPt, blockIds, disabled, onApply }: {
  indentPt: number; blockIds: readonly string[]; disabled: boolean;
  onApply: (operation: DocumentOperation) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState(false);
  return <div className="adp-office-document-ruler">
    <label>{t("officeDoc.indentPoints")}<input type="number" min={0} max={720} value={indentPt}
      disabled={disabled || blockIds.length === 0} onChange={(event) => {
        const value = Number(event.target.value);
        if (event.target.value === "" || !Number.isFinite(value) || value < 0 || value > 720) { setError(true); return; }
        setError(false);
        void onApply(documentParagraphOperation(blockIds, { indent_left_pt: value })).catch(() => setError(true));
      }} /></label>
    {error ? <span role="alert">{t("errors.office_edit.invalid")}</span> : null}
  </div>;
}
