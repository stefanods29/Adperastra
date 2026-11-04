import { pdfInversePoint } from "../handlers/pdf/pdfCoordinates";
import type { PdfPageImage, PdfRotation } from "../services/pdf";
import {
  PDF_EDIT_MAX_ANNOTATIONS,
  PDF_EDIT_MAX_FORMS,
  PDF_EDIT_MAX_HISTORY_BYTES,
  PDF_EDIT_MAX_HISTORY_ENTRIES,
  PDF_EDIT_MAX_PAGES,
  PDF_EDIT_MAX_POINTS_TOTAL,
  PDF_EDIT_MAX_REPLIES,
  PDF_EDIT_MAX_SIGNATURE_BYTES,
  PDF_EDIT_MAX_TEXT_CHARS,
  PDF_EDIT_MAX_WIRE_BYTES,
  PDF_EDIT_SCHEMA_VERSION,
  emptyPdfEditHistory,
  isFiniteNumber,
  isPdfEditSnapshot,
  isPdfEditUuid,
  isPdfRotation,
  isSafeInteger,
  newPdfEditId,
  normalizePdfRect,
  pdfAnnotationPointCount,
  pdfEditError,
  pdfRectUnion,
  simplifyPdfStroke,
  validatePdfAnnotationShape,
  validatePdfFormValue,
  validatePdfPageDescriptor,
  type PdfAnnotation,
  type PdfEditHistory,
  type PdfEditHistoryEntry,
  type PdfEditModel,
  type PdfEditOperation,
  type PdfPageDescriptor,
  type PdfPageState,
  type PdfPoint,
  type PdfRect,
} from "./types";

/** Pure model transitions for the PDF editor (Step 14a D1-D2, T1).
 *
 * Every operation validates its operands against the current immutable
 * model, returns the next model and the exact inverse operations. Nothing
 * here touches disk, the helper or a UI. */

export interface PdfEditApplyResult {
  model: PdfEditModel;
  inverse: PdfEditOperation[];
}

export interface CreatePdfEditModelInput {
  document_id: string;
  content_id: string;
  pages: PdfPageState[];
  annotations: PdfAnnotation[];
  forms: PdfEditModel["forms"];
  source_snapshot: PdfEditModel["source_snapshot"];
  history?: PdfEditHistory;
}

export function nextPdfContentId(): string {
  return newPdfEditId();
}

function pageById(model: Pick<PdfEditModel, "pages">, id: string): PdfPageState {
  const page = model.pages.find((entry) => entry.id === id);
  if (!page) throw pdfEditError("pdf_edit.bad_request");
  return page;
}

function pointInside(page: PdfPageState, point: PdfPoint): boolean {
  // Model geometry is local to the CropBox; the actual CropBox origin is
  // applied only when the helper writes PDF user-space dictionaries.
  return (
    isFiniteNumber(point.x) &&
    isFiniteNumber(point.y) &&
    point.x >= 0 &&
    point.y >= 0 &&
    point.x <= page.crop.width &&
    point.y <= page.crop.height
  );
}

/** Validate and normalize one annotation against its page and the model's
 * other annotations (reply parents). Geometry is clipped to the CropBox. */
