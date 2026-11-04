import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  degrees,
  type PDFFont,
} from "pdf-lib";
import type { PdfAnnotation, PdfEditModel, PdfEditSerializeInspection, PdfPoint, PdfRect } from "../pdf-edit/types";
import { PDF_EDIT_MAX_SOURCE_BYTES } from "../pdf-edit/types";
import { buildAnnotationAppearance, editPointToPdf, editRectToPdf } from "./appearances";
import { applyPdfFormValues, inspectPdfFormFields } from "./formWriter";
import { loadPdfForEdit, rebuildPdfInPageOrder } from "./pageCopy";
import type { PdfEditImageSource } from "./editTypes";

/** Standard annotation dictionaries (Step 14a D3-D5, T2/T3).
 *
 * New marks are indirect dictionaries appended to the page's `/Annots`
 * array. Only annotations whose `/NM` is owned by this model are removed and
 * rewritten; every unknown annotation and unrelated object stays untouched.
 * Human text uses `PDFHexString.fromText` and never reaches raw PDF syntax. */

const SUBTYPES: Record<PdfAnnotation["kind"], string> = {
  highlight: "Highlight",
  ink: "Ink",
  text: "FreeText",
  comment: "Text",
  signature: "Stamp",
};

export interface PdfAnnotationApplyOptions {
  ownedAnnotationIds: readonly string[];
  font: PDFFont;
  images: ReadonlyMap<string, PdfEditImageSource>;
}

export interface PdfAnnotationApplyResult {
  added: number;
  removed: number;
  preserved_unknown: number;
}

function dictionaryOf(pdf: PDFDocument, value: unknown): PDFDict | null {
  if (value instanceof PDFDict) return value;
  if (value instanceof PDFRef) {
    const looked = pdf.context.lookup(value);
    return looked instanceof PDFDict ? looked : null;
  }
  return null;
}

function nameOf(dictionary: PDFDict, key: string): string | null {
  const value = dictionary.lookupMaybe(PDFName.of(key), PDFName);
  // `asString()` keeps the leading slash (`/Highlight`); the decoded name is
  // what the subtype checks compare.
  return value ? value.decodeText() : null;
}

function textOf(dictionary: PDFDict, key: string): string {
  const value = dictionary.get(PDFName.of(key));
  if (value instanceof PDFHexString) return value.decodeText();
  if (value instanceof PDFString) return value.decodeText();
  return "";
}

function numberValues(pdf: PDFDocument, array: PDFArray): number[] {
  const values: number[] = [];
  for (const entry of array.asArray()) {
    const value = entry instanceof PDFNumber ? entry : pdf.context.lookup(entry);
    if (value instanceof PDFNumber) values.push(value.asNumber());
  }
  return values;
}

function colorOf(pdf: PDFDocument, dictionary: PDFDict): [number, number, number] {
  const array = dictionary.lookupMaybe(PDFName.of("C"), PDFArray);
  const values = array ? numberValues(pdf, array) : [];
  return [values[0] ?? 1, values[1] ?? 0.8, values[2] ?? 0];
}

function opacityOf(dictionary: PDFDict): number {
  const value = dictionary.lookupMaybe(PDFName.of("CA"), PDFNumber);
  return value ? Math.min(1, Math.max(0, value.asNumber())) : 1;
}

function dateOf(dictionary: PDFDict): number {
  const value = dictionary.get(PDFName.of("M"));
  try {
    if (value instanceof PDFString || value instanceof PDFHexString) {
      const date = value.decodeDate();
      return Math.max(0, Math.floor(date.getTime() / 1000));
    }
  } catch {
    // A malformed date is not a reason to reject an otherwise usable mark.
  }
  return 0;
}

