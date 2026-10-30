import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import type { ExplorerItem } from "../services/explorer";
import { EMPTY_SELECTION, selectOnly, type SelectionState } from "../services/selection";
import ColumnPane, { type ColumnPaneProps } from "../views/explorer/views/ColumnPane";
import type { ColumnListing } from "../views/explorer/views/useColumnListings";
import type { ItemViewProps } from "../views/explorer/views/useItemInteractions";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number; estimateSize: (index: number) => number }) => ({
    getTotalSize: () => opts.count * 28,
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, index) => ({ index, start: index * opts.estimateSize(index), key: index })),
    scrollToIndex: () => undefined,
  }),
}));

const item = (
  name: string,
  kind: "file" | "folder" = "file",
  path: string = `C:\\F\\${name}`,
  hidden = false,
  system = false,
): ExplorerItem => ({
  path,
  name,
  kind,
  size: 1,
  modified_unix: 1700000000,
  hidden,
  system,
  is_link: false,
  online_only: false,
  file_id: null,
  file_id_stable: false,
});

const items = [item("alpha.txt"), item("beta.txt"), item("bravo.txt"), item("charlie.txt")];

const ready = (list: ExplorerItem[]): ColumnListing => ({ status: "ready", items: list, partial: false, version: "v" });

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

type PaneOverrides = Partial<Omit<ColumnPaneProps, "view">> & { view?: Partial<ItemViewProps> };

/** Renders one column with a real selection state that follows changes. */
async function renderPane(overrides: PaneOverrides = {}, initial: SelectionState = EMPTY_SELECTION) {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const changes: SelectionState[] = [];
  let selection = initial;
  const spies = {
    onNavigateKey: vi.fn(),
    onSelectItem: vi.fn(),
    onOpenColumn: vi.fn(),
    onDragItem: vi.fn(),
    onOpen: vi.fn(),
    onContextMenu: vi.fn(),
    onCommandKey: vi.fn(),
    onItemMouseDown: vi.fn(),
  };
  const { view: viewOverrides, ...paneOverrides } = overrides;
  const props = (): ColumnPaneProps => ({
    role: "active",
    folder: "C:\\F",
    name: "F",
    width: 240,
    listing: null,
    pathItem: null,
    note: null,
    loading: false,
    showHidden: false,
    groupBy: "none",
    onNavigateKey: spies.onNavigateKey,
    onSelectItem: spies.onSelectItem,
    onOpenColumn: spies.onOpenColumn,
    onDragItem: spies.onDragItem,
    ...paneOverrides,
    view: {
      items,
      groups: null,
      selection,
      onSelectionChange: (next) => {
        selection = next;
        changes.push(next);
        void rerender();
      },
      sortKey: "name",
      sortDirection: "ascending",
      showExtensions: true,
      checkboxes: false,
      typeLabel: () => "TXT file",
      renamingPath: null,
      onStartRename: () => undefined,
      onRenameCommit: async () => null,
      onRenameCancel: () => undefined,
      onOpen: spies.onOpen,
      onContextMenu: spies.onContextMenu,
      onCommandKey: spies.onCommandKey,
      onItemMouseDown: spies.onItemMouseDown,
      label: "Files",
      ...viewOverrides,
    },
  });
  const rerender = async () => {
    await act(async () => {
      root?.render(<ColumnPane {...props()} />);
    });
  };
  await rerender();
  const list = container.querySelector<HTMLElement>("[role='listbox']")!;
  const key = async (init: KeyboardEventInit) => {
    await act(async () => {
      list.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
    });
  };
  const rows = () => container!.querySelectorAll<HTMLElement>("[role='option']");
  const click = async (index: number, init: MouseEventInit = {}) => {
    await act(async () => {
      rows()[index].dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, ...init }));
    });
  };
  return { changes, key, rows, click, spies, current: () => selection };
}

const selected = (state: SelectionState) => [...state.selected].map((path) => path.split("\\").pop()).sort();
const text = () => container!.textContent ?? "";

