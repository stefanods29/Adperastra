import { useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "../../components/Dialog";
import type { OfficeChart } from "../types";

export function workbookChart(chart: OfficeChart, sheetIds: readonly string[]): OfficeChart {
  if (chart.source.kind !== "range" || !sheetIds.includes(chart.source.range.sheet_id)) throw new Error("office_edit.invalid");
  if (chart.title.length > 512) throw new Error("office_edit.invalid");
  return { ...chart, source: { ...chart.source, range: { ...chart.source.range } }, rect: { ...chart.rect } };
}

export default function SheetChartDialog({ chart, sheetIds, onConfirm, onClose, onError }: {
  chart: OfficeChart; sheetIds: readonly string[]; onConfirm: (chart: OfficeChart) => Promise<void>; onClose: () => void; onError: (error: unknown) => void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState(chart.kind);
  const [title, setTitle] = useState(chart.title);
  const [legend, setLegend] = useState(chart.legend);
  const [headers, setHeaders] = useState(chart.source.kind === "range" && chart.source.headers);
  const [pending, setPending] = useState(false);
  const kinds: OfficeChart["kind"][] = ["column", "bar", "line", "area", "pie", "scatter"];
  return <Dialog title={t("officeSheet.chart")} onClose={() => { if (!pending) onClose(); }}>
    <form onSubmit={(event) => {
      event.preventDefault(); if (pending || chart.source.kind !== "range") return;
      setPending(true);
      void Promise.resolve().then(() => onConfirm(workbookChart({ ...chart, kind, title, legend, source: { ...chart.source, headers } } as OfficeChart, sheetIds)))
        .then(onClose).catch(onError).finally(() => setPending(false));
    }}>
      <label>{t("officeSheet.chartType")}<select value={kind} disabled={pending} onChange={(event) => setKind(event.target.value as OfficeChart["kind"])}>
        {kinds.map((value) => <option key={value} value={value}>{t(`officeSheet.chartKind.${value}`)}</option>)}
      </select></label>
      <label>{t("officeSheet.chartTitle")}<input value={title} maxLength={512} disabled={pending} onChange={(event) => setTitle(event.target.value)} /></label>
      <label><input type="checkbox" checked={headers} disabled={pending} onChange={(event) => setHeaders(event.target.checked)} />{t("officeSheet.hasHeader")}</label>
      <label><input type="checkbox" checked={legend} disabled={pending} onChange={(event) => setLegend(event.target.checked)} />{t("officeSheet.legend")}</label>
      <p>{t("officeSheet.noExternal")}</p>
      <button type="submit" disabled={pending || chart.source.kind !== "range" || !sheetIds.includes(chart.source.range.sheet_id)}>{t("officeSheet.apply")}</button>
    </form>
  </Dialog>;
}
