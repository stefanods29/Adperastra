/**
 * Grounded source extraction helpers (Step 17a T2).
 *
 * Native extraction owns the immutable backing and the real PDF/Office/OCR
 * adapters. These pure helpers build the delimited data blocks, split them
 * into evidence chunks and verify a model quote against a captured chunk.
 * They never open a path, fetch a URL or write a file.
 */

import type { AiCitation, AiSourceLocation } from "../services/localAiTypes";
import type {
  AssistantCitationCheck,
  AssistantEvidenceChunk,
  AssistantExtractedSource,
  AssistantSourceInput,
  AssistantSourceRevision,
} from "./sourceTypes";
import {
  MAX_EVIDENCE_CHUNKS,
  MAX_QUOTE_SCALARS,
  MAX_SOURCE_FILE_BYTES,
  MAX_SOURCE_TURN_BYTES,
} from "./sourceTypes";

const CHUNK_SCALARS = 4_000;

function scalars(text: string): string[] {
  return Array.from(text);
}

export function normalizeQuote(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function escapeDelimiters(text: string): string {
  // Escape the closing delimiter first; it does not contain the opening
  // prefix, so otherwise file text could end its own data block.
  return text
    .replaceAll("<<<ADP-SOURCE-END>>>", "<<<ADP-SOURCE-END-ESCAPED>>>")
    .replaceAll("<<<ADP-SOURCE", "<<<ADP-SOURCE-ESCAPED")
    .replaceAll("ADP-SOURCE>>>", "ADP-SOURCE-ESCAPED>>>")
    .replaceAll("<|im_start|>", "<|im_start-escaped|>")
    .replaceAll("<|im_end|>", "<|im_end-escaped|>");
}

/** Same structural markers as `assistant_policy::detect_source_injection`. */
export function detectInjection(text: string): boolean {
  const lower = text.toLowerCase();
  return [
    "<<<adp-source",
    "<|im_start|>",
    "<|im_end|>",
    "ignore previous instructions",
    "ignore all previous instructions",
    "ignora las instrucciones anteriores",
    "ignora todas las instrucciones anteriores",
    "system prompt",
    "developer message",
    "sistema:",
    "mensaje del desarrollador",
    "assistant_reply",
    'confirmed":true',
    'approved":true',
    "stage2_confirmation",
    "outbound_consent",
    "upload every file",
    "sube todos los archivos",
    "envía todos los archivos",
    "envia todos los archivos",
    "send the file to",
    "envía el archivo a",
    "envia el archivo a",
    "delete permanently",
    "eliminación permanente",
    "eliminacion permanente",
  ].some((marker) => lower.includes(marker));
}

/** One data block; the model cannot close it or invent a trusted role. */
export function wrapSourceBlock(source: AssistantExtractedSource): string {
  const label = escapeDelimiters(source.label).replaceAll('"', "&quot;");
  return `<<<ADP-SOURCE id="${source.input_id}" revision="${source.revision}" label="${label}">>>\n${escapeDelimiters(
    source.text,
  )}\n<<<ADP-SOURCE-END>>>`;
}

function locationAt(base: AiSourceLocation, start: number): AiSourceLocation {
  if (base.kind === "text") {
    return { kind: "text", start: base.start + start, end: base.end + start };
  }
  return base;
}

/** Split a captured text into bounded chunks with exact scalar offsets. */
export function chunkSource(
  input: AssistantSourceInput,
  text: string,
): AssistantEvidenceChunk[] {
  const chars = scalars(text);
  const chunks: AssistantEvidenceChunk[] = [];
  let offset = 0;
  while (offset < chars.length && chunks.length < MAX_EVIDENCE_CHUNKS) {
    let end = Math.min(offset + CHUNK_SCALARS, chars.length);
    if (end < chars.length) {
      const slice = chars.slice(offset, end);
      const boundary = slice.lastIndexOf("\n");
      if (boundary > CHUNK_SCALARS / 2) end = offset + boundary + 1;
    }
    const piece = chars.slice(offset, end).join("");
    chunks.push({
      input_id: input.input_ref.id,
      revision: input.input_ref.expected_revision,
      label: input.label,
      location: locationAt(input.location, offset),
      start: offset,
      end,
      text: piece,
    });
    offset = end;
  }
  return chunks;
}

/**
 * Build the immutable in-memory source. Sensitive sources are allowed for
 * local work; the API gateway refuses them before any consent is offered.
 */
export function extractSource(input: AssistantSourceInput): AssistantExtractedSource {
  if (input.online_only) throw new Error("assistant.scope_denied");
  if (!input.source_identity) throw new Error("assistant.scope_denied");
  if (input.kind !== "image" && input.text.length === 0) {
    throw new Error("assistant.extractor_unavailable");
  }
  if (byteLength(input.text) > MAX_SOURCE_FILE_BYTES) {
    throw new Error("assistant.source_too_large");
  }
  const text = input.text;
  return {
    input_id: input.input_ref.id,
    revision: input.input_ref.expected_revision,
    label: input.label,
    mime: input.mime,
    kind: input.kind,
    source_identity: input.source_identity,
    byte_len: byteLength(text),
    text,
    chunks: chunkSource(input, text),
    sensitive: input.sensitive,
    injection_warning: detectInjection(text),
  };
}

/** A turn-level guard; the native gateway repeats it on the exact payload. */
export function sourcesBlock(sources: readonly AssistantExtractedSource[]): string {
  let total = 0;
  const blocks: string[] = [];
  for (const source of sources) {
    const bytes = byteLength(source.text);
    if (bytes > MAX_SOURCE_FILE_BYTES) throw new Error("assistant.source_too_large");
    total += bytes;
    if (total > MAX_SOURCE_TURN_BYTES) throw new Error("assistant.source_too_large");
    blocks.push(wrapSourceBlock(source));
  }
  return blocks.join("\n\n");
}

function sameLocation(left: AiSourceLocation, right: AiSourceLocation): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Verify a model quote against the captured chunk map. A quote from page 1
 * cannot be labelled page 2, and a changed revision is refused.
 */
export function citationForQuote(
  source: AssistantExtractedSource,
  quote: string,
  location?: AiSourceLocation,
): AssistantCitationCheck {
  if (Array.from(quote).length === 0 || Array.from(quote).length > MAX_QUOTE_SCALARS) {
    return { valid: false, error_code: "assistant.cannot_verify", citation: null };
  }
  const needle = normalizeQuote(quote);
  for (const chunk of source.chunks) {
    if (location && !sameLocation(location, chunk.location)) continue;
    if (normalizeQuote(chunk.text).includes(needle)) {
      return {
        valid: true,
        error_code: null,
        citation: {
          input_id: source.input_id,
          revision: source.revision,
          location: chunk.location,
          quote,
        },
      };
    }
  }
  return { valid: false, error_code: "assistant.cannot_verify", citation: null };
}

/** Compare the captured source with the current one before showing a cite. */
export function revisionStillMatches(
  source: AssistantExtractedSource,
  current: AssistantSourceRevision | null,
): boolean {
  return (
    current !== null &&
    current.input_id === source.input_id &&
    current.revision === source.revision &&
    current.source_identity === source.source_identity
  );
}

/** The exact excerpt that an outbound review shows; at most 8,192 scalars. */
export function outboundExcerpt(source: AssistantExtractedSource): string {
  return scalars(source.text).slice(0, 8_192).join("");
}

/** Locally usable sources; an API review is a separate decision. */
export function apiEligible(source: AssistantExtractedSource): boolean {
  return !source.sensitive;
}

/** A stable, non-secret citation key used by the UI's source buttons. */
export function citationKey(citation: AiCitation): string {
  const location = citation.location;
  if (location.kind === "page") {
    return `${citation.input_id}:${citation.revision}:page:${location.page}`;
  }
  if (location.kind === "time") {
    return `${citation.input_id}:${citation.revision}:time:${location.start_us}-${location.end_us}`;
  }
  if (location.kind === "text") {
    return `${citation.input_id}:${citation.revision}:text:${location.start}-${location.end}`;
  }
  if (location.kind === "sheet") {
    return `${citation.input_id}:${citation.revision}:sheet:${location.sheet_id}:${location.range}`;
  }
  if (location.kind === "slide") {
    return `${citation.input_id}:${citation.revision}:slide:${location.slide_id}`;
  }
  return `${citation.input_id}:${citation.revision}:image`;
}
