import { useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "../../components/Dialog";
import Button from "../../components/Button";
import type { DocumentOperation, PageLayout } from "../types";

export const documentMillimetersToPoints = (mm: number): number => mm * 72 / 25.4;

export function documentPageOperation(sectionId: string, layout: PageLayout): DocumentOperation {
  const { width_pt: width, height_pt: height, margins, columns, column_gap_pt: gap } = layout;
  const values = [width, height, margins.top, margins.right, margins.bottom, margins.left, gap];
  if (!sectionId || !values.every(Number.isFinite) || width < 72 || width > 14400 || height < 72 || height > 14400 ||
      margins.top < 0 || margins.bottom < 0 || margins.left < 0 || margins.right < 0 ||
      margins.top > height / 2 || margins.bottom > height / 2 || margins.left > width / 2 || margins.right > width / 2 ||
      margins.top + margins.bottom >= height || margins.left + margins.right >= width ||
      !Number.isInteger(columns) || columns < 1 || columns > 6 || gap < 0 || gap > 144 ||
      (columns - 1) * gap >= width - margins.left - margins.right) throw new Error("office_edit.invalid");
  return { kind: "set_page_layout", section_id: sectionId, layout: { ...layout, margins: { ...margins } } };
}

export function DocumentPageDialog({ sectionId, layout, onApply, onClose }: {
  sectionId: string; layout: PageLayout; onApply: (operation: DocumentOperation) => Promise<void>; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [margin, setMargin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const apply = async () => {
    setError(false);
    try {
      if (margin === "") throw new Error("office_edit.invalid");
      const points = documentMillimetersToPoints(Number(margin));
      const operation = documentPageOperation(sectionId, { ...layout, margins: { top: points, right: points, bottom: points, left: points } });
      setBusy(true); await onApply(operation); onClose();
    } catch { setError(true); } finally { setBusy(false); }
  };
  return <Dialog title={t("officeDoc.pageSetup")} onClose={onClose}>
    <label>{t("officeDoc.marginsMm")}<input type="number" min={0} value={margin} disabled={busy}
      onChange={(event) => setMargin(event.target.value)} /></label>
    {error ? <p role="alert">{t("errors.office_edit.invalid")}</p> : null}
    <Button disabled={busy || margin === ""} onClick={() => void apply()}>{t("officeDoc.apply")}</Button>
  </Dialog>;
}
