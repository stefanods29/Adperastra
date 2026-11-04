import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import type { SplitLeaf, SplitState } from "../services/splitViews";
import SplitView, { type SplitViewProps } from "../views/split/SplitView";
import { beginCloseWholeSplit, type SplitHost } from "../views/split/splitHost";
import { createScrollSyncPort, type ScrollSyncPort } from "../views/split/scrollSync";

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let rectSpy: ReturnType<typeof vi.spyOn> | null = null;

const leaf = (viewId: string, title: string): SplitLeaf => ({
  view_id: viewId,
  kind: "file",
  source: { kind: "disk", path: `C:\\${title}` },
  handler: "text",
  title,
});

function split(overrides: Partial<SplitState> = {}): SplitState {
  return {
    first: leaf("view-a", "a.txt"),
    second: leaf("view-b", "b.txt"),
    direction: "vertical",
    ratio: 0.5,
    active_side: "first",
    sync_scroll: false,
    ...overrides,
  };
}

function sized(width: number, height = 900): void {
  rectSpy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect);
}

function keyDown(key: string, options: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
}

interface Mounted {
  onChange: ReturnType<typeof vi.fn>;
  onCloseSide: ReturnType<typeof vi.fn>;
  host: SplitHost;
  beginClose: ReturnType<typeof vi.fn>;
  renderLeaf: ReturnType<typeof vi.fn>;
  draw: (state: SplitState) => Promise<void>;
}

async function mountSplit(
  state: SplitState,
  props: Partial<SplitViewProps> = {},
  withPorts = true,
): Promise<Mounted> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const onChange = vi.fn();
  const onCloseSide = vi.fn(async () => undefined);
  const renderLeaf = vi.fn((entry: SplitLeaf, active: boolean) => (
    <div data-leaf={entry.view_id} data-active={active ? "true" : "false"}>
      {entry.title}
    </div>
  ));
  const ports = new Map<string, ScrollSyncPort>();
  const portFor = (viewId: string): ScrollSyncPort => {
    const existing = ports.get(viewId);
    if (existing) return existing;
    const created = createScrollSyncPort({
      view_id: viewId,
      kind: "text",
      getProgress: () => 0,
      applyProgress: () => undefined,
    });
    ports.set(viewId, created.port);
    return created.port;
  };
  const beginClose = vi.fn(async () => false);
  const host: SplitHost = {
    renderLeaf,
    getScrollPort: (viewId): ScrollSyncPort | null => (withPorts ? portFor(viewId) : null),
    dispatchToLeaf: vi.fn(),
    beginClose,
  };
  const draw = async (next: SplitState) => {
    await act(async () => {
      root?.render(
        <SplitView
          tab_id="tab-1"
          state={next}
          active
          host={host}
          onChange={onChange}
          onCloseSide={onCloseSide}
          onOpenHelp={() => undefined}
          {...props}
        />,
      );
    });
  };
  await draw(state);
  return { onChange, onCloseSide, host, beginClose, renderLeaf, draw };
}

const divider = () => container!.querySelector(".adp-split-divider") as HTMLElement | null;
const leafNode = (viewId: string) => container!.querySelector(`[data-leaf="${viewId}"]`) as HTMLElement | null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  rectSpy?.mockRestore();
  rectSpy = null;
});

