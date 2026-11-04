import {
  sendHelperReply,
  uploadHelperOutput,
  type HelperGrantDTO,
  type HelperOutputReservation,
  type HelperRequestEnvelope,
} from "../services/helperBridge";
import {
  PDF_EDIT_MAX_SOURCE_BYTES,
  PDF_EDIT_MAX_SIGNATURE_BYTES,
  PDF_EDIT_MAX_WIRE_BYTES,
  isPdfEditUuid,
  isSafeInteger,
  type PdfEditModel,
} from "../pdf-edit/types";
import { validatePdfEditWireModel } from "../pdf-edit/model";
import { serializePdfEditDocument } from "./annotations";
import { inspectPdfEditDocument } from "./annotationInspect";
import { canDisplay, embedExportFont, loadFontAsset, type FontkitLike } from "./fontAdapter";
import {
  isPdfEditHelperAction,
  pdfEditHelperError,
  type PdfEditInspectActionReply,
  type PdfEditSerializePayload,
  type PdfEditSerializeReply,
} from "./editTypes";

/** The two `pdf.edit.*` helper actions (Step 14a T2/T3/T5/T6).
 *
 * The coordinator's helper entry dispatches here after adding the actions to
 * its fixed registry. Every source, model and signature image arrives through
 * its own helper grant; no path or raw PDF bytes travel in the control JSON.
 * The inspect result and the written PDF are uploaded to the reserved output,
 * never returned inside the control reply. */

const MAX_GRANT_ENTRIES = 10_001;

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function stringField(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new Error("pdf_edit.bad_request");
  return value;
}

function grantById(request: HelperRequestEnvelope<unknown>, id: string, mime: string): HelperGrantDTO {
  const grant = request.inputs.find((input) => input.grant_id === id);
  if (!grant || grant.mime !== mime) throw new Error("pdf_edit.bad_request");
  if (!isSafeInteger(grant.byte_len, 0, PDF_EDIT_MAX_SOURCE_BYTES)) throw new Error("pdf_edit.too_large");
  return grant;
}

async function fetchGrant(grant: HelperGrantDTO, maxBytes: number): Promise<Uint8Array> {
  if (grant.byte_len > maxBytes) throw new Error("pdf_edit.too_large");
  const response = await fetch(grant.token_url, { cache: "no-store" });
  if (!response.ok) throw new Error("pdf_edit.changed");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== grant.byte_len || bytes.byteLength > maxBytes) {
    throw new Error("pdf_edit.changed");
  }
  return bytes;
}

function oneReservation(request: HelperRequestEnvelope<unknown>, mime: string): HelperOutputReservation {
  if (request.output_reservations.length !== 1) throw new Error("pdf_edit.bad_request");
  const reservation = request.output_reservations[0];
  if (reservation.mime !== mime) throw new Error("pdf_edit.bad_request");
  if (!isSafeInteger(reservation.max_bytes, 1)) throw new Error("pdf_edit.too_large");
  return reservation;
}

/** Sensitive inputs are only allowed to produce a sensitive (memory-only)
 * result. A host that cannot prove that route gets no bytes at all. */
function assertSensitiveRoute(request: HelperRequestEnvelope<unknown>, reservation: HelperOutputReservation): void {
  if (request.inputs.some((grant) => grant.sensitive) && !reservation.sensitive) {
    throw new Error("pdf_edit.unsupported");
  }
}

function grantMap(value: unknown, field: "snapshot_id" | "grant_id"): Map<string, string> {
  if (!Array.isArray(value) || value.length > MAX_GRANT_ENTRIES) throw new Error("pdf_edit.too_large");
  const entries = new Map<string, string>();
  for (const raw of value) {
    const entry = recordOf(raw);
    if (!entry) throw new Error("pdf_edit.bad_request");
    const id = entry[field];
    const grantId = entry.grant_id;
    if (typeof id !== "string" || id.length === 0 || id.length > 128) throw new Error("pdf_edit.bad_request");
    if (typeof grantId !== "string" || grantId.length === 0 || grantId.length > 128) {
      throw new Error("pdf_edit.bad_request");
    }
    if (entries.has(id)) throw new Error("pdf_edit.bad_request");
    entries.set(id, grantId);
  }
  return entries;
}

