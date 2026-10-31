import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import "../i18n";
import { defaultSettings, type AppSettings } from "../services/settings";
import ThemeSettings, { type ThemeSettingsProps } from "../views/settings/ThemeSettings";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function renderTheme(initial: AppSettings = defaultSettings()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  let settings = initial;
  const changes: AppSettings[] = [];
  const props = (): ThemeSettingsProps => ({
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
      root?.render(<ThemeSettings {...props()} />);
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

describe("ThemeSettings", () => {
  it("shows three cards per mode with live previews", async () => {
    await renderTheme();
    const cards = [...container!.querySelectorAll<HTMLElement>(".adp-theme-card")];
    expect(cards).toHaveLength(6);
    for (const card of cards) {
      const id = card.dataset.themeId;
      expect(id).toBeTruthy();
      const preview = card.querySelector<HTMLElement>("[data-theme-preview]");
      expect(preview?.dataset.themePreview).toBe(id);
    }
    expect(container!.querySelector(".adp-theme-card[data-theme-id='light']")?.getAttribute("aria-pressed")).toBe("true");
    expect(container!.querySelector(".adp-theme-card[data-theme-id='dark']")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("choosing a card sets the theme for that mode", async () => {
    const view = await renderTheme();
    await click(container!.querySelector(".adp-theme-card[data-theme-id='paper']"));
    expect(view.changes.at(-1)!.theme.light_theme).toBe("paper");
    expect(view.changes.at(-1)!.theme.dark_theme).toBe("dark");
    await click(container!.querySelector(".adp-theme-card[data-theme-id='amoled']"));
    expect(view.changes.at(-1)!.theme.dark_theme).toBe("amoled");
    expect(view.changes.at(-1)!.theme.light_theme).toBe("paper");
  });

  it("mode buttons keep working", async () => {
    const view = await renderTheme();
    await click(container!.querySelector("[data-theme-mode='dark']"));
    expect(view.changes.at(-1)!.theme.mode).toBe("dark");
  });
});
