import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** The trusted helper brain's half of the WebView helper transport (Step 07d
 * E7, helper-transport-1). This module only runs inside the helper webview:
 * the main app never imports it.
 *
 * Native mirrors live in `src-tauri/src/webview_helper_types.rs`. Requests
 * arrive as one event after the helper has its input grants; results are
 * uploaded to the helper's own output route and announced in one reply. No
 * document bytes travel through these messages (D3). */

export const HELPER_PROTOCOL_VERSION = 1 as const;

/** Every action a helper frontend may be asked to do (exact wire values). */
export type HelperAction =
  | "pdf.open"
  | "pdf.render"
  | "pdf.text"
  | "pdf.outline"
  | "pdf.search"
  | "pdf.print"
  | "book.open"
  | "book.page"
  | "book.contents"
  | "notebook.open"
  | "notebook.page"
  | "model.open"
  | "model.scene"
  | "psd.open"
  | "psd.layers"
  | "pdf.write_images"
  | "pdf.write_blocks"
  | "privacy.xmp"
  | "presentation.frame"
  | "presentation.wait_intent"
  | "presentation.end";

/** One input the helper may fetch, with its own guarded URL. */
export interface HelperGrantDTO {
  grant_id: string;
  /** `http://adpfile.localhost/<token>/<encoded name>` (never a path). */
  token_url: string;
  name: string;
  mime: string;
  byte_len: number;
  sensitive: boolean;
}

/** One result the helper must upload before its reply is accepted. */
export interface HelperOutputReservation {
  output_id: string;
  mime: string;
  token_url: string;
  upload_token: string;
  max_bytes: number;
  sensitive: boolean;
}

/** One uploaded result, announced in the reply. */
export interface HelperOutputDTO {
  output_id: string;
  mime: string;
  byte_len: number;
  sha256: string;
}

export interface HelperRequestEnvelope<T> {
  protocol_version: 1;
  request_id: string;
  action: HelperAction;
  inputs: readonly HelperGrantDTO[];
  output_reservations: readonly HelperOutputReservation[];
  payload: T;
}

export type HelperReplyEnvelope<T> =
  | {
      status: "ok";
      protocol_version: 1;
      request_id: string;
      payload: T;
      outputs: HelperOutputDTO[];
    }
  | {
      status: "error";
      protocol_version: 1;
      request_id: string;
      error_code: string;
    };

/** Largest body one upload chunk may carry (E7). */
export const HELPER_UPLOAD_CHUNK = 1024 * 1024;

/**
 * Listen for the one request the host sends after its grants are ready.
 * The action is checked here as well as natively: a reply for another action
 * is never sent.
 */
export function onHelperRequest<T>(handlers: {
  action: (value: unknown) => value is HelperAction;
  handler: (request: HelperRequestEnvelope<T>) => void;
}): Promise<UnlistenFn> {
  return listen<HelperRequestEnvelope<T>>("helper-request", (event) => {
    const request = event.payload;
    if (!request || request.protocol_version !== HELPER_PROTOCOL_VERSION) return;
    if (typeof request.request_id !== "string" || !handlers.action(request.action)) return;
    handlers.handler(request);
  }).then(async (unlisten) => {
    try { await invoke("helper_ready"); return unlisten; }
    catch (error) { unlisten(); throw error; }
  });
}

/** Send the one reply. `helper_reply` validates the version, request id and
 * action state before it reaches the parent process. */
export async function sendHelperReply<T>(reply: HelperReplyEnvelope<T>): Promise<void> {
  await invoke("helper_reply", { reply });
}

/** A fresh ArrayBuffer copy for APIs that reject SharedArrayBuffer views. */
function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", arrayBufferOf(bytes));
  return toHex(new Uint8Array(digest));
}

/**
 * Upload one result to its reserved route: contiguous chunks of at most
 * 1 MiB, then the final empty POST with the exact length and hash. The
 * reservation's token is the only authority; the helper never chooses an id
 * or a path.
 */
export async function uploadHelperOutput(
  reservation: HelperOutputReservation,
  bytes: Uint8Array,
  isCancelled?: () => boolean,
): Promise<HelperOutputDTO> {
  if (bytes.byteLength > reservation.max_bytes) throw new Error("pdf.too_large");
  let offset = 0;
  while (offset < bytes.byteLength) {
    if (isCancelled?.()) throw new Error("pdf.changed");
    const end = Math.min(bytes.byteLength, offset + HELPER_UPLOAD_CHUNK);
    const response = await fetch(reservation.token_url, {
      method: "POST",
      headers: {
        "X-Adp-Upload-Token": reservation.upload_token,
        "X-Adp-Offset": String(offset),
        "Content-Type": "application/octet-stream",
      },
      body: arrayBufferOf(bytes.subarray(offset, end)),
    });
    if (!response.ok) throw new Error("pdf.changed");
    offset = end;
  }
  if (isCancelled?.()) throw new Error("pdf.changed");
  const sha256 = await sha256Hex(bytes);
  const final = await fetch(reservation.token_url, {
    method: "POST",
    headers: {
      "X-Adp-Upload-Token": reservation.upload_token,
      "X-Adp-Offset": String(bytes.byteLength),
      "X-Adp-Final-Length": String(bytes.byteLength),
      "X-Adp-Sha256": sha256,
      "Content-Type": "application/octet-stream",
    },
  });
  if (!final.ok) throw new Error("pdf.changed");
  return { output_id: reservation.output_id, mime: reservation.mime, byte_len: bytes.byteLength, sha256 };
}
