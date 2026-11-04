import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentHandle, DocumentState } from "../documents/types";
import { createDocumentAutosave } from "../office/document/documentAutosave";

function fixture() {
  let state = { revision: 1, saved_revision: 1, content_id: "a", saved_content_id: "a", dirty: false,
    ready: true, editing_enabled: true, can_save_existing: true, can_save_copy: true } as DocumentState;
  let listener: (next: DocumentState) => void = () => undefined;
  const save = vi.fn(async () => true);
  const handle = { getState: () => state, save,
    subscribe: (callback: (next: DocumentState) => void) => { listener = callback; return () => { listener = () => undefined; }; },
  } as unknown as DocumentHandle;
  return { handle, save, state: () => state, edit(content: string) {
    state = { ...state, revision: state.revision + 1, content_id: content, dirty: true }; listener(state);
  } };
}
afterEach(() => vi.useRealTimers());
describe("document autosave", () => {
  it("off by default and debounces two seconds", async () => {
    vi.useFakeTimers(); const f = fixture();
    const auto = createDocumentAutosave(f.handle, vi.fn());
    f.edit("b"); await vi.advanceTimersByTimeAsync(3000); expect(f.save).not.toHaveBeenCalled();
    auto.setEnabled(true); await vi.advanceTimersByTimeAsync(1999); expect(f.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(f.save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10000); expect(f.save).toHaveBeenCalledTimes(1);
    auto.dispose();
  });
  it("document_autosave_failure_keeps_dirty_state", async () => {
    vi.useFakeTimers(); const f = fixture(); const failure = vi.fn();
    f.save.mockRejectedValue(new Error("office_edit.failed"));
    const auto = createDocumentAutosave(f.handle, failure); auto.setEnabled(true); f.edit("b");
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.state().dirty).toBe(true); expect(failure).toHaveBeenCalledTimes(1);
    f.edit("c"); await vi.advanceTimersByTimeAsync(20000); expect(f.save).toHaveBeenCalledTimes(1);
    auto.retry(); await vi.advanceTimersByTimeAsync(1); expect(f.save).toHaveBeenCalledTimes(2); auto.dispose();
  });
  it("saveR_editRplus1_remains_dirty", async () => {
    vi.useFakeTimers(); const f = fixture(); let finish: (saved: boolean) => void = () => undefined;
    f.save.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const auto = createDocumentAutosave(f.handle, vi.fn()); auto.setEnabled(true); f.edit("R");
    await vi.advanceTimersByTimeAsync(2000); f.edit("R+1"); finish(true);
    await vi.advanceTimersByTimeAsync(1999); expect(f.save).toHaveBeenCalledTimes(1);
    expect(f.state()).toMatchObject({ content_id: "R+1", dirty: true });
    await vi.advanceTimersByTimeAsync(1); expect(f.save).toHaveBeenCalledTimes(2); auto.dispose();
  });
  it("disposal cancels pending save", async () => {
    vi.useFakeTimers(); const f = fixture(); const auto = createDocumentAutosave(f.handle, vi.fn());
    auto.setEnabled(true); f.edit("b"); auto.dispose(); await vi.advanceTimersByTimeAsync(4000);
    expect(f.save).not.toHaveBeenCalled();
  });
});
