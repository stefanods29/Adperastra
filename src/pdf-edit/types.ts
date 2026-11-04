import type { ExportSnapshot } from "../services/exportSnapshots";

/** PDF editing model (Step 14a, `pdf-edit-1`).
 *
 * One immutable model per document. The model is document data, never a UI
 * model: scroll, zoom, selection and tool state stay in the view. All
 * geometry is in unrotated page points local to the CropBox, with the origin
 * at its top-left corner, matching the coordinate system of the 07d viewer.
 * `PdfPageState.crop` keeps the actual CropBox in PDF user space; the helper
 * adds that origin and flips to the PDF bottom-left origin only when it
 * writes dictionaries.
 *
 * Everything here is serializable plain data so the helper mirror
 * (`src/pdf-write-helper/editTypes.ts`) can import the same definitions.
 */

export const PDF_EDIT_SCHEMA_VERSION = 1;
export const PDF_EDIT_MAX_PAGES = 10_000;
export const PDF_EDIT_MAX_ANNOTATIONS = 100_000;
export const PDF_EDIT_MAX_FORMS = 10_000;
export const PDF_EDIT_MAX_AUTHOR_CHARS = 128;
export const PDF_EDIT_MAX_TEXT_CHARS = 8_192;
export const PDF_EDIT_MAX_FIELD_ID_CHARS = 512;
export const PDF_EDIT_MAX_FORM_TEXT_CHARS = 32_767;
export const PDF_EDIT_MAX_POINTS_PER_STROKE = 100_000;
export const PDF_EDIT_MAX_POINTS_TOTAL = 2_000_000;
export const PDF_EDIT_MIN_POINT_DISTANCE = 0.25;
export const PDF_EDIT_MIN_STROKE_WIDTH_PT = 0.25;
export const PDF_EDIT_MAX_STROKE_WIDTH_PT = 24;
export const PDF_EDIT_INK_WIDTH_PT = 2;
export const PDF_EDIT_MIN_FONT_SIZE_PT = 6;
export const PDF_EDIT_MAX_FONT_SIZE_PT = 144;
export const PDF_EDIT_MAX_HISTORY_ENTRIES = 1_000;
export const PDF_EDIT_MAX_HISTORY_BYTES = 128 * 1024 * 1024;
export const PDF_EDIT_MAX_SOURCE_BYTES = 256 * 1024 * 1024;
export const PDF_EDIT_MAX_SIGNATURE_BYTES = 8 * 1024 * 1024;
export const PDF_EDIT_MAX_SIGNATURE_PIXELS = 10_000_000;
export const PDF_EDIT_MAX_REPLIES = 1_000;
/** Largest bounded model descriptor the helper may receive (no file bytes). */
export const PDF_EDIT_MAX_WIRE_BYTES = 64 * 1024 * 1024;

export type PdfRotation = 0 | 90 | 180 | 270;
export type PdfAnnotationKind = "highlight" | "ink" | "text" | "comment" | "signature";
export type PdfFormKind = "text" | "check" | "radio" | "choice";
export type PdfFormValueValue = string | boolean | string[];
export type PdfEditSaveMode = "save" | "copy";

export interface PdfPoint {
  x: number;
  y: number;
}

export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Four channels in the 0..1 range: red, green, blue, alpha. */
export type PdfColor = [number, number, number, number];

export interface PdfAnnotation {
  id: string;
  page_id: string;
  kind: PdfAnnotationKind;
  rect: PdfRect;
  color: PdfColor;
  opacity: number;
  author: string;
  created_unix: number;
  text: string;
  /** Highlights only: one quadrilateral per text line, four points each,
   * clockwise from the upper-left in model coordinates. */
  quads?: PdfPoint[][];
  /** Ink and drawn signatures: one polyline per stroke. */
  strokes?: PdfPoint[][];
  /** Replies only: the comment annotation this answers. */
  parent_id?: string;
  /** Visual signatures only: bounded raster image snapshot. */
  image?: ExportSnapshot;
  /** Text boxes only. */
  font_size?: number;
}

export interface PdfPageState {
  id: string;
  origin_source: ExportSnapshot;
  /** 1-based page in the origin snapshot. */
  origin_page: number;
  rotation: PdfRotation;
  crop: PdfRect;
  annotation_ids: string[];
}

export interface PdfFormValue {
  field_id: string;
  kind: PdfFormKind;
  value: PdfFormValueValue;
  readonly: boolean;
}

export interface PdfPageDescriptor {
  /** Present only when restoring a page during Undo; a new page gets a fresh
   * UUID from the model. */
  id?: string;
  origin_source: ExportSnapshot;
  origin_page: number;
  rotation: PdfRotation;
  crop: PdfRect;
}