export function normalizePdfAnnotationForPage(
  annotation: PdfAnnotation,
  page: PdfPageState,
  all: readonly PdfAnnotation[],
): PdfAnnotation {
  const shape = validatePdfAnnotationShape(annotation);
  if (!shape) throw pdfEditError("pdf_edit.bad_request");
  if (shape.page_id !== page.id) throw pdfEditError("pdf_edit.bad_request");

  const next: PdfAnnotation = { ...shape, rect: normalizePdfRect(shape.rect) };
  if (next.kind === "highlight") {
    if (!next.quads || next.quads.length === 0) throw pdfEditError("pdf_edit.bad_request");
    for (const quad of next.quads) {
      if (quad.length !== 4) throw pdfEditError("pdf_edit.bad_request");
      for (const point of quad) if (!pointInside(page, point)) throw pdfEditError("pdf_edit.bad_request");
    }
    next.rect = pdfRectUnion(next.quads.flat());
  } else if (next.kind === "ink") {
    if (!next.strokes || next.strokes.length === 0) throw pdfEditError("pdf_edit.bad_request");
    const simplified: PdfPoint[][] = [];
    for (const stroke of next.strokes) {
      const points = simplifyPdfStroke(stroke);
      if (points.length < 2) throw pdfEditError("pdf_edit.bad_request");
      for (const point of points) if (!pointInside(page, point)) throw pdfEditError("pdf_edit.bad_request");
      simplified.push(points);
    }
    next.strokes = simplified;
    next.rect = pdfRectUnion(simplified.flat());
  } else if (next.kind === "text") {
    next.font_size = next.font_size ?? 12;
  } else if (next.kind === "comment") {
    if (next.text.trim().length === 0) throw pdfEditError("pdf_edit.bad_request");
  } else if (next.kind === "signature") {
    if (!next.image && next.text.trim().length === 0 && (!next.strokes || next.strokes.length === 0)) {
      throw pdfEditError("pdf_edit.bad_request");
    }
    if (next.strokes) {
      const simplified: PdfPoint[][] = [];
      for (const stroke of next.strokes) {
        const points = simplifyPdfStroke(stroke);
        if (points.length < 2) throw pdfEditError("pdf_edit.bad_request");
        for (const point of points) if (!pointInside(page, point)) throw pdfEditError("pdf_edit.bad_request");
        simplified.push(points);
      }
      next.strokes = simplified;
    }
    if (next.image) {
      if (next.image.mime !== "image/png" && next.image.mime !== "image/jpeg") {
        throw pdfEditError("pdf_edit.bad_request");
      }
      if (next.image.byte_len <= 0 || next.image.byte_len > PDF_EDIT_MAX_SIGNATURE_BYTES) {
        throw pdfEditError("pdf_edit.too_large");
      }
    }
  }

  if (next.rect.width <= 0 || next.rect.height <= 0) throw pdfEditError("pdf_edit.bad_request");
  if (next.rect.x < 0 || next.rect.y < 0) throw pdfEditError("pdf_edit.bad_request");
  if (next.rect.x + next.rect.width > page.crop.width) throw pdfEditError("pdf_edit.bad_request");
  if (next.rect.y + next.rect.height > page.crop.height) throw pdfEditError("pdf_edit.bad_request");

  if (next.parent_id) {
    if (next.kind !== "comment") throw pdfEditError("pdf_edit.bad_request");
    const parent = all.find((entry) => entry.id === next.parent_id);
    if (!parent || parent.kind !== "comment" || parent.id === next.id) throw pdfEditError("pdf_edit.bad_request");
    if (parent.parent_id) throw pdfEditError("pdf_edit.bad_request");
    if (parent.page_id !== next.page_id) throw pdfEditError("pdf_edit.bad_request");
    const replies = all.filter((entry) => entry.parent_id === parent.id && entry.id !== next.id);
    if (replies.length >= PDF_EDIT_MAX_REPLIES) throw pdfEditError("pdf_edit.too_large");
  }
  if (pdfAnnotationPointCount(next) > PDF_EDIT_MAX_POINTS_TOTAL) throw pdfEditError("pdf_edit.too_large");
  return next;
}

function replacedPage(model: PdfEditModel, page: PdfPageState): PdfPageState[] {
  return model.pages.map((entry) => (entry.id === page.id ? page : entry));
}

function permutationOf(model: PdfEditModel, ids: readonly string[]): PdfPageState[] {
  if (!Array.isArray(ids) || ids.length !== model.pages.length) throw pdfEditError("pdf_edit.bad_request");
  const byId = new Map(model.pages.map((page) => [page.id, page]));
  if (new Set(ids).size !== ids.length) throw pdfEditError("pdf_edit.bad_request");
  const ordered: PdfPageState[] = [];
  for (const id of ids) {
    const page = byId.get(id);
    if (!page) throw pdfEditError("pdf_edit.bad_request");
    ordered.push(page);
  }
  return ordered;
}

function rotationAfter(rotation: PdfRotation, quarterTurns: number): PdfRotation {
  const steps = (((rotation / 90 + quarterTurns) % 4) + 4) % 4;
  return (steps * 90) as PdfRotation;
}

