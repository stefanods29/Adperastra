import { describe, expect, it } from "vitest";
import {
  EXPLORER_TAB,
  activateTab,
  closeTab,
  initialTabs,
  mountedFileTabs,
  openFileTab,
  openSingleTab,
  sessionFromTabs,
  setTabPath,
  tabsFromSession,
} from "../services/tabs";

const file = (path: string, handler = "image") => ({ path, handler, title: path.split("\\").pop() ?? path });

describe("tab model", () => {
  it("opens a file tab, switches to it, and returns to the Explorer on close", () => {
    let state = initialTabs();
    state = openFileTab(state, file("C:\\a.png"), false);
    expect(state.tabs).toHaveLength(2);
    const id = state.activeId;
    expect(state.tabs[1]).toMatchObject({ kind: "file", path: "C:\\a.png", handler: "image" });
    state = closeTab(state, id);
    expect(state.activeId).toBe(EXPLORER_TAB.id);
    expect(state.tabs).toHaveLength(1);
  });

  it("reuses the tab of a file that is already open (ignoring case and \\\\?\\)", () => {
    let state = openFileTab(initialTabs(), file("C:\\Photos\\a.png"), false);
    const first = state.activeId;
    state = activateTab(state, EXPLORER_TAB.id);
    state = openFileTab(state, file("\\\\?\\c:\\photos\\A.PNG"), false);
    expect(state.tabs).toHaveLength(2);
    expect(state.activeId).toBe(first);
  });

  it("opens background tabs without switching", () => {
    const state = openFileTab(initialTabs(), file("C:\\a.png"), true);
    expect(state.tabs).toHaveLength(2);
    expect(state.activeId).toBe(EXPLORER_TAB.id);
  });

  it("closing the active tab returns to the tab used before it", () => {
    let state = openFileTab(initialTabs(), file("C:\\a.png"), false);
    const a = state.activeId;
    state = openFileTab(state, file("C:\\b.png"), false);
    const b = state.activeId;
    state = openSingleTab(state, "settings");
    state = activateTab(state, a);
    state = activateTab(state, b);
    state = closeTab(state, b);
    expect(state.activeId).toBe(a);
  });

  it("never closes the Explorer tab", () => {
    const state = closeTab(initialTabs(), EXPLORER_TAB.id);
    expect(state.tabs).toEqual([EXPLORER_TAB]);
  });

  it("keeps one Help, Settings, and Gallery tab each", () => {
    let state = openSingleTab(initialTabs(), "help");
    state = openSingleTab(state, "help");
    expect(state.tabs.filter((tab) => tab.kind === "help")).toHaveLength(1);
  });

  it("restores file tabs from a session and drops broken entries", () => {
    const session = {
      tabs: [
        { id: "explorer", kind: "explorer" },
        { id: "f1", kind: "file", path: "C:\\a.png", handler: "image", title: "a.png" },
        { id: "f2", kind: "file", path: "C:\\b.xyz", handler: "unknown-handler" },
        { id: "f3", kind: "file", handler: "image" },
        { id: "h1", kind: "help" },
        { id: "h2", kind: "help" },
        { id: "x", kind: "bogus" },
      ],
      active_tab: "f1",
      saved_unix: 1,
    };
    const state = tabsFromSession(session, ["image"]);
    // An unknown handler keeps a recoverable placeholder (Step 09i), while
    // malformed, duplicated and unknown-kind entries are still dropped.
    expect(state.tabs.map((tab) => tab.id)).toEqual(["explorer", "f1", "f2", "h1"]);
    expect(state.tabs.find((tab) => tab.id === "f2")?.missing?.reason).toBe("handler_missing");
    expect(state.activeId).toBe("f1");
  });

  it("falls back to the Explorer when the session is missing or broken", () => {
    expect(tabsFromSession(null, ["image"]).tabs).toEqual([EXPLORER_TAB]);
    expect(tabsFromSession({ tabs: "nope" }, ["image"]).activeId).toBe("explorer");
  });

  it("writes file paths and handlers to the session", () => {
    const state = openFileTab(initialTabs(), file("C:\\a.png"), false);
    const session = sessionFromTabs(state, 42);
    expect(session.tabs[1]).toMatchObject({ kind: "file", path: "C:\\a.png", handler: "image" });
    expect(session.active_tab).toBe(state.activeId);
    expect(session.saved_unix).toBe(42);
  });

  it("setTabPath renames a file tab", () => {
    let state = openFileTab(initialTabs(), file("C:\\a.png"), false);
    const id = state.activeId;
    state = openSingleTab(state, "help");
    const renamed = setTabPath(state, id, "C:\\b.png", "b.png");
    expect(renamed.tabs.find((tab) => tab.id === id)).toMatchObject({ path: "C:\\b.png", title: "b.png" });
    expect(renamed.tabs.find((tab) => tab.kind === "help")).toEqual(state.tabs.find((tab) => tab.kind === "help"));
    expect(setTabPath(state, "unknown", "C:\\c.png", "c.png")).toEqual(state);
  });

  it("keeps the active and the most recent file tabs mounted", () => {
    let state = initialTabs();
    for (let index = 0; index < 10; index += 1) state = openFileTab(state, file(`C:\\${index}.png`), false);
    const mounted = mountedFileTabs(state, 8);
    expect(mounted.size).toBe(8);
    expect(mounted.has(state.activeId)).toBe(true);
    expect(mounted.has(state.tabs[1].id)).toBe(false);
  });
});
