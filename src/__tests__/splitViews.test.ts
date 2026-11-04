import { afterEach, describe, expect, it } from "vitest";
import { defaultFolderTabState } from "../services/folderState";
import {
  MAX_SPLIT_TAB_TITLE_CHARS,
  SPLIT_RATIO_MAX,
  SPLIT_RATIO_MIN,
  closeSplitSide,
  createSplitTab,
  isSplitTab,
  leafFromTab,
  recoverSerializedSplit,
  restoreSplit,
  serializeSplit,
  serializeSplitTab,
  setSplitRatio,
  splitLeafOf,
  splitTabTitle,
  swapSplitSides,
  validateSavedSplitDescriptor,
  validateSplitLeaf,
  validateSplitState,
  viewIdentityOf,
  type SplitLeaf,
  type SplitState,
} from "../services/splitViews";
import { EXPLORER_TAB, type TabState, type TabsState } from "../services/tabs";
import { clearViewStateCodecs, registerViewStateCodec } from "../services/viewState";

const name = (path: string) => path.split("\\").pop() ?? path;

function leaf(viewId: string, path: string, extra: Partial<SplitLeaf> = {}): SplitLeaf {
  return {
    view_id: viewId,
    kind: "file",
    source: { kind: "disk", path },
    handler: "text",
    title: name(path),
    ...extra,
  };
}

function splitState(overrides: Partial<SplitState> = {}): SplitState {
  return {
    first: leaf("view-a", "C:\\a.txt"),
    second: leaf("view-b", "C:\\b.txt"),
    direction: "vertical",
    ratio: 0.5,
    active_side: "first",
    sync_scroll: false,
    ...overrides,
  };
}

function fileTab(id: string, path: string, extra: Partial<TabState> = {}): TabState {
  return {
    id,
    kind: "file",
    path,
    handler: "text",
    title: name(path),
    source: { kind: "disk", path },
    ...extra,
  };
}

function folderTab(id: string, path: string): TabState {
  return {
    id,
    kind: "folder",
    path,
    title: name(path),
    folder: defaultFolderTabState(path),
  };
}

function stateWith(tabs: TabState[], activeId = tabs[tabs.length - 1]?.id ?? EXPLORER_TAB.id): TabsState {
  return { tabs: [EXPLORER_TAB, ...tabs], activeId, history: [EXPLORER_TAB.id, activeId] };
}

function splitTab(id: string, state: SplitState = splitState()): TabState {
  return { id, kind: "split", title: splitTabTitle(state), split: state };
}

afterEach(() => clearViewStateCodecs());

