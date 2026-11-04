import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
} from "pdf-lib";
import {
  PDF_EDIT_MAX_ANNOTATIONS,
  PDF_EDIT_MAX_PAGES,
  PDF_EDIT_MAX_WIRE_BYTES,
  isPdfEditUuid,
  pdfRectUnion,
  type PdfAnnotationKind,
  type PdfPoint,
  type PdfRect,
  type PdfRotation,
} from "../pdf-edit/types";
import { inspectPdfFormFields } from "./formWriter";
import { loadPdfForEdit } from "./pageCopy";
import type { PdfEditInspectReply, PdfLoadedAnnotation } from "./editTypes";

/** Source inspection for the PDF editor (Step 14a T2/T5).
 *
 * Recognized standard annotations are loaded into the editable model; every
 * other annotation object is counted and preserved untouched. Existing visual
 * stamps are preserved rather than re-created, because their raster/vector
 * appearance cannot be reconstructed exactly. No annotation is executed. */

function asDict(pdf: PDFDocument, value: unknown): PDFDict | null {
  if (value instanceof PDFDict) return value;
  if (value instanceof PDFRef) {
    const looked = pdf.context.lookup(value);
    return looked instanceof PDFDict ? looked : null;
  }
  return null;
}

function nameOf(dict: PDFDict, key: string): string | null {
  const value = dict.lookupMaybe(PDFName.of(key), PDFName);
  // `asString()` keeps the leading slash; subtype checks compare decoded names.
  return value ? value.decodeText() : null;
}

function textOf(dict: PDFDict, key: string): string {
  const value = dict.get(PDFName.of(key));
  if (value instanceof PDFHexString) return value.decodeText();
  if (value instanceof PDFString) return value.decodeText();
  return "";
}

function numbersOf(pdf: PDFDocument, value: PDFArray | undefined): number[] {
  if (!value) return [];
  const numbers: number[] = [];
  for (const entry of value.asArray()) {
    const looked = entry instanceof PDFNumber ? entry : pdf.context.lookup(entry);
    if (looked instanceof PDFNumber) numbers.push(looked.asNumber());
  }
  return numbers;
}

function rectOf(pdf: PDFDocument, dict: PDFDict, crop: PdfRect): PdfRect | null {
  const array = dict.lookupMaybe(PDFName.of("Rect"), PDFArray);
  const values = numbersOf(pdf, array);
  if (values.length !== 4) return null;
  const x1 = Math.min(values[0], values[2]);
  const x2 = Math.max(values[0], values[2]);
  const y1 = Math.min(values[1], values[3]);
  const y2 = Math.max(values[1], values[3]);
  const x = Math.max(0, x1 - crop.x);
  const y = Math.max(0, crop.height - (y2 - crop.y));
  return {
    x,
    y,
    width: Math.min(crop.width - x, x2 - x1),
    height: Math.min(crop.height - y, y2 - y1),
  };
}

function colorOf(pdf: PDFDocument, dict: PDFDict): [number, number, number, number] {
  const values = numbersOf(pdf, dict.lookupMaybe(PDFName.of("C"), PDFArray));
  const alpha = dict.lookupMaybe(PDFName.of("CA"), PDFNumber);
  const channel = (index: number, fallback: number) =>
    values[index] !== undefined && Number.isFinite(values[index]) ? Math.max(0, Math.min(1, values[index])) : fallback;
  return [channel(0, 1), channel(1, 0.8), channel(2, 0), Math.max(0, Math.min(1, alpha ? alpha.asNumber() : 1))];
}

function dateOf(dict: PDFDict): number {
  const value = dict.get(PDFName.of("M"));
  try {
    if (value instanceof PDFString || value instanceof PDFHexString) {
      return Math.max(0, Math.floor(value.decodeDate().getTime() / 1000));
    }
  } catch {
    // A malformed date does not make the annotation unusable.
  }
  return 0;
}

function fontSizeOf(dict: PDFDict): number | null {
  const value = dict.get(PDFName.of("DA"));
  if (!(value instanceof PDFString) && !(value instanceof PDFHexString)) return null;
  const match = /(\d+(?:\.\d+)?)\s+Tf\b/.exec(value.decodeText());
  if (!match) return null;
  const size = Number(match[1]);
  return Number.isFinite(size) ? size : null;
}

