import { describe, expect, it, vi } from "vitest";
import { createExplorerCommands, type ExplorerActions } from "../commands/explorerCommands";
import { BACKGROUND_MENU, COMMAND_BAR, ITEM_MENU, resolveMenu, type MenuEntry } from "../commands/menus";
import {
  CommandRegistry,
  commandLabelKey,
  isCommandEnabled,
  type CommandContext,
} from "../commands/registry";
import {
  canGoBack,
  canGoForward,
  createHistory,
  goBack,
  goForward,
  navigate,
  type ExplorerLocation,
} from "../services/navigation";
import { displayPath, parentPathOf, pathSegments } from "../services/explorer";

const folder = (path: string): ExplorerLocation => ({ type: "folder", path });

describe("navigation history", () => {
  it("moves back and forward and clears forward on a new navigation", () => {
    let history = createHistory({ type: "home" });
    expect(canGoBack(history)).toBe(false);
    history = navigate(history, folder("C:\\A"));
    history = navigate(history, folder("C:\\B"));
    expect(history.current).toEqual(folder("C:\\B"));
    history = goBack(history);
    expect(history.current).toEqual(folder("C:\\A"));
    expect(canGoForward(history)).toBe(true);
    history = goForward(history);
    expect(history.current).toEqual(folder("C:\\B"));
    history = goBack(history);
    history = navigate(history, folder("C:\\C"));
    expect(canGoForward(history)).toBe(false);
    expect(history.current).toEqual(folder("C:\\C"));
  });

  it("does not push duplicates and back at the start is a no-op", () => {
    const start = createHistory(folder("C:\\A"));
    expect(goBack(start)).toBe(start);
    const again = navigate(start, folder("C:\\A"));
    expect(canGoBack(again)).toBe(false);
  });
});

describe("path helpers", () => {
  it("strips the long-path prefix for display", () => {
    expect(displayPath("\\\\?\\C:\\Users\\me")).toBe("C:\\Users\\me");
    expect(displayPath("\\\\?\\UNC\\server\\share")).toBe("\\\\server\\share");
    expect(displayPath("C:\\Users")).toBe("C:\\Users");
  });

  it("splits a path into breadcrumb segments and finds the parent", () => {
    expect(pathSegments("C:\\Users\\me\\Docs")).toEqual([
      { label: "C:\\", path: "C:\\" },
      { label: "Users", path: "C:\\Users" },
      { label: "me", path: "C:\\Users\\me" },
      { label: "Docs", path: "C:\\Users\\me\\Docs" },
    ]);
    expect(parentPathOf("C:\\Users\\me")).toBe("C:\\Users");
    expect(parentPathOf("C:\\")).toBeNull();
  });
});

/** Every action is a spy, created on first use. */
function makeActions(): ExplorerActions {
  const spies = new Map<string, ReturnType<typeof vi.fn>>();
  return new Proxy({} as ExplorerActions, {
    get: (_target, key: string) => {
      if (!spies.has(key)) spies.set(key, vi.fn());
      return spies.get(key);
    },
  });
}

const baseCtx: CommandContext = {
  location: "folder",
  currentPath: "C:\\Users",
  canGoBack: false,
  canGoForward: false,
  selectedPath: null,
  selectedKind: null,
  currentPinned: false,
  selection: { paths: [], count: 0, files: 0, folders: 0 },
  view: {
    showHidden: false,
    showExtensions: true,
    itemCheckboxes: false,
    detailsPane: false,
    groupBy: "none",
    sortKey: "name",
    sortDirection: "ascending",
  },
  allFavorites: false,
  selectionInCurrentFolder: true,
};

const oneFile = { paths: ["C:\\Users\\a.txt"], count: 1, files: 1, folders: 0 };

