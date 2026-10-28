import { describe, expect, it, vi } from "vitest";
import { createExplorerCommands, type ExplorerActions } from "../commands/explorerCommands";
import { CommandRegistry, type CommandContext } from "../commands/registry";
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

function makeActions(): ExplorerActions {
  return {
    back: vi.fn(),
    forward: vi.fn(),
    up: vi.fn(),
    refresh: vi.fn(),
    openSelected: vi.fn(),
    goToPath: vi.fn(),
    togglePin: vi.fn(),
  };
}

const baseCtx: CommandContext = {
  location: "folder",
  currentPath: "C:\\Users",
  canGoBack: false,
  canGoForward: false,
  selectedPath: null,
  selectedKind: null,
  currentPinned: false,
};

describe("explorer commands", () => {
  it("registers the Step 02 command set with full metadata", () => {
    const registry = new CommandRegistry();
    for (const command of createExplorerCommands(makeActions())) registry.register(command);
    const ids = registry.list().map((c) => c.id);
    expect(ids).toEqual([
      "explorer.back",
      "explorer.forward",
      "explorer.up",
      "explorer.refresh",
      "explorer.open",
      "explorer.goToPath",
      "explorer.togglePin",
    ]);
    for (const command of registry.list()) {
      expect(command.labelKey).toMatch(/^commands\./);
      expect(command.icon).toBeDefined();
      expect(command.helpSlug).toMatch(/^[a-z-]+$/);
      expect(command.risk).toBeDefined();
    }
    expect(() => registry.register(createExplorerCommands(makeActions())[0])).toThrow();
  });

  it("enabled-when rules follow the context", () => {
    const commands = createExplorerCommands(makeActions());
    const byId = Object.fromEntries(commands.map((c) => [c.id, c]));
    expect(byId["explorer.back"].enabledWhen(baseCtx)).toBe(false);
    expect(byId["explorer.back"].enabledWhen({ ...baseCtx, canGoBack: true })).toBe(true);
    expect(byId["explorer.up"].enabledWhen({ ...baseCtx, location: "home", currentPath: null })).toBe(false);
    expect(byId["explorer.open"].enabledWhen(baseCtx)).toBe(false);
    expect(byId["explorer.open"].enabledWhen({ ...baseCtx, selectedPath: "C:\\Users\\a", selectedKind: "folder" })).toBe(true);
    expect(byId["explorer.togglePin"].enabledWhen({ ...baseCtx, location: "home", currentPath: null })).toBe(false);
    expect(byId["explorer.goToPath"].enabledWhen({ ...baseCtx, location: "home", currentPath: null })).toBe(true);
  });

  it("runs through to the injected actions", () => {
    const actions = makeActions();
    const commands = createExplorerCommands(actions);
    commands.find((c) => c.id === "explorer.back")?.run(baseCtx);
    expect(actions.back).toHaveBeenCalledOnce();
    commands.find((c) => c.id === "explorer.goToPath")?.run(baseCtx, "D:\\Docs");
    expect(actions.goToPath).toHaveBeenCalledWith("D:\\Docs");
  });
});