describe("split view", () => {
  it("keyboard1%/Shift5%: arrows resize by one percent, Shift by five, one commit per key", async () => {
    sized(900);
    const { onChange } = await mountSplit(split());
    const handle = divider();
    expect(handle).not.toBeNull();

    await act(async () => {
      handle!.dispatchEvent(keyDown("ArrowRight"));
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ ratio: 0.51 }));

    await act(async () => {
      handle!.dispatchEvent(keyDown("ArrowRight", { shiftKey: true }));
    });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ ratio: 0.55 }));

    await act(async () => {
      handle!.dispatchEvent(keyDown("ArrowLeft"));
    });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ ratio: 0.49 }));
    expect(handle!.getAttribute("aria-valuenow")).toBe("50");
    expect(handle!.getAttribute("aria-valuemin")).toBe("20");
    expect(handle!.getAttribute("aria-valuemax")).toBe("80");
  });

  it("Home0.5: Home returns the divider to the middle", async () => {
    sized(900);
    const { onChange } = await mountSplit(split({ ratio: 0.7 }));
    await act(async () => {
      divider()!.dispatchEvent(keyDown("Home"));
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ ratio: 0.5 }));
  });

  it("Escoriginalratio: Escape during a drag restores the starting ratio without committing", async () => {
    sized(800);
    const { onChange } = await mountSplit(split({ ratio: 0.5 }));
    const handle = divider()!;
    expect(handle.getAttribute("aria-valuenow")).toBe("50");

    await act(async () => {
      handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 400, clientY: 100 }));
    });
    await act(async () => {
      handle.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 600, clientY: 100 }));
    });
    expect(onChange).not.toHaveBeenCalled();
    // The divider previews the new position without changing the state.
    expect(divider()!.getAttribute("aria-valuenow")).toBe("75");

    await act(async () => {
      window.dispatchEvent(keyDown("Escape"));
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(divider()!.getAttribute("aria-valuenow")).toBe("50");
  });

  it("minwidthcompactnotclip: a narrow window shows one side with an explicit switcher", async () => {
    sized(400);
    const { onChange, renderLeaf } = await mountSplit(split());
    const panes = container!.querySelector(".adp-split-panes") as HTMLElement;
    expect(panes.classList.contains("adp-split-compact")).toBe(true);
    expect(divider()).toBeNull();

    const firstLeaf = container!.querySelector(".adp-split-leaf[data-side='first']") as HTMLElement;
    const secondLeaf = container!.querySelector(".adp-split-leaf[data-side='second']") as HTMLElement;
    expect(firstLeaf.getAttribute("aria-hidden")).toBeNull();
    expect(secondLeaf.getAttribute("aria-hidden")).toBe("true");
    expect(secondLeaf.hasAttribute("inert")).toBe(true);
    expect(container!.querySelector(".adp-split-pane--first")?.classList.contains("adp-split-pane--hidden")).toBe(false);
    expect(container!.querySelector(".adp-split-pane--second")?.classList.contains("adp-split-pane--hidden")).toBe(true);
    // Both sides stay mounted: the hidden one keeps its scroll position.
    expect(leafNode("view-a")).not.toBeNull();
    expect(leafNode("view-b")).not.toBeNull();
    expect(renderLeaf).toHaveBeenCalled();

    const switcher = container!.querySelector(".adp-split-switcher") as HTMLElement;
    const buttons = [...switcher.querySelectorAll("button")];
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toBe(i18n.t("splits.first"));
    await act(async () => {
      buttons[1].click();
    });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ active_side: "second" }));
    // The saved ratio and direction are untouched by going compact.
    expect(panes.getAttribute("data-direction")).toBe("vertical");
  });

  it("activeleafcommands/F6: the active side follows the click and F6 moves between sides", async () => {
    sized(900);
    const first = split();
    const { onChange, host, draw } = await mountSplit(first);

    await act(async () => {
      leafNode("view-b")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ active_side: "second" }));
    // The split itself never dispatches a command: the app does, with the
    // active leaf's id.
    expect(host.dispatchToLeaf).not.toHaveBeenCalled();

    await draw(first);
    await act(async () => {
      leafNode("view-a")!.dispatchEvent(keyDown("F6"));
    });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ active_side: "second" }));

    const fromSecond = split({ active_side: "second" });
    await draw(fromSecond);
    onChange.mockClear();
    const event = keyDown("F6");
    await act(async () => {
      leafNode("view-b")!.dispatchEvent(event);
    });
    // From Side 2 the next region is the toolbar, owned by the app router.
    expect(onChange).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("sync stays available only when both sides register a port", async () => {
    sized(900);
    const { onChange } = await mountSplit(split());
    const syncButton = [...container!.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === i18n.t("splits.sync"),
    ) as HTMLButtonElement | undefined;
    expect(syncButton?.disabled).toBe(false);
    await act(async () => {
      syncButton!.click();
    });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ sync_scroll: true }));

    await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;

    const unavailable = await mountSplit(split(), {}, false);
    expect(unavailable.onChange).not.toHaveBeenCalled();
    const disabled = [...container!.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === i18n.t("splits.sync"),
    ) as HTMLButtonElement | undefined;
    expect(disabled?.disabled).toBe(true);
  });

  it("CtrlWwholeouter: Ctrl+W is left to the app (whole tab); only Close this side closes a leaf", async () => {
    sized(900);
    const state = split();
    const { onCloseSide, host, beginClose } = await mountSplit(state);
    const event = keyDown("w", { ctrlKey: true });
    await act(async () => {
      leafNode("view-a")!.dispatchEvent(event);
    });
    expect(onCloseSide).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);

    // The whole-tab path asks the host once for both leaves.
    expect(await beginCloseWholeSplit(host, state)).toBe(false);
    expect(beginClose).toHaveBeenCalledTimes(1);
    const leaves = beginClose.mock.calls[0][0] as SplitLeaf[];
    expect(leaves.map((leaf) => leaf.view_id)).toEqual(["view-a", "view-b"]);

    const closeButton = [...container!.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === i18n.t("splits.closeSide"),
    ) as HTMLButtonElement | undefined;
    expect(closeButton).toBeDefined();
    await act(async () => {
      closeButton!.click();
    });
    expect(onCloseSide).toHaveBeenCalledTimes(1);
    expect(onCloseSide).toHaveBeenCalledWith("first");
  });
});