function uniqueExistingPageIds(model: PdfEditModel, ids: readonly string[]): PdfPageState[] {
  if (!Array.isArray(ids) || ids.length === 0) throw pdfEditError("pdf_edit.bad_request");
  if (new Set(ids).size !== ids.length) throw pdfEditError("pdf_edit.bad_request");
  return ids.map((id) => pageById(model, id));
}

/** Apply one operation. The returned model keeps the same content id unless
 * the caller supplies the next immutable content id. */
export function applyPdfEditOperation(
  model: PdfEditModel,
  operation: PdfEditOperation,
  contentId: string = model.content_id,
): PdfEditApplyResult {
  if (!isPdfEditUuid(contentId)) throw pdfEditError("pdf_edit.bad_request");
  switch (operation.kind) {
    case "add_annotation": {
      if (model.annotations.length >= PDF_EDIT_MAX_ANNOTATIONS) throw pdfEditError("pdf_edit.too_large");
      if (model.annotations.some((entry) => entry.id === operation.annotation.id)) {
        throw pdfEditError("pdf_edit.bad_request");
      }
      const page = pageById(model, operation.annotation.page_id);
      const annotation = normalizePdfAnnotationForPage(operation.annotation, page, model.annotations);
      const annotations = [...model.annotations, annotation];
      const nextPage: PdfPageState = { ...page, annotation_ids: [...page.annotation_ids, annotation.id] };
      return {
        model: {
          ...model,
          content_id: contentId,
          pages: replacedPage(model, nextPage),
          annotations,
        },
        inverse: [{ kind: "remove_annotation", id: annotation.id }],
      };
    }
    case "update_annotation": {
      const index = model.annotations.findIndex((entry) => entry.id === operation.id);
      if (index < 0) throw pdfEditError("pdf_edit.bad_request");
      const previous = model.annotations[index];
      const page = pageById(model, previous.page_id);
      if (operation.replacement.id !== operation.id) throw pdfEditError("pdf_edit.bad_request");
      if (operation.replacement.page_id !== previous.page_id) throw pdfEditError("pdf_edit.bad_request");
      const hasReplies = model.annotations.some((entry) => entry.parent_id === operation.id);
      if (hasReplies && (operation.replacement.kind !== "comment" || operation.replacement.parent_id)) {
        // A thread root cannot become a reply or another kind while replies
        // point at it: that would leave an invalid /IRT chain.
        throw pdfEditError("pdf_edit.bad_request");
      }
      const others = model.annotations.filter((entry) => entry.id !== operation.id);
      const replacement = normalizePdfAnnotationForPage(operation.replacement, page, others);
      const annotations = [...model.annotations];
      annotations[index] = replacement;
      return {
        model: { ...model, content_id: contentId, annotations },
        inverse: [{ kind: "update_annotation", id: operation.id, replacement: previous }],
      };
    }
    case "remove_annotation": {
      const annotation = model.annotations.find((entry) => entry.id === operation.id);
      if (!annotation) throw pdfEditError("pdf_edit.bad_request");
      if (model.annotations.some((entry) => entry.parent_id === annotation.id)) {
        throw pdfEditError("pdf_edit.bad_request");
      }
      const page = pageById(model, annotation.page_id);
      const annotations = model.annotations.filter((entry) => entry.id !== annotation.id);
      const nextPage: PdfPageState = { ...page, annotation_ids: page.annotation_ids.filter((id) => id !== annotation.id) };
      return {
        model: {
          ...model,
          content_id: contentId,
          pages: replacedPage(model, nextPage),
          annotations,
        },
        inverse: [{ kind: "add_annotation", annotation }],
      };
    }
    case "set_form": {
      const index = model.forms.findIndex((entry) => entry.field_id === operation.field_id);
      if (index < 0) throw pdfEditError("pdf_edit.bad_request");
      const previous = model.forms[index];
      if (previous.readonly) throw pdfEditError("pdf_edit.read_only");
      const candidate = validatePdfFormValue({ ...previous, value: operation.value });
      if (!candidate) throw pdfEditError("pdf_edit.bad_request");
      const forms = [...model.forms];
      forms[index] = candidate;
      return {
        model: { ...model, content_id: contentId, forms },
        inverse: [{ kind: "set_form", field_id: previous.field_id, value: previous.value }],
      };
    }
    case "reorder_pages": {
      const previousOrder = model.pages.map((entry) => entry.id);
      return {
        model: { ...model, content_id: contentId, pages: permutationOf(model, operation.ids) },
        inverse: [{ kind: "reorder_pages", ids: previousOrder }],
      };
    }
    case "rotate_pages": {
      if (!isSafeInteger(operation.quarter_turns, -16, 16) || operation.quarter_turns === 0) {
        throw pdfEditError("pdf_edit.bad_request");
      }
      const pages = uniqueExistingPageIds(model, operation.ids);
      const next = new Map(pages.map((page) => [page.id, { ...page, rotation: rotationAfter(page.rotation, operation.quarter_turns) }]));
      return {
        model: { ...model, content_id: contentId, pages: model.pages.map((page) => next.get(page.id) ?? page) },
        inverse: [{ kind: "rotate_pages", ids: [...operation.ids], quarter_turns: -operation.quarter_turns }],
      };
    }
    case "delete_pages": {
      const deleted = uniqueExistingPageIds(model, operation.ids);
      if (model.pages.length - deleted.length < 1) throw pdfEditError("pdf_edit.bad_request");
      const deletedIds = new Set(deleted.map((page) => page.id));
      const removedAnnotations = model.annotations.filter((entry) => deletedIds.has(entry.page_id));
      const removedIds = new Set(removedAnnotations.map((entry) => entry.id));
      // A reply on a kept page would lose the /IRT parent that lives on a
      // deleted page. Refuse instead of writing a broken thread.
      if (model.annotations.some((entry) => !removedIds.has(entry.id) && entry.parent_id && removedIds.has(entry.parent_id))) {
        throw pdfEditError("pdf_edit.bad_request");
      }
      const pages = model.pages.filter((page) => !deletedIds.has(page.id));
      const annotations = model.annotations.filter((entry) => !deletedIds.has(entry.page_id));
      const inverse: PdfEditOperation[] = [];
      const working = [...pages];
      for (const page of [...deleted].sort((a, b) => model.pages.indexOf(a) - model.pages.indexOf(b))) {
        const originalIndex = model.pages.indexOf(page);
        const insertionIndex = Math.min(originalIndex, working.length);
        const after = insertionIndex > 0 ? working[insertionIndex - 1].id : null;
        working.splice(insertionIndex, 0, page);
        inverse.push({
          kind: "insert_pages",
          after_id: after,
          pages: [
            {
              id: page.id,
              origin_source: page.origin_source,
              origin_page: page.origin_page,
              rotation: page.rotation,
              crop: page.crop,
            },
          ],
        });
      }
      for (const annotation of [...removedAnnotations.filter((entry) => !entry.parent_id), ...removedAnnotations.filter((entry) => entry.parent_id)]) {
        inverse.push({ kind: "add_annotation", annotation });
      }
      return {
        model: { ...model, content_id: contentId, pages, annotations },
        inverse,
      };
    }
    case "insert_pages": {
      if (!Array.isArray(operation.pages) || operation.pages.length === 0) throw pdfEditError("pdf_edit.bad_request");
      if (model.pages.length + operation.pages.length > PDF_EDIT_MAX_PAGES) throw pdfEditError("pdf_edit.too_large");
      let index = 0;
      if (operation.after_id !== null) {
        const afterIndex = model.pages.findIndex((entry) => entry.id === operation.after_id);
        if (afterIndex < 0) throw pdfEditError("pdf_edit.bad_request");
        index = afterIndex + 1;
      }
      const inserted: PdfPageState[] = [];
      for (const raw of operation.pages) {
        const descriptor = validatePdfPageDescriptor(raw);
        if (!descriptor) throw pdfEditError("pdf_edit.bad_request");
        if (descriptor.crop.width <= 0 || descriptor.crop.height <= 0) throw pdfEditError("pdf_edit.bad_request");
        const id = descriptor.id ?? newPdfEditId();
        if (model.pages.some((page) => page.id === id) || inserted.some((page) => page.id === id)) {
          throw pdfEditError("pdf_edit.bad_request");
        }
        inserted.push({
          id,
          origin_source: descriptor.origin_source,
          origin_page: descriptor.origin_page,
          rotation: descriptor.rotation,
          crop: descriptor.crop,
          annotation_ids: [],
        });
      }
      const pages = [...model.pages.slice(0, index), ...inserted, ...model.pages.slice(index)];
      return {
        model: { ...model, content_id: contentId, pages },
        inverse: [{ kind: "delete_pages", ids: inserted.map((page) => page.id) }],
      };
    }
    default:
      throw pdfEditError("pdf_edit.bad_request");
  }
}

