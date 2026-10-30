import { Bold, Italic } from "lucide-react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import type { Command } from "../commands/registry";
import Ribbon from "../ribbon/Ribbon";
import { matchesShortcut } from "../ribbon/shortcuts";
import type { RibbonDef } from "../ribbon/types";

interface Ctx {
  bold: boolean;
  canItalic: boolean;
}

const def: RibbonDef = {
  tabs: [
    {
      id: "view",
      labelKey: "ribbon.view",
      keyTip: "V",
      groups: [
        {
          id: "g",
          labelKey: "ribbon.show",
          controls: [
            { type: "toggle", command: "t.bold", keyTip: "B" },
            { type: "button", command: "t.italic", keyTip: "I" },
          ],
        },
      ],
    },
  ],
};

let container: HTMLDivElement | null = null;
afterEach(() => {
  container?.remove();
  container = null;
});

describe("ribbon", () => {
  it("draws toggles, disables unavailable commands and runs on click and Alt+letter", async () => {
    const bold = vi.fn();
    const italic = vi.fn();
    const commands: Command<Ctx>[] = [
      { id: "t.bold", labelKey: "viewer.fitToWindow", icon: Bold, risk: "read-only", helpSlug: "viewing-images", checkedWhen: (c) => c.bold, enabledWhen: () => true, run: bold },
      { id: "t.italic", labelKey: "viewer.actualSize", icon: Italic, risk: "read-only", helpSlug: "viewing-images", enabledWhen: (c) => c.canItalic, run: italic },
    ];
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<Ribbon def={def} ctx={{ bold: true, canItalic: false }} commands={commands} accent="explorer" active={true} />));
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    expect(buttons[1].disabled).toBe(true);
    await act(async () => buttons[0].click());
    expect(bold).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", altKey: true, bubbles: true, cancelable: true }));
    });
    expect(bold).toHaveBeenCalledTimes(2);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "i", altKey: true, bubbles: true, cancelable: true }));
    });
    expect(italic).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});

describe("shortcut matching", () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

  it("matches modifiers exactly", () => {
    expect(matchesShortcut(key({ key: "n", ctrlKey: true, shiftKey: true }), "Ctrl+Shift+N")).toBe(true);
    expect(matchesShortcut(key({ key: "n", ctrlKey: true }), "Ctrl+Shift+N")).toBe(false);
    expect(matchesShortcut(key({ key: "F3", shiftKey: true }), "Shift+F3")).toBe(true);
    expect(matchesShortcut(key({ key: "F3" }), "Shift+F3")).toBe(false);
  });

  it("treats Ctrl+= and Ctrl++ alike", () => {
    expect(matchesShortcut(key({ key: "=", ctrlKey: true }), "Ctrl+=")).toBe(true);
    expect(matchesShortcut(key({ key: "+", ctrlKey: true, shiftKey: true }), "Ctrl+=")).toBe(true);
    expect(matchesShortcut(key({ key: "-", ctrlKey: true }), "Ctrl+=")).toBe(false);
  });
});