function parentNm(pdf: PDFDocument, dict: PDFDict): string | null {
  const ref = dict.lookupMaybe(PDFName.of("IRT"), PDFRef);
  if (!ref) return null;
  const parent = asDict(pdf, ref);
  return parent ? textOf(parent, "NM") || null : null;
}

function pdfPointTopLeft(x: number, y: number, crop: PdfRect): PdfPoint {
  return { x: x - crop.x, y: crop.y + crop.height - y };
}

function quadPointsOf(pdf: PDFDocument, dict: PDFDict, crop: PdfRect): PdfPoint[][] | undefined {
  const values = numbersOf(pdf, dict.lookupMaybe(PDFName.of("QuadPoints"), PDFArray));
  if (values.length < 8 || values.length % 8 !== 0) return undefined;
  const quads: PdfPoint[][] = [];
  for (let index = 0; index < values.length; index += 8) {
    const points: PdfPoint[] = [];
    for (let point = 0; point < 4; point += 1) {
      points.push(pdfPointTopLeft(values[index + point * 2], values[index + point * 2 + 1], crop));
    }
    // PDF order is lower-left, lower-right, upper-right, upper-left. The
    // model order is clockwise from the upper-left.
    quads.push([points[3], points[2], points[1], points[0]]);
  }
  return quads;
}

function inkStrokesOf(pdf: PDFDocument, dict: PDFDict, crop: PdfRect): PdfPoint[][] | undefined {
  const list = dict.lookupMaybe(PDFName.of("InkList"), PDFArray);
  if (!list) return undefined;
  const strokes: PdfPoint[][] = [];
  for (const entry of list.asArray()) {
    const array = entry instanceof PDFArray ? entry : pdf.context.lookup(entry);
    if (!(array instanceof PDFArray)) continue;
    const values = numbersOf(pdf, array);
    const points: PdfPoint[] = [];
    for (let index = 0; index + 1 < values.length; index += 2) {
      points.push(pdfPointTopLeft(values[index], values[index + 1], crop));
    }
    if (points.length >= 2) strokes.push(points);
  }
  return strokes.length > 0 ? strokes : undefined;
}

function rotateOf(pdf: PDFDocument, pageIndex: number): PdfRotation {
  const angle = pdf.getPage(pageIndex).getRotation().angle;
  if (angle === 90 || angle === 180 || angle === 270) return angle;
  return 0;
}

