import { useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "../../components/Dialog";
import Button from "../../components/Button";
import type { DocumentOperation, ParagraphFormatPatch } from "../types";

export function documentIndent(left: number, direction: "indent" | "outdent"): ParagraphFormatPatch {
  if (!Number.isFinite(left) || left < 0 || left > 720) throw new Error("office_edit.invalid");
  const next = direction === "indent" ? left + 18 : Math.max(0, left - 18);
  if (next > 720) throw new Error("office_edit.invalid");
  return { indent_left_pt: next };
}

export function documentParagraphOperation(blockIds: readonly string[], patch: ParagraphFormatPatch): DocumentOperation {
  if (blockIds.length === 0 || blockIds.length > 1000 || Object.keys(patch).length === 0) throw new Error("office_edit.invalid");
  return { kind: "format_paragraph", block_ids: [...blockIds], patch };
}

/** IDs are the live engine selection's paragraphs, never guessed from span endpoints. */
export function DocumentParagraphDialog({ blockIds, onApply, onClose }: {
  blockIds: readonly string[]; onApply: (operation: DocumentOperation) => Promise<void>; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [spacing, setSpacing] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const apply = async () => {
    const value = Number(spacing);
    if (spacing === "" || !Number.isFinite(value) || value < 0.5 || value > 5) { setError(true); return; }
    setBusy(true); setError(false);
    try { await onApply(documentParagraphOperation(blockIds, { line_spacing: value })); onClose(); }
    catch { setError(true); } finally { setBusy(false); }
  };
  return <Dialog title={t("officeDoc.paragraph")} onClose={onClose}>
    <label>{t("officeDoc.spacing")}<input type="number" min={0.5} max={5} step={0.1}
      value={spacing} onChange={(event) => setSpacing(event.target.value)} disabled={busy} /></label>
    {error ? <p role="alert">{t("errors.office_edit.invalid")}</p> : null}
    <Button disabled={busy || blockIds.length === 0 || spacing === ""} onClick={() => void apply()}>{t("officeDoc.apply")}</Button>
  </Dialog>;
}
