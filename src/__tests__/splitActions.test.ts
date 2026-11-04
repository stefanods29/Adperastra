import { afterEach, describe, expect, it } from "vitest";
import type { DocumentHandle, DocumentState } from "../documents/types";
import type { SplitLeaf } from "../services/splitViews";
import {
  closeSplit,
  createSplit,
  splitUndoEntry,
  swapSplit,
  type SplitCloseHost,
  type SplitPresentationHost,
} from "../services/splitActions";
import { serializeSplitTab } from "../services/splitViews";
import {
  EXPLORER_TAB,
  type SessionData,
  type SessionTab,
  type TabState,
  type TabsState,
} from "../services/tabs";
import { TabHistory } from "../services/tabHistory";
import { UiHistoryRegistry } from "../services/uiHistory";

const name = (path: string) => path.split("\\").pop() ?? path;

function fileTab(id: string, path: string): TabState {
  return {
    id,
    kind: "file",
    path,
    handler: "text",
    title: name(path),
    source: { kind: "disk", path },
  };
}

function stateWith(tabs: TabState[]): TabsState {
  return { tabs: [EXPLORER_TAB, ...tabs], activeId: tabs[0]?.id ?? EXPLORER_TAB.id, history: [EXPLORER_TAB.id] };
}

function handle(id: string): DocumentHandle {
  const source = { kind: "disk" as const, path: `C:\\${id}.txt` };
  const state: DocumentState = {
    revision: 1,
    saved_revision: 1,
    content_id: id,
    saved_content_id: id,
    dirty: false,
    ready: true,
    editing_enabled: false,
    can_save_existing: false,
    can_save_copy: true,
  };
  return {
    id,
    source,
    info: {
      document_id: id,
      source,
      name: `${id}.txt`,
      ext: "txt",
      mime: "text/plain",
      size: 4,
      modified_unix: 0,
      read_only: false,
      from_internet: false,
      sensitive: false,
      disk_path: source.path,
    },
    getState: () => state,
    subscribe: () => () => undefined,
    readRange: async () => new Uint8Array(),
    captureSnapshot: async () => {
      throw new Error("snapshots are not part of these tests");
    },
    save: async () => false,
    saveCopy: async () => false,
    discard: async () => undefined,
    release: () => undefined,
  };
}

function sessionOf(state: TabsState): SessionData {
  const tabs: SessionTab[] = state.tabs.map((tab) => {
    const base: SessionTab = {
      id: tab.id,
      kind: tab.kind,
      title: tab.title,
      path: tab.path,
      handler: tab.handler,
    };
    const split = serializeSplitTab(tab);
    return split ? { ...base, kind: "split", split: split.split } : base;
  });
  return { schema_version: 2, tabs, active_tab: state.activeId, saved_unix: 1, history: state.history };
}

afterEach(() => {
  UiHistoryRegistry.clear();
});

