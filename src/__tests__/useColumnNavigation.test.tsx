import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExplorerItem } from "../services/explorer";
import { selectOnly } from "../services/selection";
import {
  useColumnNavigation,
  type ColumnNavigationInput,
  type ColumnNavigate,
} from "../views/explorer/views/useColumnNavigation";

let latest: ColumnNavigate | null = null;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Probe(props: ColumnNavigationInput) {
  latest = useColumnNavigation(props);
  return null;
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  latest = null;
  vi.restoreAllMocks();
});

const item = (path: string): ExplorerItem => ({
  path,
  name: path.split("\\").pop() ?? path,
  kind: "file",
  size: 1,
  modified_unix: 1700000000,
  hidden: false,
  system: false,
  is_link: false,
  online_only: false,
  file_id: null,
  file_id_stable: false,
});

interface Harness {
  goToFolder: ReturnType<typeof vi.fn>;
  setSelection: ReturnType<typeof vi.fn>;
  openContextMenu: ReturnType<typeof vi.fn>;
  pendingSelectRef: { current: string | null };
  render: (patch?: Partial<ColumnNavigationInput>) => Promise<void>;
  call: (folder: string, select: string | null, menuPoint: { x: number; y: number } | null) => void;
}

function harness(base: Partial<ColumnNavigationInput> = {}): Harness {
  const goToFolder = vi.fn();
  const setSelection = vi.fn();
  const openContextMenu = vi.fn();
  const pendingSelectRef: { current: string | null } = { current: null };
  const props: ColumnNavigationInput = {
    location: { type: "folder", path: "C:\\F" },
    orderPaths: [],
    selection: selectOnly("C:\\F\\a.txt"),
    itemByPath: new Map(),
    goToFolder,
    setSelection,
    pendingSelectRef,
    openContextMenu,
    ...base,
  };
  const render = async (patch: Partial<ColumnNavigationInput> = {}) => {
    Object.assign(props, patch);
    if (!root) {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
    }
    await act(async () => {
      root!.render(<Probe {...props} />);
    });
  };
  return {
    goToFolder,
    setSelection,
    openContextMenu,
    pendingSelectRef,
    render,
    call: (folder, select, menuPoint) => latest!(folder, select, menuPoint),
  };
}

describe("useColumnNavigation", () => {
  it("opens another folder and remembers what to select", async () => {
    const test = harness();
    await test.render();
    test.call("C:\\Other", "C:\\Other\\x.txt", null);
    expect(test.goToFolder).toHaveBeenCalledWith("C:\\Other");
    expect(test.pendingSelectRef.current).toBe("C:\\Other\\x.txt");
    expect(test.openContextMenu).not.toHaveBeenCalled();
  });

  it("selects at once in the open folder", async () => {
    const paths = ["\\\\?\\C:\\F\\a.txt", "\\\\?\\C:\\F\\b.txt"];
    const test = harness({ orderPaths: paths });
    await test.render();
    test.call("c:\\f\\", "C:\\F\\b.txt", null);
    expect(test.goToFolder).not.toHaveBeenCalled();
    expect(test.setSelection).toHaveBeenCalledWith(selectOnly("\\\\?\\C:\\F\\b.txt"));
  });

  it("opens the item menu once the item is selected", async () => {
    const path = "\\\\?\\C:\\Other\\x.txt";
    const file = item(path);
    const test = harness();
    await test.render();
    test.call("C:\\Other", "C:\\Other\\x.txt", { x: 5, y: 6 });
    await test.render({ selection: selectOnly(path), itemByPath: new Map([[path, file]]) });
    expect(test.openContextMenu).toHaveBeenCalledTimes(1);
    expect(test.openContextMenu).toHaveBeenCalledWith({ x: 5, y: 6 }, file);
    await test.render({ selection: selectOnly(path), itemByPath: new Map([[path, file]]) });
    expect(test.openContextMenu).toHaveBeenCalledTimes(1);
  });

  it("an old wish never opens a menu", async () => {
    const path = "\\\\?\\C:\\Other\\x.txt";
    const file = item(path);
    const test = harness();
    await test.render();
    const now = vi.spyOn(performance, "now");
    now.mockReturnValueOnce(1000).mockReturnValue(2600);
    test.call("C:\\Other", "C:\\Other\\x.txt", { x: 5, y: 6 });
    await test.render({ selection: selectOnly(path), itemByPath: new Map([[path, file]]) });
    expect(test.openContextMenu).not.toHaveBeenCalled();
  });
});