function pdfDate(unix: number): string {
  const date = new Date(Math.max(0, unix) * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function toPdfPoints(points: readonly PdfPoint[], crop: PdfRect): PdfPoint[] {
  return points.map((point) => editPointToPdf(point, crop));
}

/** PDF QuadPoints are counterclockwise from the lower-left. The model stores
 * quads clockwise from the upper-left, so the order is reversed here. */
function quadPoints(points: readonly PdfPoint[], crop: PdfRect): number[] {
  const pdfPoints = toPdfPoints(points, crop);
  const ordered = [pdfPoints[3], pdfPoints[2], pdfPoints[1], pdfPoints[0]];
  return ordered.flatMap((point) => [point.x, point.y]);
}

function openAnnots(pdf: PDFDocument, pageIndex: number): PDFArray {
  const page = pdf.getPage(pageIndex);
  const existing = page.node.Annots();
  if (existing) return existing;
  const annots = pdf.context.obj([]);
  page.node.set(PDFName.of("Annots"), annots);
  return annots;
}

function annotationDict(
  pdf: PDFDocument,
  annotation: PdfAnnotation,
  crop: PdfRect,
  pageIndex: number,
  font: PDFFont,
  image?: Parameters<typeof buildAnnotationAppearance>[4],
  parentRef?: PDFRef,
): PDFDict {
  const page = pdf.getPage(pageIndex);
  const rect = editRectToPdf(annotation.rect, crop);
  const dictionary = pdf.context.obj({
    Type: "Annot",
    Subtype: SUBTYPES[annotation.kind],
    Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
    P: page.ref,
    NM: PDFHexString.fromText(annotation.id),
    M: PDFString.of(pdfDate(annotation.created_unix)),
    T: PDFHexString.fromText(annotation.author),
    Contents: PDFHexString.fromText(annotation.text),
    F: 4,
    C: [annotation.color[0], annotation.color[1], annotation.color[2]],
    CA: annotation.opacity,
  });
  if (annotation.kind !== "comment") {
    const appearance = buildAnnotationAppearance(pdf, annotation, crop, font, image);
    dictionary.set(PDFName.of("AP"), pdf.context.obj({ N: appearance }));
  }
  if (annotation.kind === "highlight") {
    const quads = (annotation.quads ?? []).map((quad) => quadPoints(quad, crop));
    dictionary.set(PDFName.of("QuadPoints"), pdf.context.obj(quads.flat()));
  }
  if (annotation.kind === "ink") {
    const inkList = (annotation.strokes ?? []).map((stroke) =>
      toPdfPoints(stroke, crop).flatMap((point) => [point.x, point.y]),
    );
    dictionary.set(PDFName.of("InkList"), pdf.context.obj(inkList));
    dictionary.set(
      PDFName.of("BS"),
      pdf.context.obj({ W: 2, S: "Solid" }),
    );
  }
  if (annotation.kind === "text") {
    dictionary.set(PDFName.of("DA"), PDFString.of(`/F0 ${annotation.font_size ?? 12} Tf 0 g`));
    dictionary.set(PDFName.of("Q"), PDFNumber.of(0));
  }
  if (annotation.kind === "comment") {
    dictionary.set(PDFName.of("Name"), PDFName.of("Comment"));
    dictionary.set(PDFName.of("Open"), pdf.context.obj(false));
    if (parentRef) {
      dictionary.set(PDFName.of("IRT"), parentRef);
      dictionary.set(PDFName.of("RT"), PDFName.of("R"));
    }
  }
  return dictionary;
}

/** Remove exactly the annotations this model owned before, keeping every
 * unknown annotation in place. */
function removeOwnedAnnotations(pdf: PDFDocument, owned: ReadonlySet<string>): number {
  if (owned.size === 0) return 0;
  let removed = 0;
  for (let pageIndex = 0; pageIndex < pdf.getPageCount(); pageIndex += 1) {
    const annots = pdf.getPage(pageIndex).node.Annots();
    if (!annots) continue;
    for (let index = annots.size() - 1; index >= 0; index -= 1) {
      const dictionary = dictionaryOf(pdf, annots.get(index));
      if (!dictionary) continue;
      const nm = textOf(dictionary, "NM");
      if (!owned.has(nm)) continue;
      annots.remove(index);
      removed += 1;
    }
  }
  return removed;
}

export async function applyPdfAnnotations(
  pdf: PDFDocument,
  model: Pick<Readonly<PdfEditModel>, "pages" | "annotations">,
  options: PdfAnnotationApplyOptions,
): Promise<PdfAnnotationApplyResult> {
  // Only annotations present in this model may be replaced. Any other id is
  // ignored, so a stale or forged owned list can never delete an unknown
  // source annotation (R-SAFE).
  const modelIds = new Set(model.annotations.map((annotation) => annotation.id));
  const owned = new Set(options.ownedAnnotationIds.filter((id) => modelIds.has(id)));
  const removed = removeOwnedAnnotations(pdf, owned);
  const pageIndex = new Map(model.pages.map((page, index) => [page.id, index]));
  const refs = new Map<string, PDFRef>();
  const roots = model.annotations.filter((annotation) => !annotation.parent_id);
  const replies = model.annotations.filter((annotation) => annotation.parent_id);
  let added = 0;
  for (const annotation of [...roots, ...replies]) {
    const index = pageIndex.get(annotation.page_id);
    if (index === undefined) throw new Error("pdf_edit.bad_request");
    const crop = model.pages[index].crop;
    let image: Parameters<typeof buildAnnotationAppearance>[4];
    if (annotation.image) {
      const source = options.images.get(annotation.image.snapshot_id);
      if (!source) throw new Error("pdf_edit.changed");
      image = source.mime === "image/png" ? await pdf.embedPng(source.bytes) : await pdf.embedJpg(source.bytes);
    }
    let parentRef: PDFRef | undefined;
    if (annotation.parent_id) {
      parentRef = refs.get(annotation.parent_id);
      if (!parentRef) throw new Error("pdf_edit.bad_request");
    }
    const dictionary = annotationDict(pdf, annotation, crop, index, options.font, image, parentRef);
    const ref = pdf.context.register(dictionary);
    openAnnots(pdf, index).push(ref);
    refs.set(annotation.id, ref);
    added += 1;
  }
  const unknown = countAnnotations(pdf) - model.annotations.length;
  return { added, removed, preserved_unknown: Math.max(0, unknown) };
}

export function countAnnotations(pdf: PDFDocument): number {
  let count = 0;
  for (let pageIndex = 0; pageIndex < pdf.getPageCount(); pageIndex += 1) {
    const annots = pdf.getPage(pageIndex).node.Annots();
    if (annots) count += annots.size();
  }
  return count;
}

/** Read one annotation dictionary for inspection/tests. */
export function readPdfAnnotation(pdf: PDFDocument, dictionary: PDFDict): {
  subtype: string | null;
  nm: string;
  rect: PdfRect | null;
  contents: string;
  author: string;
  createdUnix: number;
  color: [number, number, number];
  opacity: number;
} {
  const rectArray = dictionary.lookupMaybe(PDFName.of("Rect"), PDFArray);
  const rect = rectArray ? rectArray.asRectangle() : null;
  const values = rectArray ? numberValues(pdf, rectArray) : [];
  return {
    subtype: nameOf(dictionary, "Subtype"),
    nm: textOf(dictionary, "NM"),
    rect: rect
      ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      : values.length === 4
        ? { x: values[0], y: values[1], width: values[2] - values[0], height: values[3] - values[1] }
        : null,
    contents: textOf(dictionary, "Contents"),
    author: textOf(dictionary, "T"),
    createdUnix: dateOf(dictionary),
    color: colorOf(pdf, dictionary),
    opacity: opacityOf(dictionary),
  };
}

/** Find one annotation by its `/NM` id, across all pages. */
export function findPdfAnnotation(pdf: PDFDocument, id: string): PDFDict | null {
  for (let pageIndex = 0; pageIndex < pdf.getPageCount(); pageIndex += 1) {
    const annots = pdf.getPage(pageIndex).node.Annots();
    if (!annots) continue;
    for (let index = 0; index < annots.size(); index += 1) {
      const dictionary = dictionaryOf(pdf, annots.get(index));
      if (dictionary && textOf(dictionary, "NM") === id) return dictionary;
    }
  }
  return null;
}

export interface SerializePdfEditPayload {
  model: Omit<PdfEditModel, "history">;
  revision: number;
  content_id: string;
  owned_annotation_ids: readonly string[];
}

/** Load and embed the licensed export font in the exact document being
 * written. It must run after any page rebuild, because a rebuilt document has
 * a new object graph. */
export type PdfEditFontProvider = (pdf: PDFDocument) => Promise<PDFFont>;

export interface SerializePdfEditResult {
  bytes: Uint8Array;
  inspection: PdfEditSerializeInspection;
}

function sameBaseOrder(model: Omit<PdfEditModel, "history">, sourceId: string, pageCount: number): boolean {
  if (model.pages.length !== pageCount) return false;
  return model.pages.every(
    (page, index) => page.origin_source.snapshot_id === sourceId && page.origin_page === index + 1,
  );
}

function hasSignatureAnnotation(pdf: PDFDocument): boolean {
  for (let pageIndex = 0; pageIndex < pdf.getPageCount(); pageIndex += 1) {
    const annots = pdf.getPage(pageIndex).node.Annots();
    if (!annots) continue;
    for (let index = 0; index < annots.size(); index += 1) {
      const dictionary = dictionaryOf(pdf, annots.get(index));
      if (dictionary && nameOf(dictionary, "Subtype") === "Sig") return true;
    }
  }
  return false;
}

/** Annotations this model does not own. They must survive untouched, even
 * when their subtype is one we can otherwise load. */
function countUnknownAnnotations(pdf: PDFDocument, known: ReadonlySet<string>): number {
  let unknown = 0;
  for (let pageIndex = 0; pageIndex < pdf.getPageCount(); pageIndex += 1) {
    const annots = pdf.getPage(pageIndex).node.Annots();
    if (!annots) continue;
    for (let index = 0; index < annots.size(); index += 1) {
      const dictionary = dictionaryOf(pdf, annots.get(index));
      if (!dictionary) continue;
      if (!known.has(textOf(dictionary, "NM"))) unknown += 1;
    }
  }
  return unknown;
}

/** Cross-page structures a page rebuild cannot reproduce. Their presence
 * makes reorder/delete/insert/merge/split refuse rather than silently drop
 * data. */
function structureMarkers(pdf: PDFDocument): string[] {
  const markers = new Set<string>();
  if (pdf.catalog.get(PDFName.of("Outlines"))) markers.add("outline");
  if (pdf.catalog.get(PDFName.of("StructTreeRoot"))) markers.add("structure_tree");
  if (pdf.catalog.get(PDFName.of("OpenAction")) || pdf.catalog.get(PDFName.of("AA"))) markers.add("javascript");
  if (pdf.catalog.get(PDFName.of("PageLabels"))) markers.add("page_labels");
  if (pdf.catalog.get(PDFName.of("OCProperties"))) markers.add("optional_content");
  if (pdf.catalog.get(PDFName.of("Perms"))) markers.add("permissions");
  const names = pdf.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  if (names) {
    markers.add("names");
    if (names.get(PDFName.of("EmbeddedFiles"))) markers.add("embedded_files");
  }
  // `inspectPdfFormFields` reads AcroForm directly and never calls the
  // pdf-lib `getForm()` helper, which would delete XFA data.
  const form = inspectPdfFormFields(pdf);
  if (form.xfa) markers.add("xfa");
  if (form.values.length > 0) markers.add("form_fields");
  if (form.signature_present) markers.add("signature_field");
  if (hasSignatureAnnotation(pdf)) markers.add("signature_annotation");
  return [...markers].sort();
}

function sameFormValues(left: readonly PdfEditModel["forms"][number][], right: readonly PdfEditModel["forms"][number][]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a.field_id !== b.field_id || a.kind !== b.kind || a.readonly !== b.readonly) return false;
    if (JSON.stringify(a.value) !== JSON.stringify(b.value)) return false;
  }
  return true;
}

