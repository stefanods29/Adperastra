import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OfficeController } from "../office/OfficeController";
import { createDocumentDictation } from "../office/document/documentDictationSession";

const speech = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), page: vi.fn(), release: vi.fn() }));
vi.mock("../services/speech", () => ({ startDictation: speech.start, stopDictation: speech.stop,
  cancelDictation: speech.cancel, transcriptPage: speech.page, releaseTranscript: speech.release }));
vi.mock("../office/document/documentController", () => ({
  canDocumentMutate: (_state: unknown, _capability: string, previewOnly: boolean) => ({ enabled: !previewOnly }),
}));

function fixture() {
  const position = { block_id: "00000000-0000-4000-8000-000000000001", offset_utf16: 0 };
  const selection = { kind: "document" as const, page: 1, span: { anchor: position, focus: position, revision: 1 } };
  const state = { revision: 1, content_id: "initial", document_id: "doc" };
  const transact = vi.fn(async () => ({ changed: true }));
  const controller = { getState: () => state, transact } as unknown as OfficeController;
  const dictation = createDocumentDictation(controller, () => selection);
  return { state, selection, transact, dictation };
}
beforeEach(() => {
  vi.clearAllMocks();
  speech.start.mockResolvedValue({ id: "mic" });
  speech.stop.mockResolvedValue({ id: "transcript", partial: false });
  speech.page.mockResolvedValue({ transcript_id: "transcript", segments: [{ text: "Reviewed words" }], next_index: null });
  speech.cancel.mockResolvedValue(undefined); speech.release.mockResolvedValue(undefined);
});
describe("document dictation", () => {
  it("explicit_start_only", async () => {
    const f = fixture(); expect(speech.start).not.toHaveBeenCalled();
    await f.dictation.start("es", true);
    expect(speech.start).toHaveBeenCalledWith({ document_id: "doc", expected_revision: 1,
      expected_content_id: "initial", language: "es", max_seconds: 120 });
    expect(f.transact).not.toHaveBeenCalled(); await f.dictation.cancel();
  });
  it("microphone_denied_no_capture", async () => {
    speech.start.mockRejectedValue(new Error("speech.denied")); const f = fixture();
    await expect(f.dictation.start("en", true)).rejects.toThrow("speech.denied");
    expect(f.transact).not.toHaveBeenCalled(); expect(speech.page).not.toHaveBeenCalled();
  });
  it("stop_requires_review", async () => {
    const f = fixture(); await f.dictation.start("en", true);
    expect(await f.dictation.stop()).toBe("Reviewed words"); expect(f.transact).not.toHaveBeenCalled();
    await f.dictation.apply(); expect(f.transact).toHaveBeenCalledTimes(1);
    expect(f.transact.mock.calls[0]).toEqual([expect.objectContaining({ expected_revision: 1,
      operations: [{ family: "document", operation: { kind: "insert_text", position: f.selection.span.focus, text: "Reviewed words" } }],
    })]);
    expect(speech.release).toHaveBeenCalledWith("transcript");
  });
  it("changed_revision_refused", async () => {
    const f = fixture(); await f.dictation.start("en", true); await f.dictation.stop(); f.state.revision++;
    await expect(f.dictation.apply()).rejects.toThrow("office_edit.changed"); expect(f.transact).not.toHaveBeenCalled();
    await f.dictation.cancel();
  });
  it("dictation_rejects_stale_content_id", async () => {
    const f = fixture(); await f.dictation.start("en", true); await f.dictation.stop(); f.state.content_id = "other";
    await expect(f.dictation.apply()).rejects.toThrow("office_edit.changed"); expect(f.transact).not.toHaveBeenCalled();
    await f.dictation.cancel();
  });
  it("changed selection refused", async () => {
    const f = fixture(); await f.dictation.start("en", true); await f.dictation.stop(); f.selection.page = 2;
    await expect(f.dictation.apply()).rejects.toThrow("office_edit.changed"); await f.dictation.cancel();
  });
  it("cancel_keeps_document", async () => {
    const f = fixture(); await f.dictation.start("en", true); await f.dictation.cancel();
    expect(speech.cancel).toHaveBeenCalledWith("mic"); expect(f.transact).not.toHaveBeenCalled();
    expect(f.state.content_id).toBe("initial");
  });
  it("speech_pack_missing_disabled", async () => {
    const f = fixture(); await expect(f.dictation.start("en", false)).rejects.toThrow("office_edit.unsupported");
    expect(speech.start).not.toHaveBeenCalled();
  });
  it("late microphone acquisition is cancelled", async () => {
    let finish: (value: { id: string }) => void = () => undefined;
    speech.start.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const f = fixture(); const pending = f.dictation.start("en", true); await f.dictation.cancel();
    finish({ id: "late" }); await pending;
    expect(speech.cancel).toHaveBeenCalledWith("late"); expect(f.transact).not.toHaveBeenCalled();
  });
  it("partial transcript is not silently inserted", async () => {
    speech.stop.mockResolvedValue({ id: "partial", partial: true }); const f = fixture();
    await f.dictation.start("en", true); await expect(f.dictation.stop()).rejects.toThrow("office_edit.failed");
    expect(speech.release).toHaveBeenCalledWith("partial"); expect(f.transact).not.toHaveBeenCalled();
  });
});
