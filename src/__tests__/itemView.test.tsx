import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import ItemView from "../views/explorer/views/ItemView";
import type { ItemViewProps } from "../views/explorer/views/useItemInteractions";
import type { ViewModeId } from "../services/settings";
import type { ExplorerItem } from "../services/explorer";
import { EMPTY_SELECTION } from "../services/selection";
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

async function renderItemView(mode: ViewModeId, onZoomStep?: (direction: 1 | -1) => void) {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const props: ItemViewProps = {
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
  };
  await act(async () => {
    root!.render(<ItemView mode={mode} onZoomStep={onZoomStep} {...props} />);
  });
  return container.querySelector<HTMLElement>(".adp-itemview")!;
}

const wheel = (element: HTMLElement, init: WheelEventInit) => {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
  element.dispatchEvent(event);
  return event;
};

describe("ItemView", () => {
  it("shows the component for the mode", async () => {
    await renderItemView("details");
    expect(container!.querySelector(".adp-filelist-header")).not.toBeNull();
    await renderItemView("list");
    expect(container!.querySelector(".adp-flowlist")).not.toBeNull();
    await renderItemView("tiles");
    expect(container!.querySelector(".adp-itemgrid--tiles")).not.toBeNull();
  });

  it("Ctrl+wheel steps the view and never scrolls the page", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    try {
      const onZoomStep = vi.fn();
      const view = await renderItemView("details", onZoomStep);
      expect(wheel(view, { ctrlKey: true, deltaY: -120 }).defaultPrevented).toBe(true);
      expect(wheel(view, { ctrlKey: true, deltaY: -120 }).defaultPrevented).toBe(true);
      expect(onZoomStep.mock.calls).toEqual([[1]]);
      vi.advanceTimersByTime(200);
      expect(wheel(view, { ctrlKey: true, deltaY: 120 }).defaultPrevented).toBe(true);
      expect(onZoomStep.mock.calls).toEqual([[1], [-1]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("small touchpad steps add up", async () => {
    const onZoomStep = vi.fn();
    const view = await renderItemView("details", onZoomStep);
    wheel(view, { ctrlKey: true, deltaY: -60 });
    wheel(view, { ctrlKey: true, deltaY: -60 });
    expect(onZoomStep.mock.calls).toEqual([[1]]);
  });

  it("without Ctrl the wheel is left alone", async () => {
    const onZoomStep = vi.fn();
    const view = await renderItemView("details", onZoomStep);
    expect(wheel(view, { deltaY: 120 }).defaultPrevented).toBe(false);
    expect(onZoomStep).not.toHaveBeenCalled();
  });
});