export interface PdfEditHistoryEntry {
  applied: PdfEditOperation;
  inverse: PdfEditOperation[];
  before_content_id: string;
  after_content_id: string;
  bytes: number;
}

export interface PdfEditHistory {
  entries: PdfEditHistoryEntry[];
  /** Number of entries that can be undone; entries after it can be redone. */
  cursor: number;
  bytes: number;
}

export interface PdfEditModel {
  schema_version: 1;
  document_id: string;
  content_id: string;
  pages: PdfPageState[];
  annotations: PdfAnnotation[];
  forms: PdfFormValue[];
  source_snapshot: ExportSnapshot;
  history: PdfEditHistory;
}

export type PdfEditOperation =
  | { kind: "add_annotation"; annotation: PdfAnnotation }
  | { kind: "update_annotation"; id: string; replacement: PdfAnnotation }
  | { kind: "remove_annotation"; id: string }
  | { kind: "set_form"; field_id: string; value: PdfFormValueValue }
  | { kind: "reorder_pages"; ids: string[] }
  | { kind: "rotate_pages"; ids: string[]; quarter_turns: number }
  | { kind: "delete_pages"; ids: string[] }
  | { kind: "insert_pages"; after_id: string | null; pages: PdfPageDescriptor[] };

/** Form choices are inspection data, not document-owned values. */
export interface PdfFormOption {
  field_id: string;
  options: string[];
}

/** What the helper found in the source PDF. The parent assigns page and
 * annotation UUIDs before creating the model. */
export interface PdfEditCapabilities {
  signature_present: boolean;
  xfa_present: boolean;
  rich_text_fields: string[];
  unsupported_structures: string[];
  /** True only when a sensitive source was proved memory-only by the host. */
  sensitive_memory_only: boolean;
}

export interface PdfEditInspection {
  pages: PdfPageState[];
  annotations: PdfAnnotation[];
  forms: PdfFormValue[];
  form_options: PdfFormOption[];
  owned_annotation_ids: string[];
  unknown_annotations: number;
  capabilities: PdfEditCapabilities;
}

/** The verified facts of a serialized copy (T6). */
export interface PdfEditSerializeInspection {
  page_count: number;
  annotation_count: number;
  forms: PdfFormValue[];
  unknown_annotations_preserved: boolean;
  /** Source structures the writer could not preserve; must be empty. */
  dropped_structures: string[];
}

export type PdfEditErrorCode =
  | "pdf_edit.bad_request"
  | "pdf_edit.read_only"
  | "pdf_edit.unsupported"
  | "pdf_edit.too_large"
  | "pdf_edit.changed"
  | "pdf_edit.missing_glyph"
  | "pdf_edit.signature_change"
  | "pdf_edit.failed";

export class PdfEditError extends Error {
  readonly code: PdfEditErrorCode;

  constructor(code: PdfEditErrorCode) {
    super(code);
    this.name = "PdfEditError";
    this.code = code;
  }
}

export function pdfEditError(code: PdfEditErrorCode): PdfEditError {
  return new PdfEditError(code);
}