describe("explorer commands", () => {
  it("keeps the Step 02 commands and gives every command full metadata", () => {
    const registry = new CommandRegistry();
    for (const command of createExplorerCommands(makeActions())) registry.register(command);
    const ids = registry.list().map((c) => c.id);
    for (const id of ["explorer.back", "explorer.forward", "explorer.up", "explorer.refresh", "explorer.open", "explorer.goToPath", "explorer.togglePin"]) {
      expect(ids).toContain(id);
    }
    for (const command of registry.list()) {
      expect(command.labelKey).toMatch(/^commands\./);
      expect(command.icon).toBeDefined();
      expect(command.helpSlug).toMatch(/^[a-z-]+$/);
      expect(command.risk).toBeDefined();
    }
    expect(() => registry.register(createExplorerCommands(makeActions())[0])).toThrow();
  });

  it("enabled-when rules follow the context and the selection", () => {
    const byId = Object.fromEntries(createExplorerCommands(makeActions()).map((c) => [c.id, c]));
    expect(isCommandEnabled(byId["explorer.back"], baseCtx)).toBe(false);
    expect(isCommandEnabled(byId["explorer.back"], { ...baseCtx, canGoBack: true })).toBe(true);
    expect(isCommandEnabled(byId["explorer.up"], { ...baseCtx, location: "home", currentPath: null })).toBe(false);
    expect(isCommandEnabled(byId["explorer.open"], baseCtx)).toBe(false);
    expect(isCommandEnabled(byId["explorer.open"], { ...baseCtx, selection: oneFile })).toBe(true);
    expect(isCommandEnabled(byId["explorer.rename"], baseCtx)).toBe(false);
    expect(isCommandEnabled(byId["explorer.rename"], { ...baseCtx, selection: oneFile })).toBe(true);
    const two = { paths: ["a", "b"], count: 2, files: 1, folders: 1 };
    expect(isCommandEnabled(byId["explorer.rename"], { ...baseCtx, selection: two })).toBe(false);
    expect(isCommandEnabled(byId["explorer.share"], { ...baseCtx, selection: two })).toBe(false);
    expect(isCommandEnabled(byId["explorer.share"], { ...baseCtx, selection: oneFile })).toBe(true);
    expect(isCommandEnabled(byId["explorer.goToPath"], { ...baseCtx, location: "home", currentPath: null })).toBe(true);
  });

  it("keeps not-yet-built commands disabled even with a selection", () => {
    const byId = Object.fromEntries(createExplorerCommands(makeActions()).map((c) => [c.id, c]));
    for (const id of ["explorer.cut", "explorer.copy", "explorer.paste", "explorer.delete", "explorer.newFolder", "explorer.viewList"]) {
      expect(byId[id].pending).toBe(true);
      expect(isCommandEnabled(byId[id], { ...baseCtx, selection: oneFile })).toBe(false);
    }
    expect(isCommandEnabled(byId["explorer.viewDetails"], baseCtx)).toBe(true);
  });

  it("labels and checks follow the context", () => {
    const byId = Object.fromEntries(createExplorerCommands(makeActions()).map((c) => [c.id, c]));
    expect(commandLabelKey(byId["explorer.toggleFavorite"], baseCtx)).toBe("commands.addFavorite");
    expect(commandLabelKey(byId["explorer.toggleFavorite"], { ...baseCtx, allFavorites: true })).toBe("commands.removeFavorite");
    expect(byId["explorer.sortByName"].checkedWhen?.(baseCtx)).toBe(true);
    expect(byId["explorer.sortBySize"].checkedWhen?.(baseCtx)).toBe(false);
    expect(byId["explorer.toggleDetailsPane"].checkedWhen?.({ ...baseCtx, view: { ...baseCtx.view, detailsPane: true } })).toBe(true);
  });

  it("every command's help page exists in every app language", () => {
    const pages = new Set(Object.keys(import.meta.glob("../../help/*/*.md")).map((path) => path.replace("../../help/", "")));
    const slugs = new Set(createExplorerCommands(makeActions()).map((c) => c.helpSlug));
    for (const slug of [...slugs, "command-bar", "details-pane", "home-page"]) {
      for (const lang of ["en", "es"]) {
        expect(pages.has(`${lang}/${slug}.md`), `${lang}/${slug}`).toBe(true);
      }
    }
  });

  it("runs through to the injected actions", () => {
    const actions = makeActions();
    const commands = createExplorerCommands(actions);
    commands.find((c) => c.id === "explorer.back")?.run(baseCtx);
    expect(actions.back).toHaveBeenCalledOnce();
    commands.find((c) => c.id === "explorer.goToPath")?.run(baseCtx, "D:\\Docs");
    expect(actions.goToPath).toHaveBeenCalledWith("D:\\Docs");
    commands.find((c) => c.id === "explorer.sortBySize")?.run(baseCtx);
    expect(actions.setSortKey).toHaveBeenCalledWith("size");
    commands.find((c) => c.id === "explorer.toggleHiddenItems")?.run(baseCtx);
    expect(actions.toggleView).toHaveBeenCalledWith("showHidden");
  });
});

describe("menus from commands", () => {
  const registry = new CommandRegistry();
  for (const command of createExplorerCommands(makeActions())) registry.register(command);
  const lookup = (id: string) => registry.get(id);
  const ids = (entries: MenuEntry[]) => entries.map((e) => (e.type === "command" ? e.id : e.type === "submenu" ? `sub:${e.id}` : e.type));

  it("every command a menu or the bar names is registered", () => {
    const walk = (entries: MenuEntry[]): string[] =>
      entries.flatMap((e) => (e.type === "command" ? [e.id] : e.type === "iconRow" ? e.ids : e.type === "submenu" ? walk(e.entries) : []));
    const named = [...walk(ITEM_MENU), ...walk(BACKGROUND_MENU)];
    for (const entry of COMMAND_BAR) {
      if (entry.type === "command") named.push(entry.id);
      if (entry.type === "menu" || entry.type === "overflow") named.push(...walk(entry.entries));
    }
    for (const id of named) expect(registry.get(id), id).toBeDefined();
  });

  it("hides commands that do not apply and tidies separators", () => {
    const fileMenu = resolveMenu(ITEM_MENU, { ...baseCtx, selection: oneFile }, lookup);
    expect(ids(fileMenu)).toContain("explorer.openWith");
    expect(ids(fileMenu)).not.toContain("explorer.showInFolder");
    const homeMenu = resolveMenu(ITEM_MENU, { ...baseCtx, location: "home", selection: oneFile, selectionInCurrentFolder: false }, lookup);
    expect(ids(homeMenu)).toContain("explorer.showInFolder");
    const folderMenu = resolveMenu(ITEM_MENU, { ...baseCtx, selection: { paths: ["d"], count: 1, files: 0, folders: 1 } }, lookup);
    expect(ids(folderMenu)).not.toContain("explorer.openWith");
    const background = resolveMenu(BACKGROUND_MENU, baseCtx, lookup);
    expect(ids(background).slice(0, 3)).toEqual(["sub:view", "sub:sort", "sub:new"]);
    const resolved = resolveMenu(
      [{ type: "separator" }, { type: "command", id: "missing" }, { type: "separator" }, { type: "command", id: "explorer.refresh" }, { type: "separator" }],
      baseCtx,
      lookup,
    );
    expect(ids(resolved)).toEqual(["explorer.refresh"]);
  });
});
