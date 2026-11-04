import { invoke } from "@tauri-apps/api/core";
import { runJob } from "./jobs";
import type { ExportSnapshot } from "./exportSnapshots";
import {
  pdfEditError,
  pdfEditErrorCode,
  validatePdfEditInspection,
  type PdfEditInspection,
  type PdfEditSerializeInspection,
} from "../pdf-edit/types";
import {
  registerPdfEditSourceLoader,
  type PdfEditSourceLoader,
} from "../pdf-edit/PdfEditRegistry";
import {
  registerPdfEditSerializeHost,
  type PdfEditHostSerializeOutcome,
  type PdfEditHostSerializeRequest,
  type PdfEditSerializeHost,
} from "../pdf-edit/serialize";

/** Native adapters for the two PDF edit host ports (Step 14a).
 *
 * The UI and the document controller never call these commands directly;
 * they use the registered ports. Only this service crosses into Rust. The
 * model and every source stay descriptors or 08a snapshot ids: no path and
 * no PDF bytes travel through `invoke`. */

export interface PdfEditInspectNativeRequest {
  document_id: string;
  snapshot_id: string;
  revision: number;
  content_id: string;
}

export interface PdfEditSerializeNativeRequest {
  document_id: string;
  snapshot_id: string;
  revision: number;
  content_id: string;
  model: PdfEditHostSerializeRequest["model"];
  owned_annotation_ids: string[];
}

export interface PdfEditSerializeNativeReply {
  snapshot: ExportSnapshot;
  inspection: PdfEditSerializeInspection;
}

/** Native errors use the feature's stable codes; anything else is failed. */
function asPdfEditError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "helper.sensitive_unsupported") {
    return pdfEditError("pdf_edit.unsupported");
  }
  return pdfEditError(pdfEditErrorCode(error));
}

async function runEditJob<T>(start: (requestId: string) => Promise<void>): Promise<T> {
  let completion: Promise<T>;
  try {
    completion = (await runJob<T>("pdfedit", start)).completion;
  } catch (error) {
    throw asPdfEditError(error);
  }
  try {
    return await completion;
  } catch (error) {
    throw asPdfEditError(error);
  }
}

/** Inspect one authorized source snapshot through the pdf_write helper. */
export async function inspectPdfEditSource(
  documentId: string,
  snapshot: ExportSnapshot,
): Promise<PdfEditInspection> {
  if (snapshot.document_id !== documentId) throw pdfEditError("pdf_edit.changed");
  const request: PdfEditInspectNativeRequest = {
    document_id: documentId,
    snapshot_id: snapshot.snapshot_id,
    revision: snapshot.revision,
    content_id: snapshot.content_id,
  };
  const raw = await runEditJob<PdfEditInspection>((requestId) =>
    invoke("pdf_edit_inspect_start", { requestId, request }),
  );
  const inspection = validatePdfEditInspection(raw);
  if (!inspection) throw pdfEditError("pdf_edit.failed");
  return inspection;
}

/** Serialize the captured model into a new immutable PDF snapshot. The
 * returned snapshot is the Save-copy input; this never writes the source. */
export async function serializePdfEditNative(
  request: PdfEditHostSerializeRequest,
): Promise<PdfEditHostSerializeOutcome> {
  const source = request.model.source_snapshot;
  if (source.document_id !== request.document_id) throw pdfEditError("pdf_edit.changed");
  const nativeRequest: PdfEditSerializeNativeRequest = {
    document_id: request.document_id,
    snapshot_id: source.snapshot_id,
    revision: request.revision,
    content_id: request.content_id,
    model: request.model,
    owned_annotation_ids: [...request.owned_annotation_ids],
  };
  const raw = await runEditJob<PdfEditSerializeNativeReply>((requestId) =>
    invoke("pdf_edit_serialize_start", { requestId, request: nativeRequest }),
  );
  if (!raw || typeof raw !== "object" || !raw.snapshot || !raw.inspection) {
    throw pdfEditError("pdf_edit.failed");
  }
  return { snapshot: raw.snapshot, inspection: raw.inspection };
}

export const nativePdfEditInspectHost: PdfEditSourceLoader = (document, snapshot) =>
  inspectPdfEditSource(document.id, snapshot);

export const nativePdfEditSerializeHost: PdfEditSerializeHost = {
  serialize: (request) => serializePdfEditNative(request),
};

/** Register the two native ports once, at app startup (coordinator-owned). */
export function registerNativePdfEditHosts(): void {
  registerPdfEditSourceLoader(nativePdfEditInspectHost);
  registerPdfEditSerializeHost(nativePdfEditSerializeHost);
}
