import { useTranslation } from "react-i18next";
import type { ExportSnapshot } from "../../services/exportSnapshots";
import type {
  DeckShape, DeckTextParagraph, OfficeChart, OfficeColor, OfficeFont, OfficeRect, ParagraphFormat,
  TextFormat,
} from "../types";

/** Typed shape construction (Step 22a T4). Shapes are inserted through one
 * `add_shape` transaction; ids are chosen by the editor before the call, so
 * the first shape already has an app-owned UUID. No shape turns into an
 * executable object: table cells and chart labels stay inert text. */

export const MAX_GROUP_DEPTH = 16;
export const MAX_SHAPE_COORD_PT = 14_400;
export const MAX_SHAPE_SIZE_PT = 28_800;
export const MAX_TABLE_ROWS = 100;
export const MAX_TABLE_COLUMNS = 100;

/** The default text box rectangle (D-shape defaults in the guide). */
export function defaultShapeRect(): OfficeRect {
  return { x_pt: 36, y_pt: 72, width_pt: 288, height_pt: 144, rotation_deg: 0 };
}

/** A 4 pt grid position for a freshly inserted shape. */
export function defaultShapeRectAt(index: number): OfficeRect {
  const offset = Math.max(0, Math.min(40, Math.trunc(index) || 0)) * 4;
  return { x_pt: 36 + offset, y_pt: 72 + offset, width_pt: 288, height_pt: 144, rotation_deg: 0 };
}

export function newShapeId(): string {
  return crypto.randomUUID();
}

/** OfficeRect validation; NaN, infinity, negative sizes and values beyond
 * the 20a caps are refused before a transaction is sent. */
export function validateShapeRect(rect: OfficeRect): boolean {
  const values = [rect.x_pt, rect.y_pt, rect.width_pt, rect.height_pt, rect.rotation_deg];
  if (!values.every((value) => Number.isFinite(value))) return false;
  if (Math.abs(rect.x_pt) > MAX_SHAPE_COORD_PT || Math.abs(rect.y_pt) > MAX_SHAPE_COORD_PT) return false;
  if (!(rect.width_pt > 0) || !(rect.height_pt > 0)) return false;
  if (rect.width_pt > MAX_SHAPE_SIZE_PT || rect.height_pt > MAX_SHAPE_SIZE_PT) return false;
  return rect.rotation_deg >= -360 && rect.rotation_deg <= 360;
}

/** Parse an arbitrary rectangle; null means "refuse", never "use defaults". */
export function normalizeShapeRect(value: unknown): OfficeRect | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  const numbers = ["x_pt", "y_pt", "width_pt", "height_pt"] as const;
  if (!numbers.every((key) => typeof item[key] === "number" && Number.isFinite(item[key]))) return null;
  const rotation = typeof item.rotation_deg === "number" && Number.isFinite(item.rotation_deg) ? item.rotation_deg : 0;
  const rect: OfficeRect = {
    x_pt: item.x_pt as number,
    y_pt: item.y_pt as number,
    width_pt: item.width_pt as number,
    height_pt: item.height_pt as number,
    rotation_deg: ((rotation % 360) + 360) % 360,
  };
  return validateShapeRect(rect) ? rect : null;
}

/** Aggregate group depth, including the group being created. */
export function validateGroupDepth(depth: number): boolean {
  return Number.isInteger(depth) && depth >= 0 && depth <= MAX_GROUP_DEPTH;
}

export function exceedsGroupDepth(parentDepth: number): boolean {
  return !validateGroupDepth(parentDepth + 1);
}

export function defaultOfficeColor(red = 0, green = 0, blue = 0, alpha = 255): OfficeColor {
  return { r: red, g: green, b: blue, a: alpha };
}

export function defaultDeckFont(): OfficeFont {
  return { family: "Noto Sans", source: "installed", embeddable: false };
}

export function defaultTextFormat(): TextFormat {
  return {
    font: defaultDeckFont(), size_pt: 18, bold: false, italic: false, strike: false,
    underline: "none", script: "normal", foreground: defaultOfficeColor(0, 0, 0),
    highlight: null, language: "en-US",
  };
}

export function defaultParagraphFormat(): ParagraphFormat {
  return {
    align: "left", direction: "ltr", indent_left_pt: 0, indent_right_pt: 0, first_line_pt: 0,
    line_spacing: 1, before_pt: 0, after_pt: 0, list: "none", outline_level: 0,
  };
}

export function newTextParagraph(text: string, format: TextFormat = defaultTextFormat()): DeckTextParagraph {
  return {
    id: crypto.randomUUID(),
    runs: text ? [{ text, format }] : [],
    paragraph: defaultParagraphFormat(),
  };
}

/** A text box with one paragraph. The paragraph id is fresh and owned by the
 * editor; the engine adopts it, never the other way round. */
