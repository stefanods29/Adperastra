import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import type { FolderListing } from "../services/columnListing";
import { listFolder } from "../services/columnListing";
import type { ExplorerItem } from "../services/explorer";
import { EMPTY_SELECTION, selectOnly, type SelectionState } from "../services/selection";
import ColumnView from "../views/explorer/views/ColumnView";
import type { ColumnViewOptions } from "../views/explorer/views/columnTrail";
import type { ItemViewProps } from "../views/explorer/views/useItemInteractions";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number; estimateSize: (index: number) => number }) => ({
    getTotalSize: () => opts.count * 28,
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, index) => ({ index, start: index * opts.estimateSize(index), key: index })),
    scrollToIndex: () => undefined,
  }),
}));

vi.mock("../services/columnListing", () => ({ listFolder: vi.fn() }));

const item = (
  name: string,
  kind: "file" | "folder" = "file",
  path: string = `C:\\F\\${name}`,
): ExplorerItem => ({
  path,
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

const items = [item("docs", "folder", "C:\\F\\docs"), item("alpha.txt"), item("beta.txt")];

type Request = { done: Promise<FolderListing>; cancel: () => void };
const resolved = (list: ExplorerItem[]): Request => ({
  done: Promise.resolve({ items: list, partial: false }),
  cancel: vi.fn(),
});
const never = (): Request => ({ done: new Promise(() => undefined), cancel: vi.fn() });

const rootListing = () =>
  resolved([item("F", "folder", "C:\\F"), item("Other", "folder", "C:\\Other")]);

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

type ViewOverrides = Partial<ItemViewProps>;
type OptionOverrides = Partial<ColumnViewOptions>;

/** Renders the column view with a real selection state that follows changes. */
async function renderView(
  viewOverrides: ViewOverrides = {},
  optionOverrides: OptionOverrides = {},
  initial: SelectionState = EMPTY_SELECTION,
) {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const changes: SelectionState[] = [];
  let selection = initial;
  const spies = {
    onWidthChange: vi.fn(),
    onNavigate: vi.fn(),
    onDragItem: vi.fn(),
    onOpen: vi.fn(),
  };
  const viewProps = (): ItemViewProps => ({
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
    onContextMenu: () => undefined,
    onCommandKey: () => undefined,
    label: "Files",
    ...viewOverrides,
  });
  const options = (): ColumnViewOptions => ({
    folder: "C:\\F",
    root: "C:\\",
    note: null,
    loading: false,
    showHidden: false,
    groupBy: "none",
    refreshKey: 0,
    width: 240,
    showPreview: true,
    onWidthChange: spies.onWidthChange,
    onNavigate: spies.onNavigate,
    onDragItem: spies.onDragItem,
    ...optionOverrides,
  });
  const rerender = async () => {
    await act(async () => {
      root?.render(<ColumnView {...viewProps()} options={options()} />);
    });
  };
  await rerender();
  await act(async () => undefined);
  await act(async () => undefined);
  const activeList = () =>
    container!.querySelector<HTMLElement>(".adp-colview-column--active .adp-colview-list")!;
  const key = async (init: KeyboardEventInit) => {
    await act(async () => {
      activeList().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
    });
  };
  const clickRow = async (text: string) => {
    const row = [...container!.querySelectorAll<HTMLElement>(".adp-colview-row")].find(
      (entry) => entry.textContent === text,
    )!;
    await act(async () => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });
  };
  return { changes, key, clickRow, spies, current: () => selection };
}

const columns = () => container!.querySelectorAll(".adp-colview-column");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listFolder).mockImplementation((path: string) => (path === "C:\\" ? rootListing() : never()));
});