describe("split views", () => {
  it("nestedsplitrefused: a split inside a split is refused with the two-side limit", () => {
    const inner = splitState({ first: leaf("one", "C:\\one.txt"), second: leaf("two", "C:\\two.txt") });
    const state = stateWith([splitTab("split-outer", inner), fileTab("other", "C:\\other.txt")]);

    expect(() => createSplitTab(state, "split-outer", "other", "vertical")).toThrowError("splits.limit");

    // A leaf descriptor can never smuggle another split in.
    expect(validateSplitLeaf({ ...leaf("x", "C:\\x.txt"), split: inner })).toBeNull();
    expect(validateSplitLeaf({ ...leaf("x", "C:\\x.txt"), children: [] })).toBeNull();
    expect(validateSplitLeaf({ ...leaf("x", "C:\\x.txt"), kind: "split" })).toBeNull();
    const nested = splitState();
    (nested.first as unknown as Record<string, unknown>).split = inner;
    expect(validateSplitState(nested)).toBeNull();
  });

  it("legacytabunchanged: a normal tab keeps its shape and identity", () => {
    const tab = fileTab("file-1", "C:\\Docs\\report.txt");
    const state = stateWith([tab]);

    expect(isSplitTab(tab)).toBe(false);
    expect(serializeSplitTab(tab)).toBeNull();
    expect(viewIdentityOf(tab)).toBe("file-1");
    expect(splitLeafOf(tab, "first")).toBeNull();

    const asLeaf = leafFromTab(tab);
    expect(asLeaf).toEqual({
      view_id: "file-1",
      kind: "file",
      source: { kind: "disk", path: "C:\\Docs\\report.txt" },
      handler: "text",
      title: "report.txt",
    });

    // Splitting two tabs consumes them into one outer tab; the leaves keep
    // the consumed tab ids, so no document reference changes hands.
    const next = createSplitTab(
      stateWith([fileTab("file-1", "C:\\Docs\\report.txt"), folderTab("folder-1", "C:\\Work")]),
      "file-1",
      "folder-1",
      "vertical",
    );
    const outer = next.tabs[1];
    expect(next.tabs).toHaveLength(2);
    expect(outer.kind).toBe("split");
    expect(isSplitTab(outer)).toBe(true);
    if (!isSplitTab(outer)) return;
    expect(outer.split.first.view_id).toBe("file-1");
    expect(outer.split.second.view_id).toBe("folder-1");
    expect(outer.split.first.title).toBe("report.txt");
    expect(outer.split.second.folder?.path).toBe("C:\\Work");
    expect(next.activeId).toBe(outer.id);

    // Restoring never mutates the descriptor.
    const descriptor = serializeSplit(splitState());
    expect(descriptor).not.toBeNull();
    if (!descriptor) return;
    const snapshot = JSON.parse(JSON.stringify(descriptor));
    const restored = restoreSplit(descriptor);
    expect(descriptor).toEqual(snapshot);
    expect(restored.first.view_id).not.toBe(descriptor.split.first.view_id);
    expect(restored.second.view_id).not.toBe(descriptor.split.second.view_id);
    expect(restored.first.source).toEqual(descriptor.split.first.source);
  });

  it("virtualtitleomitted: a locked leaf never carries a plain title or view", () => {
    const locked: SplitLeaf = {
      view_id: "view-locked",
      kind: "file",
      source: {
        kind: "virtual",
        provider: "locked",
        container_path: "C:\\Vault.adplock",
        entry_id: "6f0b9f6e-0f4e-4b1b-9f1a-2f1c5a5a8c11",
      },
      handler: "text",
      title: "secret.txt",
      view: { scroll_top: 40 },
    };
    expect(validateSplitLeaf(locked)).toBeNull();

    // From a live tab, the title and view are simply not copied.
    const tab = fileTab("file-locked", "C:\\Vault.adplock", {
      source: locked.source,
      title: "secret.txt",
      view: { scroll_top: 40 },
    });
    const asLeaf = leafFromTab(tab);
    expect(asLeaf.title).toBeUndefined();
    expect(asLeaf.view).toBeUndefined();
    expect(asLeaf.source).toEqual(locked.source);

    // Serializing a split never writes the plain name either.
    const state = splitState({ first: { ...leaf("view-locked", "C:\\a.txt"), source: locked.source, title: undefined } });
    const saved = serializeSplit(state);
    expect(saved).not.toBeNull();
    expect(saved?.split.first.title).toBeUndefined();
    expect(saved?.split.first.view).toBeUndefined();
    expect(JSON.stringify(saved)).not.toContain("secret.txt");
  });

  it("ratioNaNrefused: NaN, Infinity and out-of-range ratios are refused", () => {
    const state = stateWith([
      splitTab("split-1", splitState({ first: leaf("a", "C:\\a.txt"), second: leaf("b", "C:\\b.txt") })),
    ]);
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0.1, 0.9]) {
      expect(() => setSplitRatio(state, "split-1", value)).toThrowError("splits.invalid");
      expect(validateSplitState(splitState({ ratio: value }))).toBeNull();
    }
    expect(setSplitRatio(state, "split-1", SPLIT_RATIO_MIN).tabs[1].split?.ratio).toBe(0.2);
    expect(setSplitRatio(state, "split-1", SPLIT_RATIO_MAX).tabs[1].split?.ratio).toBe(0.8);
  });

  it("missingonesidedoesnotdropother: one broken side keeps the other one usable", () => {
    const valid = leaf("view-good", "C:\\good.txt");
    const broken = { view_id: "view-bad", kind: "file", handler: "text" };

    const recovered = recoverSerializedSplit({ first: broken, second: valid });
    expect(recovered.state).toBeNull();
    expect(recovered.survivor).not.toBeNull();
    expect(recovered.survivor?.view_id).not.toBe("view-good");
    expect(recovered.survivor?.source).toEqual(valid.source);

    // Both sides survive when only the handler is unknown: the tab opens
    // with its own placeholder instead of losing the whole split.
    const withUnknownHandler = recoverSerializedSplit(
      { first: valid, second: { ...leaf("view-two", "C:\\two.xyz"), handler: "nope" } },
      ["text"],
    );
    expect(withUnknownHandler.survivor).toBeNull();
    expect(withUnknownHandler.state).not.toBeNull();
    expect(withUnknownHandler.state?.first.source).toEqual(valid.source);
    expect(withUnknownHandler.state?.second.missing?.reason).toBe("handler_missing");

    expect(recoverSerializedSplit({ first: broken, second: { kind: "file" } })).toEqual({
      state: null,
      survivor: null,
    });
  });

  it("swaps sides, keeps the active document, and promotes the survivor under the same outer id", () => {
    const first = fileTab("view-a", "C:\\a.txt");
    const second = folderTab("view-b", "C:\\b");
    let state = createSplitTab(stateWith([first, second]), "view-a", "view-b", "vertical");
    const outerId = state.activeId;

    state = swapSplitSides(state, outerId);
    const split = state.tabs.find((tab) => tab.id === outerId)?.split;
    expect(split?.first.view_id).toBe("view-b");
    expect(split?.second.view_id).toBe("view-a");
    expect(split?.active_side).toBe("second");
    expect(split?.ratio).toBe(0.5);

    const promoted = closeSplitSide(state, outerId, "first");
    const survivor = promoted.tabs.find((tab) => tab.id === outerId);
    expect(survivor?.id).toBe(outerId);
    expect(survivor?.kind).toBe("file");
    expect(survivor?.content_view_id).toBe("view-a");
    expect(survivor?.path).toBe("C:\\a.txt");
    expect(survivor?.split).toBeUndefined();
    expect(viewIdentityOf(survivor as TabState)).toBe("view-a");
  });

  it("viewstatecrossesthecodecboundary: a stored leaf keeps only its encoded view", () => {
    registerViewStateCodec("split-test", {
      version: 3,
      encode: (state) => {
        const value = state as { scroll_top?: unknown } | null;
        const top = value?.scroll_top;
        return { scroll_top: typeof top === "number" ? top : 0 };
      },
      decode: (state) => {
        const value = state as { scroll_top?: unknown } | null;
        const top = value?.scroll_top;
        return { scroll_top: typeof top === "number" ? top : 0 };
      },
    });
    const state = splitState({
      first: leaf("view-a", "C:\\a.txt", {
        handler: "split-test",
        view: { scroll_top: 12, cursor_line: 9, live_only: true },
      }),
    });
    const saved = serializeSplit(state);
    expect(saved).not.toBeNull();
    if (!saved) return;
    expect(saved.split.first.view).toEqual({ scroll_top: 12 });
    expect(saved.split.first.view_version).toBe(3);
    expect(restoreSplit(saved).first.view).toEqual({ scroll_top: 12 });

    // No registered codec: the live state is omitted, never written raw.
    clearViewStateCodecs();
    const unsaved = serializeSplit(state);
    expect(unsaved?.split.first.view).toBeUndefined();
    expect(unsaved?.split.first.view_version).toBeUndefined();
  });

  it("outertitlestaysinsidethesessioncap: both side names survive the 255-character cap", () => {
    const title = splitTabTitle(
      splitState({
        first: leaf("view-a", "C:\\a.txt", { title: "a".repeat(512) }),
        second: leaf("view-b", "C:\\b.txt", { title: "b".repeat(512) }),
      }),
    );
    expect([...title].length).toBe(MAX_SPLIT_TAB_TITLE_CHARS);
    expect(title.startsWith("a")).toBe(true);
    expect(title.endsWith("b")).toBe(true);
    expect(title).toContain(" / ");
  });

  it("viewidlimitcountscharacters: the 128-character cap counts code points, not UTF-16 units", () => {
    const base = {
      kind: "file",
      source: { kind: "disk", path: "C:\\a.txt" },
      handler: "text",
    };
    expect(validateSplitLeaf({ ...base, view_id: "😀".repeat(128) })).not.toBeNull();
    expect(validateSplitLeaf({ ...base, view_id: "😀".repeat(129) })).toBeNull();
  });

  it("folderleafkeepsitsscrollinfolderstate: a folder leaf refuses a top-level view", () => {
    const folder = defaultFolderTabState("C:\\Work");
    expect(validateSplitLeaf({ view_id: "folder-1", kind: "folder", folder })).not.toBeNull();
    expect(
      validateSplitLeaf({ view_id: "folder-1", kind: "folder", folder, view: { scroll_top: 5 } }),
    ).toBeNull();
    expect(
      validateSplitLeaf({ view_id: "folder-1", kind: "folder", folder, view_version: 1 }),
    ).toBeNull();
  });

  it("accepts only the saved split descriptor shape", () => {
    const saved = serializeSplit(splitState());
    expect(saved).not.toBeNull();
    if (!saved) return;
    expect(validateSavedSplitDescriptor(saved)?.split.first.view_id).toBe("view-a");
    expect(validateSavedSplitDescriptor({ kind: "file", path: "C:\\a.txt" })).toBeNull();
    expect(validateSavedSplitDescriptor({ kind: "split", split: { ...saved.split, ratio: 2 } })).toBeNull();
  });
});
