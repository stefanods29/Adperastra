import type { OfficeController } from "../OfficeController";
import type { OfficeSelection } from "../types";
import { canDocumentMutate } from "./documentController";
import { startDictation, stopDictation, cancelDictation, transcriptPage, releaseTranscript } from "../../services/speech";
import type { DictationRequest, DictationSession, TranscriptInfo } from "../../services/speechTypes";

/** Owns one explicit microphone session and the reviewed, bounded transcript lease. */
export function createDocumentDictation(controller: OfficeController, readSelection: () => OfficeSelection | null) {
  let session: DictationSession | null = null;
  let transcript: TranscriptInfo | null = null;
  let captured: { revision: number; contentId: string; selection: Extract<OfficeSelection, { kind: "document" }> } | null = null;
  let generation = 0;
  let busy = false;
  let applying = false;
  let reviewedText: string | null = null;
  const matches = () => {
    const state = controller.getState();
    return captured !== null && state.revision === captured.revision && state.content_id === captured.contentId &&
      JSON.stringify(readSelection()) === JSON.stringify(captured.selection);
  };
  const clearTranscript = async () => {
    const previous = transcript; transcript = null; reviewedText = null;
    if (previous) await releaseTranscript(previous.id);
  };
  return {
    async start(language: "en" | "es", speechReady: boolean, previewOnly = false): Promise<void> {
      if (busy || session || transcript || applying) throw new Error("office_edit.busy");
      const state = controller.getState();
      const selection = readSelection();
      if (!speechReady || !canDocumentMutate(state, "document_text", previewOnly).enabled || selection?.kind !== "document") {
        throw new Error("office_edit.unsupported");
      }
      if (selection.span.revision !== state.revision) throw new Error("office_edit.changed");
      const current = ++generation;
      captured = { revision: state.revision, contentId: state.content_id, selection: structuredClone(selection) };
      const request: DictationRequest = {
        document_id: state.document_id, expected_revision: state.revision, expected_content_id: state.content_id,
        language, max_seconds: 120,
      };
      busy = true;
      try {
        const result = await startDictation(request);
        if (current !== generation) { await cancelDictation(result.id); return; }
        session = result;
      } finally { busy = false; }
    },
    async stop(): Promise<string> {
      if (!session || busy || applying) throw new Error("office_edit.invalid");
      const current = generation;
      const id = session.id;
      busy = true;
      try {
        const result = await stopDictation(id);
        if (current !== generation) { await releaseTranscript(result.id); throw new Error("office_edit.cancelled"); }
        session = null; transcript = result;
        if (result.partial) throw new Error("office_edit.failed");
        let first = 0;
        let text = "";
        for (;;) {
          const page = await transcriptPage(result.id, first);
          if (current !== generation) throw new Error("office_edit.cancelled");
          if (page.transcript_id !== result.id) throw new Error("office_edit.changed");
          const addition = page.segments.map((segment) => segment.text).join("\n");
          if (text.length + addition.length + 1 > 1024 * 1024) throw new Error("office_edit.too_large");
          text += (text ? "\n" : "") + addition;
          if (page.next_index === null) break;
          if (page.next_index <= first) throw new Error("office_edit.invalid");
          first = page.next_index;
        }
        reviewedText = text;
        return text;
      } catch (error) {
        await clearTranscript();
        throw error;
      } finally { busy = false; }
    },
    async apply(): Promise<void> {
      if (busy || applying || reviewedText === null || !captured || !matches()) throw new Error("office_edit.changed");
      if (!canDocumentMutate(controller.getState(), "document_text").enabled) throw new Error("office_edit.read_only");
      const intent = captured;
      const text = reviewedText;
      if (!text) throw new Error("office_edit.invalid");
      applying = true;
      try {
        await controller.transact({
          transaction_id: crypto.randomUUID(), expected_revision: intent.revision,
          operations: [{ family: "document", operation: { kind: "insert_text", position: intent.selection.span.focus, text } }],
          selection_after: null, label_key: "office.transaction",
        });
        await clearTranscript(); captured = null;
      } finally { applying = false; }
    },
    async cancel(): Promise<void> {
      if (applying) throw new Error("office_edit.busy");
      ++generation;
      const previous = session; session = null; captured = null;
      try { if (previous) await cancelDictation(previous.id); }
      finally { await clearTranscript(); }
    },
  };
}