/** Apply operations without history, for Undo/Redo replay. */
export function runPdfEditOperations(model: PdfEditModel, operations: readonly PdfEditOperation[]): PdfEditModel {
  let current = model;
  for (const operation of operations) current = applyPdfEditOperation(current, operation).model;
  return current;
}

export function estimatePdfEditBytes(value: unknown): number {
  return 64 + JSON.stringify(value).length * 2;
}

/** Push one transaction and keep the exact inverse history bounded. */
export function pushPdfEditHistory(model: PdfEditModel, entry: PdfEditHistoryEntry): PdfEditModel {
  if (!isPdfEditUuid(entry.after_content_id) || !isPdfEditUuid(entry.before_content_id)) {
    throw pdfEditError("pdf_edit.bad_request");
  }
  const bytes = 128 + estimatePdfEditBytes(entry.applied) + entry.inverse.reduce((sum, operation) => sum + estimatePdfEditBytes(operation), 0);
  if (bytes > PDF_EDIT_MAX_HISTORY_BYTES) throw pdfEditError("pdf_edit.too_large");
  const kept = model.history.entries.slice(0, model.history.cursor);
  const entries = [...kept, { ...entry, bytes }];
  let cursor = entries.length;
  let total = entries.reduce((sum, item) => sum + item.bytes, 0);
  while (entries.length > PDF_EDIT_MAX_HISTORY_ENTRIES || total > PDF_EDIT_MAX_HISTORY_BYTES) {
    const removed = entries.shift();
    total -= removed?.bytes ?? 0;
    cursor = Math.max(0, cursor - 1);
  }
  return { ...model, history: { entries, cursor, bytes: total } };
}

