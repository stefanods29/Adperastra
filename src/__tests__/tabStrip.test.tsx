import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import TabStrip from "../layout/TabStrip";
import type { TabBarPosition } from "../services/settings";
import type { TabState } from "../services/tabs";

const TABS: readonly TabState[] = [
  { id: "explorer", kind: "explorer" },
  { id: "f1", kind: "file", title: "notes.txt", path: "C:\\Demo\\notes.txt", handler: "text" },
];

const label = (tab: TabState): string =>
  tab.kind === "file" ? (tab.title ?? "") : i18n.t("tabs.explorer");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function setup() {
  const onActivate = vi.fn();
  const onClose = vi.fn();
  const onNewTab = vi.fn();
  const onToggleCollapsed = vi.fn();
  const draw = async (side: TabBarPosition, collapsed = false) => {
    await act(async () => {
      root?.render(
        <TabStrip
          tabs={TABS}
          activeId="explorer"
          side={side}
          collapsed={collapsed}
          label={label}
          onActivate={onActivate}
          onClose={onClose}
          onNewTab={onNewTab}
          onToggleCollapsed={onToggleCollapsed}
        />,
      );
    });
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  return { onActivate, onClose, onNewTab, onToggleCollapsed, draw };
}

const tabNodes = () => [...container!.querySelectorAll("[role='tab']")];
const buttonWith = (name: string) =>
  [...container!.querySelectorAll("button")].find(
    (button) => button.getAttribute("aria-label") === name,
  ) as HTMLButtonElement | undefined;

describe("TabStrip", () => {
  it("the plus button immediately opens a Home tab without a menu", async () => {
    const { draw, onNewTab } = setup();
    await draw("top");
    await act(async () => buttonWith(i18n.t("tabs.newTab"))!.click());
    expect(onNewTab).toHaveBeenCalledWith("home");
    expect(container!.querySelector("[role='menu']")).toBeNull();
  });
  it("allows window dragging only on empty space in the top tab bar", async () => {
    const { draw } = setup();
    await draw("top");
    expect(container!.querySelector(".adp-tabbar")!.hasAttribute("data-tauri-drag-region")).toBe(true);
    expect(container!.querySelector("[role='tab'][data-tauri-drag-region]")).toBeNull();
    expect(container!.querySelector("button[data-tauri-drag-region]")).toBeNull();
    await draw("bottom");
    expect(container!.querySelector(".adp-tabbar")!.hasAttribute("data-tauri-drag-region")).toBe(false);
    await draw("left");
    expect(container!.querySelector("[data-tauri-drag-region]")).toBeNull();
  });

  it("a top tab bar draws the tabs in a row", async () => {
    const { draw } = setup();
    await draw("top");
    const bar = container!.querySelector(".adp-tabbar");
    expect(bar).not.toBeNull();
    expect(bar!.getAttribute("role")).toBe("tablist");
    const tabs = tabNodes();
    expect(tabs).toHaveLength(2);
    expect(tabs[0].querySelector(".adp-tab-label")).toBeNull();
    expect(tabs[1].querySelector(".adp-tab-label")!.textContent).toBe("notes.txt");
    expect(tabs[1].querySelector(".adp-tab-close")).not.toBeNull();
  });

  it("the bottom bar has its class", async () => {
    const { draw } = setup();
    await draw("bottom");
    expect(container!.querySelector(".adp-tabbar.adp-tabbar--bottom")).not.toBeNull();
  });

  it("a side column shows names and can shrink", async () => {
    const { draw, onToggleCollapsed } = setup();
    await draw("left");
    const rail = container!.querySelector(".adp-tabrail");
    expect(rail).not.toBeNull();
    expect(rail!.classList.contains("adp-tabrail--left")).toBe(true);
    expect(rail!.getAttribute("aria-orientation")).toBe("vertical");
    const tabs = tabNodes();
    expect(tabs[0].querySelector(".adp-tab-label")!.textContent).toBe(i18n.t("tabs.explorer"));
    expect(tabs[1].querySelector(".adp-tab-label")!.textContent).toBe("notes.txt");
    const collapse = buttonWith(i18n.t("tabs.collapse"))!;
    expect(collapse).toBeDefined();
    await act(async () => {
      collapse.click();
    });
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);

    await draw("left", true);
    const collapsedRail = container!.querySelector(".adp-tabrail")!;
    expect(collapsedRail.classList.contains("adp-tabrail--collapsed")).toBe(true);
    const small = tabNodes();
    expect(small[0].querySelector(".adp-tab-label")).toBeNull();
    expect(small[1].querySelector(".adp-tab-label")).toBeNull();
    expect(small[1].querySelector(".adp-tab-close")).toBeNull();
    expect(small[1].getAttribute("title")).toBe("C:\\Demo\\notes.txt");
    expect(small[0].getAttribute("title")).toBe(i18n.t("tabs.explorer"));
    expect(buttonWith(i18n.t("tabs.expand"))).toBeDefined();
  });

  it("unsaved tabs show a dot", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <TabStrip
          tabs={TABS}
          activeId="explorer"
          side="top"
          collapsed={false}
          label={label}
          onActivate={() => undefined}
          onClose={() => undefined}
          onNewTab={() => undefined}
          onToggleCollapsed={() => undefined}
          dirtyIds={new Set(["f1"])}
        />,
      );
    });
    const tabs = tabNodes();
    expect(tabs[0].querySelector(".adp-tab-dirty")).toBeNull();
    expect(tabs[1].querySelector(".adp-tab-dirty")).not.toBeNull();
    expect(tabs[1].getAttribute("aria-description")).toBe(i18n.t("editor.unsaved"));
    expect(tabs[0].getAttribute("aria-description")).toBeNull();
  });

  it("tabs activate on click and close on middle-click", async () => {
    const { draw, onActivate, onClose } = setup();
    await draw("right");
    const fileTab = tabNodes()[1];
    await act(async () => {
      fileTab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onActivate).toHaveBeenCalledWith("f1");
    await act(async () => {
      fileTab.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    });
    expect(onClose).toHaveBeenCalledWith("f1");
  });
});
