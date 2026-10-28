import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import FileList, { type FileListProps } from "../views/explorer/FileList";
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

/** Renders the list with a real selection state that follows changes. */
async function renderList(overrides: Partial<FileListProps> = {}, initial: SelectionState = EMPTY_SELECTION) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const changes: SelectionState[] = [];
  let selection = initial;
  const props = (): FileListProps => ({
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
      root?.render(<FileList {...props()} />);
    });
  };
  await rerender();
  const list = container.querySelector<HTMLElement>("[role='listbox']")!;
  const key = async (init: KeyboardEventInit) => {
    await act(async () => {
      list.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
    });
  };
  const rows = () => {
    return container!.querySelectorAll<HTMLElement>("[role='option']");
  };
  const click = async (index: number, init: MouseEventInit = {}) => {
    await act(async () => {
      rows()[index].dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, ...init }));
    });
  };
  return { changes, key, rows, click, current: () => selection };
}

const selected = (state: SelectionState) => [...state.selected].map((p) => p.split("\\").pop()).sort();

describe("FileList", () => {
  it("arrow keys move the selection and Shift extends it", async () => {
    const list = await renderList({}, selectOnly(items[0].path));
    await list.key({ key: "ArrowDown" });
    expect(selected(list.current())).toEqual(["beta.txt"]);
    await list.key({ key: "ArrowDown", shiftKey: true });
    expect(selected(list.current())).toEqual(["beta.txt", "bravo.txt"]);
    await list.key({ key: "a", ctrlKey: true });
    expect(list.current().selected.size).toBe(4);
  });

  it("clicks select, Ctrl+click toggles, Shift+click selects a range", async () => {
    const list = await renderList();
    await list.click(1);
    expect(selected(list.current())).toEqual(["beta.txt"]);
    await list.click(3, { ctrlKey: true });
    expect(selected(list.current())).toEqual(["beta.txt", "charlie.txt"]);
    // The anchor is now charlie.txt (the last Ctrl+click), so Shift+click
    // on alpha.txt selects everything between them.
    await list.click(0, { shiftKey: true });
    expect(selected(list.current())).toEqual(["alpha.txt", "beta.txt", "bravo.txt", "charlie.txt"]);
    expect(list.rows()[0].getAttribute("aria-selected")).toBe("true");
  });

  it("type-ahead jumps to the next matching name", async () => {
    const list = await renderList({}, selectOnly(items[0].path));
    await list.key({ key: "b" });
    expect(selected(list.current())).toEqual(["beta.txt"]);
    await list.key({ key: "b" });
    expect(selected(list.current())).toEqual(["bravo.txt"]);
  });

  it("routes command keys and right-clicks to the Explorer", async () => {
    const onCommandKey = vi.fn();
    const onContextMenu = vi.fn();
    const list = await renderList({ onCommandKey, onContextMenu }, selectOnly(items[1].path));
    await list.key({ key: "F2" });
    await list.key({ key: "Enter" });
    await list.key({ key: "Enter", altKey: true });
    expect(onCommandKey.mock.calls.map((call) => call[0])).toEqual(["explorer.rename", "explorer.open", "explorer.properties"]);
    await act(async () => {
      list.rows()[2].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 40, clientY: 50 }));
    });
    expect(selected(list.current())).toEqual(["bravo.txt"]);
    expect(onContextMenu).toHaveBeenCalledWith({ x: 40, y: 50 }, items[2]);
  });

  it("shows the rename box with only the name part selected, and Escape cancels", async () => {
    const onRenameCancel = vi.fn();
    await renderList({ renamingPath: items[1].path, onRenameCancel }, selectOnly(items[1].path));
    const input = container!.querySelector<HTMLInputElement>(".adp-rename-input")!;
    expect(input.value).toBe("beta.txt");
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4]);
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onRenameCancel).toHaveBeenCalledOnce();
  });

  it("warns before renaming a system item and needs a second Enter", async () => {
    const system = { ...item("boot.ini"), system: true };
    const onRenameCommit = vi.fn(async () => null);
    await renderList({ items: [system], renamingPath: system.path, onRenameCommit }, selectOnly(system.path));
    const input = container!.querySelector<HTMLInputElement>(".adp-rename-input")!;
    const enter = async () => {
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
    };
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "boot2.ini");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await enter();
    expect(onRenameCommit).not.toHaveBeenCalled();
    expect(container!.querySelector("[role='alert']")?.textContent).toContain("system");
    await enter();
    expect(onRenameCommit).toHaveBeenCalledWith(system, "boot2.ini");
  });

  it("hides extensions when asked and groups items under headers", async () => {
    await renderList({
      showExtensions: false,
      groups: [
        { id: "aToH", items: [items[0], items[1], items[2]] },
        { id: "other", items: [items[3]] },
      ],
    });
    expect(container!.textContent).toContain("alpha");
    expect(container!.textContent).not.toContain("alpha.txt");
    expect(container!.querySelectorAll(".adp-group-header")).toHaveLength(2);
    expect(container!.textContent).toContain("A–H");
  });
});