function textValues(model: Readonly<PdfEditModel>): string[] {
  const texts: string[] = [];
  for (const annotation of model.annotations) {
    if ((annotation.kind === "text" || annotation.kind === "signature") && annotation.text.length > 0) {
      texts.push(annotation.text);
    }
  }
  for (const form of model.forms) {
    if (typeof form.value === "string") texts.push(form.value);
    else if (Array.isArray(form.value)) texts.push(...form.value);
  }
  return texts;
}

async function inspectAction(request: HelperRequestEnvelope<unknown>): Promise<void> {
  const payload = recordOf(request.payload);
  if (!payload || typeof payload.grant_id !== "string" || payload.grant_id.length === 0) {
    throw new Error("pdf_edit.bad_request");
  }
  const reservation = oneReservation(request, "application/json");
  assertSensitiveRoute(request, reservation);
  const grant = grantById(request, payload.grant_id, "application/pdf");
  const bytes = await fetchGrant(grant, PDF_EDIT_MAX_SOURCE_BYTES);
  const reply = await inspectPdfEditDocument(bytes);
  const encoded = new TextEncoder().encode(JSON.stringify(reply));
  if (encoded.byteLength === 0 || encoded.byteLength > PDF_EDIT_MAX_WIRE_BYTES) {
    throw new Error("pdf_edit.too_large");
  }
  if (encoded.byteLength > reservation.max_bytes) throw new Error("pdf_edit.too_large");
  const output = await uploadHelperOutput(reservation, encoded);
  const control: PdfEditInspectActionReply = { byte_len: encoded.byteLength };
  await sendHelperReply({
    status: "ok",
    protocol_version: 1,
    request_id: request.request_id,
    payload: control,
    outputs: [output],
  });
}

