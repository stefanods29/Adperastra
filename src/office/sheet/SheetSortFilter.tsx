import { useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "../../components/Dialog";
import type { CellRange, SheetOperation } from "../types";

export default function SheetSortFilter({ range, onConfirm, onClose, onError }: {
  range: CellRange; onConfirm: (operation: Extract<SheetOperation, { kind: "sort" }>) => Promise<void>;
  onClose: () => void; onError: (error: unknown) => void;
}) {
  const { t } = useTranslation();
  const [header, setHeader] = useState(true);
  const [column, setColumn] = useState(0);
  const [descending, setDescending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  return <Dialog title={t("officeSheet.sort")} onClose={() => { if (!pending) onClose(); }}>
    <p>{t("officeSheet.sortRange", { firstRow: range.first_row + 1, lastRow: range.last_row + 1, firstColumn: range.first_column + 1, lastColumn: range.last_column + 1 })}</p>
    <label><input type="checkbox" checked={header} disabled={pending} onChange={(event) => setHeader(event.target.checked)} />{t("officeSheet.hasHeader")}</label>
    <label>{t("officeSheet.sortColumn")}<input type="number" min={1} max={range.last_column - range.first_column + 1} value={column + 1} disabled={pending} onChange={(event) => setColumn(Number(event.target.value) - 1)} /></label>
    <label><input type="checkbox" checked={descending} disabled={pending} onChange={(event) => setDescending(event.target.checked)} />{t("officeSheet.descending")}</label>
    <label><input type="checkbox" checked={confirmed} disabled={pending} onChange={(event) => setConfirmed(event.target.checked)} />{t("officeSheet.sortFullRows")}</label>
    <button type="button" disabled={!confirmed || pending || !Number.isInteger(column) || column < 0 || column > range.last_column - range.first_column} onClick={() => {
      setPending(true);
      void onConfirm({ kind: "sort", range: { ...range }, has_header: header, keys: [{ column_offset: column, direction: descending ? "descending" : "ascending", comparison: "auto" }] })
        .then(onClose).catch(onError).finally(() => setPending(false));
    }}>{t("officeSheet.apply")}</button>
  </Dialog>;
}
