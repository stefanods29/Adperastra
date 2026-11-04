import { describe, expect, it } from "vitest";
import { EXPLORER_TAB, type TabState, type TabsState } from "../services/tabs";
import {
  createTabGroup,
  moveTabGroup,
  normalizeTabGroups,
  patchTabGroup,
  removeTabsFromGroup,
  ungroupTabGroup,
  type TabGroup,
} from "../services/tabGroups";

const GROUP_ID = "00000000-0000-4000-8000-0000000000aa";

function fileTab(id: string, extra: Partial<TabState> = {}): TabState {
  return {
    id,
    kind: "file",
    title: `${id}.txt`,
    path: `C:\\Demo\\${id}.txt`,
    handler: "text",
    ...extra,
  };
}

function stateWith(tabs: TabState[], groups: TabGroup[] = []): TabsState {
  return {
    tabs: [EXPLORER_TAB, ...tabs],
    activeId: EXPLORER_TAB.id,
    history: [EXPLORER_TAB.id],
    groups,
  };
}

describe("tab group state (step 09b T1)", () => {
  it("gathers_scattered_tabs_in_display_order", () => {
    const state = stateWith([fileTab("a"), fileTab("x"), fileTab("b")]);
    const next = createTabGroup(state, ["b", "a"], "Work", "blue");
    expect(next.tabs.map((tab) => tab.id)).toEqual(["explorer", "a", "b", "x"]);
    expect(next.groups).toHaveLength(1);
    expect(next.groups?.[0].tab_ids).toEqual(["a", "b"]);
    expect(next.groups?.[0]).toMatchObject({ name: "Work", color: "blue", collapsed: false });
    expect(next.tabs.find((tab) => tab.id === "a")?.group_id).toBe(next.groups?.[0].id);
    expect(next.tabs.find((tab) => tab.id === "x")?.group_id).toBeUndefined();
    // The input is never mutated.
    expect(state.tabs.map((tab) => tab.id)).toEqual(["explorer", "a", "x", "b"]);
    expect(state.groups).toEqual([]);
  });

  it("rejects_pinned_and_permanent_members", () => {
    const pinned = stateWith([fileTab("a", { pinned: true }), fileTab("b")]);
    const before = structuredClone(pinned);
    expect(() => createTabGroup(pinned, ["a"], "Work", "purple")).toThrow("tabs.invalid_group");
    expect(pinned).toEqual(before);
    const plain = stateWith([fileTab("a")]);
    expect(() => createTabGroup(plain, ["explorer"], "Work", "purple")).toThrow(
      "tabs.invalid_group",
    );
    expect(plain.groups).toEqual([]);
  });

  it("drops_empty_group", () => {
    const grouped = createTabGroup(stateWith([fileTab("a"), fileTab("b")]), ["a", "b"], "Work", "teal");
    const emptied = removeTabsFromGroup(grouped, ["a", "b"]);
    expect(emptied.groups).toEqual([]);
    expect(emptied.tabs.map((tab) => tab.id)).toEqual(["explorer", "a", "b"]);
    const legacy = stateWith([fileTab("a")], [
      { id: GROUP_ID, name: "Empty", color: "red", collapsed: false, tab_ids: [] },
    ]);
    expect(normalizeTabGroups(legacy).groups).toEqual([]);
  });

  it("legacy_session_defaults_to_no_groups", () => {
    const legacy: TabsState = {
      tabs: [EXPLORER_TAB, fileTab("a")],
      activeId: "a",
      history: ["explorer", "a"],
    };
    const normalized = normalizeTabGroups(legacy);
    expect(normalized.groups).toEqual([]);
    expect(normalized.activeId).toBe("a");
  });

  it("rejects a duplicate membership and an unknown patch field", () => {
    const grouped = createTabGroup(stateWith([fileTab("a"), fileTab("b")]), ["a"], "Work", "purple");
    expect(() => createTabGroup(grouped, ["a"], "Again", "red")).toThrow("tabs.invalid_group");
    const groupId = grouped.groups?.[0].id ?? "";
    expect(() =>
      patchTabGroup(grouped, groupId, { name: "New", bogus: true } as never),
    ).toThrow("tabs.invalid_group");
    expect(patchTabGroup(grouped, groupId, { name: "  Renamed  " }).groups?.[0].name).toBe(
      "Renamed",
    );
    expect(() => patchTabGroup(grouped, groupId, {})).toThrow("tabs.invalid_group");
  });

  it("ungroup keeps member order and content", () => {
    const grouped = createTabGroup(
      stateWith([fileTab("a"), fileTab("x"), fileTab("b")]),
      ["a", "b"],
      "Work",
      "green",
    );
    const groupId = grouped.groups?.[0].id ?? "";
    const next = ungroupTabGroup(grouped, groupId);
    expect(next.groups).toEqual([]);
    expect(next.tabs.map((tab) => tab.id)).toEqual(["explorer", "a", "b", "x"]);
    expect(next.tabs.every((tab) => tab.group_id === undefined)).toBe(true);
  });

  it("moves a whole group segment and refuses to split another group", () => {
    let state = stateWith([fileTab("a"), fileTab("b"), fileTab("x"), fileTab("c"), fileTab("d")]);
    state = createTabGroup(state, ["a", "b"], "One", "purple");
    state = createTabGroup(state, ["c", "d"], "Two", "red");
    const [one, two] = state.groups ?? [];
    // After removing group One the array is explorer,x,c,d: index 4 is the end.
    const moved = moveTabGroup(state, one.id, 4);
    expect(moved.tabs.map((tab) => tab.id)).toEqual(["explorer", "x", "c", "d", "a", "b"]);
    // Index 3 would land between c and d.
    expect(() => moveTabGroup(state, one.id, 3)).toThrow("tabs.invalid_group");
    expect(two.tab_ids).toEqual(["c", "d"]);
  });
});