/** Read a pointer in rendered pixels back to the model's CropBox-local
 * top-left page coordinates. Uses the render's resolved scale and rendered
 * rotation, never the requested zoom (D2). */
export function renderPixelToPdfPoint(
  rendered: Pick<PdfPageImage, "info" | "resolved_scale" | "rendered_rotation">,
  _page: Pick<PdfPageState, "crop">,
  px: number,
  py: number,
): PdfPoint {
  if (!isFiniteNumber(rendered.resolved_scale) || rendered.resolved_scale <= 0) {
    throw pdfEditError("pdf_edit.bad_request");
  }
  if (!isFiniteNumber(px) || !isFiniteNumber(py)) throw pdfEditError("pdf_edit.bad_request");
  return pdfInversePoint(
    px / rendered.resolved_scale,
    py / rendered.resolved_scale,
    rendered.info,
    100,
    rendered.rendered_rotation,
  );
}

/** Validate a loaded or deserialized model. Throws a stable PdfEdit code. */
export function assertPdfEditModel(model: PdfEditModel): void {
  if (model.schema_version !== PDF_EDIT_SCHEMA_VERSION) throw pdfEditError("pdf_edit.unsupported");
  if (!isPdfEditUuid(model.document_id) || !isPdfEditUuid(model.content_id)) throw pdfEditError("pdf_edit.bad_request");
  if (!isPdfEditSnapshot(model.source_snapshot)) throw pdfEditError("pdf_edit.bad_request");
  if (model.source_snapshot.document_id !== model.document_id) throw pdfEditError("pdf_edit.bad_request");
  if (!Array.isArray(model.pages) || model.pages.length < 1 || model.pages.length > PDF_EDIT_MAX_PAGES) {
    throw pdfEditError("pdf_edit.bad_request");
  }
  const pageIds = new Set<string>();
  for (const page of model.pages) {
    if (!isPdfEditUuid(page.id) || pageIds.has(page.id)) throw pdfEditError("pdf_edit.bad_request");
    pageIds.add(page.id);
    if (!isPdfEditSnapshot(page.origin_source)) throw pdfEditError("pdf_edit.bad_request");
    // A sensitive document may only be composed from memory-only snapshots;
    // an ordinary page origin would materialize plaintext on disk (D1).
    if (
      model.source_snapshot.storage_policy === "sensitive" &&
      page.origin_source.storage_policy !== "sensitive"
    ) {
      throw pdfEditError("pdf_edit.bad_request");
    }
    if (!isSafeInteger(page.origin_page, 1, PDF_EDIT_MAX_PAGES) || !isPdfRotation(page.rotation)) {
      throw pdfEditError("pdf_edit.bad_request");
    }
    if (![page.crop.x, page.crop.y, page.crop.width, page.crop.height].every(isFiniteNumber)) {
      throw pdfEditError("pdf_edit.bad_request");
    }
    const crop = normalizePdfRect(page.crop);
    if (crop.width <= 0 || crop.height <= 0) throw pdfEditError("pdf_edit.bad_request");
  }
  if (!Array.isArray(model.annotations) || model.annotations.length > PDF_EDIT_MAX_ANNOTATIONS) {
    throw pdfEditError("pdf_edit.bad_request");
  }
  const annotationIds = new Set<string>();
  const pageLookup = new Map(model.pages.map((page) => [page.id, page]));
  let points = 0;
  for (const annotation of model.annotations) {
    if (!isPdfEditUuid(annotation.id) || annotationIds.has(annotation.id)) throw pdfEditError("pdf_edit.bad_request");
    annotationIds.add(annotation.id);
    const page = pageLookup.get(annotation.page_id);
    if (!page) throw pdfEditError("pdf_edit.bad_request");
    const normalized = normalizePdfAnnotationForPage(annotation, page, model.annotations);
    if (
      normalized.image &&
      model.source_snapshot.storage_policy === "sensitive" &&
      normalized.image.storage_policy !== "sensitive"
    ) {
      throw pdfEditError("pdf_edit.bad_request");
    }
    points += pdfAnnotationPointCount(normalized);
  }
  if (points > PDF_EDIT_MAX_POINTS_TOTAL) throw pdfEditError("pdf_edit.too_large");
  // One pass over the annotations; comparing every page against every
  // annotation would be quadratic at the 10,000-page/100,000-mark caps.
  const idsByPage = new Map<string, string[]>();
  for (const annotation of model.annotations) {
    const list = idsByPage.get(annotation.page_id);
    if (list) list.push(annotation.id);
    else idsByPage.set(annotation.page_id, [annotation.id]);
  }
  for (const page of model.pages) {
    if (page.annotation_ids.length > PDF_EDIT_MAX_ANNOTATIONS) throw pdfEditError("pdf_edit.too_large");
    const expected = idsByPage.get(page.id) ?? [];
    if (page.annotation_ids.length !== expected.length || page.annotation_ids.some((id, index) => id !== expected[index])) {
      throw pdfEditError("pdf_edit.bad_request");
    }
  }
  if (!Array.isArray(model.forms) || model.forms.length > PDF_EDIT_MAX_FORMS) throw pdfEditError("pdf_edit.bad_request");
  const fields = new Set<string>();
  for (const form of model.forms) {
    const validated = validatePdfFormValue(form);
    if (!validated || fields.has(form.field_id)) throw pdfEditError("pdf_edit.bad_request");
    fields.add(form.field_id);
  }
  const history = model.history;
  if (!history || !Array.isArray(history.entries) || history.entries.length > PDF_EDIT_MAX_HISTORY_ENTRIES) {
    throw pdfEditError("pdf_edit.bad_request");
  }
  if (!isSafeInteger(history.cursor, 0, history.entries.length)) throw pdfEditError("pdf_edit.bad_request");
  if (!isFiniteNumber(history.bytes) || history.bytes < 0 || history.bytes > PDF_EDIT_MAX_HISTORY_BYTES) {
    throw pdfEditError("pdf_edit.bad_request");
  }
  for (const entry of history.entries) {
    if (!isPdfEditUuid(entry.before_content_id) || !isPdfEditUuid(entry.after_content_id)) {
      throw pdfEditError("pdf_edit.bad_request");
    }
    if (!Array.isArray(entry.inverse)) throw pdfEditError("pdf_edit.bad_request");
  }
}

