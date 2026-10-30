import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import "../i18n";
import ViewsSettings, { moveViewMode, withViewModeHidden, type ViewsSettingsProps } from "../views/settings/ViewsSettings";
import { defaultSettings, type ExplorerViewSettings } from "../services/settings";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function renderViews(initial: ExplorerViewSettings = defaultSettings().explorer) {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  let explorer = initial;
  const changes: ExplorerViewSettings[] = [];
  const props = (): ViewsSettingsProps => ({
    explorer,
    onChange: (next) => {
      explorer = next;
      changes.push(next);
      void rerender();
    },
    onOpenHelp: () => undefined,
  });
  const rerender = async () => {
    await act(async () => {
      root?.render(<ViewsSettings {...props()} />);
    });
  };
  await rerender();
  return { changes, current: () => explorer, rerender };
}

describe("ViewsSettings", () => {
  it("moveViewMode swaps a view with its neighbour", () => {
    const order = defaultSettings().explorer.view_mode_order;
    expect(moveViewMode(order, "largeIcons", -1).slice(0, 2)).toEqual(["largeIcons", "extraLargeIcons"]);
    expect(moveViewMode(order, "extraLargeIcons", -1)).toEqual(order);
    expect(moveViewMode(order, "content", 1)).toEqual(order);
  });

  it("withViewModeHidden hides a view and resets the default", () => {
    const explorer: ExplorerViewSettings = { ...defaultSettings().explorer, view_mode: "tiles" };
    const hidden = withViewModeHidden(explorer, "tiles", true);
    expect(hidden.hidden_view_modes).toEqual(["tiles"]);
    expect(hidden.view_mode).toBe("details");
    expect(withViewModeHidden(hidden, "tiles", false).hidden_view_modes).toEqual([]);
    expect(withViewModeHidden(explorer, "details", true)).toEqual(explorer);
  });

  it("lists the views in order and hides one with its switch", async () => {
    const view = await renderViews();
    expect(container!.querySelectorAll(".adp-views-item")).toHaveLength(8);
    const detailsSwitch = container!.querySelector<HTMLButtonElement>("[role='switch'][aria-label='Details']")!;
    expect(detailsSwitch.disabled).toBe(true);
    await act(async () => {
      container!.querySelector<HTMLButtonElement>("[role='switch'][aria-label='Tiles']")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(view.changes.at(-1)!.hidden_view_modes).toEqual(["tiles"]);
  });

  it("moves a view up", async () => {
    const view = await renderViews();
    await act(async () => {
      container!.querySelector<HTMLButtonElement>("button[aria-label='Move Large icons up']")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(view.changes.at(-1)!.view_mode_order.slice(0, 2)).toEqual(["largeIcons", "extraLargeIcons"]);
  });

  it("changes the default view", async () => {
    const view = await renderViews();
    const select = container!.querySelector<HTMLSelectElement>("select")!;
    await act(async () => {
      select.value = "list";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(view.changes.at(-1)!.view_mode).toBe("list");
  });
});
