import type { PdfInput } from "../services/pdf";
import type { ExportSnapshot } from "../services/exportSnapshots";
import {
  PDF_EDIT_MAX_SOURCE_BYTES,
  PdfEditError,
  isPdfEditSnapshot,
  isPdfEditUuid,
  isSafeInteger,
  pdfEditError,
  type PdfEditCapabilities,
  type PdfEditErrorCode,
  type PdfEditModel,
  type PdfEditSaveMode,
  type PdfEditSerializeInspection,
} from "./types";
import { assertPdfEditModel, pdfEditWireModel } from "./model";

/** Revision-safe capture and serialization (Step 14a E3, T6).
 *
 * `serializePdfEdit` freezes the captured revision and content id before any
 * encoding starts. The actual PDF parsing/writing runs in the isolated
 * pdf_write helper; the native host (registered by the coordinator) runs that
 * helper, uploads the output through the Step 08a snapshot authority and
 * returns the finished ExportSnapshot. This module never writes a file and
 * never receives raw PDF bytes through JSON. */

export interface PdfEditHostSerializeRequest {
  document_id: string;
  revision: number;
  content_id: string;
  /** The bounded wire model; history is intentionally excluded. */
  model: Omit<PdfEditModel, "history">;
  /** Model annotation ids that may already exist in the source and must be
   * replaced. Ids absent from the source are a no-op for the writer. */
  owned_annotation_ids: string[];
}

export interface PdfEditHostSerializeOutcome {
  snapshot: ExportSnapshot;
  inspection: PdfEditSerializeInspection;
}

export interface PdfEditSerializeHost {
  /** Run `pdf.edit.serialize` and finish the 08a upload. */
  serialize(request: PdfEditHostSerializeRequest): Promise<PdfEditHostSerializeOutcome>;
}

let host: PdfEditSerializeHost | null = null;

/** Register the one trusted host implementation. A second registration is
 * refused rather than silently replacing the writer. */
export function registerPdfEditSerializeHost(next: PdfEditSerializeHost): void {
  if (host !== null) throw pdfEditError("pdf_edit.unsupported");
  host = next;
}

export function getPdfEditSerializeHost(): PdfEditSerializeHost | null {
  return host;
}

/** Test helper: forget the host between suites. */
export function resetPdfEditSerializeHostForTests(): void {
  host = null;
}

function sameFormValues(left: PdfEditModel["forms"], right: PdfEditSerializeInspection["forms"]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a.field_id !== b.field_id || a.kind !== b.kind || a.readonly !== b.readonly) return false;
    if (JSON.stringify(a.value) !== JSON.stringify(b.value)) return false;
  }
  return true;
}

function verifyOutcome(
  model: Readonly<PdfEditModel>,
  revision: number,
  contentId: string,
  outcome: PdfEditHostSerializeOutcome,
): ExportSnapshot {
  if (outcome === null || typeof outcome !== "object") throw pdfEditError("pdf_edit.failed");
  const snapshot = outcome.snapshot;
  if (!snapshot || typeof snapshot !== "object") throw pdfEditError("pdf_edit.failed");
  if (!isPdfEditSnapshot(snapshot)) throw pdfEditError("pdf_edit.failed");
  if (snapshot.document_id !== model.document_id) throw pdfEditError("pdf_edit.changed");
  if (snapshot.revision !== revision) throw pdfEditError("pdf_edit.changed");
  if (snapshot.content_id !== contentId) throw pdfEditError("pdf_edit.changed");
  if (snapshot.mime !== "application/pdf") throw pdfEditError("pdf_edit.unsupported");
  // A new copy keeps the source storage policy exactly: a sensitive document
  // never becomes an ordinary on-disk snapshot, and an ordinary Save copy is
  // never silently turned into a memory-only result (D1/D9).
  if (snapshot.storage_policy !== model.source_snapshot.storage_policy) {
    throw pdfEditError("pdf_edit.unsupported");
  }
  if (!isSafeInteger(snapshot.byte_len, 1, PDF_EDIT_MAX_SOURCE_BYTES)) throw pdfEditError("pdf_edit.too_large");
  const inspection = outcome.inspection;
  if (!inspection || typeof inspection !== "object") throw pdfEditError("pdf_edit.failed");
  if (inspection.page_count !== model.pages.length) throw pdfEditError("pdf_edit.unsupported");
  if (inspection.annotation_count !== model.annotations.length) throw pdfEditError("pdf_edit.unsupported");
  if (!sameFormValues(model.forms, inspection.forms)) throw pdfEditError("pdf_edit.unsupported");
  if (inspection.unknown_annotations_preserved !== true) throw pdfEditError("pdf_edit.unsupported");
  if (!Array.isArray(inspection.dropped_structures) || inspection.dropped_structures.length > 0) {
    throw pdfEditError("pdf_edit.unsupported");
  }
  return snapshot;
}

/** E3: encode the captured model revision into one immutable PDF snapshot. */
export async function serializePdfEdit(
  model: Readonly<PdfEditModel>,
  revision: number,
  contentId: string,
): Promise<ExportSnapshot> {
  assertPdfEditModel(model as PdfEditModel);
  if (!isSafeInteger(revision, 1)) throw pdfEditError("pdf_edit.bad_request");
  if (!isPdfEditUuid(contentId)) throw pdfEditError("pdf_edit.bad_request");
  if (contentId !== model.content_id) throw pdfEditError("pdf_edit.changed");
  const active = host;
  if (!active) throw pdfEditError("pdf_edit.unsupported");

  const wire = pdfEditWireModel(model);
  const request: PdfEditHostSerializeRequest = {
    document_id: model.document_id,
    revision,
    content_id: contentId,
    model: wire,
    owned_annotation_ids: model.annotations.map((annotation) => annotation.id),
  };
  let outcome: PdfEditHostSerializeOutcome;
  try {
    outcome = await active.serialize(request);
  } catch (error) {
    if (error instanceof PdfEditError) throw error;
    throw pdfEditError("pdf_edit.failed");
  }
  return verifyOutcome(model, revision, contentId, outcome);
}

/** The 07d input for the captured model. A snapshot never fabricates a path
 * or a SourceStamp; this is the identity used by a new PDF session. */
export function buildPdfInputForModel(model: Readonly<PdfEditModel>): PdfInput {
  const snapshot = model.source_snapshot;
  // `source_snapshot.mime` is the descriptive origin MIME, not the capture
  // MIME; the snapshot identity below is what opens the PDF session.
  return {
    kind: "snapshot",
    reference: {
      snapshot_id: snapshot.snapshot_id,
      document_id: snapshot.document_id,
      revision: snapshot.revision,
      content_id: snapshot.content_id,
    },
  };
}

/** Save changes to the existing file only when 09f proved the capability.
 * A changed PDF with a real digital signature always needs Save a copy. */
export function pdfEditSaveModeError(
  capabilities: PdfEditCapabilities,
  canSaveExisting: boolean,
  mode: PdfEditSaveMode,
): PdfEditErrorCode | null {
  if (mode === "copy") return null;
  if (capabilities.signature_present) return "pdf_edit.signature_change";
  if (capabilities.xfa_present) return "pdf_edit.unsupported";
  if (!canSaveExisting) return "pdf_edit.read_only";
  return null;
}

export function assertPdfEditSaveMode(
  capabilities: PdfEditCapabilities,
  canSaveExisting: boolean,
  mode: PdfEditSaveMode,
): void {
  const code = pdfEditSaveModeError(capabilities, canSaveExisting, mode);
  if (code) throw pdfEditError(code);
}