/** Serialize edited PDF bytes. The source PDF is the base snapshot; page
 * copies from other authorized snapshots arrive in `sources`. The returned
 * inspection is measured on the written bytes, never assumed. */
export async function serializePdfEditDocument(
  sourceBytes: Uint8Array,
  payload: SerializePdfEditPayload,
  fontProvider: PdfEditFontProvider,
  images: ReadonlyMap<string, PdfEditImageSource>,
  sources: ReadonlyMap<string, Uint8Array> = new Map(),
): Promise<SerializePdfEditResult> {
  if (sourceBytes.byteLength === 0 || sourceBytes.byteLength > PDF_EDIT_MAX_SOURCE_BYTES) {
    throw new Error("pdf_edit.too_large");
  }
  let pdf = await loadPdfForEdit(sourceBytes);
  const baseId = payload.model.source_snapshot.snapshot_id;
  const preservingOrder = sameBaseOrder(payload.model, baseId, pdf.getPageCount());
  const owned = new Set(payload.owned_annotation_ids);
  const sourceMarkers = structureMarkers(pdf);
  const sourceUnknown = countUnknownAnnotations(pdf, owned);
  if (!preservingOrder) {
    if (sourceMarkers.length > 0) throw new Error("pdf_edit.unsupported");
    pdf = await rebuildPdfInPageOrder(payload.model.pages, sources);
  } else {
    payload.model.pages.forEach((page, index) => pdf.getPage(index).setRotation(degrees(page.rotation)));
  }
  const font = await fontProvider(pdf);
  if (payload.model.forms.length > 0) {
    await applyPdfFormValues(pdf, payload.model.forms, font);
  }
  await applyPdfAnnotations(pdf, payload.model, {
    ownedAnnotationIds: payload.owned_annotation_ids,
    font,
    images,
  });
  const bytes = await pdf.save({ useObjectStreams: false, updateFieldAppearances: false });
  if (bytes.byteLength === 0 || bytes.byteLength > PDF_EDIT_MAX_SOURCE_BYTES) throw new Error("pdf_edit.too_large");

  // Verify the actual output. A dropped annotation, form value or source
  // structure is a refusal, never a successful save with silent data loss.
  const output = await loadPdfForEdit(bytes);
  const known = new Set(payload.model.annotations.map((annotation) => annotation.id));
  for (const annotation of payload.model.annotations) {
    if (!findPdfAnnotation(output, annotation.id)) throw new Error("pdf_edit.unsupported");
  }
  const outputUnknown = countUnknownAnnotations(output, known);
  if (outputUnknown < sourceUnknown) throw new Error("pdf_edit.unsupported");
  const outputMarkers = new Set(structureMarkers(output));
  const dropped = sourceMarkers.filter((marker) => !outputMarkers.has(marker));
  if (dropped.length > 0) throw new Error("pdf_edit.unsupported");
  const outputForms = inspectPdfFormFields(output).values;
  if (!sameFormValues(payload.model.forms, outputForms)) throw new Error("pdf_edit.unsupported");
  return {
    bytes,
    inspection: {
      page_count: output.getPageCount(),
      annotation_count: payload.model.annotations.length,
      forms: outputForms,
      unknown_annotations_preserved: true,
      dropped_structures: [],
    },
  };
}
