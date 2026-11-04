import type { DocumentHandle } from "../../documents/types";
import { useRecoveryCapture } from "../../documents/useRecoveryCapture";
import type { JobHandle } from "../../services/jobs";
import { saveRecoverySnapshot, type RecoveryMetadata } from "../../services/recovery";
import type { OfficeController } from "../OfficeController";
import { captureCurrentDeck } from "./deckExport";

/** Recovery for a deck (Step 22a T8 E1, 09h recovery-1).
 *
 * The 09h store owns encryption/cataloguing; this adapter only supplies the
 * exact captured revision and metadata. Sensitive (locked-folder) decks are
 * refused before any snapshot bytes are written: the ordinary DPAPI store
 * must never hold their plaintext. */

export interface DeckRecoveryOptions {
  enabled: boolean;
  interval_seconds: number;
}

export function deckRecoveryMetadata(
  document: DocumentHandle,
  capturedRevision: number,
  contentId: string,
  byteLen: number,
  nowUnix: number,
): RecoveryMetadata {
  if (document.info.sensitive) throw new Error("recovery.sensitive");
  if (!Number.isSafeInteger(capturedRevision) || capturedRevision < 0) throw new Error("recovery.invalid");
  if (!Number.isSafeInteger(byteLen) || byteLen < 0 || byteLen > 64 * 1024 * 1024) throw new Error("recovery.too_large");
  return {
    version: 1,
    record_id: crypto.randomUUID(),
    document_id: document.id,
    source: document.source,
    name: document.info.name,
    mime: document.info.mime,
    handler_id: "office-slide",
    captured_revision: capturedRevision,
    content_id: contentId,
    captured_unix: Math.max(0, Math.trunc(nowUnix)),
    byte_len: byteLen,
    from_internet: document.info.from_internet,
    sensitive: false,
  };
}

/** Capture and save one ordinary deck recovery revision. */
export async function captureDeckRecovery(
  controller: OfficeController,
  nowUnix = Math.floor(Date.now() / 1000),
): Promise<JobHandle<{ record_id: string; captured_revision: number }>> {
  if (controller.document.info.sensitive) throw new Error("recovery.sensitive");
  const snapshot = await captureCurrentDeck(controller);
  try {
    const metadata = deckRecoveryMetadata(
      controller.document, snapshot.revision, snapshot.content_id, snapshot.byte_len, nowUnix,
    );
    return await saveRecoverySnapshot(snapshot, metadata);
  } catch (error) {
    const { releaseExportSnapshot } = await import("../../services/exportSnapshots");
    await releaseExportSnapshot(snapshot.snapshot_id).catch(() => undefined);
    throw error;
  }
}

/** One recovery capture owner per document, exactly as 09h requires. */
export function useDeckRecoveryCapture(
  document: DocumentHandle,
  options: DeckRecoveryOptions,
  onWarning: (code: string) => void,
): void {
  useRecoveryCapture(document, options, onWarning);
}
