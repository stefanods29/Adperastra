import { invoke } from "@tauri-apps/api/core";
import { fileUrl } from "./files";

/** Read aloud with installed Windows voices (Step 10f, read-aloud-1).
 * Text is plain: markup is read literally, never parsed as SSML. Speech
 * stays in memory; the UI plays each chunk through its file token and
 * never receives audio as JSON or base64. */

export interface ReadVoice {
  id: string;
  name: string;
  language: string;
  local: true;
}

export interface ReadAloudRequest {
  text: string;
  voice_id?: string;
  document_id?: string;
  source_revision?: number;
  sensitive: boolean;
}

export interface SpeechChunk {
  session_id: string;
  sequence: number;
  token: string;
  name: "speech.wav";
  mime: "audio/wav";
  byte_len: number;
  end: boolean;
}

export type SpeechSessionState = "preparing" | "playing" | "paused" | "stopped";

export interface SpeechSession {
  session_id: string;
  chunk_count: number;
  next_sequence: number;
  state: SpeechSessionState;
}

export const MAX_READ_TEXT_SCALARS = 100000;
export const MAX_READ_CHUNK_BYTES = 32 * 1024 * 1024;
export const MAX_READ_VOICES = 256;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readAloudError(code: string): Error {
  return new Error(code);
}

export function scalarCount(text: string): number {
  return [...text].length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Client-side mirror of the native request bounds. The native side checks
 * again and forces `sensitive` from the document, never from this flag. */
export function validateReadAloudRequest(request: ReadAloudRequest): ReadAloudRequest {
  if (!isRecord(request)) throw readAloudError("read_aloud.invalid");
  const count = typeof request.text === "string" ? scalarCount(request.text) : 0;
  if (count < 1 || count > MAX_READ_TEXT_SCALARS) throw readAloudError("read_aloud.invalid");
  if (request.voice_id !== undefined) {
    if (typeof request.voice_id !== "string" || scalarCount(request.voice_id) > 512) {
      throw readAloudError("read_aloud.invalid");
    }
  }
  if (request.document_id !== undefined && !UUID_RE.test(request.document_id)) {
    throw readAloudError("read_aloud.invalid");
  }
  if (
    request.source_revision !== undefined &&
    (!Number.isSafeInteger(request.source_revision) || request.source_revision < 0)
  ) {
    throw readAloudError("read_aloud.invalid");
  }
  if (typeof request.sensitive !== "boolean") throw readAloudError("read_aloud.invalid");
  return request;
}

function validVoice(value: unknown): value is ReadVoice {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    scalarCount(value.id) <= 512 &&
    typeof value.name === "string" &&
    scalarCount(value.name as string) <= 128 &&
    typeof value.language === "string" &&
    scalarCount(value.language as string) <= 64 &&
    value.local === true
  );
}

function validSession(value: unknown): value is SpeechSession {
  return (
    isRecord(value) &&
    typeof value.session_id === "string" &&
    UUID_RE.test(value.session_id) &&
    Number.isInteger(value.chunk_count) &&
    (value.chunk_count as number) >= 0 &&
    Number.isInteger(value.next_sequence) &&
    (value.next_sequence as number) >= 0 &&
    ["preparing", "playing", "paused", "stopped"].includes(value.state as string)
  );
}

function validChunk(value: unknown): value is SpeechChunk {
  return (
    isRecord(value) &&
    typeof value.session_id === "string" &&
    UUID_RE.test(value.session_id) &&
    Number.isInteger(value.sequence) &&
    (value.sequence as number) >= 0 &&
    typeof value.token === "string" &&
    /^[0-9a-f]{32}$/.test(value.token) &&
    value.name === "speech.wav" &&
    value.mime === "audio/wav" &&
    typeof value.byte_len === "number" &&
    value.byte_len >= 0 &&
    value.byte_len <= MAX_READ_CHUNK_BYTES &&
    typeof value.end === "boolean"
  );
}

/** Installed voices only (max 256). No voice is downloaded or synthesized
 * in the cloud. */
export async function listReadVoices(): Promise<ReadVoice[]> {
  const value: unknown = await invoke("read_voices");
  if (!Array.isArray(value) || value.length > MAX_READ_VOICES || !value.every(validVoice)) {
    throw readAloudError("read_aloud.failed");
  }
  return value;
}

/** Starts a session. The text is captured once; later edits of the source
 * document do not change what this session reads. */
export async function startReadAloud(request: ReadAloudRequest): Promise<SpeechSession> {
  validateReadAloudRequest(request);
  const value: unknown = await invoke("read_aloud_start", { request });
  if (!validSession(value)) throw readAloudError("read_aloud.failed");
  return value;
}

/** Metadata for one synthesized chunk. Oversized audio fails here, before
 * any grant is used to play it. Play via `speechChunkUrl`. */
export async function readSpeechChunk(sessionId: string, sequence: number): Promise<SpeechChunk> {
  if (!UUID_RE.test(sessionId) || !Number.isInteger(sequence) || sequence < 0) {
    throw readAloudError("read_aloud.invalid");
  }
  const value: unknown = await invoke("read_aloud_chunk", { sessionId, sequence });
  if (!isRecord(value)) throw readAloudError("read_aloud.failed");
  if (typeof value.byte_len === "number" && value.byte_len > MAX_READ_CHUNK_BYTES) {
    throw readAloudError("read_aloud.too_large");
  }
  if (!validChunk(value) || value.session_id !== sessionId || value.sequence !== sequence) {
    throw readAloudError("read_aloud.failed");
  }
  return value;
}

export function speechChunkUrl(chunk: SpeechChunk): string {
  return fileUrl(chunk.token, chunk.name);
}

/** Stops a session immediately; the native side revokes every queued chunk
 * grant for it. */
export async function stopReadAloud(sessionId: string): Promise<void> {
  if (!UUID_RE.test(sessionId)) throw readAloudError("read_aloud.invalid");
  await invoke("read_aloud_stop", { sessionId });
}
