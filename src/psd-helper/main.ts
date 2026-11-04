/** Trusted PSD helper entry (Step 07g T5). */
import {
  onHelperRequest,
  sendHelperReply,
  type HelperGrantDTO,
  type HelperAction,
  type HelperReplyEnvelope,
  type HelperRequestEnvelope,
} from "../services/helperBridge";
import { uploadOutput } from "../model-helper/upload";
import { encodePsdComposite, readPsdDocument, type PsdDocument } from "./psdAdapter";

interface PsdOpenPayload {
  grant_id: string;
  /** 64/128/256/2048; the viewer uses 2048, thumbnails use their bucket. */
  max_edge?: number;
}

interface PsdLayersPayload {
  offset: number;
}

interface PsdOpenReply {
  width: number;
  height: number;
  has_composite: boolean;
  layer_count: number;
}

interface PsdLayersReply {
  layers: unknown[];
  complete: boolean;
}

let document: PsdDocument | null = null;

function fail(code: string): never {
  throw new Error(code);
}

async function readGrant(grant: HelperGrantDTO): Promise<Uint8Array> {
  if (!Number.isSafeInteger(grant.byte_len) || grant.byte_len <= 0 || grant.byte_len > 256 * 1024 * 1024) {
    fail("special_view.too_large");
  }
  const response = await fetch(grant.token_url, { cache: "no-store" });
  if (!response.ok) fail("special_view.unavailable");
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== grant.byte_len) fail("special_view.changed");
  return new Uint8Array(buffer);
}

function errorReply(requestId: string, error: unknown): HelperReplyEnvelope<unknown> {
  const code = error instanceof Error ? error.message : "";
  const allowed = new Set([
    "special_view.bad_request",
    "special_view.unsupported",
    "special_view.too_large",
    "special_view.changed",
    "special_view.corrupt",
    "special_view.unavailable",
  ]);
  return {
    protocol_version: 1,
    request_id: requestId,
    status: "error",
    error_code: allowed.has(code) ? code : "special_view.corrupt",
  } as HelperReplyEnvelope<unknown>;
}

async function openPsd(request: HelperRequestEnvelope<PsdOpenPayload>, reservations: readonly import("../services/helperBridge").HelperOutputReservation[]): Promise<HelperReplyEnvelope<PsdOpenReply>> {
  const grant = request.inputs.find((input) => input.grant_id === request.payload.grant_id);
  if (!grant) fail("special_view.bad_request");
  const bytes = await readGrant(grant);
  document = readPsdDocument(bytes);
  const edge = request.payload.max_edge ?? 2048;
  if (![64, 128, 256, 2048].includes(edge)) fail("special_view.bad_request");
  const composite = await encodePsdComposite(document, edge);
  const outputs: Array<{ output_id: string; mime: string; byte_len: number; sha256: string }> = [];
  if (composite) {
    const reservation = reservations[0];
    if (!reservation) fail("special_view.bad_request");
    const uploaded = await uploadOutput(reservation, composite.png);
    outputs.push({ output_id: uploaded.output_id, mime: "image/png", byte_len: composite.png.length, sha256: uploaded.sha256 });
  }
  return {
    protocol_version: 1,
    request_id: request.request_id,
    status: "ok",
    payload: {
      width: document.width,
      height: document.height,
      has_composite: composite !== null,
      layer_count: document.layers.length,
    },
    outputs,
  } as HelperReplyEnvelope<PsdOpenReply>;
}

async function layers(request: HelperRequestEnvelope<PsdLayersPayload>): Promise<HelperReplyEnvelope<PsdLayersReply>> {
  if (!document) fail("special_view.unavailable");
  const offset = request.payload.offset;
  if (!Number.isInteger(offset) || offset < 0 || offset > document.layers.length) fail("special_view.bad_request");
  const page = document.layers.slice(offset, offset + 256).map((layer) => ({
    ...layer,
    // The name is a string in the wire DTO; React renders it as text.
    name: layer.name,
  }));
  return {
    protocol_version: 1,
    request_id: request.request_id,
    status: "ok",
    payload: { layers: page, complete: offset + page.length >= document.layers.length },
    outputs: [],
  } as HelperReplyEnvelope<PsdLayersReply>;
}

async function start(): Promise<void> {
  await onHelperRequest<PsdOpenPayload | PsdLayersPayload>({ action: (value): value is HelperAction => value === "psd.open" || value === "psd.layers", handler: async (request) => {
    try {
      const reply = request.action === "psd.open"
        ? await openPsd(request as HelperRequestEnvelope<PsdOpenPayload>, request.output_reservations ?? [])
        : request.action === "psd.layers"
          ? await layers(request as HelperRequestEnvelope<PsdLayersPayload>)
          : fail("special_view.unsupported");
      await sendHelperReply<PsdLayersReply | PsdOpenReply>(reply);
    } catch (error) {
      await sendHelperReply(errorReply(request.request_id, error));
    }
  }});
}

void start();