export async function inspectPdfEditDocument(sourceBytes: Uint8Array): Promise<PdfEditInspectReply> {
  const pdf = await loadPdfForEdit(sourceBytes);
  if (pdf.getPageCount() > PDF_EDIT_MAX_PAGES) throw new Error("pdf_edit.too_large");
  const form = inspectPdfFormFields(pdf);
  const unsupported = new Set<string>(form.unsupported_structures);
  if (pdf.catalog.get(PDFName.of("Outlines"))) unsupported.add("outline");
  if (pdf.catalog.get(PDFName.of("StructTreeRoot"))) unsupported.add("structure_tree");
  if (pdf.catalog.get(PDFName.of("OpenAction")) || pdf.catalog.get(PDFName.of("AA"))) unsupported.add("javascript");
  if (form.xfa) unsupported.add("xfa");
  const names = pdf.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  if (names && names.get(PDFName.of("EmbeddedFiles"))) unsupported.add("embedded_files");

  const pages: PdfEditInspectReply["pages"] = [];
  const annotations: PdfLoadedAnnotation[] = [];
  const seenIds = new Set<string>();
  let unknown = 0;
  let signaturePresent = form.signature_present;
  for (let pageIndex = 0; pageIndex < pdf.getPageCount(); pageIndex += 1) {
    const page = pdf.getPage(pageIndex);
    const crop = page.getCropBox();
    pages.push({
      origin_page: pageIndex + 1,
      rotation: rotateOf(pdf, pageIndex),
      crop: { x: crop.x, y: crop.y, width: crop.width, height: crop.height },
    });
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let index = 0; index < annots.size(); index += 1) {
      const dict = asDict(pdf, annots.get(index));
      if (!dict) continue;
      const subtype = nameOf(dict, "Subtype");
      if (subtype === "Widget" || subtype === "Popup") continue;
      if (subtype === "Sig") {
        signaturePresent = true;
        continue;
      }
      if (subtype === "Text" && dict.get(PDFName.of("Popup"))) {
        // A comment with a Popup child cannot be rewritten without orphaning
        // that child; preserve the whole original comment untouched.
        unknown += 1;
        continue;
      }
      const nm = textOf(dict, "NM") || null;
      const kind = kindOf(subtype);
      const rect = rectOf(pdf, dict, crop);
      // The model identifies an annotation by its UUID /NM. A foreign or
      // missing /NM cannot round-trip, so it stays unknown and untouched.
      if (!kind || !rect || !nm || !isPdfEditUuid(nm) || seenIds.has(nm)) {
        unknown += 1;
        continue;
      }
      const quads = kind === "highlight" ? quadPointsOf(pdf, dict, crop) : undefined;
      const strokes = kind === "ink" ? inkStrokesOf(pdf, dict, crop) : undefined;
      const modelRect = quads || strokes ? pdfRectUnion((quads ?? strokes ?? []).flat()) : rect;
      const color = colorOf(pdf, dict);
      const annotation: PdfLoadedAnnotation = {
        origin_page: pageIndex + 1,
        nm,
        kind,
        rect: modelRect,
        color,
        opacity: color[3],
        author: textOf(dict, "T").slice(0, 128),
        created_unix: dateOf(dict),
        text: textOf(dict, "Contents").slice(0, 8_192),
      };
      if (quads) annotation.quads = quads;
      if (strokes) annotation.strokes = strokes;
      if (kind === "comment") {
        const parent = parentNm(pdf, dict);
        if (dict.get(PDFName.of("IRT"))) {
          // A reply whose parent is missing or not one of our UUID comments
          // cannot keep its /IRT chain; preserve the whole source reply.
          if (!parent || !isPdfEditUuid(parent)) {
            unknown += 1;
            continue;
          }
          annotation.parent_nm = parent;
        }
      }
      if (kind === "text") {
        const size = fontSizeOf(dict);
        if (size !== null) annotation.font_size = size;
      }
      seenIds.add(nm);
      annotations.push(annotation);
      if (annotations.length > PDF_EDIT_MAX_ANNOTATIONS) throw new Error("pdf_edit.too_large");
    }
  }
  // Replies are loaded only when their root comment is part of this model.
  // Anything else stays an unknown source annotation and is never rewritten.
  const roots = new Set(annotations.filter((annotation) => !annotation.parent_nm).map((annotation) => annotation.nm));
  const kept = annotations.filter((annotation) => {
    const parent = annotation.parent_nm;
    return !parent || (roots.has(parent) && seenIds.has(parent));
  });
  unknown += annotations.length - kept.length;
  const owned = kept.map((annotation) => annotation.nm as string);
  const reply: PdfEditInspectReply = {
    pages,
    annotations: kept,
    forms: form.values,
    form_options: form.options,
    signature_present: signaturePresent,
    xfa_present: form.xfa,
    rich_text_fields: form.rich_text_fields,
    unsupported_structures: [...unsupported],
    owned_annotation_ids: owned,
    unknown_annotations: unknown,
    byte_len: 0,
  };
  reply.byte_len = new TextEncoder().encode(JSON.stringify(reply)).byteLength;
  if (reply.byte_len > PDF_EDIT_MAX_WIRE_BYTES) throw new Error("pdf_edit.too_large");
  return reply;
}

/** Existing stamps are always preserved: their raster/vector appearance is
 * not reconstructed, so they are counted as unknown and left untouched. */
function kindOf(subtype: string | null): PdfAnnotationKind | null {
  if (subtype === "Highlight") return "highlight";
  if (subtype === "Ink") return "ink";
  if (subtype === "FreeText") return "text";
  if (subtype === "Text") return "comment";
  return null;
}
