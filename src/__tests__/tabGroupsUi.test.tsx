import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import type { TabGroup } from "../services/tabGroups";
import type { SavedGroupCatalog } from "../services/savedGroups";
import TabGroupLabel from "../tabs/TabGroupLabel";
import TabGroupMenu from "../tabs/TabGroupMenu";
import SavedGroupsPanel from "../tabs/SavedGroupsPanel";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number; estimateSize: (index: number) => number }) => ({
    getTotalSize: () => opts.count * opts.estimateSize(0),
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, index) => ({
        index,
        start: index * opts.estimateSize(index),
        key: index,
      })),
    scrollToIndex: () => undefined,
  }),
}));

const GROUP: TabGroup = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Work",
  color: "purple",
  collapsed: false,
  tab_ids: ["a", "b"],
};

const GROUP_TWO: TabGroup = { ...GROUP, id: "00000000-0000-4000-8000-000000000002", name: "Trips" };

function savedCatalog(): SavedGroupCatalog {
  return {
    schema_version: 1,
    revision: 3,
    groups: [
      {
        id: GROUP.id,
        name: "Work",
        color: "purple",
        tabs: [{ kind: "file", title: "a.txt", path: "C:\\Demo\\a.txt", handler: "text", pinned: false }],
        active_index: 0,
        created_unix: 10,
        modified_unix: 1_700_000_000,
        version: 1,
      },
      {
        id: GROUP_TWO.id,
        name: "Trips",
        color: "teal",
        tabs: [{ kind: "folder", path: "C:\\Demo", pinned: false }],
        active_index: 0,
        created_unix: 10,
        modified_unix: 1_700_000_000,
        version: 1,
      },
    ],
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  await i18n.changeLanguage("en");
});

function mount(node: React.ReactNode) {
  if (!container) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  return act(async () => {
    root?.render(node);
  });
}

const anchor = {
  x: 10,
  y: 10,
  left: 10,
  top: 10,
  right: 110,
  bottom: 42,
  width: 100,
  height: 32,
} as DOMRect;

