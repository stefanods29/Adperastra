import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import Dialog from "../../components/Dialog";
import type { ExportSnapshot } from "../../services/exportSnapshots";
import type { DeckShape, OfficeChart } from "../types";
import {
  buildChartShape, buildGeometryShape, buildImageShape, buildTableShape, buildTextShape,
  MAX_TABLE_COLUMNS, MAX_TABLE_ROWS, newShapeId, validateShapeRect,
} from "./DeckShapeTools";

export type DeckInsertDialogId = "shape" | "image" | "table" | "chart";

export interface DeckInsertDialogsProps {
  dialog: DeckInsertDialogId;
  snapshot: ExportSnapshot | null;
  disabled: boolean;
  onInsert: (shape: DeckShape) => void;
  onPickImage: () => void;
  onClose: () => void;
  onOpenHelp: (slug: string) => void;
}

const GEOMETRY = ["rectangle", "ellipse", "line", "arrow", "triangle"] as const;
const CHART_KINDS: OfficeChart["kind"][] = ["column", "bar", "line", "area", "pie", "scatter"];

/** Shape, picture, table and chart insertion (Step 22a T4).
 *
 * The dialog builds one typed DeckShape; the caller sends one add_shape
 * transaction. Table cells are literal strings and chart data is bounded
 * inline data, so pasted `=1+1` never executes. A picture needs an immutable
 * authorized snapshot; without one the Insert button stays disabled. */
export default function DeckInsertDialogs({
  dialog,
  snapshot,
  disabled,
  onInsert,
  onPickImage,
  onClose,
  onOpenHelp,
}: DeckInsertDialogsProps) {
  const { t } = useTranslation();
  const [geometry, setGeometry] = useState<(typeof GEOMETRY)[number]>("rectangle");
  const [text, setText] = useState("");
  const [alt, setAlt] = useState("");
  const [rows, setRows] = useState(2);
  const [columns, setColumns] = useState(2);
  const [chartKind, setChartKind] = useState<OfficeChart["kind"]>("column");
  const [chartTitle, setChartTitle] = useState("");
  const [categories, setCategories] = useState("A, B, C");
  const [series, setSeries] = useState("1, 2, 3");

  const title =
    dialog === "shape" ? t("officeDeck.textBox") :
    dialog === "image" ? t("officeDeck.picture") :
    dialog === "table" ? t("officeDeck.table") : t("officeDeck.chart");

  const insert = () => {
    if (disabled) return;
    if (dialog === "shape") {
      const shape = text.trim()
        ? buildTextShape(newShapeId(), text)
        : buildGeometryShape(newShapeId(), geometry);
      if (validateShapeRect(shape.rect)) onInsert(shape);
      return;
    }
    if (dialog === "image") {
      if (!snapshot) return;
      onInsert(buildImageShape(newShapeId(), snapshot, alt));
      return;
    }
    if (dialog === "table") {
      const cells = Array.from({ length: Math.min(MAX_TABLE_ROWS, Math.max(1, rows)) }, () =>
        Array.from({ length: Math.min(MAX_TABLE_COLUMNS, Math.max(1, columns)) }, () => ""));
      onInsert(buildTableShape(newShapeId(), cells));
      return;
    }
    const categoryList = categories.split(",").map((entry) => entry.trim()).filter(Boolean).slice(0, 10_000);
    const values = series.split(",").map((entry) => Number(entry.trim()));
    if (categoryList.length === 0 || values.some((value) => !Number.isFinite(value))) return;
    const count = Math.min(categoryList.length, values.length);
    onInsert(buildChartShape(newShapeId(), {
      kind: chartKind,
      source: {
        kind: "inline",
        categories: categoryList.slice(0, count),
        series: [{ name: chartTitle.slice(0, 128), values: values.slice(0, count) }],
      },
      title: chartTitle.slice(0, 512),
      legend: true,
    }));
  };

  return (
    <Dialog title={title} onClose={onClose} className="adp-deck-dialog">
      <div className="adp-deck-dialog-body">
        {dialog === "shape" ? (
          <>
            <label className="adp-deck-field">
              <span>{t("officeDeck.shape")}</span>
              <select value={geometry} onChange={(event) => setGeometry(event.target.value as typeof geometry)}>
                {GEOMETRY.map((entry) => (
                  <option key={entry} value={entry}>{t(`officeDeck.geometry.${entry}`)}</option>
                ))}
              </select>
            </label>
            <label className="adp-deck-field">
              <span>{t("officeDeck.textBox")}</span>
              <textarea value={text} onChange={(event) => setText(event.target.value)} rows={3} />
            </label>
            <p className="adp-deck-hint">{t("officeDeck.shapeDefaults")}</p>
          </>
        ) : null}
        {dialog === "image" ? (
          <>
            <p>{snapshot ? t("officeDeck.imageReady") : t("officeDeck.imageNeedsCopy")}</p>
            <Button onClick={onPickImage} disabled={disabled}>{t("officeDeck.chooseImage")}</Button>
            <label className="adp-deck-field">
              <span>{t("officeDeck.altText")}</span>
              <input value={alt} maxLength={4096} onChange={(event) => setAlt(event.target.value)} />
            </label>
            {snapshot ? <p className="adp-deck-hint">{snapshot.mime} · {snapshot.byte_len}</p> : null}
          </>
        ) : null}
        {dialog === "table" ? (
          <div className="adp-deck-grid-fields">
            <label className="adp-deck-field">
              <span>{t("officeDeck.tableRows")}</span>
              <input type="number" min={1} max={MAX_TABLE_ROWS} value={rows}
                onChange={(event) => setRows(Math.min(MAX_TABLE_ROWS, Math.max(1, Number(event.target.value) || 1)))} />
            </label>
            <label className="adp-deck-field">
              <span>{t("officeDeck.tableColumns")}</span>
              <input type="number" min={1} max={MAX_TABLE_COLUMNS} value={columns}
                onChange={(event) => setColumns(Math.min(MAX_TABLE_COLUMNS, Math.max(1, Number(event.target.value) || 1)))} />
            </label>
          </div>
        ) : null}
        {dialog === "chart" ? (
          <>
            <label className="adp-deck-field">
              <span>{t("officeDeck.chartKindLabel")}</span>
              <select value={chartKind} onChange={(event) => setChartKind(event.target.value as OfficeChart["kind"])}>
                {CHART_KINDS.map((entry) => <option key={entry} value={entry}>{t(`officeDeck.chartKind.${entry}`)}</option>)}
              </select>
            </label>
            <label className="adp-deck-field">
              <span>{t("officeDeck.chartTitle")}</span>
              <input value={chartTitle} maxLength={512} onChange={(event) => setChartTitle(event.target.value)} />
            </label>
            <label className="adp-deck-field">
              <span>{t("officeDeck.chartCategories")}</span>
              <input value={categories} onChange={(event) => setCategories(event.target.value)} />
            </label>
            <label className="adp-deck-field">
              <span>{t("officeDeck.chartSeries")}</span>
              <input value={series} onChange={(event) => setSeries(event.target.value)} />
            </label>
            <p className="adp-deck-hint">{t("officeDeck.chartInlineHint")}</p>
          </>
        ) : null}
        <footer className="adp-deck-dialog-footer">
          <button type="button" className="adp-btn adp-btn--subtle" onClick={() => onOpenHelp("editing-presentations")}>
            {t("help.title")}
          </button>
          <span className="adp-deck-header-spacer" />
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={insert} disabled={disabled || (dialog === "image" && !snapshot)}>
            {t("officeDeck.insert")}
          </Button>
        </footer>
      </div>
    </Dialog>
  );
}