describe("ColumnPane", () => {
  it("a parent column lists its folder and marks the way on", async () => {
    await renderPane({
      role: "parent",
      folder: "C:\\",
      name: "C:\\",
      pathItem: "C:\\F",
      listing: ready([item("F", "folder", "C:\\F"), item("Other", "folder", "C:\\Other"), item("a.txt", "file", "C:\\a.txt")]),
    });
    expect(container!.querySelectorAll("[role='option']")).toHaveLength(3);
    const way = [...container!.querySelectorAll<HTMLElement>("[role='option']")].find((row) => row.textContent === "F")!;
    expect(way.classList.contains("adp-colview-row--path")).toBe(true);
    expect(way.getAttribute("aria-selected")).toBe("true");
    const list = container!.querySelector(".adp-colview-list")!;
    expect(list.classList.contains("adp-filelist-scroll")).toBe(false);
    const column = container!.querySelector(".adp-colview-column")!;
    expect(column.getAttribute("data-drop-folder")).toBe("C:\\");
    expect(column.classList.contains("adp-colview-column--parent")).toBe(true);
  });

  it("hidden items show only with Hidden items on", async () => {
    const list = [item("a.txt"), item("h.txt", "file", "C:\\F\\h.txt", true)];
    await renderPane({ role: "child", listing: ready(list) });
    expect(container!.querySelectorAll("[role='option']")).toHaveLength(1);
    await renderPane({ role: "child", listing: ready(list), showHidden: true });
    expect(container!.querySelectorAll("[role='option']")).toHaveLength(2);
  });

  it("clicks in a side column ask to open it", async () => {
    const a = item("a.txt");
    const pane = await renderPane({ role: "child", listing: ready([a]) });
    await pane.click(0);
    expect(pane.spies.onSelectItem.mock.calls[0]).toEqual([a, null]);
    let rightClick: MouseEvent | null = null;
    await act(async () => {
      rightClick = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 50 });
      pane.rows()[0].dispatchEvent(rightClick);
    });
    expect(pane.spies.onSelectItem.mock.calls[1]).toEqual([a, { x: 40, y: 50 }]);
    expect(rightClick!.defaultPrevented).toBe(true);
    await act(async () => {
      pane.rows()[0].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(pane.spies.onOpen).toHaveBeenCalledWith(a);
    await act(async () => {
      container!.querySelector<HTMLElement>(".adp-colview-list")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(pane.spies.onOpenColumn).toHaveBeenCalledTimes(1);
  });

  it("side rows drag only their own item", async () => {
    const a = item("a.txt");
    const pane = await renderPane({ role: "child", listing: ready([a]) });
    await act(async () => {
      pane.rows()[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });
    expect(pane.spies.onDragItem).toHaveBeenCalledWith(expect.anything(), a);
    expect(pane.spies.onItemMouseDown).not.toHaveBeenCalled();
    expect(pane.current().selected.size).toBe(0);
  });

  it("an empty, failed or slow column says so", async () => {
    vi.useFakeTimers();
    await renderPane({ role: "child", listing: ready([]) });
    expect(text()).toContain(i18n.t("explorer.emptyFolder"));
    await renderPane({ role: "child", listing: { status: "error", items: [], partial: false, version: "v" } });
    expect(text()).toContain(i18n.t("explorer.loadError"));
    await renderPane({ role: "child", listing: null });
    expect(container!.querySelector(".adp-skeleton-rows")).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(99);
    });
    expect(container!.querySelector(".adp-skeleton-rows")).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(container!.querySelector(".adp-skeleton-rows")).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    expect(text()).toContain(i18n.t("explorer.stillLoading"));
    await act(async () => {
      vi.advanceTimersByTime(14000);
    });
    expect(text()).toContain(i18n.t("explorer.notAvailable"));
    expect(container!.querySelector(".adp-skeleton-rows")).toBeNull();
  });

  it("folders get a chevron and are drop targets", async () => {
    await renderPane({
      role: "child",
      listing: ready([item("docs", "folder", "C:\\F\\docs"), item("a.txt")]),
    });
    const docs = [...container!.querySelectorAll<HTMLElement>("[role='option']")].find((row) => row.textContent === "docs")!;
    const file = [...container!.querySelectorAll<HTMLElement>("[role='option']")].find((row) => row.textContent === "a.txt")!;
    expect(docs.querySelector(".adp-colview-chevron")).not.toBeNull();
    expect(docs.getAttribute("data-drop-folder")).toBe("C:\\F\\docs");
    expect(file.querySelector(".adp-colview-chevron")).toBeNull();
    expect(file.getAttribute("data-drop-folder")).toBeNull();
  });

  it("the open folder's column is the file list", async () => {
    await renderPane();
    expect(container!.querySelectorAll("[role='option']")).toHaveLength(4);
    const list = container!.querySelector<HTMLElement>(".adp-filelist-scroll.adp-colview-list")!;
    expect(list).not.toBeNull();
    expect(list.getAttribute("role")).toBe("listbox");
    expect(list.getAttribute("aria-multiselectable")).toBe("true");
    expect(list.getAttribute("tabindex")).toBe("0");
    expect(container!.querySelector(".adp-colview-column")!.classList.contains("adp-colview-column--active")).toBe(true);
  });

  it("Up and Down move like Details", async () => {
    const pane = await renderPane({}, selectOnly(items[0].path));
    await pane.key({ key: "ArrowDown" });
    expect(selected(pane.current())).toEqual(["beta.txt"]);
    await pane.key({ key: "ArrowDown", shiftKey: true });
    expect(selected(pane.current())).toEqual(["beta.txt", "bravo.txt"]);
  });

  it("Left and Right ask to change columns", async () => {
    const pane = await renderPane();
    await pane.key({ key: "ArrowRight" });
    await pane.key({ key: "ArrowLeft" });
    await pane.key({ key: "ArrowLeft", altKey: true });
    await pane.key({ key: "ArrowRight", shiftKey: true });
    expect(pane.spies.onNavigateKey.mock.calls).toEqual([["right"], ["left"]]);
  });

  it("clicks, Enter and the menu key work as in Details", async () => {
    const pane = await renderPane();
    await pane.click(0);
    expect(selected(pane.current())).toEqual(["alpha.txt"]);
    await pane.click(1, { ctrlKey: true });
    expect(selected(pane.current())).toEqual(["alpha.txt", "beta.txt"]);
    await pane.key({ key: "Enter" });
    expect(pane.spies.onCommandKey.mock.calls[0][0]).toBe("explorer.open");
    await pane.key({ key: "ContextMenu" });
    expect(pane.spies.onContextMenu.mock.calls[0][1]).toEqual(items[1]);
  });

  it("rename box and check boxes live in the open folder's column", async () => {
    await renderPane({ view: { renamingPath: items[1].path } }, selectOnly(items[1].path));
    const renaming = container!.querySelector("[data-index='1']")!;
    expect(renaming.querySelector(".adp-rename-input")).not.toBeNull();
    const pane = await renderPane({ view: { checkboxes: true } });
    await act(async () => {
      container!.querySelector<HTMLElement>("[data-index='3'] .adp-row-check")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, detail: 1 }),
      );
    });
    expect(selected(pane.current())).toEqual(["charlie.txt"]);
  });

  it("shows the cached rows while the folder loads", async () => {
    await renderPane({
      loading: true,
      view: { items: [] },
      listing: ready([item("x.txt"), item("y.txt")]),
    });
    const rows = [...container!.querySelectorAll<HTMLElement>("[role='option']")];
    expect(rows.map((row) => row.textContent)).toEqual(["x.txt", "y.txt"]);
    expect(container!.querySelector(".adp-skeleton-rows")).toBeNull();
  });

  it("notes of the open folder show inside its column", async () => {
    await renderPane({ note: "empty", view: { items: [] } });
    expect(text()).toContain(i18n.t("explorer.emptyFolder"));
    expect(container!.querySelector(".adp-filelist-scroll")).not.toBeNull();
    await renderPane({ note: "noResults", view: { items: [] } });
    expect(text()).toContain(i18n.t("explorer.noSearchResults"));
    await renderPane({ note: "loading", view: { items: [] }, listing: null });
    expect(container!.querySelector(".adp-skeleton-rows")).not.toBeNull();
  });
});
