import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import "../i18n";
import { LayoutContext } from "../layout/LayoutContext";
import { defaultSettings, type LayoutSettings } from "../services/settings";
import ExplorerHome from "../views/ExplorerHome";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const layoutWith = (patch: Partial<LayoutSettings>): LayoutSettings => ({
  ...defaultSettings().layout,
  ...patch,
});

async function renderExplorer(layout: LayoutSettings): Promise<HTMLDivElement> {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <LayoutContext.Provider value={{ layout, onLayoutChange: () => undefined }}>
        <ExplorerHome
          onOpenHelp={() => undefined}
          view={{ ...defaultSettings().explorer, details_pane: true }}
        />
      </LayoutContext.Provider>,
    );
  });
  return container;
}

describe("Explorer layouts", () => {
  it("the command bar sits in the toolbar dock", async () => {
    const element = await renderExplorer(defaultSettings().layout);
    expect(element.querySelector(".adp-dock--top .adp-dock-bar .adp-commandbar")).not.toBeNull();
    expect(element.querySelector(".adp-dock-content .adp-explorer-body")).not.toBeNull();
  });

  it("the navigation pane moves right or hides", async () => {
    let element = await renderExplorer(layoutWith({ nav_pane_position: "right" }));
    expect(element.querySelector(".adp-explorer-body")!.classList.contains("adp-explorer-body--nav-right")).toBe(true);
    expect(element.querySelector(".adp-explorer-nav")).not.toBeNull();
    element = await renderExplorer(layoutWith({ nav_pane_position: "hidden" }));
    expect(element.querySelector(".adp-explorer-nav")).toBeNull();
  });

  it("the Details pane can sit under the files", async () => {
    let element = await renderExplorer(layoutWith({ details_pane_position: "bottom" }));
    expect(element.querySelector(".adp-explorer-center .adp-details-pane.adp-details-pane--bottom")).not.toBeNull();
    element = await renderExplorer(layoutWith({ details_pane_position: "right" }));
    const pane = element.querySelector(".adp-details-pane");
    expect(pane).not.toBeNull();
    expect(pane!.classList.contains("adp-details-pane--bottom")).toBe(false);
    expect(pane!.parentElement!.classList.contains("adp-explorer-body")).toBe(true);
  });
});
