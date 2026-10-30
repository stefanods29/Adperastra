import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import FileGrid from "../views/explorer/views/FileGrid";
import type { GridModeId } from "../views/explorer/views/viewModes";
import type { ItemViewProps } from "../views/explorer/views/useItemInteractions";
import type { ExplorerItem } from "../services/explorer";
import { EMPTY_SELECTION, selectOnly, type SelectionState } from "../services/selection";
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number; estimateSize: (index: number) => number }) => ({
    getTotalSize: () => opts.count * 28,
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, index) => ({ index, start: index * opts.estimateSize(index), key: index })),
    scrollToIndex: () => undefined,
  }),
}));

const item = (name: string, kind: "file" | "folder" = "file"): ExplorerItem => ({
  path: `C:\\F\\${name}`,
  name,
  kind,
  size: 1,
  modified_unix: 1700000000,
  hidden: false,
  system: false,
  is_link: false,
  online_only: false,
  file_id: null,
  file_id_stable: false,
});

const items = [item("alpha.txt"), item("beta.txt"), item("bravo.txt"), item("charlie.txt")];
let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

/** Renders the grid with a real selection state that follows changes. */
async function renderGrid(
  overrides: Partial<ItemViewProps> = {},
  initial: SelectionState = EMPTY_SELECTION,
  mode: GridModeId = "largeIcons",
) {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const changes: SelectionState[] = [];
  let selection = initial;
  const props = (): ItemViewProps => ({
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
    onOpen: () => undefined,
    onContextMenu: () => undefined,
    onCommandKey: () => undefined,
    label: "Files",
    ...overrides,
  });
  const rerender = async () => {
    await act(async () => {
      root?.render(<FileGrid mode={mode} {...props()} />);
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
  return { changes, key, rows, click, current: () => selection };
}

const selected = (state: SelectionState) => [...state.selected].map((p) => p.split("\\").pop()).sort();

describe("FileGrid", () => {
  it("draws every item as an option in a listbox", async () => {
    await renderGrid();
    expect([...container!.querySelectorAll("[role='option']")].map((node) => node.textContent)).toEqual([
      "alpha.txt",
      "beta.txt",
      "bravo.txt",
      "charlie.txt",
    ]);
    expect(container!.querySelector(".adp-filelist-scroll")).not.toBeNull();
  });

  it("lays items out in rows", async () => {
    await renderGrid();
    expect([...container!.querySelectorAll(".adp-itemgrid-row")].map((row) => row.querySelectorAll("[role='option']").length)).toEqual([4]);
    await renderGrid({}, EMPTY_SELECTION, "extraLargeIcons");
    expect([...container!.querySelectorAll(".adp-itemgrid-row")].map((row) => row.querySelectorAll("[role='option']").length)).toEqual([3, 1]);
  });

  it("arrow keys move by the grid", async () => {
    const grid = await renderGrid({}, selectOnly(items[0].path), "extraLargeIcons");
    await grid.key({ key: "ArrowDown" });
    expect(selected(grid.current())).toEqual(["charlie.txt"]);
    await grid.key({ key: "ArrowRight" });
    expect(selected(grid.current())).toEqual(["charlie.txt"]);
    await grid.key({ key: "ArrowUp" });
    expect(selected(grid.current())).toEqual(["alpha.txt"]);
    await grid.key({ key: "ArrowRight" });
    expect(selected(grid.current())).toEqual(["beta.txt"]);
    await grid.key({ key: "ArrowDown", shiftKey: true });
    expect(selected(grid.current())).toEqual(["beta.txt", "bravo.txt", "charlie.txt"]);
  });

  it("clicks select like Details", async () => {
    const grid = await renderGrid();
    await grid.click(0);
    expect(selected(grid.current())).toEqual(["alpha.txt"]);
    await grid.click(2, { ctrlKey: true });
    expect(selected(grid.current())).toEqual(["alpha.txt", "bravo.txt"]);
    await grid.click(3, { shiftKey: true });
    expect(selected(grid.current())).toEqual(["bravo.txt", "charlie.txt"]);
  });

  it("group headers start new rows", async () => {
    await renderGrid({
      groups: [
        { id: "text", label: "Text files", items: [items[0], items[1], items[2]] },
        { id: "other", items: [items[3]] },
      ],
    });
    const headers = [...container!.querySelectorAll(".adp-itemgrid-header")];
    expect(headers.map((header) => header.querySelector("span")?.textContent)).toEqual(["Text files", "Other"]);
    expect(headers.map((header) => header.querySelector(".adp-group-count")?.textContent)).toEqual(["3", "1"]);
    expect(container!.querySelectorAll(".adp-itemgrid-row")).toHaveLength(2);
  });

  it("shows the rename box inside the cell", async () => {
    await renderGrid({ renamingPath: items[1].path }, selectOnly(items[1].path));
    const cell = container!.querySelector("[data-index='1']")!;
    expect(cell.querySelector(".adp-rename-input")).not.toBeNull();
  });

  it("tiles and content show more details", async () => {
    await renderGrid({}, EMPTY_SELECTION, "tiles");
    expect(container!.querySelector("[role='option']")!.textContent).toContain("TXT file");
    await renderGrid({}, EMPTY_SELECTION, "content");
    const text = container!.querySelector("[role='option']")!.textContent;
    expect(text).toContain("Date modified:");
    expect(text).toContain("Size:");
  });

  it("check boxes toggle items", async () => {
    const grid = await renderGrid({ checkboxes: true });
    await act(async () => {
      grid.rows()[2].querySelector(".adp-row-check")!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });
    expect(selected(grid.current())).toEqual(["bravo.txt"]);
  });

  it("routes Enter, F2 and the menu key to the Explorer", async () => {
    const onCommandKey = vi.fn();
    const onContextMenu = vi.fn();
    const grid = await renderGrid({ onCommandKey, onContextMenu }, selectOnly(items[0].path));
    await grid.key({ key: "Enter" });
    await grid.key({ key: "F2" });
    await grid.key({ key: "ContextMenu" });
    expect(onCommandKey.mock.calls.map((call) => call[0])).toEqual(["explorer.open", "explorer.rename"]);
    expect(onContextMenu.mock.calls[0][1]).toEqual(items[0]);
  });

  it("double-click opens and middle-click opens in the background", async () => {
    const onOpen = vi.fn();
    const onOpenInBackground = vi.fn();
    const grid = await renderGrid({ onOpen, onOpenInBackground });
    await act(async () => {
      grid.rows()[0].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(onOpen).toHaveBeenCalledWith(items[0]);
    await act(async () => {
      grid.rows()[0].dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    });
    expect(onOpenInBackground).toHaveBeenCalledWith(items[0]);
  });
});
