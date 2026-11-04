/** `privacy.xmp` static helper action (Step 08c E5).
 *
 * Runs in the trusted `pdf_write` WebView host with network and external
 * entity resolution disabled by the host. The main app never receives raw
 * XML through `invoke`.
 */

import type { MetadataCategory } from "../convert/types";
import {
  sendHelperReply,
  uploadHelperOutput,
  type HelperRequestEnvelope,
  type HelperReplyEnvelope,
} from "../services/helperBridge";
import { applyXmpEdit, inspectXmp, type XmpEdit } from "../services/xmp";
import type { PrivacyField } from "../services/privacy";

export interface PrivacyXmpPayload {
  kind: "remove_categories" | "set_keywords" | "inspect";
  categories?: MetadataCategory[];
  keywords?: string[];
}

export interface PrivacyXmpReply {
  fields: PrivacyField[];
}

export function isPrivacyXmpAction(value: unknown): value is "privacy.xmp" {
  return value === "privacy.xmp";
}

function editOf(payload: PrivacyXmpPayload): XmpEdit | null {
  if (payload.kind === "remove_categories") {
    return { kind: "remove_categories", categories: payload.categories ?? [] };
  }
  if (payload.kind === "set_keywords") {
    return { kind: "set_keywords", keywords: payload.keywords ?? [] };
  }
  return null;
}

async function readInput(url: string): Promise<string> {
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) throw new Error("privacy.unsupported");
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > 1024 * 1024) throw new Error("privacy.too_large");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("privacy.unsupported");
  }
}

/** Handle exactly one `privacy.xmp` request and upload its one XML result. */
export async function handlePrivacyXmpRequest(
  request: HelperRequestEnvelope<PrivacyXmpPayload>,
): Promise<void> {
  try {
    const input = request.inputs[0];
    if (!input) throw new Error("privacy.bad_request");
    const xml = await readInput(input.token_url);
    const edit = editOf(request.payload);
    if (!edit) {
      const fields = inspectXmp(xml);
      const reply: HelperReplyEnvelope<PrivacyXmpReply> = {
        status: "ok",
        protocol_version: 1,
        request_id: request.request_id,
        payload: { fields },
        outputs: [],
      };
      await sendHelperReply(reply);
      return;
    }
    const output = applyXmpEdit(xml, edit);
    const reservation = request.output_reservations[0];
    if (!reservation) throw new Error("privacy.bad_request");
    const bytes = new TextEncoder().encode(output);
    const uploaded = await uploadHelperOutput(reservation, bytes);
    const reply: HelperReplyEnvelope<PrivacyXmpReply> = {
      status: "ok",
      protocol_version: 1,
      request_id: request.request_id,
      payload: { fields: [] },
      outputs: [uploaded],
    };
    await sendHelperReply(reply);
  } catch (error) {
    const code =
      error instanceof Error && error.message.startsWith("privacy.")
        ? error.message
        : "privacy.failed";
    const reply: HelperReplyEnvelope<PrivacyXmpReply> = {
      protocol_version: 1,
      request_id: request.request_id,
      status: "error",
      error_code: code,
    };
    await sendHelperReply(reply);
  }
}