export function buildTextShape(id: string, text: string, rect = defaultShapeRect(), z = 1): DeckShape {
  return {
    id, kind: "text", rect, z, alt: "", fill: null,
    stroke: { color: defaultOfficeColor(0x43, 0x3e, 0x1c), width_pt: 1 },
    paragraphs: [newTextParagraph(text)],
  };
}

/** An image shape keeps the exact immutable snapshot it was given. */
export function buildImageShape(
  id: string,
  snapshot: ExportSnapshot,
  alt: string,
  rect = defaultShapeRect(),
  z = 1,
): DeckShape {
  return {
    id, kind: "image", rect, z, alt: alt.slice(0, 4096), fill: null,
    stroke: { color: defaultOfficeColor(0, 0, 0), width_pt: 1 },
    image: snapshot,
  };
}

export function buildGeometryShape(
  id: string,
  geometry: "rectangle" | "ellipse" | "line" | "arrow" | "triangle",
  rect = defaultShapeRect(),
  z = 1,
): DeckShape {
  return {
    id, kind: "geometry", rect, z, alt: "", fill: null,
    stroke: { color: defaultOfficeColor(0x43, 0x3e, 0x1c), width_pt: 1 },
    geometry,
  };
}

/** Table cells are inert strings, including formula-like text such as =1+1. */
export function buildTableShape(
  id: string,
  cells: readonly (readonly string[])[],
  rect = defaultShapeRect(),
  z = 1,
): DeckShape {
  const rows = cells.slice(0, MAX_TABLE_ROWS).map((row) =>
    row.slice(0, MAX_TABLE_COLUMNS).map((cell) => String(cell)));
  return {
    id, kind: "table", rect, z, alt: "", fill: null,
    stroke: { color: defaultOfficeColor(0, 0, 0), width_pt: 1 },
    cells: rows,
  };
}

/** A chart with a bounded inline data source; no live external range. */
export function buildChartShape(
  id: string,
  chart: Omit<OfficeChart, "id" | "rect">,
  rect = defaultShapeRect(),
  z = 1,
): DeckShape {
  return {
    id, kind: "chart", rect, z, alt: "", fill: null,
    stroke: { color: defaultOfficeColor(0, 0, 0), width_pt: 1 },
    chart: { ...chart, id: crypto.randomUUID(), rect },
  };
}

export interface DeckShapeToolsProps {
  disabled: boolean;
  onInsert: (shape: DeckShape) => void;
  onOpenDialog: (id: "shape" | "image" | "table" | "chart") => void;
  onOpenHelp: (slug: string) => void;
}

/** Compact shape palette for the Insert tab. The full mix of geometry and
 * picture/table/chart dialogs is opened through the shared dialog ids. */
export default function DeckShapeTools({ disabled, onInsert, onOpenDialog, onOpenHelp }: DeckShapeToolsProps) {
  const { t } = useTranslation();
  const geometry: { id: "rectangle" | "ellipse" | "line" | "arrow" | "triangle"; labelKey: string }[] = [
    { id: "rectangle", labelKey: "officeDeck.geometry.rectangle" },
    { id: "ellipse", labelKey: "officeDeck.geometry.ellipse" },
    { id: "line", labelKey: "officeDeck.geometry.line" },
    { id: "arrow", labelKey: "officeDeck.geometry.arrow" },
    { id: "triangle", labelKey: "officeDeck.geometry.triangle" },
  ];
  return (
    <div className="adp-deck-shape-tools" role="toolbar" aria-label={t("officeDeck.shapes")}>
      {geometry.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className="adp-btn"
          disabled={disabled}
          onClick={() => {
            const shape = buildGeometryShape(newShapeId(), entry.id);
            if (validateShapeRect(shape.rect)) onInsert(shape);
          }}
        >
          {t(entry.labelKey)}
        </button>
      ))}
      <button type="button" className="adp-btn" disabled={disabled} onClick={() => {
        const shape = buildTextShape(newShapeId(), t("officeDeck.textPlaceholder"));
        if (validateShapeRect(shape.rect)) onInsert(shape);
      }}>
        {t("officeDeck.textBox")}
      </button>
      <button type="button" className="adp-btn" disabled={disabled} onClick={() => onOpenDialog("image")}>
        {t("officeDeck.picture")}
      </button>
      <button type="button" className="adp-btn" disabled={disabled} onClick={() => onOpenDialog("table")}>
        {t("officeDeck.table")}
      </button>
      <button type="button" className="adp-btn" disabled={disabled} onClick={() => onOpenDialog("chart")}>
        {t("officeDeck.chart")}
      </button>
      <button type="button" className="adp-icon-btn" aria-label={t("help.title")} onClick={() => onOpenHelp("editing-presentations")}>
        ?
      </button>
    </div>
  );
}
