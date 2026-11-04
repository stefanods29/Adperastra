import { describe, expect, it, vi } from "vitest";
import { documentViewStateCodec, normalizeDocumentViewState } from "../office/document/documentViewState";
import { canDocumentMutate } from "../office/document/documentController";
import type { OfficeSessionState } from "../office/types";

vi.mock("../office/OfficeController", () => ({ acquireOfficeController: vi.fn(), registerOfficeControllerFactory: vi.fn() }));

describe("document view state", () => {
  it("changingviewscrollneverdirty", () => {
    const state = normalizeDocumentViewState({ viewport: { y_px: 200, zoom_percent: 200 } });
    expect(state.viewport.y_px).toBe(200);
    expect(state).not.toHaveProperty("content_id");
    expect(state).not.toHaveProperty("dirty");
  });
  it("clamps zoom, page and nonfinite scroll and strips contents and runtime handles", () => {
    const decoded = documentViewStateCodec.decode({
      session_id: "secret", token: "private", text: "private text", active_ribbon_tab: "unknown",
      viewport: { zoom_percent: 900, x_px: Infinity, y_px: -4, view_revision: 99 },
      selection: { kind: "document", page: 0, span: {
        revision: 1,
        anchor: { block_id: "00000000-0000-4000-8000-000000000001", offset_utf16: 0, token: "secret" },
        focus: { block_id: "00000000-0000-4000-8000-000000000001", offset_utf16: 2 },
      } },
    });
    expect(decoded?.viewport).toMatchObject({ zoom_percent: 400, x_px: 0, y_px: 0, view_revision: 0 });
    expect(decoded?.selection).toMatchObject({ page: 1 });
    expect(decoded?.active_ribbon_tab).toBe("doc.home");
    expect(JSON.stringify(decoded)).not.toMatch(/secret|private|token|session_id/);
  });
  it("rejects malformed selection and keeps the lower zoom bound", () => {
    expect(normalizeDocumentViewState({ viewport: { zoom_percent: -1 }, selection: { kind: "sheet" } }))
      .toMatchObject({ selection: null, viewport: { zoom_percent: 10 } });
  });
  it("previewOnlynevermutable", () => {
    // Only the fields this UI-level guard consumes; no replacement engine model.
    const state = { ready: true, busy: false, mode: "editing", capabilities: ["document_text"] } as OfficeSessionState;
    expect(canDocumentMutate(state, "document_text", true).enabled).toBe(false);
    expect(canDocumentMutate(state, "document_text", false).enabled).toBe(true);
  });
});
