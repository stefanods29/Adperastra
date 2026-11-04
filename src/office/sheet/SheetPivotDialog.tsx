import { useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "../../components/Dialog";
import type { SheetOperation } from "../types";

type Pivot = Extract<SheetOperation, { kind: "upsert_pivot" }>["pivot"];
/** A preview must be bound by the host to this exact pivot/revision before Apply. */
export default function SheetPivotDialog({ pivot, destinationReviewed, onConfirm, onClose, onError }: {
  pivot: Pivot; destinationReviewed: boolean; onConfirm: (pivot: Pivot) => Promise<void>; onClose: () => void; onError: (error: unknown) => void;
}) {
  const { t } = useTranslation();
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  return <Dialog title={t("officeSheet.pivot")} onClose={() => { if (!pending) onClose(); }}>
    <p>{t("officeSheet.pivotReview")}</p>
    <p>{t("officeSheet.pivotFields", { rows: pivot.rows.map((value) => value + 1).join(", "), columns: pivot.columns.map((value) => value + 1).join(", ") })}</p>
    <label><input type="checkbox" checked={acknowledged} disabled={pending || !destinationReviewed} onChange={(event) => setAcknowledged(event.target.checked)} />{t("officeSheet.pivotOverwriteReview")}</label>
    <button type="button" disabled={pending || !destinationReviewed || !acknowledged} onClick={() => {
      setPending(true); void onConfirm(pivot).then(onClose).catch(onError).finally(() => setPending(false));
    }}>{t("officeSheet.apply")}</button>
  </Dialog>;
}
