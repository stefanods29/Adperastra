import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import "../i18n";
import { defaultSettings, type AppSettings } from "../services/settings";
import AppearanceSettings, { type AppearanceSettingsProps } from "../views/settings/AppearanceSettings";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function renderAppearance(initial: AppSettings = defaultSettings()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  let settings = initial;
  const changes: AppSettings[] = [];
  const props = (): AppearanceSettingsProps => ({
    settings,
    onApply: (next) => {
      settings = next;
      changes.push(next);
      void rerender();
    },
    onOpenHelp: () => undefined,
  });
  const rerender = async () => {
    await act(async () => {
      root?.render(<AppearanceSettings {...props()} />);
    });
  };
  await rerender();
  return { changes, current: () => settings };
}

const click = async (element: Element | null) => {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("AppearanceSettings", () => {
  it("changes the UI scale", async () => {
    const view = await renderAppearance();
    const select = container!.querySelector<HTMLSelectElement>("select[data-appearance-field='ui_scale']")!;
    await act(async () => {
      select.value = "150";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(view.changes.at(-1)!.appearance.ui_scale).toBe(150);
  });

  it("density, corners and animations", async () => {
    const view = await renderAppearance();
    for (const [field, value] of [
      ["density", "comfortable"],
      ["radius", "standard"],
      ["animations", "full"],
    ]) {
      expect(
        container!.querySelector(`[data-appearance-${field}='${value}']`)?.getAttribute("aria-pressed"),
      ).toBe("true");
    }
    await click(container!.querySelector("[data-appearance-density='compact']"));
    await click(container!.querySelector("[data-appearance-radius='square']"));
    await click(container!.querySelector("[data-appearance-animations='reduced']"));
    const last = view.changes.at(-1)!.appearance;
    expect(last.density).toBe("compact");
    expect(last.corner_radius).toBe("square");
    expect(last.animations).toBe("reduced");
  });
});
