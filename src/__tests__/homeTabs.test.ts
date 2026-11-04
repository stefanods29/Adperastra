import { expect, it } from "vitest";
import { defaultFolderTabState, validateFolderTabState } from "../services/folderState";
import { openFolderTab } from "../services/tabActions";
import { initialTabs, sessionFromTabs, tabsFromSession } from "../services/tabs";

it("opens independent Home tabs and restores them with their own identities", () => {
  let state = openFolderTab(initialTabs(), defaultFolderTabState("home"), false);
  const first = state.activeId;
  state = openFolderTab(state, defaultFolderTabState("home"), false);
  expect(state.tabs).toHaveLength(3);
  expect(state.activeId).not.toBe(first);
  const saved = sessionFromTabs(state, 1);
  expect(saved.schema_version).toBe(3);
  const restored = tabsFromSession(saved, []);
  expect(restored.tabs.map(tab => tab.id)).toEqual(state.tabs.map(tab => tab.id));
  expect(restored.tabs.filter(tab => tab.kind === "folder").map(tab => tab.folder?.path)).toEqual(["home", "home"]);
  expect(validateFolderTabState(defaultFolderTabState("relative-folder"))).toBeNull();
});
