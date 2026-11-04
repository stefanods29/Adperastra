/**
 * Grounded source shapes (Step 17a T2).
 *
 * An extracted source is captured from an immutable authorized backing. It
 * carries stable input/revision/location identifiers so a citation can be
 * checked against the exact bytes the model saw. No OS path is included.
 */

import type { AiCitation, AiInputRef, AiSourceLocation } from "../services/localAiTypes";

export const MAX_SOURCE_FILE_BYTES = 64 * 1024;
export const MAX_SOURCE_TURN_BYTES = 128 * 1024;
export const MAX_EVIDENCE_CHUNKS = 512;
export const MAX_QUOTE_SCALARS = 500;

export type AssistantSourceKind = "text" | "pdf" | "ocr" | "office_readonly" | "table" | "image";

/** What native extraction receives after source authorization. */
export interface AssistantSourceInput {
  input_ref: AiInputRef;
  label: string;
  mime: string;
  kind: AssistantSourceKind;
  /** Immutable native identity, opaque to the UI. */
  source_identity: string;
  /** Location of the whole source, e.g. page 2 or a text range. */
  location: AiSourceLocation;
  /** Authorized extracted text; never a path or raw file bytes. */
  text: string;
  sensitive: boolean;
  online_only: boolean;
}

export interface AssistantEvidenceChunk {
  input_id: string;
  revision: number;
  label: string;
  location: AiSourceLocation;
  /** Scalar offset inside the captured source text. */
  start: number;
  end: number;
  text: string;
}

export interface AssistantExtractedSource {
  input_id: string;
  revision: number;
  label: string;
  mime: string;
  kind: AssistantSourceKind;
  source_identity: string;
  byte_len: number;
  text: string;
  chunks: AssistantEvidenceChunk[];
  sensitive: boolean;
  injection_warning: boolean;
}

export interface AssistantCitationCheck {
  valid: boolean;
  error_code: "assistant.cannot_verify" | "assistant.source_changed" | null;
  citation: AiCitation | null;
}

/** A captured chat scope revision used to reject stale citations. */
export interface AssistantSourceRevision {
  input_id: string;
  revision: number;
  source_identity: string;
}
