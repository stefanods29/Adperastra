import { act, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { LayoutContext } from "../layout/LayoutContext";
import ToolbarDock from "../layout/ToolbarDock";
import { ToolbarLayoutContext, type ToolbarLayout } from "../layout/toolbarLayout";
import { KeyTipsContext } from "../ribbon/keyTips";
import { defaultSettings, type LayoutSettings } from "../services/settings";

const BUTTON_LABEL = "Probe button";
const INPUT_LABEL = "Probe box";
const CONTENT = "Dock content";

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const reads: ToolbarLayout[] = [];

function Probe() {
  reads.push(useContext(ToolbarLayoutContext));
  return null;
}

const layoutWith = (patch: Partial<LayoutSettings>): LayoutSettings => ({
  ...defaultSettings().layout,
  ...patch,
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  reads.length = 0;
  vi.useRealTimers();
});

async function renderDock(layout: LayoutSettings, keyTips = false) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const onLayoutChange = vi.fn();
  const draw = async (next: LayoutSettings, tips = false) => {
    await act(async () => {
      root?.render(
        <LayoutContext.Provider value={{ layout: next, onLayoutChange }}>
          <KeyTipsContext.Provider value={tips}>
            <ToolbarDock
              toolbar={
                <div>
                  <button type="button">{BUTTON_LABEL}</button>
                  <Probe />
                  <input aria-label={INPUT_LABEL} />
                </div>
              }
            >
              <p>{CONTENT}</p>
            </ToolbarDock>
          </KeyTipsContext.Provider>
        </LayoutContext.Provider>,
      );
    });
  };
  await draw(layout, keyTips);
  return { onLayoutChange, draw };
}

const dock = () => container!.firstElementChild as HTMLElement;
const revealed = () => container!.querySelector(".adp-dock-bar")!.classList.contains("adp-dock-bar--revealed");

describe("ToolbarDock", () => {
  it("places the toolbar on the chosen side", async () => {
    await renderDock(layoutWith({ toolbar_position: "bottom" }));
    expect(dock().classList.contains("adp-dock")).toBe(true);
    expect(dock().classList.contains("adp-dock--bottom")).toBe(true);
    expect(dock().querySelector(".adp-dock-bar button")?.textContent).toBe(BUTTON_LABEL);
    expect(dock().querySelector(".adp-dock-content")?.textContent).toContain(CONTENT);
  });

  it("gives the toolbar its side and style", async () => {
    const { draw } = await renderDock(layoutWith({ toolbar_position: "left", toolbar_mode: "compact" }));
    expect(reads.at(-1)).toEqual({ side: "left", orientation: "vertical", mode: "compact" });
    await draw(layoutWith({ toolbar_position: "top", toolbar_mode: "autoHide" }));
    expect(reads.at(-1)).toEqual({ side: "top", orientation: "horizontal", mode: "full" });
  });

  it("auto-hide shows the toolbar on hover and hides it later", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await renderDock(layoutWith({ toolbar_mode: "autoHide" }));
    const bar = container!.querySelector(".adp-dock-bar") as HTMLElement;
    await act(async () => {
      bar.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(revealed()).toBe(true);
    await act(async () => {
      bar.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(399);
    });
    expect(revealed()).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(revealed()).toBe(false);
  });

  it("auto-hide shows the toolbar while it has the focus or Alt is held", async () => {
    const { draw } = await renderDock(layoutWith({ toolbar_mode: "autoHide" }));
    const button = container!.querySelector(".adp-dock-bar button") as HTMLButtonElement;
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    await act(async () => {
      button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(revealed()).toBe(true);
    await act(async () => {
      button.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }));
    });
    expect(revealed()).toBe(false);
    outside.remove();
    await draw(layoutWith({ toolbar_mode: "autoHide" }), true);
    expect(revealed()).toBe(true);
  });

  it("right-click opens the toolbar menu", async () => {
    const { onLayoutChange } = await renderDock(defaultSettings().layout);
    const button = container!.querySelector(".adp-dock-bar button") as HTMLElement;
    await act(async () => {
      button.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 100, clientY: 60 }),
      );
    });
    const menu = document.querySelector(".adp-ctxmenu[role='menu']") as HTMLElement | null;
    expect(menu).not.toBeNull();
    expect(menu!.getAttribute("aria-label")).toBe(i18n.t("layout.menuLabel"));
    const positionItem = [...menu!.querySelectorAll("[role='menuitem']")].find((item) =>
      item.textContent?.includes(i18n.t("layout.toolbarPosition")),
    ) as HTMLElement;
    await act(async () => {
      positionItem.click();
    });
    const leftItem = [...document.querySelectorAll("[role='menuitemradio']")].find((item) =>
      item.textContent?.includes(i18n.t("commands.toolbarLeft")),
    ) as HTMLElement;
    await act(async () => {
      leftItem.click();
    });
    expect(onLayoutChange).toHaveBeenCalledWith({ ...defaultSettings().layout, toolbar_position: "left" });
    expect(document.querySelector(".adp-ctxmenu")).toBeNull();
  });

  it("a text box inside the toolbar keeps its own menu", async () => {
    await renderDock(defaultSettings().layout);
    const input = container!.querySelector(".adp-dock-bar input") as HTMLInputElement;
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    let prevented = false;
    await act(async () => {
      input.dispatchEvent(event);
      prevented = event.defaultPrevented;
    });
    expect(prevented).toBe(false);
    expect(document.querySelector(".adp-ctxmenu")).toBeNull();
  });
});
