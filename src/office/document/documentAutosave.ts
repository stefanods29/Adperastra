import type { DocumentHandle } from "../../documents/types";

/** One instance is installed by the document owner, never by each mounted view. */
export function createDocumentAutosave(document: DocumentHandle, onFailure: () => void) {
  let enabled = false;
  let disposed = false;
  let failed = false;
  let saving = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let due = 0;
  let lastContent = document.getState().content_id;
  const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const permitted = () => {
    const state = document.getState();
    return !disposed && enabled && !failed && state.ready && state.dirty && state.editing_enabled && state.can_save_existing;
  };
  const schedule = () => {
    clear();
    if (permitted() && !saving) timer = setTimeout(() => void save(), Math.max(0, due - Date.now()));
  };
  const save = async () => {
    clear();
    if (!permitted() || saving) return;
    const dispatchedContent = document.getState().content_id;
    saving = true;
    // DocumentHandle.save owns capture, content identity, version hook and serialization
    // with manual saves. Do not call markClean or compare mutable disk bytes here.
    try {
      if (!await document.save()) throw new Error("office_edit.failed");
    } catch {
      failed = true;
      if (!disposed) onFailure();
    } finally {
      saving = false;
      // Only a new edit schedules a follow-up. A false/failed save never busy-loops.
      if (document.getState().content_id !== dispatchedContent) schedule();
    }
  };
  const unsubscribe = document.subscribe((state) => {
    if (state.content_id !== lastContent) {
      lastContent = state.content_id;
      due = Date.now() + 2000;
    }
    schedule();
  });
  return {
    setEnabled(value: boolean) { enabled = value; due = Date.now() + 2000; schedule(); },
    retry() { if (!disposed && !saving) { failed = false; due = Date.now(); schedule(); } },
    dispose() { disposed = true; clear(); unsubscribe(); },
  };
}
