import type { DocumentOperation, TextPosition, TextSpan } from "../types";
import type { ExportSnapshot } from "../../services/exportSnapshots";

/** Builders consume authorized immutable snapshots, never paths or live disk bytes. */
export function documentInsertImage(position: TextPosition, snapshot: ExportSnapshot,
  widthPt: number, heightPt: number, alt: string): DocumentOperation {
  if (!Number.isFinite(widthPt) || !Number.isFinite(heightPt) || widthPt <= 0 || heightPt <= 0 ||
      widthPt > 14400 || heightPt > 14400 || [...alt].length > 4096 ||
      !["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/tiff"].includes(snapshot.mime)) {
    throw new Error("office_edit.invalid");
  }
  return { kind: "insert_image", position: { ...position }, snapshot: { ...snapshot }, width_pt: widthPt, height_pt: heightPt, alt };
}

export function documentInsertTable(position: TextPosition, rows: number, columns: number): DocumentOperation {
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || rows > 100 || columns < 1 || columns > 100) {
    throw new Error("office_edit.invalid");
  }
  return { kind: "insert_table", position: { ...position }, rows, columns };
}

export function documentInsertLink(span: TextSpan, value: string): DocumentOperation {
  if (value.length > 2048 || value !== value.trim() || /[\u0000-\u0020\u007f]/.test(value)) throw new Error("office_edit.invalid");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("office_edit.invalid"); }
  const scheme = url.protocol.slice(0, -1);
  if (scheme !== "https" && scheme !== "http" && scheme !== "mailto") throw new Error("office_edit.invalid");
  return { kind: "insert_link", span, target: { kind: "url", url: value, scheme } };
}
