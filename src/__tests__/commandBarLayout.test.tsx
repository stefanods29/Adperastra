import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { COMMAND_BAR } from "../commands/menus";
import { createExplorerCommands, type ExplorerActions } from "../commands/explorerCommands";
import type { CommandContext } from "../commands/registry";
import { ToolbarLayoutContext, type ToolbarLayout } from "../layout/toolbarLayout";
import CommandBar from "../views/explorer/CommandBar";

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
    viewMode: "details",
    hiddenViewModes: [],
  },
  allFavorites: false,
  selectionInCurrentFolder: true,
  canUndo: false,
  canRedo: false,
};

const commands = createExplorerCommands(makeActions());
const lookup = (id: string) => commands.find((command) => command.id === id);

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function renderBar(layout?: ToolbarLayout): Promise<HTMLElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const bar = (
    <CommandBar
      entries={COMMAND_BAR}
      ctx={baseCtx}
      lookup={lookup}
      onRun={() => undefined}
      onOpenHelp={() => undefined}
    />
  );
  await act(async () => {
    root?.render(layout ? <ToolbarLayoutContext.Provider value={layout}>{bar}</ToolbarLayoutContext.Provider> : bar);
  });
  return container.querySelector(".adp-commandbar") as HTMLElement;
}

const buttonWith = (rootElement: HTMLElement, label: string) =>
  [...rootElement.querySelectorAll("button")].find(
    (button) => button.getAttribute("aria-label") === label,
  ) as HTMLButtonElement | undefined;

describe("CommandBar layouts", () => {
  it("the standard bar is unchanged", async () => {
    const bar = await renderBar();
    expect(bar.classList.contains("adp-commandbar--vertical")).toBe(false);
    expect(bar.classList.contains("adp-commandbar--compact")).toBe(false);
    expect(bar.classList.contains("adp-commandbar--icons")).toBe(false);
    const neu = buttonWith(bar, i18n.t("commands.new"))!;
    expect(neu.textContent).toContain(i18n.t("commands.new"));
    expect(neu.querySelector(".lucide-chevron-down")).not.toBeNull();
    expect(buttonWith(bar, i18n.t("commands.cut"))!.textContent).toBe("");
  });

  it("a side bar shows names beside the icons", async () => {
    const bar = await renderBar({ side: "left", orientation: "vertical", mode: "full" });
    expect(bar.classList.contains("adp-commandbar--vertical")).toBe(true);
    expect(bar.getAttribute("aria-orientation")).toBe("vertical");
    expect(buttonWith(bar, i18n.t("commands.cut"))!.textContent).toBe(i18n.t("commands.cut"));
    expect(buttonWith(bar, i18n.t("commands.new"))!.querySelector(".lucide-chevron-right")).not.toBeNull();
    expect(buttonWith(bar, i18n.t("commands.more"))!.textContent).toBe(i18n.t("commands.more"));
  });

  it("icons only hides every name", async () => {
    const bar = await renderBar({ side: "top", orientation: "horizontal", mode: "iconsOnly" });
    expect(bar.classList.contains("adp-commandbar--icons")).toBe(true);
    expect(buttonWith(bar, i18n.t("commands.new"))!.textContent).toBe("");
    expect(buttonWith(bar, i18n.t("commands.detailsPane"))!.textContent).toBe("");
  });

  it("compact adds its class", async () => {
    const bar = await renderBar({ side: "bottom", orientation: "horizontal", mode: "compact" });
    expect(bar.classList.contains("adp-commandbar--compact")).toBe(true);
  });

  it("menus open from a side bar", async () => {
    const bar = await renderBar({ side: "left", orientation: "vertical", mode: "full" });
    await act(async () => {
      buttonWith(bar, i18n.t("commands.new"))!.click();
    });
    expect(container!.querySelector("[role='menu']")).not.toBeNull();
  });
});