/** Create and freeze the first model of a document. Page annotation lists are
 * derived from the authoritative annotations, so a loader only has to assign
 * ids and does not have to duplicate their order. */
export function createPdfEditModel(input: CreatePdfEditModelInput): PdfEditModel {
  const idsByPage = new Map<string, string[]>();
  for (const annotation of input.annotations) {
    const list = idsByPage.get(annotation.page_id);
    if (list) list.push(annotation.id);
    else idsByPage.set(annotation.page_id, [annotation.id]);
  }
  const model: PdfEditModel = {
    schema_version: PDF_EDIT_SCHEMA_VERSION,
    document_id: input.document_id,
    content_id: input.content_id,
    pages: input.pages.map((page) => ({ ...page, annotation_ids: [...(idsByPage.get(page.id) ?? [])] })),
    annotations: input.annotations,
    forms: input.forms,
    source_snapshot: input.source_snapshot,
    history: input.history ?? emptyPdfEditHistory(),
  };
  assertPdfEditModel(model);
  return deepFreezePdfEdit(model);
}

/** Validate the bounded wire model a helper receives. Geometry is normalized
 * against its page and page annotation lists are rebuilt from the actual
 * annotations, so a malformed descriptor can never reach the writer. */
export function validatePdfEditWireModel(value: unknown): PdfEditModel | null {
  if (value === null || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.schema_version !== PDF_EDIT_SCHEMA_VERSION) return null;
  if (typeof raw.document_id !== "string" || typeof raw.content_id !== "string") return null;
  if (!isPdfEditSnapshot(raw.source_snapshot)) return null;
  if (!Array.isArray(raw.pages) || !Array.isArray(raw.annotations) || !Array.isArray(raw.forms)) return null;
  try {
    const pages: PdfPageState[] = [];
    for (const entry of raw.pages) {
      const page = validatePdfPageDescriptor(entry);
      if (!page || !page.id) return null;
      pages.push({ ...page, id: page.id, annotation_ids: [] });
    }
    const shapes: PdfAnnotation[] = [];
    for (const entry of raw.annotations) {
      const annotation = validatePdfAnnotationShape(entry);
      if (!annotation) return null;
      shapes.push(annotation);
    }
    const annotations: PdfAnnotation[] = [];
    for (const annotation of shapes) {
      const page = pages.find((candidate) => candidate.id === annotation.page_id);
      if (!page) return null;
      annotations.push(normalizePdfAnnotationForPage(annotation, page, shapes));
    }
    for (const page of pages) {
      page.annotation_ids = annotations.filter((entry) => entry.page_id === page.id).map((entry) => entry.id);
    }
    const forms: PdfEditModel["forms"] = [];
    for (const entry of raw.forms) {
      const form = validatePdfFormValue(entry);
      if (!form) return null;
      forms.push(form);
    }
    return createPdfEditModel({
      document_id: raw.document_id,
      content_id: raw.content_id,
      pages,
      annotations,
      forms,
      source_snapshot: raw.source_snapshot,
      history: emptyPdfEditHistory(),
    });
  } catch {
    return null;
  }
}

/** Recursively freeze a model so no view can mutate shared document data. */
export function deepFreezePdfEdit<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return value;
  seen.add(value as object);
  for (const entry of Object.values(value as Record<string, unknown>)) deepFreezePdfEdit(entry, seen);
  return Object.freeze(value);
}

/** The bounded wire model: history stays in memory and is not sent to the
 * helper. Rejects models whose descriptor would exceed the transport cap. */
export function pdfEditWireModel(model: Readonly<PdfEditModel>): Omit<PdfEditModel, "history"> {
  const { history: _history, ...wire } = model;
  if (estimatePdfEditBytes(wire) > PDF_EDIT_MAX_WIRE_BYTES) throw pdfEditError("pdf_edit.too_large");
  return wire;
}

export function pdfEditTextLength(text: string): number {
  return Math.min(text.length, PDF_EDIT_MAX_TEXT_CHARS);
}

export function pdfEditPageDescriptor(page: PdfPageState): PdfPageDescriptor {
  return {
    origin_source: page.origin_source,
    origin_page: page.origin_page,
    rotation: page.rotation,
    crop: { ...page.crop },
  };
}

export function pdfEditPageBounds(page: Pick<PdfPageState, "crop">): PdfRect {
  return { ...page.crop };
}
