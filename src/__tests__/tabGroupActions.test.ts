import { describe, expect, it, vi } from "vitest";
import { EXPLORER_TAB, type TabState, type TabsState } from "../services/tabs";
import { createTabGroup, patchTabGroup, removeTabsFromGroup } from "../services/tabGroups";
import { activateTabInGroup, closeTabGroup } from "../services/tabGroupActions";
import {
  applyGroupHistory,
  recordGroupChange,
  type TabHistoryPort,
} from "../services/tabGroupHistory";
import { UndoStack, type UndoEntryInput } from "../services/undo";
import type { FileAction } from "../services/undo";

function fileTab(id: string): TabState {
  return { id, kind: "file", title: `${id}.txt`, path: `C:\\Demo\\${id}.txt`, handler: "text" };
}

function groupedState(): TabsState {
  const base: TabsState = {
    tabs: [EXPLORER_TAB, fileTab("a"), fileTab("b"), fileTab("c")],
    activeId: EXPLORER_TAB.id,
    history: [EXPLORER_TAB.id],
    groups: [],
  };
  return createTabGroup(base, ["a", "b", "c"], "Work", "purple");
}

describe("tab group actions (step 09b T2)", () => {
  it("remove_member_places_it_after_group", () => {
    const next = removeTabsFromGroup(groupedState(), ["b"]);
    expect(next.tabs.map((tab) => tab.id)).toEqual(["explorer", "a", "c", "b"]);
    expect(next.groups?.[0].tab_ids).toEqual(["a", "c"]);
    expect(next.tabs.find((tab) => tab.id === "b")?.group_id).toBeUndefined();
  });

  it("active_hidden_member_expands", () => {
    let state = groupedState();
    const groupId = state.groups?.[0].id ?? "";
    state = patchTabGroup(state, groupId, { collapsed: true });
    const next = activateTabInGroup(state, "b");
    expect(next.activeId).toBe("b");
    expect(next.groups?.[0].collapsed).toBe(false);
  });

  it("cancel_close_preserves_all_tabs", async () => {
    const state = groupedState();
    const prepareClose = vi.fn(async () => false);
    const result = await closeTabGroup(state, state.groups?.[0].id ?? "", {
      lastViewDocumentIds: () => ["doc-a"],
      prepareClose,
    });
    expect(result).toBeNull();
    expect(prepareClose).toHaveBeenCalledTimes(1);
    expect(state.tabs.map((tab) => tab.id)).toEqual(["explorer", "a", "b", "c"]);
    expect(state.groups).toHaveLength(1);
  });

  it("shared_document_prompted_once", async () => {
    const state = groupedState();
    const prepareClose = vi.fn(async (_ids: readonly string[]) => true);
    const result = await closeTabGroup(state, state.groups?.[0].id ?? "", {
      // Two group tabs share one underlying document.
      lastViewDocumentIds: () => ["doc-shared", "doc-shared", "doc-other"],
      prepareClose,
    });
    expect(prepareClose).toHaveBeenCalledTimes(1);
    expect(prepareClose).toHaveBeenCalledWith(["doc-shared", "doc-other"]);
    expect(result?.tabs.map((tab) => tab.id)).toEqual(["explorer"]);
    expect(result?.groups).toEqual([]);
    expect(result?.activeId).toBe("explorer");
  });

  it("undo_reopens_through_host_without_old_tokens", async () => {
    const before = groupedState();
    const groupId = before.groups?.[0].id ?? "";
    const after = patchTabGroup(before, groupId, { collapsed: true });
    const seen: { before?: unknown; after?: unknown } = {};
    const entry: UndoEntryInput = {
      labelKey: "groups.collapse",
      undo: { type: "uiState", id: "hist-1", reverse: true } as unknown as FileAction,
      redo: { type: "uiState", id: "hist-1", reverse: false } as unknown as FileAction,
    };
    const applied: [string, boolean][] = [];
    const port: TabHistoryPort = {
      record: (beforeData, afterData) => {
        seen.before = beforeData;
        seen.after = afterData;
        return entry;
      },
      apply: async (id, reverse) => {
        applied.push([id, reverse]);
      },
      releaseUnreferenced: () => undefined,
    };
    const recorded = recordGroupChange(before, after, "groups.collapse", undefined, 100, port);
    expect(recorded).toBe(entry);
    // Only bounded descriptors were recorded: no runtime document IDs,
    // grants or file tokens can appear in the recorded session data.
    const serialized = JSON.stringify(seen);
    expect(serialized).not.toContain("document_id");
    expect(serialized).not.toContain("adpfile");
    expect(serialized).not.toContain("token");
    // Applying goes through the 09a host (which reopens through the
    // normal pipeline); the entry itself carries no old token.
    await applyGroupHistory("hist-1", true, port);
    expect(applied).toEqual([["hist-1", true]]);
  });

  it("history_failure_does_not_confirm_cursor", async () => {
    const stack = new UndoStack();
    const entry: UndoEntryInput = {
      labelKey: "groups.collapse",
      undo: { type: "uiState", id: "hist-9", reverse: true } as unknown as FileAction,
      redo: { type: "uiState", id: "hist-9", reverse: false } as unknown as FileAction,
    };
    stack.push(entry);
    const failing: TabHistoryPort = {
      record: () => entry,
      apply: async () => {
        throw new Error("tabs.invalid_state");
      },
      releaseUnreferenced: () => undefined,
    };
    // The executor pattern: confirm the cursor only after success.
    const top = stack.peekUndo();
    expect(top).not.toBeNull();
    await expect(applyGroupHistory("hist-9", true, failing)).rejects.toThrow(
      "tabs.invalid_state",
    );
    expect(stack.canUndo).toBe(true);
    expect(stack.peekUndo()?.id).toBe(top?.id);
  });
});
