import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../services/settings";
import {
  discardOfficeSaved, officeFormatting, officeItems, officeState,
} from "../services/officeEdit";
import type {
  OfficeDiscardSavedResult, OfficeProposalDiff, OfficeSessionState,
} from "../office/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../services/settings", () => ({ isTauriRuntime: vi.fn() }));

const sessionId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const contentId = "33333333-3333-4333-8333-333333333333";
const sheetId = "44444444-4444-4444-8444-444444444444";

const state: OfficeSessionState = {
  session_id: sessionId,
  document_id: documentId,
  family: "document",
  format: "docx",
  revision: 2,
  saved_revision: 1,
  content_id: contentId,
  saved_content_id: "55555555-5555-4555-8555-555555555555",
  ready: true,
  mode: "editing",
  dirty: true,
  can_undo: true,
  can_redo: false,
  capabilities: ["document_text"],
  selection: null,
  compatibility: {
    format: "docx", entries: [], next_cursor: null,
    can_preserve_unknown: true, blocks_save: false,
  },
  page_count: 1, sheet_count: 0, slide_count: 0, busy: false, status_key: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isTauriRuntime).mockReturnValue(true);
});

describe("Office base command names", () => {
  it("state_items_and_formatting_use_frozen_commands", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(state);
    await officeState(sessionId);
    expect(invoke).toHaveBeenLastCalledWith("office_edit_state", { sessionId });

    vi.mocked(invoke).mockResolvedValueOnce({
      kind: "slides", items: [], next_cursor: null, complete: true, revision: 2,
    });
    await officeItems(sessionId, "slides");
    expect(invoke).toHaveBeenLastCalledWith("office_edit_items", {
      sessionId, kind: "slides", cursor: undefined,
    });

    vi.mocked(invoke).mockResolvedValueOnce({ selection: { kind: "sheet", ranges: [], active: {} } });
    await officeFormatting(sessionId, {
      kind: "sheet",
      ranges: [{ sheet_id: sheetId, first_row: 0, last_row: 0, first_column: 0, last_column: 0 }],
      active: { sheet_id: sheetId, row: 0, column: 0 },
    });
    expect(invoke).toHaveBeenLastCalledWith("office_edit_formatting", {
      sessionId,
      selection: {
        kind: "sheet",
        ranges: [{ sheet_id: sheetId, first_row: 0, last_row: 0, first_column: 0, last_column: 0 }],
        active: { sheet_id: sheetId, row: 0, column: 0 },
      },
    });
  });

  it("discard_uses_one_typed_atomic_command", async () => {
    const result: OfficeDiscardSavedResult = {
      state: {
        ...state,
        content_id: state.saved_content_id,
        dirty: false,
        can_undo: false,
        can_redo: false,
      },
      changed: true,
    };
    vi.mocked(invoke).mockResolvedValueOnce(result);
    await expect(
      discardOfficeSaved(sessionId, state.saved_content_id, 2, contentId),
    ).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("office_edit_discard_saved", {
      sessionId,
      savedContentId: state.saved_content_id,
      expectedRevision: 2,
      expectedContentId: contentId,
    });
  });

  it("missing_engine_refuses_before_invoke", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(false);
    await expect(discardOfficeSaved(sessionId, contentId, 2, contentId))
      .rejects.toThrow("office_edit.engine_missing");
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("Office proposal diff wire shape", () => {
  it("chart_tag_and_chart_kind_do_not_collide", () => {
    const diff = {
      kind: "chart",
      chart_id: "66666666-6666-4666-8666-666666666666",
      source: {
        sheet_id: sheetId,
        first_row: 0,
        last_row: 4,
        first_column: 0,
        last_column: 1,
      },
      chart_kind: "column",
    } satisfies OfficeProposalDiff;
    expect(diff.kind).toBe("chart");
    expect(diff.chart_kind).toBe("column");
    expect(Object.keys(diff).sort()).toEqual(
      ["chart_id", "chart_kind", "kind", "source"],
    );
  });
});
