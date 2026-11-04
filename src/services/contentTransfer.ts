import { invoke } from "@tauri-apps/api/core";
import { isUuid } from "../documents/types";
import { validateTransferEnvelope, validateTransferPayload } from "../transfer/transferValidation";
import { transferError, type TransferEnvelope, type TransferPayload } from "../transfer/types";

/** Content-transfer service (Step 09c E1). The renderer sends values only;
 * the native registry assigns the transfer id, expiry and authoritative
 * sensitivity, and holds any snapshot lease until release. A malformed
 * payload or response never reaches an editor. */

function requireEnvelope(value: unknown): TransferEnvelope {
  const envelope = validateTransferEnvelope(value);
  if (!envelope) throw transferError("transfer.invalid");
  return envelope;
}

export async function createTransfer(
  sourceDocumentId: string | null,
  payload: TransferPayload,
): Promise<TransferEnvelope> {
  if (sourceDocumentId !== null && !isUuid(sourceDocumentId)) {
    throw transferError("transfer.invalid");
  }
  const normalized = validateTransferPayload(payload);
  if (!normalized) throw transferError("transfer.invalid");
  if (
    (normalized.kind === "image" || normalized.kind === "pdf_pages") &&
    normalized.snapshot.document_id !== sourceDocumentId
  ) {
    throw transferError("transfer.invalid");
  }
  const response = await invoke("transfer_create", {
    sourceDocumentId,
    payload: normalized,
  });
  return requireEnvelope(response);
}

export async function getTransfer(id: string): Promise<TransferEnvelope> {
  if (!isUuid(id)) throw transferError("transfer.invalid");
  const response = await invoke("transfer_get", { transferId: id });
  return requireEnvelope(response);
}

export async function releaseTransfer(id: string): Promise<void> {
  if (!isUuid(id)) throw transferError("transfer.invalid");
  await invoke("transfer_release", { transferId: id });
}
