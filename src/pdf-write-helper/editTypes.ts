import type { ExportSnapshot } from "../services/exportSnapshots";
import type {
  PdfAnnotation,
  PdfAnnotationKind,
  PdfEditModel,
  PdfFormOption,
  PdfFormValue,
  PdfPoint,
  PdfRect,
  PdfRotation,
} from "../pdf-edit/types";

/** Helper-side wire types for the two `pdf.edit.*` actions (Step 14a).
 *
 * The canonical model lives in `src/pdf-edit/types.ts`; this module imports
 * the same serializable definitions instead of duplicating them. No file
 * bytes travel through these JSON shapes: PDF sources and rasters are helper
 * grants (`grant_id`), and the model itself is a bounded descriptor upload
 * (`model_grant_id`), never a path. */

export const PDF_EDIT_HELPER_ACTIONS = ["pdf.edit.inspect", "pdf.edit.serialize"] as const;
export type PdfEditHelperAction = (typeof PDF_EDIT_HELPER_ACTIONS)[number];

export function isPdfEditHelperAction(value: unknown): value is PdfEditHelperAction {
  return typeof value === "string" && (PDF_EDIT_HELPER_ACTIONS as readonly string[]).includes(value);
}

export type PdfEditWireModel = Omit<PdfEditModel, "history">;

/** `pdf.edit.inspect` request payload. The named grant is application/pdf. */
export interface PdfEditInspectPayload {
  grant_id: string;
}

/** One annotation found in the source. `nm` is the existing PDF /NM value;
 * `parent_nm` is the /IRT parent's /NM (for replies). */
export interface PdfLoadedAnnotation {
  origin_page: number;
  nm: string | null;
  kind: PdfAnnotationKind;
  rect: PdfRect;
  color: [number, number, number, number];
  opacity: number;
  author: string;
  created_unix: number;
  text: string;
  quads?: PdfPoint[][];
  strokes?: PdfPoint[][];
  parent_nm?: string | null;
  font_size?: number | null;
}

export interface PdfLoadedPage {
  origin_page: number;
  rotation: PdfRotation;
  crop: PdfRect;
}

/** `pdf.edit.inspect` success body. It is uploaded as one bounded
 * application/json output, not returned inside the 768 KiB control JSON. */
export interface PdfEditInspectReply {
  pages: PdfLoadedPage[];
  annotations: PdfLoadedAnnotation[];
  forms: PdfFormValue[];
  form_options: PdfFormOption[];
  signature_present: boolean;
  xfa_present: boolean;
  rich_text_fields: string[];
  unsupported_structures: string[];
  owned_annotation_ids: string[];
  unknown_annotations: number;
  byte_len: number;
}

export interface PdfEditSourceGrant {
  snapshot_id: string;
  grant_id: string;
}

/** `pdf.edit.serialize` request payload. The model descriptor is an input
 * grant (`application/json`, at most `PDF_EDIT_MAX_WIRE_BYTES`). */
export interface PdfEditSerializePayload {
  model_grant_id: string;
  revision: number;
  content_id: string;
  owned_annotation_ids: string[];
  /** PDF source bytes, including the base model snapshot. */
  source_grants: PdfEditSourceGrant[];
  /** Visual-signature rasters referenced by `PdfAnnotation.image`. */
  image_grants: PdfEditSourceGrant[];
}

export interface PdfEditSerializeReply {
  page_count: number;
  annotation_count: number;
  forms: PdfFormValue[];
  unknown_annotations_preserved: boolean;
  dropped_structures: string[];
  byte_len: number;
}

/** Small control reply; the inspection body itself is the uploaded JSON
 * output and never travels through the helper's limited control channel. */
export interface PdfEditInspectActionReply {
  byte_len: number;
}

export interface PdfEditImageSource {
  bytes: Uint8Array;
  mime: "image/png" | "image/jpeg";
}

export function isPdfEditImageSource(value: unknown): value is PdfEditImageSource {
  if (value === null || typeof value !== "object") return false;
  const image = value as Record<string, unknown>;
  return (
    image.bytes instanceof Uint8Array &&
    (image.mime === "image/png" || image.mime === "image/jpeg")
  );
}

/** Signature image snapshots are fetched through a helper grant, never
 * through a path. */
export type PdfEditImageResolver = (snapshot: ExportSnapshot) => Promise<PdfEditImageSource>;

export interface PdfEditLoadedModel {
  model: PdfEditWireModel;
  revision: number;
  content_id: string;
  owned_annotation_ids: string[];
}

/** Stable helper error codes for this feature; the coordinator adds them to
 * the helper error allowlist. Unknown failures become `pdf_edit.failed`. */
export const PDF_EDIT_HELPER_ERRORS = [
  "pdf_edit.bad_request",
  "pdf_edit.read_only",
  "pdf_edit.unsupported",
  "pdf_edit.too_large",
  "pdf_edit.changed",
  "pdf_edit.missing_glyph",
  "pdf_edit.signature_change",
  "pdf_edit.failed",
] as const;

export function pdfEditHelperError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (PDF_EDIT_HELPER_ERRORS as readonly string[]).includes(message) ? message : "pdf_edit.failed";
}

export function isPdfAnnotationModelValue(value: unknown): value is PdfAnnotation {
  return value !== null && typeof value === "object" && typeof (value as Record<string, unknown>).id === "string";
}
