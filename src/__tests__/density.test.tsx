import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { AppearanceContext, ROW_SIZES } from "../appearance/density";
import type { ExplorerItem } from "../services/explorer";
import { EMPTY_SELECTION } from "../services/selection";
import { defaultSettings, type Density } from "../services/settings";
import FileList, { type FileListProps } from "../views/explorer/FileList";
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number; estimateSize: (index: number) => number }) => ({
    getTotalSize: () => opts.count * 28,
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, index) => ({ index, start: index * opts.estimateSize(index), key: index })),
    scrollToIndex: () => undefined,
  }),
}));

const item = (name: string): ExplorerItem => ({
  path: `C:\\F\\${name}`,
  name,
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

const items = [item("alpha.txt"), item("beta.txt"), item("bravo.txt"), item("charlie.txt")];
let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const props = (): FileListProps => ({
  items,
  groups: null,
  selection: EMPTY_SELECTION,
  onSelectionChange: () => undefined,
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
});

async function renderList(density: Density | null) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const list = <FileList {...props()} />;
  await act(async () => {
    root?.render(density === null ? list : <AppearanceContext.Provider value={density}>{list}</AppearanceContext.Provider>);
  });
  return container.querySelectorAll<HTMLElement>("[role='option']");
}

describe("density", () => {
  it("row sizes per density", () => {
    expect(ROW_SIZES.compact).toEqual({ row: 24, listItem: 20 });
    expect(ROW_SIZES.comfortable).toEqual({ row: 28, listItem: 24 });
    expect(ROW_SIZES.spacious).toEqual({ row: 36, listItem: 30 });
  });

  it("Details rows follow the density", async () => {
    expect(defaultSettings().appearance.density).toBe("comfortable");
    const rows = await renderList("spacious");
    expect(rows[1].style.transform).toBe("translateY(36px)");
    expect(rows[1].style.height).toBe("36px");
  });

  it("without a provider rows keep 28 px", async () => {
    const rows = await renderList(null);
    expect(rows[1].style.transform).toBe("translateY(28px)");
    expect(rows[1].style.height).toBe("28px");
  });
});