/** Use the code of a known PdfEdit error, `pdf_edit.failed` otherwise. */
export function pdfEditErrorCode(error: unknown): PdfEditErrorCode {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith("pdf_edit.") ? (message as PdfEditErrorCode) : "pdf_edit.failed";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isPdfEditUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** A fresh canonical UUID; the fallback keeps tests deterministic enough. */
export function newPdfEditId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = (Math.random() * 16) | 0;
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isSafeInteger(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

export function isPdfRotation(value: unknown): value is PdfRotation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

export function isPdfAnnotationKind(value: unknown): value is PdfAnnotationKind {
  return value === "highlight" || value === "ink" || value === "text" || value === "comment" || value === "signature";
}

export function isPdfFormKind(value: unknown): value is PdfFormKind {
  return value === "text" || value === "check" || value === "radio" || value === "choice";
}

/** A rectangle with non-negative sides in any corner order. */
export function normalizePdfRect(rect: PdfRect): PdfRect {
  const x1 = Math.min(rect.x, rect.x + rect.width);
  const y1 = Math.min(rect.y, rect.y + rect.height);
  const x2 = Math.max(rect.x, rect.x + rect.width);
  const y2 = Math.max(rect.y, rect.y + rect.height);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** Read an untrusted rectangle, or null when a side is not finite. */
export function readPdfRect(value: unknown): PdfRect | null {
  if (value === null || typeof value !== "object") return null;
  const rect = value as Record<string, unknown>;
  if (![rect.x, rect.y, rect.width, rect.height].every(isFiniteNumber)) return null;
  return { x: rect.x as number, y: rect.y as number, width: rect.width as number, height: rect.height as number };
}

export function isPdfRectWithin(rect: PdfRect, bounds: PdfRect): boolean {
  const value = normalizePdfRect(rect);
  return (
    value.x >= bounds.x &&
    value.y >= bounds.y &&
    value.x + value.width <= bounds.x + bounds.width &&
    value.y + value.height <= bounds.y + bounds.height
  );
}

export function clipPdfRect(rect: PdfRect, bounds: PdfRect): PdfRect {
  const value = normalizePdfRect(rect);
  const x1 = Math.max(bounds.x, value.x);
  const y1 = Math.max(bounds.y, value.y);
  const x2 = Math.min(bounds.x + bounds.width, value.x + value.width);
  const y2 = Math.min(bounds.y + bounds.height, value.y + value.height);
  return { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
}

export function pdfRectUnion(points: readonly PdfPoint[]): PdfRect {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = minX;
  let maxY = minY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** True for a usable 08a snapshot reference; never trusts paths or bytes. */
export function isPdfEditSnapshot(value: unknown): value is ExportSnapshot {
  if (value === null || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  if (!isPdfEditUuid(snapshot.snapshot_id)) return false;
  if (!isPdfEditUuid(snapshot.content_id)) return false;
  if (typeof snapshot.document_id !== "string" || snapshot.document_id.length < 1 || snapshot.document_id.length > 128) {
    return false;
  }
  if (!isSafeInteger(snapshot.revision, 1)) return false;
  if (!isSafeInteger(snapshot.byte_len, 0, PDF_EDIT_MAX_SOURCE_BYTES)) return false;
  if (typeof snapshot.mime !== "string" || snapshot.mime.length < 1 || snapshot.mime.length > 128) return false;
  if (snapshot.storage_policy !== "ordinary" && snapshot.storage_policy !== "sensitive") return false;
  if (!isSafeInteger(snapshot.expires_unix, 0)) return false;
  return true;
}

export function validatePdfPageDescriptor(value: unknown): PdfPageDescriptor | null {
  if (value === null || typeof value !== "object") return null;
  const page = value as Record<string, unknown>;
  if (!isPdfEditSnapshot(page.origin_source)) return null;
  if (!isSafeInteger(page.origin_page, 1, PDF_EDIT_MAX_PAGES)) return null;
  if (!isPdfRotation(page.rotation)) return null;
  const crop = readPdfRect(page.crop);
  if (!crop) return null;
  if (page.id !== undefined && !isPdfEditUuid(page.id)) return null;
  return {
    ...(page.id !== undefined ? { id: page.id } : {}),
    origin_source: page.origin_source,
    origin_page: page.origin_page,
    rotation: page.rotation,
    crop: normalizePdfRect(crop),
  };
}

export function validatePdfFormValue(value: unknown): PdfFormValue | null {
  if (value === null || typeof value !== "object") return null;
  const field = value as Record<string, unknown>;
  if (typeof field.field_id !== "string" || field.field_id.length < 1 || field.field_id.length > PDF_EDIT_MAX_FIELD_ID_CHARS) {
    return null;
  }
  if (!isPdfFormKind(field.kind) || typeof field.readonly !== "boolean") return null;
  const formValue = field.value;
  if (field.kind === "text" || field.kind === "radio") {
    if (typeof formValue !== "string" || formValue.length > PDF_EDIT_MAX_FORM_TEXT_CHARS) return null;
  } else if (field.kind === "check") {
    if (typeof formValue !== "boolean") return null;
  } else if (field.kind === "choice") {
    if (!Array.isArray(formValue)) return null;
    if (formValue.length > 1_000) return null;
    if (!formValue.every((entry) => typeof entry === "string" && entry.length <= PDF_EDIT_MAX_FORM_TEXT_CHARS)) return null;
  }
  return {
    field_id: field.field_id,
    kind: field.kind,
    value: formValue as PdfFormValueValue,
    readonly: field.readonly,
  };
}

export function validatePdfFormOption(value: unknown): PdfFormOption | null {
  if (value === null || typeof value !== "object") return null;
  const option = value as Record<string, unknown>;
  if (typeof option.field_id !== "string" || option.field_id.length > PDF_EDIT_MAX_FIELD_ID_CHARS) return null;
  if (!Array.isArray(option.options) || option.options.length > 1_000) return null;
  if (!option.options.every((entry) => typeof entry === "string" && entry.length <= PDF_EDIT_MAX_FORM_TEXT_CHARS)) return null;
  return { field_id: option.field_id, options: [...option.options] as string[] };
}

export function validatePdfEditCapabilities(value: unknown): PdfEditCapabilities {
  const fallback: PdfEditCapabilities = {
    signature_present: false,
    xfa_present: false,
    rich_text_fields: [],
    unsupported_structures: [],
    sensitive_memory_only: false,
  };
  if (value === null || typeof value !== "object") return fallback;
  const raw = value as Record<string, unknown>;
  const strings = (input: unknown, max: number): string[] =>
    Array.isArray(input)
      ? input.filter((entry): entry is string => typeof entry === "string" && entry.length <= 128).slice(0, max)
      : [];
  return {
    signature_present: raw.signature_present === true,
    xfa_present: raw.xfa_present === true,
    rich_text_fields: strings(raw.rich_text_fields, 10_000),
    unsupported_structures: strings(raw.unsupported_structures, 64),
    sensitive_memory_only: raw.sensitive_memory_only === true,
  };
}

/** The helper's inspection reply is bounded before the parent creates a model. */
export function validatePdfEditInspection(value: unknown): PdfEditInspection | null {
  if (value === null || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.pages) || raw.pages.length < 1 || raw.pages.length > PDF_EDIT_MAX_PAGES) return null;
  if (!Array.isArray(raw.annotations) || raw.annotations.length > PDF_EDIT_MAX_ANNOTATIONS) return null;
  if (!Array.isArray(raw.forms) || raw.forms.length > PDF_EDIT_MAX_FORMS) return null;
  const pages: PdfPageState[] = [];
  for (const entry of raw.pages) {
    if (entry === null || typeof entry !== "object") return null;
    const page = entry as Record<string, unknown>;
    if (!isPdfEditUuid(page.id)) return null;
    if (!isPdfEditSnapshot(page.origin_source)) return null;
    if (!isSafeInteger(page.origin_page, 1, PDF_EDIT_MAX_PAGES)) return null;
    if (!isPdfRotation(page.rotation)) return null;
    if (!Array.isArray(page.annotation_ids)) return null;
    if (!page.annotation_ids.every((id) => typeof id === "string" && isPdfEditUuid(id))) return null;
    if (page.annotation_ids.length > PDF_EDIT_MAX_ANNOTATIONS) return null;
    const crop = readPdfRect(page.crop);
    if (!crop) return null;
    pages.push({
      id: page.id,
      origin_source: page.origin_source,
      origin_page: page.origin_page,
      rotation: page.rotation,
      crop: normalizePdfRect(crop),
      annotation_ids: [...page.annotation_ids] as string[],
    });
  }
  const annotations: PdfAnnotation[] = [];
  for (const entry of raw.annotations) {
    const annotation = validatePdfAnnotationShape(entry);
    if (!annotation) return null;
    annotations.push(annotation);
  }
  const forms: PdfFormValue[] = [];
  for (const entry of raw.forms) {
    const form = validatePdfFormValue(entry);
    if (!form) return null;
    forms.push(form);
  }
  const formOptions: PdfFormOption[] = [];
  if (Array.isArray(raw.form_options)) {
    for (const entry of raw.form_options) {
      const option = validatePdfFormOption(entry);
      if (!option) return null;
      formOptions.push(option);
    }
  }
  // Owned ids are the /NM values the writer may replace. They must be the
  // model's canonical UUIDs: a free-form /NM could otherwise name an
  // annotation this model does not own and delete it on save (R-SAFE).
  if (raw.owned_annotation_ids !== undefined && !Array.isArray(raw.owned_annotation_ids)) return null;
  const ownedInput = Array.isArray(raw.owned_annotation_ids) ? raw.owned_annotation_ids : [];
  if (ownedInput.length > PDF_EDIT_MAX_ANNOTATIONS) return null;
  const owned = [...new Set(ownedInput)];
  if (!owned.every((id) => isPdfEditUuid(id))) return null;
  return {
    pages,
    annotations,
    forms,
    form_options: formOptions,
    owned_annotation_ids: owned,
    unknown_annotations: isSafeInteger(raw.unknown_annotations, 0, PDF_EDIT_MAX_ANNOTATIONS) ? raw.unknown_annotations : 0,
    capabilities: validatePdfEditCapabilities(raw.capabilities),
  };
}

/** Shape validation shared by inspection and operation arguments. Bounds
 * against the page crop happen in `model.ts`, which knows the page. */
export function validatePdfAnnotationShape(value: unknown): PdfAnnotation | null {
  if (value === null || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!isPdfEditUuid(raw.id) || !isPdfEditUuid(raw.page_id)) return null;
  if (!isPdfAnnotationKind(raw.kind)) return null;
  const rect = readPdfRect(raw.rect);
  if (rect === null) return null;
  if (!Array.isArray(raw.color) || raw.color.length !== 4 || !raw.color.every((entry) => isFiniteNumber(entry) && entry >= 0 && entry <= 1)) {
    return null;
  }
  if (!isFiniteNumber(raw.opacity) || raw.opacity < 0 || raw.opacity > 1) return null;
  if (typeof raw.author !== "string" || raw.author.length > PDF_EDIT_MAX_AUTHOR_CHARS) return null;
  if (!isSafeInteger(raw.created_unix, 0)) return null;
  if (typeof raw.text !== "string" || raw.text.length > PDF_EDIT_MAX_TEXT_CHARS) return null;
  const points = (input: unknown): PdfPoint[][] | null | undefined => {
    if (input === undefined) return undefined;
    if (!Array.isArray(input)) return null;
    const groups: PdfPoint[][] = [];
    for (const group of input) {
      if (!Array.isArray(group) || group.length === 0 || group.length > PDF_EDIT_MAX_POINTS_PER_STROKE) return null;
      const groupPoints: PdfPoint[] = [];
      for (const point of group) {
        if (point === null || typeof point !== "object") return null;
        const pair = point as Record<string, unknown>;
        if (!isFiniteNumber(pair.x) || !isFiniteNumber(pair.y)) return null;
        groupPoints.push({ x: pair.x, y: pair.y });
      }
      groups.push(groupPoints);
    }
    return groups;
  };
  const quads = points(raw.quads);
  if (quads === null) return null;
  const strokes = points(raw.strokes);
  if (strokes === null) return null;
  if (raw.parent_id !== undefined && raw.parent_id !== null && !isPdfEditUuid(raw.parent_id)) return null;
  if (raw.image !== undefined && !isPdfEditSnapshot(raw.image)) return null;
  if (raw.image) {
    const image = raw.image as ExportSnapshot;
    // A raster belongs only to a visual signature, is always PNG/JPEG, and
    // its exact 8 MiB cap is enforced with `pdf_edit.too_large` in model.ts.
    if (raw.kind !== "signature") return null;
    if (image.mime !== "image/png" && image.mime !== "image/jpeg") return null;
    if (!isSafeInteger(image.byte_len, 1)) return null;
  }
  if (raw.font_size !== undefined && (!isFiniteNumber(raw.font_size) || raw.font_size < PDF_EDIT_MIN_FONT_SIZE_PT || raw.font_size > PDF_EDIT_MAX_FONT_SIZE_PT)) {
    return null;
  }
  const annotation: PdfAnnotation = {
    id: raw.id,
    page_id: raw.page_id,
    kind: raw.kind,
    rect,
    color: [...raw.color] as PdfColor,
    opacity: raw.opacity,
    author: raw.author,
    created_unix: raw.created_unix,
    text: raw.text,
  };
  if (quads) annotation.quads = quads;
  if (strokes) annotation.strokes = strokes;
  if (typeof raw.parent_id === "string") annotation.parent_id = raw.parent_id;
  if (raw.image) annotation.image = raw.image as ExportSnapshot;
  if (isFiniteNumber(raw.font_size)) annotation.font_size = raw.font_size;
  return annotation;
}

/** Total stored points of one annotation, for the model-wide cap. */
export function pdfAnnotationPointCount(annotation: PdfAnnotation): number {
  let total = 0;
  for (const group of annotation.quads ?? []) total += group.length;
  for (const group of annotation.strokes ?? []) total += group.length;
  return total;
}

/** Remove consecutive points closer than the minimum distance, keeping the
 * first and last point (D2). */
export function simplifyPdfStroke(points: readonly PdfPoint[]): PdfPoint[] {
  if (points.length <= 2) return points.map((point) => ({ ...point }));
  const result: PdfPoint[] = [{ ...points[0] }];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = result[result.length - 1];
    const point = points[index];
    const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
    if (distance >= PDF_EDIT_MIN_POINT_DISTANCE) result.push({ ...point });
  }
  const last = points[points.length - 1];
  const previous = result[result.length - 1];
  if (Math.hypot(last.x - previous.x, last.y - previous.y) >= PDF_EDIT_MIN_POINT_DISTANCE || result.length === 1) {
    result.push({ ...last });
  } else {
    result[result.length - 1] = { ...last };
  }
  return result;
}

export function emptyPdfEditHistory(): PdfEditHistory {
  return { entries: [], cursor: 0, bytes: 0 };
}
