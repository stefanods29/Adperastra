import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import "../i18n";
import FileList from "../views/explorer/FileList";
import type { ExplorerItem } from "../services/explorer";
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number; estimateSize: () => number }) => ({
    getTotalSize: () => opts.count * opts.estimateSize(),
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, index) => ({ index, start: index * opts.estimateSize(), key: index })),
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

describe("FileList keyboard navigation", () => {
  it("ArrowDown and ArrowUp move selection and focus", async () => {
    const items = [item("a.txt"), item("b.txt"), item("c.txt")];
    const onSelect = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <FileList
          items={items}
          selectedPath={items[0].path}
          sortKey="name"
          sortDirection="ascending"
          onSort={() => undefined}
          onSelect={onSelect}
          onOpen={() => undefined}
        />,
      );
    });
    const rows = container.querySelectorAll<HTMLButtonElement>(".adp-file-row");
    expect(rows.length).toBeGreaterThan(0);
    rows[0].focus();
    await act(async () => {
      rows[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith(items[1]);
    await act(async () => root.unmount());
    container.remove();
  });
});
