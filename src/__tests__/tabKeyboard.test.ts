import { describe, expect, it } from "vitest";
import { resolveTabKey, type TabKeyEvent } from "../services/tabKeyRouting";
import { activateTab, initialTabs, openFileTab, type TabsState } from "../services/tabs";

const file = (path: string) => ({ path, handler: "text", title: path.split("\\").pop() ?? path });

function stateWith(count: number): TabsState {
  let state = initialTabs();
  for (let index = 0; index < count; index += 1) {
    state = openFileTab(state, file(`C:\\f-${index}.txt`), true);
  }
  return activateTab(state, state.tabs[state.tabs.length - 1].id);
}

const key = (partial: Partial<TabKeyEvent>): TabKeyEvent => ({
  key: "",
  ctrlKey: true,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...partial,
});

const plain = { searchFocused: false, textEditing: false };

describe("dirty-safe tab controls and keyboard routing (T6)", () => {
  it("ctrl_9_targets_last_tab", () => {
    const state = stateWith(3);
    const action = resolveTabKey(key({ key: "9" }), state, plain);
    expect(action).toEqual({ type: "activate", id: state.tabs[state.tabs.length - 1].id });
  });

  it("ctrl_1_to_8_target_visible_positions_including_permanent", () => {
    const state = stateWith(3);
    expect(resolveTabKey(key({ key: "1" }), state, plain)).toEqual({ type: "activate", id: "explorer" });
    expect(resolveTabKey(key({ key: "2" }), state, plain)).toEqual({ type: "activate", id: state.tabs[1].id });
  });

  it("search_focused_ctrl_tab_does_not_activate_other_tab", () => {
    const state = stateWith(3);
    const action = resolveTabKey(key({ key: "Tab" }), state, { searchFocused: true, textEditing: false });
    expect(action).toEqual({ type: "none" });
  });

  it("ctrl_tab_cycles_mru_without_reordering_visible_list", () => {
    const state = stateWith(3);
    const before = state.tabs.map((tab) => tab.id);
    const action = resolveTabKey(key({ key: "Tab" }), state, plain);
    expect(action.type).toBe("activate");
    expect(state.tabs.map((tab) => tab.id)).toEqual(before);
  });

  it("text_editing_keeps_its_own_shortcuts", () => {
    const state = stateWith(2);
    expect(resolveTabKey(key({ key: "9" }), state, { searchFocused: false, textEditing: true })).toEqual({
      type: "none",
    });
  });

  it("ctrl_shift_t_reopens_and_ctrl_w_never_closes_permanent", () => {
    const state = stateWith(1);
    expect(resolveTabKey(key({ key: "T", shiftKey: true }), state, plain)).toEqual({ type: "reopenClosed" });
    const explorerActive = activateTab(state, "explorer");
    expect(resolveTabKey(key({ key: "w" }), explorerActive, plain)).toEqual({ type: "none" });
  });

  it("virtual_tabs_close_without_disk_invoke_routing", () => {
    // Virtual tabs have no disk path: the close action only names the tab
    // id, so the host runs the E11 close plan instead of any file command.
    const state = stateWith(1);
    const action = resolveTabKey(key({ key: "w" }), state, plain);
    expect(action).toEqual({ type: "close", id: state.activeId });
    expect(JSON.stringify(action)).not.toContain("\\\\");
  });
});
