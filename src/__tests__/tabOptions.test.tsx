import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { useTabHoverPreview } from "../layout/useTabHoverPreview";
import {
  closeButtonShown,
  closeTabWithOptions,
  insertTabIndex,
  insertTabAt,
  tabTitlePresentation,
  tabWidthPx,
} from "../services/tabOptionReducers";
import { defaultTabOptions, type TabOptions } from "../services/tabOptions";
import { initialTabs, type TabState, type TabsState } from "../services/tabs";

const options: TabOptions = { ...defaultTabOptions(), hover_preview: true };

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

function groupedState(): TabsState {
  return {
    tabs: [
      { id: "explorer", kind: "explorer" },
      { id: "a", kind: "file", path: "C:\\A\\a.txt", handler: "text", group_id: "g1" },
      { id: "b", kind: "file", path: "C:\\A\\b.txt", handler: "text", group_id: "g1" },
      { id: "c", kind: "help" },
    ],
    activeId: "a",
    history: ["explorer", "a"],
    groups: [{ id: "g1", name: "One", color: "purple", collapsed: false, tab_ids: ["a", "b"] }],
  } as unknown as TabsState;
}

describe("tab placement", () => {
  it("keeps a group contiguous when a tab opens after the active member", () => {
    const state = groupedState();
    const index = insertTabIndex(state, { ...options, new_position: "after_active" });
    expect(index).toBe(3);
    const next = insertTabAt(state, { id: "new", kind: "file", path: "C:\\A\\new.txt", handler: "text" }, index);
    const groupIndexes = next.tabs
      .map((tab, at) => ((tab as TabState & { group_id?: string }).group_id === "g1" ? at : -1))
      .filter((at) => at >= 0);
    expect(groupIndexes).toEqual([1, 2]);
  });

  it("falls back to the previous active tab after closing the last tab on the right", () => {
    const state: TabsState = {
      tabs: [
        { id: "explorer", kind: "explorer" },
        { id: "a", kind: "help" },
        { id: "b", kind: "settings" },
        { id: "c", kind: "gallery" },
      ],
      activeId: "b",
      history: ["explorer", "a", "b"],
    };
    const right = { ...options, close_activation: "right" as const };
    expect(insertTabIndex(state, options)).toBe(4);
    const closed = closeTabWithOptions(state, "b", right);
    expect(closed.activeId).toBe("c");
    // No tab remains on the right, so the MRU fallback becomes active.
    expect(closeTabWithOptions(closed, "c", right).activeId).toBe("a");
  });

  it("never changes the permanent Explorer tab", () => {
    const state = initialTabs();
    expect(insertTabIndex(state, options)).toBe(1);
    expect(closeTabWithOptions(state, "explorer", options)).toBe(state);
    expect(insertTabAt(state, { id: "x", kind: "help" }, 0).tabs[0].id).toBe("explorer");
  });

  it("keeps the full name for accessibility while shortening the visible title", () => {
    const full = "a-very-long-report-name-that-needs-shortening.txt";
    const title = tabTitlePresentation(full, { ...options, title_limit: 12 });
    expect(title.full).toBe(full);
    expect(title.visible.endsWith("…")).toBe(true);
    expect(Array.from(title.visible).length).toBeLessThanOrEqual(12);
  });

  it("applies the configured width and close-button rules", () => {
    expect(tabWidthPx({ ...options, width_mode: "compact" }, 1000, 8)).toBe(94);
    expect(tabWidthPx({ ...options, width_mode: "fit" }, 1000, 8)).toBe(125);
    expect(tabWidthPx({ ...options, width_mode: "fit" }, 1000, 3)).toBe(280);
    expect(closeButtonShown({ ...options, close_button: "hover" }, false, false)).toBe(false);
    expect(closeButtonShown({ ...options, close_button: "hover" }, true, false)).toBe(true);
    expect(closeButtonShown({ ...options, close_button: "always" }, false, false)).toBe(true);
  });
});

interface HarnessProps {
  tab: TabState;
  active: boolean;
  inspect: (path: string) => Promise<{ online_only: boolean }>;
}

function Harness({ tab, active, inspect }: HarnessProps) {
  const preview = useTabHoverPreview({ tab, active, options, inspect });
  return (
    <div>
      <button type="button" data-testid="enter" onClick={preview.onPointerEnter}>
        enter
      </button>
      <button type="button" data-testid="leave" onClick={preview.onPointerLeave}>
        leave
      </button>
      <span data-testid="path">{preview.previewPath ?? ""}</span>
      <span data-testid="flags">{`${preview.previewOnly ? "readonly" : "edit"}:${
        preview.autoplay ? "play" : "paused"
      }`}</span>
    </div>
  );
}

async function renderHarness(props: HarnessProps) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const render = async (next: HarnessProps) => {
    await act(async () => {
      root?.render(<Harness {...next} />);
    });
  };
  await render(props);
  return { render };
}

async function advance(milliseconds: number) {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("tab hover previews", () => {
  const tab: TabState = { id: "file-1", kind: "file", path: "C:\\A\\a.txt", handler: "text" };

  it("starts after the delay and cancels on leave", async () => {
    vi.useFakeTimers();
    const inspect = vi.fn(async () => ({ online_only: false }));
    await renderHarness({ tab, active: false, inspect });
    const enter = container!.querySelector<HTMLButtonElement>("[data-testid='enter']")!;
    const leave = container!.querySelector<HTMLButtonElement>("[data-testid='leave']")!;
    await act(async () => enter.click());
    await advance(499);
    expect(container!.querySelector("[data-testid='path']")!.textContent).toBe("");
    await advance(1);
    expect(container!.querySelector("[data-testid='path']")!.textContent).toBe("C:\\A\\a.txt");
    expect(container!.querySelector("[data-testid='flags']")!.textContent).toBe("readonly:paused");

    await act(async () => leave.click());
    expect(container!.querySelector("[data-testid='path']")!.textContent).toBe("");
    await advance(2000);
    expect(container!.querySelector("[data-testid='path']")!.textContent).toBe("");
  });

  it("cancels a pending timer when the pointer leaves early", async () => {
    vi.useFakeTimers();
    const inspect = vi.fn(async () => ({ online_only: false }));
    await renderHarness({ tab, active: false, inspect });
    const enter = container!.querySelector<HTMLButtonElement>("[data-testid='enter']")!;
    const leave = container!.querySelector<HTMLButtonElement>("[data-testid='leave']")!;
    await act(async () => enter.click());
    await advance(300);
    await act(async () => leave.click());
    await advance(2000);
    expect(inspect).not.toHaveBeenCalled();
    expect(container!.querySelector("[data-testid='path']")!.textContent).toBe("");
  });

  it("skips cloud files and active tabs", async () => {
    vi.useFakeTimers();
    const cloud = vi.fn(async () => ({ online_only: true }));
    const rendered = await renderHarness({ tab, active: false, inspect: cloud });
    await act(async () => container!.querySelector<HTMLButtonElement>("[data-testid='enter']")!.click());
    await advance(600);
    expect(container!.querySelector("[data-testid='path']")!.textContent).toBe("");

    const local = vi.fn(async () => ({ online_only: false }));
    await rendered.render({ tab, active: true, inspect: local });
    await act(async () => container!.querySelector<HTMLButtonElement>("[data-testid='enter']")!.click());
    await advance(600);
    expect(local).not.toHaveBeenCalled();
    expect(container!.querySelector("[data-testid='path']")!.textContent).toBe("");
  });
});