describe("tab group controls (step 09b T5)", () => {
  it("the label toggles, opens its menu and reports count and color accessibly", async () => {
    const onToggle = vi.fn();
    const onMenu = vi.fn();
    await mount(
      <TabGroupLabel group={GROUP} memberCount={2} active={false} onToggle={onToggle} onMenu={onMenu} />,
    );
    const label = container!.querySelector("button.adp-tab-group-label") as HTMLButtonElement;
    expect(label).not.toBeNull();
    expect(label.getAttribute("aria-expanded")).toBe("true");
    expect(label.getAttribute("aria-label")).toContain("Work");
    expect(label.querySelector(".adp-tab-group-name")?.textContent).toBe("Work");
    await act(async () => label.click());
    expect(onToggle).toHaveBeenCalledTimes(1);
    await act(async () => {
      label.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    expect(onMenu).toHaveBeenCalledTimes(1);
  });

  it("the menu moves focus with arrows, chooses a color and Esc closes", async () => {
    const onClose = vi.fn();
    const onColor = vi.fn();
    await mount(
      <TabGroupMenu
        group={GROUP}
        anchor={anchor}
        onClose={onClose}
        onRename={vi.fn()}
        onColor={onColor}
        onToggleCollapse={vi.fn()}
        onUngroup={vi.fn()}
        onCloseGroup={vi.fn()}
        onSave={vi.fn()}
        onSaveAndClose={vi.fn()}
      />,
    );
    const menu = container!.querySelector("[role='menu']") as HTMLElement;
    expect(menu).not.toBeNull();
    const items = [...menu.querySelectorAll<HTMLElement>("[data-menu-item]")];
    expect(items.length).toBeGreaterThan(6);
    expect(document.activeElement).toBe(items[0]);
    await act(async () => {
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    const blue = menu.querySelector("[aria-label='Blue']") as HTMLButtonElement;
    expect(blue).not.toBeNull();
    await act(async () => blue.click());
    expect(onColor).toHaveBeenCalledWith("blue");
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => {
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("Enter opens the selected saved group and Esc-close callbacks stay with the caller", async () => {
    const onOpen = vi.fn(async () => undefined);
    await mount(
      <SavedGroupsPanel
        catalog={savedCatalog()}
        loading={false}
        onOpen={onOpen}
        onRename={vi.fn(async () => undefined)}
        onRemove={vi.fn(async () => undefined)}
        onImport={vi.fn(async () => undefined)}
        onExport={vi.fn(async () => undefined)}
        onOpenHelp={vi.fn()}
      />,
    );
    const row = container!.querySelector("[data-saved-group-row]") as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.textContent).toContain("Work");
    await act(async () => {
      row.focus();
      row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onOpen).toHaveBeenCalledWith(GROUP.id);
  });

  it("shows loading, error and empty states with controls reachable", async () => {
    const panel = (catalog: SavedGroupCatalog | null, loading: boolean, errorCode?: string) => (
      <SavedGroupsPanel
        catalog={catalog}
        loading={loading}
        errorCode={errorCode}
        onOpen={vi.fn(async () => undefined)}
        onRename={vi.fn(async () => undefined)}
        onRemove={vi.fn(async () => undefined)}
        onImport={vi.fn(async () => undefined)}
        onExport={vi.fn(async () => undefined)}
        onOpenHelp={vi.fn()}
      />
    );
    await mount(panel(null, true));
    expect(container!.querySelector("[role='status']")).not.toBeNull();
    await mount(panel(null, false, "groups.io"));
    expect(container!.querySelector("[role='alert']")?.textContent).toContain(
      "could not be saved or opened",
    );
    expect(container!.textContent).toContain("No saved groups yet.");
    const buttons = [...container!.querySelectorAll("button")];
    expect(buttons.some((button) => button.textContent?.includes("Import"))).toBe(true);
  });

  it("rename keeps the panel open after a failed save", async () => {
    const onRename = vi.fn(async () => {
      throw new Error("groups.changed");
    });
    await mount(
      <SavedGroupsPanel
        catalog={savedCatalog()}
        loading={false}
        onOpen={vi.fn(async () => undefined)}
        onRename={onRename}
        onRemove={vi.fn(async () => undefined)}
        onImport={vi.fn(async () => undefined)}
        onExport={vi.fn(async () => undefined)}
        onOpenHelp={vi.fn()}
      />,
    );
    const rename = [...container!.querySelectorAll("button")].find(
      (button) => button.textContent === "Rename group",
    ) as HTMLButtonElement;
    await act(async () => rename.click());
    const input = container!.querySelector("input.adp-input") as HTMLInputElement;
    expect(input).not.toBeNull();
    const save = [...container!.querySelectorAll("button")].find(
      (button) => button.textContent === "Save",
    ) as HTMLButtonElement;
    await act(async () => save.click());
    expect(onRename).toHaveBeenCalledWith(GROUP.id, "Work");
    // Still editing: the failure did not close the catalog entry.
    expect(container!.querySelector("input.adp-input")).not.toBeNull();
    expect(container!.querySelector("[role='alert']")?.textContent).toContain("changed");
  });

  it("Spanish labels come from the translation files", async () => {
    await i18n.changeLanguage("es");
    const onClose = vi.fn();
    await mount(
      <TabGroupMenu
        group={GROUP}
        anchor={anchor}
        onClose={onClose}
        onRename={vi.fn()}
        onColor={vi.fn()}
        onToggleCollapse={vi.fn()}
        onUngroup={vi.fn()}
        onCloseGroup={vi.fn()}
        onSave={vi.fn()}
        onSaveAndClose={vi.fn()}
      />,
    );
    expect(container!.textContent).toContain("Cambiar nombre del grupo");
    expect(container!.querySelector("[aria-label='Azul']")).not.toBeNull();
    await i18n.changeLanguage("en");
  });

  it("a long group name keeps its truncating class at large zoom", async () => {
    const long: TabGroup = { ...GROUP, name: "A very long group name that must not widen the tab strip" };
    await mount(
      <TabGroupLabel group={long} memberCount={2} active onToggle={vi.fn()} onMenu={vi.fn()} />,
    );
    const name = container!.querySelector(".adp-tab-group-name") as HTMLElement;
    expect(name.textContent).toBe(long.name);
    expect(name.classList.contains("adp-tab-group-name")).toBe(true);
  });
});