describe("split actions", () => {
  it("twotabsconsumedoneouter: two tabs become one outer tab and no document is closed", () => {
    const before = stateWith([
      fileTab("view-a", "C:\\a.txt"),
      fileTab("view-b", "C:\\b.txt"),
      fileTab("view-c", "C:\\c.txt"),
    ]);
    const outcome = createSplit(before, "view-a", "view-b", "horizontal");

    expect(outcome.before).toBe(before);
    expect(outcome.state.tabs).toHaveLength(3);
    const outer = outcome.state.tabs[1];
    expect(outer.kind).toBe("split");
    expect(outcome.state.activeId).toBe(outer.id);
    expect(outcome.state.tabs[2].id).toBe("view-c");
    expect(outcome.state.tabs.filter((tab) => tab.kind === "split")).toHaveLength(1);
    expect(before.tabs).toHaveLength(4);
  });

  it("stableviewIDs/sharedmodelretainedacrosspresentationremount: leaves keep their view ids while the view remounts", () => {
    const calls: string[] = [];
    const captures: Record<string, unknown> = { "view-a": { scroll_top: 12 }, "view-b": { scroll_top: 34 } };
    const host: SplitPresentationHost = {
      captureViewState: (viewId) => {
        calls.push(`capture:${viewId}`);
        const captured = captures[viewId] as SplitLeaf["view"];
        return captured ?? null;
      },
      restoreViewState: (viewId, state) => {
        calls.push(`restore:${viewId}:${JSON.stringify(state)}`);
      },
    };
    const before = stateWith([fileTab("view-a", "C:\\a.txt"), fileTab("view-b", "C:\\b.txt")]);
    const outcome = createSplit(before, "view-a", "view-b", "vertical", host);

    expect(calls).toEqual([
      "capture:view-a",
      "capture:view-b",
      'restore:view-a:{"scroll_top":12}',
      'restore:view-b:{"scroll_top":34}',
    ]);
    expect(outcome.viewStates).toEqual({ "view-a": { scroll_top: 12 }, "view-b": { scroll_top: 34 } });
    const outer = outcome.state.tabs[1];
    expect(outer.kind).toBe("split");
    expect(outer.kind === "split" ? outer.split!.first.view_id : "").toBe("view-a");
    expect(outer.kind === "split" ? outer.split!.second.view_id : "").toBe("view-b");

    const swapped = swapSplit(outcome.state, outer.id, host);
    expect(calls.slice(4)).toEqual([
      "capture:view-a",
      "capture:view-b",
      'restore:view-a:{"scroll_top":12}',
      'restore:view-b:{"scroll_top":34}',
    ]);
    expect(swapped.state.tabs[1].kind === "split" ? swapped.state.tabs[1].split!.second.view_id : "").toBe("view-a");
  });

  it("swapactivefollowscontent: swapping keeps the same document active in its new position", () => {
    const state = createSplit(
      stateWith([fileTab("view-a", "C:\\a.txt"), fileTab("view-b", "C:\\b.txt")]),
      "view-a",
      "view-b",
      "vertical",
    ).state;
    const outerId = state.activeId;
    const swapped = swapSplit(state, outerId).state;
    const outer = swapped.tabs[1];
    expect(outer.kind === "split" ? outer.split!.active_side : "").toBe("second");
    expect(outer.kind === "split" ? outer.split!.first.view_id : "").toBe("view-b");
    expect(outer.kind === "split" ? outer.split!.second.view_id : "").toBe("view-a");
    expect(swapped.activeId).toBe(outerId);
  });

  it("closelastsavedcancelpreservesboth: a cancelled dirty decision closes nothing", async () => {
    const state = createSplit(
      stateWith([fileTab("view-a", "C:\\a.txt"), fileTab("view-b", "C:\\b.txt")]),
      "view-a",
      "view-b",
      "vertical",
    ).state;
    const outerId = state.activeId;
    const documents: Record<string, DocumentHandle> = { "view-a": handle("doc-a"), "view-b": handle("doc-b") };
    const released: string[] = [];
    const prompts: string[][] = [];
    const cancelling: SplitCloseHost = {
      documentsFor: (ids) => ids.map((id) => documents[id]),
      prepareClose: async (handles) => {
        prompts.push(handles.map((entry) => entry.id));
        return false;
      },
      releaseView: (id) => released.push(id),
    };

    const cancelled = await closeSplit(state, outerId, "first", cancelling);
    expect(cancelled).toBeNull();
    expect(prompts).toEqual([["doc-a"]]);
    expect(released).toEqual([]);
    expect(state.tabs.find((tab) => tab.id === outerId)?.kind).toBe("split");

    const approving: SplitCloseHost = { ...cancelling, prepareClose: async () => true };
    const closed = await closeSplit(state, outerId, "first", approving);
    expect(closed).not.toBeNull();
    expect(released).toEqual(["view-a"]);
    expect(closed?.state.tabs.find((tab) => tab.id === outerId)?.kind).toBe("file");
    expect(closed?.before).toBe(state);
  });

  it("survivorsameouterID: the promoted survivor keeps the outer id and its view", async () => {
    const state = createSplit(
      stateWith([fileTab("view-a", "C:\\a.txt"), fileTab("view-b", "C:\\b.txt")]),
      "view-a",
      "view-b",
      "vertical",
    ).state;
    const outerId = state.activeId;
    const documents: Record<string, DocumentHandle> = { "view-a": handle("doc-a"), "view-b": handle("doc-b") };
    const host: SplitCloseHost = {
      documentsFor: (ids) => ids.map((id) => documents[id]),
      prepareClose: async () => true,
      releaseView: () => undefined,
    };

    const closed = await closeSplit(state, outerId, "first", host);
    const promoted = closed?.state.tabs.find((tab) => tab.id === outerId);
    expect(promoted).toBeDefined();
    expect(promoted?.id).toBe(outerId);
    expect(promoted?.kind).toBe("file");
    expect(promoted?.content_view_id).toBe("view-b");
    expect(promoted?.path).toBe("C:\\b.txt");
    expect(promoted?.split).toBeUndefined();
    expect(closed?.state.activeId).toBe(outerId);
  });

  it("oneUndo: a structural action records exactly one tab-history entry", async () => {
    const applied: unknown[] = [];
    UiHistoryRegistry.registerAdapter("tabs", {
      validate: () => true,
      apply: async (state) => {
        applied.push(state);
      },
    });
    const before = stateWith([fileTab("view-a", "C:\\a.txt"), fileTab("view-b", "C:\\b.txt")]);
    const outcome = createSplit(before, "view-a", "view-b", "horizontal");
    const entry = splitUndoEntry(outcome, "splits.open", sessionOf);

    expect(entry.labelKey).toBe("splits.open");
    expect(entry.undo.type).toBe("uiState");
    expect(entry.redo.type).toBe("uiState");
    if (entry.undo.type !== "uiState" || entry.redo.type !== "uiState") return;
    expect(entry.undo.id).toBe(entry.redo.id);

    await TabHistory.apply(entry.undo.id, true);
    expect(applied).toHaveLength(1);
    const restored = applied[0] as SessionData;
    expect(restored.tabs.map((tab) => tab.kind)).toEqual(["explorer", "file", "file"]);
    // The permanent Explorer tab has no path by design (09a); both file tabs keep theirs.
    expect(restored.tabs.filter((tab) => tab.kind === "file").map((tab) => tab.path)).toEqual([
      "C:\\a.txt",
      "C:\\b.txt",
    ]);
  });
});
