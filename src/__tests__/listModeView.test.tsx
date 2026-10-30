import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import ListModeView from "../views/explorer/views/ListModeView";
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
const manyItems = Array.from({ length: 30 }, (_, index) => item(`f${String(index).padStart(2, "0")}.txt`));
let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

/** Renders the list with a real selection state that follows changes. */
async function renderList(
  overrides: Partial<ItemViewProps> = {},
  initial: SelectionState = EMPTY_SELECTION,
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
      root?.render(<ListModeView {...props()} />);
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
  return { changes, key, rows, click, list, current: () => selection };
}

const selected = (state: SelectionState) => [...state.selected].map((p) => p.split("\\").pop()).sort();

describe("ListModeView", () => {
  it("flows items down, then into the next column", async () => {
    await renderList({ items: manyItems });
    const columns = [...container!.querySelectorAll(".adp-flowlist-column")];
    expect(columns).toHaveLength(2);
    expect(columns[0].querySelectorAll("[role='option']")).toHaveLength(24);
    expect(columns[1].querySelectorAll("[role='option']")).toHaveLength(6);
  });

  it("Down goes to the next item, Right jumps a column", async () => {
    const list = await renderList({ items: manyItems }, selectOnly(manyItems[0].path));
    await list.key({ key: "ArrowDown" });
    expect(selected(list.current())).toEqual(["f01.txt"]);
    await list.key({ key: "ArrowRight" });
    expect(selected(list.current())).toEqual(["f25.txt"]);
    await list.key({ key: "ArrowRight" });
    expect(selected(list.current())).toEqual(["f25.txt"]);
    await list.key({ key: "ArrowLeft" });
    expect(selected(list.current())).toEqual(["f01.txt"]);
    await list.key({ key: "End" });
    expect(selected(list.current())).toEqual(["f29.txt"]);
    await list.key({ key: "Home" });
    expect(selected(list.current())).toEqual(["f00.txt"]);
  });

  it("ignores groups but keeps their order", async () => {
    await renderList({
      groups: [
        { id: "one", items: [items[1], items[0]] },
        { id: "two", items: [items[3]] },
      ],
    });
    expect([...container!.querySelectorAll("[role='option']")].map((node) => node.textContent)).toEqual([
      "beta.txt",
      "alpha.txt",
      "charlie.txt",
    ]);
    expect(container!.querySelector(".adp-group-header")).toBeNull();
  });

  it("the mouse wheel scrolls sideways, Ctrl+wheel is left alone", async () => {
    const list = await renderList({ items: manyItems });
    const wheel = (init: WheelEventInit) => {
      const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
      list.list.dispatchEvent(event);
      return event;
    };
    expect(wheel({ deltaY: 120 }).defaultPrevented).toBe(true);
    expect(wheel({ deltaY: 120, ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it("clicks select and Enter opens", async () => {
    const onCommandKey = vi.fn();
    const list = await renderList({ onCommandKey });
    await list.click(2);
    expect(selected(list.current())).toEqual(["bravo.txt"]);
    list.list.focus();
    await list.key({ key: "Enter" });
    expect(onCommandKey).toHaveBeenCalledWith("explorer.open");
  });
});
