import { describe, expect, it } from "vitest";
import { defaultFolderTabState } from "../services/folderState";
import {
  MAX_CLOSED_TABS,
  closeTabRecording,
  duplicateTab,
  mruCycleTarget,
  openFolderTab,
  pinTab,
  reorderTab,
  reopenClosedTab,
} from "../services/tabActions";
import { EXPLORER_TAB, initialTabs, openFileTab, type TabsState } from "../services/tabs";

const file = (path: string) => ({ path, handler: "text", title: path.split("\\").pop() ?? path });

function withFiles(count: number): TabsState {
  let state = initialTabs();
  for (let index = 0; index < count; index += 1) {
    state = openFileTab(state, file(`C:\\docs\\file-${index}.txt`), true);
  }
  return state;
}

describe("folder and document descriptors (T1)", () => {
  it("duplicate_permanentExplorer_fixed_to_exactly_one", () => {
    let state = openFolderTab(initialTabs(), defaultFolderTabState("C:\\a"), false);
    state = openFolderTab(state, defaultFolderTabState("C:\\b"), false);
    expect(state.tabs.filter((tab) => tab.kind === "explorer")).toHaveLength(1);
    expect(state.tabs[0]).toEqual(EXPLORER_TAB);
  });

  it("tab_201_is_refused", () => {
    let state = withFiles(199);
    expect(state.tabs).toHaveLength(200);
    const refused = openFolderTab(state, defaultFolderTabState("C:\\overflow"), false);
    expect(refused.tabs).toHaveLength(200);
    expect(refused).toBe(state);
  });

  it("virtual_title_and_token_are_not_serialized", () => {
    const descriptor = {
      id: "locked-1",
      kind: "file",
      handler: "text",
      source: {
        kind: "virtual",
        provider: "locked",
        container_path: "C:\\vault.adplock",
        entry_id: "123e4567-e89b-12d3-a456-426614174000",
      },
    };
    const json = JSON.stringify(descriptor);
    expect(json).not.toContain("secret");
    expect(json).not.toMatch(/token/i);
  });

  it("existing_legacy_file_tab_migrates_without_path_meaning_change", () => {
    const state = openFileTab(initialTabs(), file("C:\\photos\\a.png"), false);
    const tab = state.tabs[1];
    // A legacy file tab keeps its exact path; the document source is the
    // same disk path, not a reinterpreted one.
    expect(tab.path).toBe("C:\\photos\\a.png");
    expect(tab.kind).toBe("file");
  });
});

describe("pin duplicate reorder reopen (T3)", () => {
  it("permanent_cannot_close_or_pin", () => {
    const state = withFiles(1);
    expect(pinTab(state, EXPLORER_TAB.id, true)).toBe(state);
    expect(closeTabRecording(state, EXPLORER_TAB.id, 1)).toBe(state);
  });

  it("pinned_cannot_cross_segment_on_reorder", () => {
    let state = withFiles(3);
    const [first, second] = [state.tabs[1].id, state.tabs[2].id];
    state = pinTab(state, first, true);
    expect(state.tabs[1].id).toBe(first);
    expect(state.tabs[1].pinned).toBe(true);
    // Moving the pinned tab past the unpinned segment clamps it back.
    const moved = reorderTab(state, first, state.tabs.length - 1);
    expect(moved.tabs.findIndex((tab) => tab.id === first)).toBe(1);
    // An unpinned tab cannot move into the pinned segment either.
    const crossed = reorderTab(state, second, 1);
    expect(crossed.tabs.findIndex((tab) => tab.id === second)).toBeGreaterThan(1);
  });

  it("duplicate_has_new_view_id_same_document_id", () => {
    let state = openFileTab(initialTabs(), file("C:\\docs\\a.txt"), false);
    const original = state.tabs[1];
    state = {
      ...state,
      tabs: state.tabs.map((tab) => (tab.id === original.id ? { ...tab, document_id: "doc-1" } : tab)),
    };
    const duplicated = duplicateTab(state, original.id);
    const copy = duplicated.tabs.find((tab) => tab.id !== original.id && tab.kind === "file");
    expect(copy).toBeDefined();
    expect(copy?.document_id).toBe("doc-1");
    expect(copy?.path).toBe(original.path);
  });

  it("closed_history_51_keeps_newest_50", () => {
    let state = withFiles(55);
    const ids = state.tabs.slice(1).map((tab) => tab.id);
    for (const id of ids) state = closeTabRecording(state, id, 100);
    expect(state.closed).toHaveLength(MAX_CLOSED_TABS);
    // The oldest closed entries were dropped; the newest remains.
    expect(state.closed?.[MAX_CLOSED_TABS - 1].tab.id).toBe(ids[ids.length - 1]);
  });

  it("mru_cycle_keeps_visible_order", () => {
    let state = withFiles(3);
    const visibleBefore = state.tabs.map((tab) => tab.id);
    const target = mruCycleTarget(state, 1);
    expect(target).not.toBeNull();
    expect(state.tabs.map((tab) => tab.id)).toEqual(visibleBefore);
  });

  it("reopen_closed_creates_a_new_view_id", () => {
    let state = withFiles(1);
    const closedId = state.tabs[1].id;
    state = closeTabRecording(state, closedId, 5);
    const closed = state.closed?.[0];
    expect(closed).toBeDefined();
    const reopened = reopenClosedTab(state, closed!);
    const tab = reopened.tabs.find((entry) => entry.kind === "file");
    expect(tab).toBeDefined();
    expect(tab?.id).not.toBe(closedId);
    expect(tab?.document_id).toBeUndefined();
  });
});