describe("ColumnView", () => {
  it("shows the columns from the root to the open folder", async () => {
    await renderView();
    expect(columns()).toHaveLength(2);
    const first = container!.querySelectorAll<HTMLElement>(".adp-colview-column")[0];
    expect(first.classList.contains("adp-colview-column--parent")).toBe(true);
    const way = [...first.querySelectorAll<HTMLElement>("[role='option']")].find((row) => row.textContent === "F")!;
    expect(way.classList.contains("adp-colview-row--path")).toBe(true);
    const second = container!.querySelectorAll<HTMLElement>(".adp-colview-column")[1];
    expect(second.classList.contains("adp-colview-column--active")).toBe(true);
    expect(vi.mocked(listFolder).mock.calls[0][0]).toBe("C:\\");
    expect(vi.mocked(listFolder).mock.calls[0][1]).toEqual({ key: "name", direction: "ascending" });
  });

  it("a selected folder adds its column after a short wait", async () => {
    vi.useFakeTimers();
    vi.mocked(listFolder).mockImplementation((path: string) => {
      if (path === "C:\\") return rootListing();
      if (path === "C:\\F\\docs") return resolved([item("inside.txt", "file", "C:\\F\\docs\\inside.txt")]);
      return never();
    });
    await renderView({}, {}, selectOnly("C:\\F\\docs"));
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    await act(async () => undefined);
    await act(async () => undefined);
    expect(vi.mocked(listFolder).mock.calls.some((call) => call[0] === "C:\\F\\docs")).toBe(true);
    expect(columns()).toHaveLength(3);
    const last = container!.querySelectorAll<HTMLElement>(".adp-colview-column")[2];
    expect(last.classList.contains("adp-colview-column--child")).toBe(true);
    expect([...last.querySelectorAll("[role='option']")].map((row) => row.textContent)).toEqual(["inside.txt"]);
  });

  it("a selected file shows its preview", async () => {
    const view = await renderView({}, {}, selectOnly("C:\\F\\alpha.txt"));
    const preview = container!.querySelector(".adp-colview-preview")!;
    expect(preview.textContent).toContain("alpha.txt");
    expect(preview.textContent).toContain("TXT file");
    await act(async () => {
      preview.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(view.spies.onOpen).toHaveBeenCalledWith(items[1]);
    await renderView({}, { showPreview: false }, selectOnly("C:\\F\\alpha.txt"));
    expect(container!.querySelector(".adp-colview-preview")).toBeNull();
  });

  it("Right opens the selected folder at its first item", async () => {
    vi.useFakeTimers();
    vi.mocked(listFolder).mockImplementation((path: string) => {
      if (path === "C:\\") return rootListing();
      if (path === "C:\\F\\docs") {
        return resolved([
          item("inside.txt", "file", "C:\\F\\docs\\inside.txt"),
          item("more.txt", "file", "C:\\F\\docs\\more.txt"),
        ]);
      }
      return never();
    });
    const view = await renderView({}, {}, selectOnly("C:\\F\\docs"));
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    await act(async () => undefined);
    await act(async () => undefined);
    await view.key({ key: "ArrowRight" });
    expect(view.spies.onNavigate.mock.calls[0]).toEqual(["C:\\F\\docs", "C:\\F\\docs\\inside.txt", null]);
  });

  it("Right before the folder has loaded opens it with nothing selected", async () => {
    const view = await renderView({}, {}, selectOnly("C:\\F\\docs"));
    await view.key({ key: "ArrowRight" });
    expect(view.spies.onNavigate.mock.calls[0]).toEqual(["C:\\F\\docs", null, null]);
  });

  it("Right on a file does nothing", async () => {
    const view = await renderView({}, {}, selectOnly("C:\\F\\alpha.txt"));
    await view.key({ key: "ArrowRight" });
    expect(view.spies.onNavigate).not.toHaveBeenCalled();
  });

  it("Left goes one column back", async () => {
    const view = await renderView();
    await view.key({ key: "ArrowLeft" });
    expect(view.spies.onNavigate.mock.calls[0]).toEqual(["C:\\", "C:\\F", null]);
  });

  it("Left at the first column opens the parent folder", async () => {
    const view = await renderView({}, { root: "C:\\F" });
    await view.key({ key: "ArrowLeft" });
    expect(view.spies.onNavigate.mock.calls[0]).toEqual(["C:\\", "C:\\F", null]);
    expect(listFolder).not.toHaveBeenCalled();
  });

  it("Left at a drive root does nothing", async () => {
    const view = await renderView({ items: [] }, { root: "C:\\", folder: "C:\\" });
    await view.key({ key: "ArrowLeft" });
    expect(view.spies.onNavigate).not.toHaveBeenCalled();
  });

  it("clicking in another column opens it", async () => {
    const view = await renderView();
    await view.clickRow("Other");
    expect(view.spies.onNavigate.mock.calls[0]).toEqual(["C:\\", "C:\\Other", null]);
    const firstColumn = container!.querySelectorAll<HTMLElement>(".adp-colview-column")[0];
    const firstList = firstColumn.querySelector<HTMLElement>(".adp-colview-list")!;
    await act(async () => {
      firstList.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(view.spies.onNavigate.mock.calls[1]).toEqual(["C:\\", "C:\\F", null]);
  });

  it("dragging a divider resizes every column", async () => {
    const view = await renderView();
    const divider = container!.querySelector<HTMLElement>(".adp-colview-resizer")!;
    await act(async () => {
      divider.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 100 }));
    });
    await act(async () => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 160 }));
    });
    await act(async () => {
      window.dispatchEvent(new MouseEvent("mouseup", { clientX: 160 }));
    });
    for (const column of columns()) {
      expect((column as HTMLElement).style.width).toBe("300px");
    }
    expect(view.spies.onWidthChange).toHaveBeenCalledTimes(1);
    expect(view.spies.onWidthChange).toHaveBeenCalledWith(300);
  });

  it("the divider keeps the limits and double-click resets it", async () => {
    const view = await renderView();
    const divider = container!.querySelector<HTMLElement>(".adp-colview-resizer")!;
    await act(async () => {
      divider.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 100 }));
    });
    await act(async () => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 1000 }));
    });
    await act(async () => {
      window.dispatchEvent(new MouseEvent("mouseup", { clientX: 1000 }));
    });
    expect(view.spies.onWidthChange).toHaveBeenCalledWith(480);
    await act(async () => {
      divider.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(view.spies.onWidthChange).toHaveBeenLastCalledWith(240);
  });

  it("a link back up never repeats a column", async () => {
    await renderView({ items: [item("up", "folder", "C:\\")] }, {}, selectOnly("C:\\"));
    expect(columns()).toHaveLength(2);
    const calledPaths = vi.mocked(listFolder).mock.calls.map((call) => call[0]);
    expect(calledPaths).toEqual(["C:\\"]);
  });

  it("the open folder's column gets the focus", async () => {
    await renderView();
    const list = container!.querySelector<HTMLElement>(".adp-colview-column--active .adp-colview-list");
    expect(document.activeElement).toBe(list);
  });

  it("only the open folder's column is the file list", async () => {
    await renderView();
    expect(container!.querySelectorAll(".adp-filelist-scroll")).toHaveLength(1);
    expect(container!.querySelector(".adp-colview-column--active .adp-filelist-scroll")).not.toBeNull();
  });
});
