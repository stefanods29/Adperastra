import { act, type RefObject } from "react";
import { createRoot } from "react-dom/client";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import type { ExportHandle } from "../handlers/types";
import { useTextExport } from "../convert/useTextExport";

const calls = vi.hoisted(() => ({ models: [] as unknown[] }));
vi.mock("../convert/exportCapture", () => ({
  createFileExportCapture: vi.fn((_token: string, read: () => unknown) => ({
    capture: async () => { calls.models.push(read()); return {}; },
    close: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  })),
}));

describe("current text export binding", () => {
  it("reads unsaved model bytes at capture time and unregisters on unmount", async () => {
    const view = { current: { state: EditorState.create({ doc: "saved" }) } };
    let registered: ExportHandle | null = null;
    function Host() {
      useTextExport("http://adpfile.localhost/granted/note.txt", view as RefObject<EditorView | null>, true,
        (handle) => { registered = handle; });
      return null;
    }
    const element = document.createElement("div");
    const root = createRoot(element);
    await act(async () => root.render(<Host />));
    try {
      expect(registered).not.toBeNull();
      view.current.state = EditorState.create({ doc: "unsaved revision one" });
      await registered!.capture();
      view.current.state = EditorState.create({ doc: "unsaved revision two" });
      await registered!.capture();
      expect(calls.models).toEqual([
        expect.objectContaining({ revision: 1, bytes: new TextEncoder().encode("unsaved revision one") }),
        expect.objectContaining({ revision: 2, bytes: new TextEncoder().encode("unsaved revision two") }),
      ]);
    } finally {
      await act(async () => root.unmount());
    }
    expect(registered).toBeNull();
  });
});
