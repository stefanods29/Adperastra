/**
 * Profile-bound AI inputs and opaque artifacts (Step 14c, E3/E4).
 * No function passes file bytes through JSON.
 */

import { invoke } from "@tauri-apps/api/core";
import type { ConversionInput } from "../convert/types";
import type { AiArtifactInfo, AiInputAcquire, AiInputRef } from "./localAiTypes";

export const MAX_AI_READ_BYTES = 8 * 1024 * 1024;
const PROTOCOL_READ_BYTES = 4 * 1024 * 1024;

/** A bare file path is not authorization; capture an 08a snapshot first. */
export async function acquireAiInput(input: ConversionInput): Promise<AiInputRef> {
  if (input.kind !== "snapshot") {
    throw new Error("ai.bad_request");
  }
  const request: AiInputAcquire = {
    kind: "snapshot",
    snapshot_id: input.snapshot_id,
    document_id: input.document_id,
    revision: input.revision,
  };
  return (await invoke("ai_input_acquire", { input: request })) as AiInputRef;
}

/** The original opened backing at revision 1 only. */
export async function acquireAiDocumentInput(documentId: string): Promise<AiInputRef> {
  return (await invoke("ai_document_input_acquire", {
    documentId,
  })) as AiInputRef;
}

export async function releaseAiInput(id: string): Promise<void> {
  await invoke("ai_input_release", { id });
}

export async function describeAiArtifact(id: string): Promise<AiArtifactInfo> {
  return (await invoke("ai_artifact_describe", { id })) as AiArtifactInfo;
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return new Uint8Array(value);
  throw new Error("ai.failed");
}

/**
 * One public range of at most 8 MiB, split into at most two 4 MiB reads.
 * The command returns a raw response, never a JSON byte array.
 */
export async function readAiArtifact(
  id: string,
  offset: number,
  length: number,
): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length <= 0 ||
    length > MAX_AI_READ_BYTES
  ) {
    throw new Error("ai.bad_request");
  }
  const first = Math.min(length, PROTOCOL_READ_BYTES);
  const firstBytes = toBytes(
    await invoke("ai_artifact_read", { request: { id, offset, length: first } }),
  );
  if (firstBytes.length !== first) throw new Error("ai.model_output");
  if (first === length) return firstBytes;
  const second = length - first;
  const secondBytes = toBytes(
    await invoke("ai_artifact_read", {
      request: { id, offset: offset + first, length: second },
    }),
  );
  if (secondBytes.length !== second) throw new Error("ai.model_output");
  const joined = new Uint8Array(first + second);
  joined.set(firstBytes, 0);
  joined.set(secondBytes, first);
  return joined;
}

export async function releaseAiArtifact(id: string): Promise<void> {
  await invoke("ai_artifact_release", { id });
}
