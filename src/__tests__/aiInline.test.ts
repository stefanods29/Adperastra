import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobHandle } from "../services/jobs";
import {
  INLINE_PAUSE_MS,
  defaultAiInlineSettings,
  inlineAvailability,
  type InlineCompletion,
  type InlineCompletionRequest,
} from "../editor/aiInlineTypes";
import { InlineScheduler, type InlineContext } from "../editor/aiInlineScheduler";
import {
  acceptInlineCompletion,
  currentGhost,
  dismissInlineCompletion,
  inlineGhostExtension,
  showInlineGhost,
} from "../editor/aiInlineGhost";
import { createInlineCompletionExtension } from "../editor/aiInlineCompletion";

function context(patch: Partial<InlineContext> = {}): InlineContext {
  return {
    document_id: "11111111-1111-4111-8111-111111111111",
    revision: 1,
    content_id: "22222222-2222-4222-8222-222222222222",
    cursor_utf16: 12,
    before: "The meeting ",
    after: "",
    file_type: "text",
    language: "text",
    ...patch,
  };
}

interface PendingRequest {
  request: InlineCompletionRequest;
  resolve: (completion: InlineCompletion) => void;
  cancel: ReturnType<typeof vi.fn>;
}

function fakeClock() {
  let now = 0;
  let nextId = 1;
  let timers: Array<{ id: number; due: number; callback: () => void }> = [];
  return {
    setTimer: (callback: () => void, ms: number) => {
      const id = nextId++;
      timers.push({ id, due: now + ms, callback });
      return id;
    },
    clearTimer: (id: number) => {
      timers = timers.filter((timer) => timer.id !== id);
    },
    advance: (ms: number) => {
      now += ms;
      const due = timers.filter((timer) => timer.due <= now);
      timers = timers.filter((timer) => timer.due > now);
      for (const timer of due) timer.callback();
    },
    pending: () => timers.length,
  };
}

function completionFor(request: InlineCompletionRequest, text: string): InlineCompletion {
  return {
    generation: request.generation,
    revision: request.revision,
    content_id: request.content_id,
    cursor_utf16: request.cursor_utf16,
    text,
    expires_unix: 2_000_000_000,
  };
}

function harness() {
  const clock = fakeClock();
  const pending: PendingRequest[] = [];
  const start = vi.fn((request: InlineCompletionRequest): Promise<JobHandle<InlineCompletion>> => {
    let resolve!: (completion: InlineCompletion) => void;
    let reject!: (reason: unknown) => void;
    const completion = new Promise<InlineCompletion>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const cancel = vi.fn(async () => {
      reject(new Error("ai_inline.cancelled"));
    });
    pending.push({ request, resolve, cancel });
    return Promise.resolve({ id: `job-${request.generation}`, cancel, completion });
  });
  return { clock, pending, start };
}

const flush = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

describe("inline scheduler", () => {
  it("inline_waits_pause", async () => {
    const { clock, pending, start } = harness();
    const scheduler = new InlineScheduler({
      start,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      onAvailable: vi.fn(),
    });
    scheduler.noteInsertion(context());
    clock.advance(749);
    expect(start).not.toHaveBeenCalled();
    clock.advance(1);
    await flush();
    expect(start).toHaveBeenCalledTimes(1);
    expect(INLINE_PAUSE_MS).toBe(750);
    expect(pending).toHaveLength(1);
  });

  it("inline_typing_cancels", async () => {
    const { clock, pending, start } = harness();
    const available = vi.fn();
    const scheduler = new InlineScheduler({
      start,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      onAvailable: available,
    });
    scheduler.noteInsertion(context({ cursor_utf16: 12 }));
    clock.advance(750);
    await flush();
    expect(pending).toHaveLength(1);
    // A new key before the first answer: cancel it and schedule again.
    scheduler.noteInsertion(context({ cursor_utf16: 13, before: "The meeting b" }));
    clock.advance(750);
    await flush();
    expect(pending).toHaveLength(2);
    expect(pending[0].cancel).toHaveBeenCalled();
    // The late first answer is dropped; the current one is shown.
    pending[0].resolve(completionFor(pending[0].request, "old text"));
    await flush();
    expect(available).not.toHaveBeenCalled();
    pending[1].resolve(completionFor(pending[1].request, "begins"));
    await flush();
    expect(available).toHaveBeenCalledTimes(1);
    expect(available.mock.calls[0][0].text).toBe("begins");
  });

  it("inline_ime_no_request", async () => {
    const { clock, pending, start } = harness();
    const scheduler = new InlineScheduler({
      start,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    scheduler.noteCompositionStart();
    scheduler.noteInsertion(context());
    clock.advance(750);
    await flush();
    expect(start).not.toHaveBeenCalled();
    scheduler.noteCompositionEnd();
    scheduler.noteInsertion(context());
    clock.advance(750);
    await flush();
    expect(start).toHaveBeenCalledTimes(1);
    expect(pending).toHaveLength(1);
  });
});

function editor(doc = "The meeting ") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [history(), inlineGhostExtension] }),
    parent: host,
  });
  return view;
}

const GHOST: InlineCompletion = {
  generation: 1,
  revision: 1,
  content_id: "22222222-2222-4222-8222-222222222222",
  cursor_utf16: 12,
  text: "begins at ten.",
  expires_unix: 2_000_000_000,
};

describe("inline ghost", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("inline_tab_one_undo", () => {
    const view = editor();
    showInlineGhost(view, GHOST, 12);
    expect(currentGhost(view)).not.toBeNull();
    expect(acceptInlineCompletion(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("The meeting begins at ten.");
    undo(view);
    expect(view.state.doc.toString()).toBe("The meeting ");
    view.destroy();
  });

  it("inline_escape_clean", () => {
    let documentChanges = 0;
    const listener = EditorView.updateListener.of((update) => {
      if (update.docChanged) documentChanges += 1;
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({
      state: EditorState.create({
        doc: "The meeting ",
        extensions: [history(), inlineGhostExtension, listener],
      }),
      parent: host,
    });
    showInlineGhost(view, GHOST, 12);
    expect(dismissInlineCompletion(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("The meeting ");
    expect(documentChanges).toBe(0);
    expect(currentGhost(view)).toBeNull();
    view.destroy();
  });

  it("inline_stale_cursor", () => {
    const view = editor();
    showInlineGhost(view, GHOST, 12);
    view.dispatch({ selection: { anchor: 5 } });
    expect(acceptInlineCompletion(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("The meeting ");
    view.destroy();
  });

  it("inline_api_selected_disabled", () => {
    const settings = defaultAiInlineSettings();
    settings.inline_enabled = true;
    settings.enabled_types.text = true;
    const availability = inlineAvailability({
      backend: "api",
      settings,
      file_type: "text",
    });
    expect(availability).toEqual({ available: false, reason: "api_backend" });
    const document = {
      id: "11111111-1111-4111-8111-111111111111",
      getState: () => ({
        revision: 1,
        saved_revision: 1,
        content_id: "22222222-2222-4222-8222-222222222222",
        saved_content_id: "22222222-2222-4222-8222-222222222222",
        dirty: false,
        ready: true,
        editing_enabled: true,
        can_save_existing: false,
        can_save_copy: true,
      }),
      subscribe: () => () => undefined,
    };
    const extension = createInlineCompletionExtension({
      document,
      fileType: "text",
      language: "text",
      enabled: true,
      backend: "api",
      start: vi.fn(),
    });
    expect(extension).toEqual([]);
    const view = editor();
    expect(acceptInlineCompletion(view)).toBe(false);
    view.destroy();
  });
});
