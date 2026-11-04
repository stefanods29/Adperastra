import type { OfficeAiContext } from "../../types";
import { DOCUMENT_AI_LIMITS as L } from "./documentAiTypes";
import { documentAiScalarLength } from "./documentAiGeneration";

export function assertDocumentAiUtf16Boundary(text: string, offset: number): void {
  documentAiScalarLength(text);
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) throw new Error("document_ai.invalid");
  if (offset === 0 || offset === text.length) return;
  const previous = text.charCodeAt(offset - 1);
  const current = text.charCodeAt(offset);
  if (previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff) {
    throw new Error("document_ai.invalid");
  }
}

/** Validate an E20 result from the canonical `services/officeAi.ts` capture
 * (`bindOfficeAiContext` + `captureOfficeAiContext`); this does not capture,
 * authorize, or flatten a selection. Cross-object/token metadata and
 * context-window contracts remain unresolved. */
export function validateDocumentAiContext(
  context: OfficeAiContext, sessionId: string, expectedRevision: number,
  expectedContentId: string, nowUnix: number,
): void {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || !Number.isFinite(nowUnix)) {
    throw new Error("document_ai.invalid");
  }
  if (context.session_id !== sessionId || context.revision !== expectedRevision || context.content_id !== expectedContentId) {
    throw new Error("document_ai.changed");
  }
  if (!Number.isSafeInteger(context.expires_unix) || context.expires_unix <= nowUnix) {
    throw new Error("office_edit.proposal_expired");
  }
  if (context.family !== "document" || context.selection.kind !== "document" ||
      !Number.isSafeInteger(context.selection.page) || context.selection.page < 1 ||
      context.cells.length || context.slides.length) {
    throw new Error("document_ai.invalid");
  }
  // The canonical preview service revalidates the live selection revision.
  // Reject a context whose captured span belongs to another revision here too;
  // otherwise a stale context could pass this guard with matching outer IDs.
  if (context.selection.span.revision !== expectedRevision) throw new Error("document_ai.changed");
  if (!context.complete || context.truncated || context.next_cursor !== null ||
      !Array.isArray(context.text_runs) || context.text_runs.length > 256) {
    throw new Error("document_ai.too_large");
  }
  let scalars = 0;
  const seen = new Set<string>();
  for (const run of context.text_runs) {
    if (seen.has(run.id)) throw new Error("document_ai.invalid");
    seen.add(run.id);
    if (run.span.revision !== expectedRevision) throw new Error("document_ai.changed");
    scalars += documentAiScalarLength(run.text);
  }
  if (scalars > L.source_scalars) throw new Error("document_ai.too_large");
}
