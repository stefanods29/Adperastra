import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import i18n from "../i18n";

vi.mock("../services/customThemes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/customThemes")>();
  return {
    ...actual,
    listSystemFontFamilies: vi.fn(async () => ["Example Sans"]),
  };
});

import ThemeEditor from "../appearance/ThemeEditor";
import {
  createCustomTheme,
  type CustomTheme,
} from "../services/customThemes";

const ID = "22222222-2222-4222-8222-222222222222";
let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  delete document.documentElement.dataset.materialSupport;
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-scheme");
});

function draft(overrides: Partial<CustomTheme> = {}): CustomTheme {
  return { ...createCustomTheme("Example", "light", ID), ...overrides };
}

async function renderEditor(
  value: CustomTheme,
  onSave = vi.fn<(theme: CustomTheme) => Promise<void>>(async () => undefined),
  onCancel = vi.fn(),
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <ThemeEditor draft={value} onSave={onSave} onCancel={onCancel} onOpenHelp={() => undefined} />,
    );
  });
  return { onSave, onCancel };
}

function button(label: string): HTMLButtonElement {
  const found = [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!found) throw new Error(`button not found: ${label}`);
  return found;
}

async function click(element: Element | null) {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("ThemeEditor", () => {
  it("draft preview does not change the global root", async () => {
    document.documentElement.dataset.theme = "light";
    document.documentElement.dataset.scheme = "light";
    await renderEditor(draft());
    const input = container!.querySelector<HTMLInputElement>(".adp-theme-token-hex");
    expect(input).not.toBeNull();
    await act(async () => {
      if (input) {
        input.value = "#123456";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.getPropertyValue("--adp-color-surface-window")).toBe("");
    expect(container!.querySelector("#adp-theme-editor-preview")?.getAttribute("data-theme")).toBe("custom");
  });

  it("cancel restores the prior live state and never touches the root", async () => {
    const view = await renderEditor(draft());
    await click(button(i18n.t("common.cancel")));
    expect(view.onCancel).toHaveBeenCalledTimes(1);
    expect(view.onSave).not.toHaveBeenCalled();
    expect(document.documentElement.style.getPropertyValue("--adp-font-family")).toBe("");
  });

  it("invalid contrast blocks save", async () => {
    const value = draft();
    value.tokens = { ...value.tokens, "color.text.primary": "#FFFFFF", "color.surface.window": "#FFFFFF" };
    const view = await renderEditor(value);
    await click(button(i18n.t("themeEditor.save")));
    expect(view.onSave).not.toHaveBeenCalled();
    expect(container!.textContent).toContain(i18n.t("errors.theme.contrast"));
  });

  it("material fallback is visible when the host has no native material", async () => {
    document.documentElement.dataset.materialSupport = "solid";
    await renderEditor(draft({ material: "acrylic" }));
    const note = container!.querySelector("[data-material-fallback]");
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain(i18n.t("errors.theme.unavailable"));
  });

  it("installed fonts are names, never source bytes", async () => {
    const view = await renderEditor(draft());
    await act(async () => undefined);
    const select = container!.querySelector<HTMLSelectElement>("select[aria-label='" + i18n.t("themeEditor.font") + "']");
    expect(select).not.toBeNull();
    await act(async () => {
      if (select) {
        select.value = "Example Sans";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await click(button(i18n.t("themeEditor.save")));
    expect(view.onSave).toHaveBeenCalledTimes(1);
    const saved = view.onSave.mock.calls[0][0] as CustomTheme;
    expect(saved.ui_font).toBe("Example Sans");
    const text = JSON.stringify(saved);
    expect(text).not.toContain("base64");
    expect(text).not.toContain(".ttf");
    expect(text).not.toContain(".otf");
  });
});