async function serializeAction(request: HelperRequestEnvelope<unknown>): Promise<void> {
  const raw = recordOf(request.payload);
  if (!raw) throw new Error("pdf_edit.bad_request");
  const modelGrantId = stringField(raw.model_grant_id);
  const revision = raw.revision;
  if (!isSafeInteger(revision, 1)) throw new Error("pdf_edit.bad_request");
  const contentId = stringField(raw.content_id);
  if (!isPdfEditUuid(contentId)) throw new Error("pdf_edit.bad_request");
  const ownedRaw = raw.owned_annotation_ids;
  if (!Array.isArray(ownedRaw) || ownedRaw.length > 100_000) throw new Error("pdf_edit.too_large");
  const ownedValues = ownedRaw as unknown[];
  if (!ownedValues.every((entry) => typeof entry === "string" && isPdfEditUuid(entry))) {
    throw new Error("pdf_edit.bad_request");
  }
  const sourceGrants = grantMap(raw.source_grants, "snapshot_id");
  const imageGrants = grantMap(raw.image_grants, "snapshot_id");
  const reservation = oneReservation(request, "application/pdf");
  assertSensitiveRoute(request, reservation);

  const modelGrant = grantById(request, modelGrantId, "application/json");
  const modelBytes = await fetchGrant(modelGrant, PDF_EDIT_MAX_WIRE_BYTES);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(modelBytes));
  } catch {
    throw new Error("pdf_edit.bad_request");
  }
  const model = validatePdfEditWireModel(parsed);
  if (!model) throw new Error("pdf_edit.bad_request");
  if (model.content_id !== contentId) throw new Error("pdf_edit.changed");

  // Only annotations this model actually owns may be replaced. A stale or
  // forged `/NM` in the request can never delete an unknown annotation.
  const modelIds = new Set(model.annotations.map((annotation) => annotation.id));
  const owned = [...new Set(ownedValues as string[])].filter((id) => modelIds.has(id));

  // The base source and every page origin must be explicitly granted.
  const requiredSources = new Set<string>([model.source_snapshot.snapshot_id]);
  for (const page of model.pages) requiredSources.add(page.origin_source.snapshot_id);
  if (requiredSources.size > MAX_GRANT_ENTRIES) throw new Error("pdf_edit.too_large");
  const sources = new Map<string, Uint8Array>();
  for (const snapshotId of requiredSources) {
    const grantId = sourceGrants.get(snapshotId);
    if (!grantId) throw new Error("pdf_edit.changed");
    const grant = grantById(request, grantId, "application/pdf");
    if (!isPdfEditUuid(snapshotId)) throw new Error("pdf_edit.bad_request");
    sources.set(snapshotId, await fetchGrant(grant, PDF_EDIT_MAX_SOURCE_BYTES));
  }
  const baseBytes = sources.get(model.source_snapshot.snapshot_id);
  if (!baseBytes || baseBytes.byteLength === 0) throw new Error("pdf_edit.changed");

  const images = new Map<string, { bytes: Uint8Array; mime: "image/png" | "image/jpeg" }>();
  for (const annotation of model.annotations) {
    if (!annotation.image) continue;
    const snapshot = annotation.image;
    if (!isPdfEditUuid(snapshot.snapshot_id)) throw new Error("pdf_edit.bad_request");
    if (images.has(snapshot.snapshot_id)) continue;
    const grantId = imageGrants.get(snapshot.snapshot_id);
    if (!grantId) throw new Error("pdf_edit.changed");
    if (snapshot.mime !== "image/png" && snapshot.mime !== "image/jpeg") throw new Error("pdf_edit.unsupported");
    const grant = grantById(request, grantId, snapshot.mime);
    const bytes = await fetchGrant(grant, PDF_EDIT_MAX_SIGNATURE_BYTES);
    images.set(snapshot.snapshot_id, { bytes, mime: snapshot.mime });
  }

  // One embedded licensed font, checked for every visible code point before
  // anything is written.
  const fontkitModule = await import("@pdf-lib/fontkit");
  const fontkit = ((fontkitModule as { default?: FontkitLike }).default ?? fontkitModule) as unknown as FontkitLike;
  const asset = await loadFontAsset("inter-regular");
  const kit = fontkit.create(asset.bytes);
  for (const text of textValues(model)) {
    if (!canDisplay(kit, text)) throw new Error("pdf_edit.missing_glyph");
  }
  const fontProvider = async (pdf: Parameters<typeof embedExportFont>[0]) =>
    (await embedExportFont(pdf, asset, fontkit)).font;

  const payload: PdfEditSerializePayload = {
    model_grant_id: modelGrantId,
    revision,
    content_id: contentId,
    owned_annotation_ids: owned as string[],
    source_grants: [...sourceGrants].map(([snapshot_id, grant_id]) => ({ snapshot_id, grant_id })),
    image_grants: [...imageGrants].map(([snapshot_id, grant_id]) => ({ snapshot_id, grant_id })),
  };
  const result = await serializePdfEditDocument(
    baseBytes,
    {
      model,
      revision: payload.revision,
      content_id: payload.content_id,
      owned_annotation_ids: payload.owned_annotation_ids,
    },
    fontProvider,
    images,
    sources,
  );
  if (result.bytes.byteLength === 0 || result.bytes.byteLength > reservation.max_bytes) {
    throw new Error("pdf_edit.too_large");
  }
  const output = await uploadHelperOutput(reservation, result.bytes);
  const reply: PdfEditSerializeReply = {
    ...result.inspection,
    byte_len: result.bytes.byteLength,
  };
  await sendHelperReply({
    status: "ok",
    protocol_version: 1,
    request_id: request.request_id,
    payload: reply,
    outputs: [output],
  });
}


/** Dispatch one of the two PDF edit actions. The coordinator's helper entry
 * calls this only for `isPdfEditHelperAction(request.action)`; unknown
 * actions remain refused by that entry. */
export async function handlePdfEditRequest(request: HelperRequestEnvelope<unknown>): Promise<void> {
  try {
    if (!isPdfEditHelperAction(request.action)) throw new Error("pdf_edit.bad_request");
    if (request.action === "pdf.edit.inspect") await inspectAction(request);
    else await serializeAction(request);
  } catch (error) {
    await sendHelperReply({
      status: "error",
      protocol_version: 1,
      request_id: request.request_id,
      error_code: pdfEditHelperError(error),
    });
  }
}
