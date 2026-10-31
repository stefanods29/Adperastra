import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { defaultSettings, type AppSettings } from "../services/settings";
import SettingsView, { type SettingsViewProps } from "../views/SettingsView";
import { resetAllSettings } from "../views/settings/sections";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function renderSettings(initial: AppSettings = defaultSettings()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  let settings = initial;
  const applied: AppSettings[] = [];
  const onApply = vi.fn((next: AppSettings) => {
    settings = next;
    applied.push(next);
    void rerender();
  });
  const props = (): SettingsViewProps => ({
    settings,
    onApply,
    onOpenHelp: () => undefined,
    onOpenHelpPage: () => undefined,
  });
  const rerender = async () => {
    await act(async () => {
      root?.render(<SettingsView {...props()} />);
    });
  };
  await rerender();
  return { applied, onApply, current: () => settings };
}

const click = async (element: Element | null) => {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

const buttonWithText = (scope: ParentNode, text: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === text,
  ) ?? null;

const navTitles = () =>
  [...container!.querySelectorAll(".adp-settings-nav-item")].map((item) => item.textContent?.trim());

describe("SettingsView", () => {
  it("lists the seven sections in order", async () => {
    await renderSettings();
    expect(navTitles()).toEqual([
      "General",
      "Appearance",
      "Theme",
      "Layout",
      "Views",
      "Opening files",
      "Version history",
    ]);
    expect(container!.querySelectorAll(".adp-settings-block")).toHaveLength(7);
  });

  it("search keeps only the matching sections", async () => {
    await renderSettings();
    const search = container!.querySelector<HTMLInputElement>(".adp-settings-search input")!;
    const type = async (text: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, text);
        search.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await type("toolbar");
    expect(navTitles()).toEqual(["Layout"]);
    expect(container!.querySelectorAll(".adp-settings-block")).toHaveLength(1);
    await type("zzz");
    expect(container!.querySelectorAll(".adp-settings-block")).toHaveLength(0);
    expect(container!.textContent).toContain("No settings match your search.");
  });

  it("a section reset can be undone", async () => {
    const view = await renderSettings();
    const appearance = container!.querySelector<HTMLElement>("#adp-settings-appearance")!;
    await click(appearance.querySelector("[data-appearance-density='compact']"));
    expect(view.current().appearance.density).toBe("compact");

    await click(container!.querySelector("#adp-settings-appearance .adp-settings-block-actions button"));
    expect(view.current().appearance.density).toBe("comfortable");
    expect(container!.querySelector(".adp-settings-notice")?.textContent).toContain(
      "Appearance is back to its default settings.",
    );

    await click(buttonWithText(container!.querySelector(".adp-settings-notice")!, "Undo"));
    expect(view.current().appearance.density).toBe("compact");
    expect(container!.querySelector(".adp-settings-notice")).toBeNull();
  });

  it("reset all asks first", async () => {
    const view = await renderSettings();
    const before = view.onApply.mock.calls.length;

    await click(buttonWithText(container!.querySelector(".adp-settings-footer")!, "Reset all settings…"));
    const dialog = container!.querySelector("[role='dialog']")!;
    await click(buttonWithText(dialog, "Cancel"));
    expect(view.onApply.mock.calls.length).toBe(before);
    expect(container!.querySelector("[role='dialog']")).toBeNull();

    await click(buttonWithText(container!.querySelector(".adp-settings-footer")!, "Reset all settings…"));
    await click(container!.querySelector("[role='dialog'] .adp-dialog-actions .adp-btn--primary"));
    expect(view.applied.at(-1)).toEqual(resetAllSettings(defaultSettings()));
    expect(container!.querySelector(".adp-settings-notice")?.textContent).toContain(
      "All settings are back to their defaults.",
    );
  });

  it("the backup buttons are there", async () => {
    await renderSettings();
    const footer = container!.querySelector(".adp-settings-footer")!;
    expect(buttonWithText(footer, "Export settings…")).not.toBeNull();
    expect(buttonWithText(footer, "Import settings…")).not.toBeNull();
  });
});
