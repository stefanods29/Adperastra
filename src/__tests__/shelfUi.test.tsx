import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import i18n from "../i18n";
import ShelfPanel from "../shelf/ShelfPanel";
import { isShelfToggleShortcut } from "../shelf/shelfValidation";
import { refreshShelf, type ShelfCatalog, type ShelfItem } from "../services/shelf";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const refreshMock = vi.mocked(refreshShelf);

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: { count: number; estimateSize: (index: number) => number }) => ({
    getTotalSize: () => options.count * 72,
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
        index,
        start: index * options.estimateSize(index),
        key: index,
      })),
    scrollToIndex: () => undefined,
  }),
}));

vi.mock("../components/FileThumbnail", () => ({
  default: ({ active }: { active: boolean }) => (
    <span data-testid="thumb" data-active={active ? "1" : "0"} />
  ),
}));

vi.mock("../shelf/shelfRefresh", () => ({
  useShelfWatcher: () => undefined,
}));

vi.mock("../services/shelf", async (original) => ({
  ...(await original<typeof import("../services/shelf")>()),
  refreshShelf: vi.fn(),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => undefined }),
}));

function item(id: string, name: string, state: ShelfItem["state"] = "available"): ShelfItem {
  return {
    id,
    source: { kind: "disk", path: `C:\\Shelf\\${name}` },
    display_name: name,
    added_unix: 1,
    state,
    last_checked_unix: 1,
    runtime_sensitive: false,
  };
}

function catalog(items: ShelfItem[]): ShelfCatalog {
  return { schema_version: 1, revision: 2, items };
}

function job(result: ShelfCatalog, completion = Promise.resolve(result)) {
  return { id: "shelf-1", cancel: vi.fn(async () => undefined), completion };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let currentItems: ShelfItem[] = [];

async function render(
  items: ShelfItem[],
  props: {
    active?: boolean;
    onPatch?: (patch: unknown) => Promise<void>;
    onAction?: (id: string, ids: readonly string[]) => Promise<void>;
    onOpen?: (id: string) => Promise<void>;
  } = {},
) {
  const onPatch = props.onPatch ?? vi.fn(async () => undefined);
  const onAction = props.onAction ?? vi.fn(async () => undefined);
  const onOpen = props.onOpen ?? vi.fn(async () => undefined);
  currentItems = items;
  const tree = (active: boolean) => (
    <ShelfPanel
      catalog={catalog(items)}
      active={active}
      onPatch={onPatch as never}
      onAction={onAction as never}
      onOpen={onOpen}
      onOpenHelp={() => undefined}
    />
  );
  if (!root) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => {
    root!.render(tree(props.active ?? true));
  });
  for (let index = 0; index < 4; index += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
  }
  return {
    onPatch,
    onAction,
    onOpen,
    rerender: async (active: boolean) => {
      await act(async () => {
        root!.render(tree(active));
      });
      await act(async () => {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      });
    },
  };
}

beforeEach(() => {
  refreshMock.mockReset();
  refreshMock.mockImplementation(async () => job(catalog(currentItems)));
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("the shelf", () => {
  it("uses Ctrl+Alt+S only and leaves Save as alone", () => {
    expect(
      isShelfToggleShortcut({ ctrlKey: true, altKey: true, shiftKey: false, key: "s" }),
    ).toBe(true);
    expect(
      isShelfToggleShortcut({ ctrlKey: true, altKey: true, shiftKey: true, key: "s" }),
    ).toBe(false);
    expect(
      isShelfToggleShortcut({ ctrlKey: true, altKey: false, shiftKey: true, key: "s" }),
    ).toBe(false);
    expect(
      isShelfToggleShortcut({ ctrlKey: true, altKey: false, shiftKey: false, key: "s" }),
    ).toBe(false);
    expect(i18n.t("shelf.title")).toBe("Shelf");
  });

  it("moves through rows, selects with Space and opens the menu", async () => {
    const items = [
      item("00000000-0000-4000-8000-000000000001", "a.txt"),
      item("00000000-0000-4000-8000-000000000002", "b.txt"),
      item("00000000-0000-4000-8000-000000000003", "c.txt"),
    ];
    const { onAction } = await render(items);
    const first = document.querySelector<HTMLElement>('[data-shelf-row="0"]');
    first?.focus();
    await act(async () => {
      first?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(document.activeElement).toBe(document.querySelector('[data-shelf-row="1"]'));
    await act(async () => {
      document
        .querySelector('[data-shelf-row="1"]')
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });
    expect(document.querySelector('[data-shelf-row="1"]')?.getAttribute("aria-selected")).toBe("true");
    await act(async () => {
      document
        .querySelector('[data-shelf-row="1"]')
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true }));
    });
    const copy = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (entry) => entry.textContent === i18n.t("commands.copy"),
    );
    await act(async () => {
      copy?.click();
    });
    expect(onAction).toHaveBeenCalledWith("copy", ["00000000-0000-4000-8000-000000000002"]);
  });

  it("cancels refresh and thumbnail work when the panel is hidden", async () => {
    const pending = new Promise<ShelfCatalog>(() => undefined);
    const cancel = vi.fn(async () => undefined);
    refreshMock.mockResolvedValue({ id: "shelf-1", cancel, completion: pending });
    const { rerender } = await render([
      item("00000000-0000-4000-8000-000000000001", "a.txt"),
    ]);
    expect(refreshMock).toHaveBeenCalled();
    const thumb = document.querySelector('[data-testid="thumb"]');
    expect(thumb?.getAttribute("data-active")).toBe("1");
    await rerender(false);
    expect(cancel).toHaveBeenCalled();
    expect(document.querySelector('[data-testid="thumb"]')?.getAttribute("data-active")).toBe("0");
  });

  it("asks before clearing references", async () => {
    const { onPatch } = await render([
      item("00000000-0000-4000-8000-000000000001", "a.txt"),
    ]);
    const clear = document.querySelector<HTMLButtonElement>(
      `button[aria-label="${i18n.t("shelf.clear")}"]`,
    );
    await act(async () => {
      clear?.click();
    });
    expect(document.body.textContent).toContain(i18n.t("shelf.clearConfirm"));
    const confirm = [...document.querySelectorAll<HTMLButtonElement>(".adp-dialog button")].find(
      (button) => button.textContent === i18n.t("shelf.clear"),
    );
    await act(async () => {
      confirm?.click();
    });
    expect(onPatch).toHaveBeenCalledWith({ kind: "clear" });
  });

  it("shows the empty text and missing state", async () => {
    const { rerender } = await render([]);
    await rerender(true);
    expect(document.body.textContent).toContain(i18n.t("shelf.empty"));
    expect(i18n.t("shelf.missing")).toBe("File not found");
  });
});
