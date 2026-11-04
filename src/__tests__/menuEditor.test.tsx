import { Copy } from "lucide-react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { CommandRegistry, type Command, type CommandContext } from "../commands/registry";
import type { MenuEntry } from "../commands/menus";
import MenuEditor from "../shell/MenuEditor";
import { resolveCustomMenu } from "../shell/menuCustomization";
import type { MenuCustomization, MenuNode } from "../shell/types";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const uuid = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;

const runCopy = vi.fn();
const runPaste = vi.fn();

function makeRegistry(): CommandRegistry<CommandContext> {
  const registry = new CommandRegistry<CommandContext>();
  const command = (id: string, labelKey: string, icon: typeof Copy, run: () => void): Command<CommandContext> => ({
    id,
    labelKey,
    icon,
    risk: "read-only",
    helpSlug: "editing-menus",
    enabledWhen: () => true,
    run,
  });
  registry.register(command("explorer.copy", "commands.copy", Copy, runCopy));
  registry.register(command("explorer.paste", "commands.paste", Copy, runPaste));
  return registry;
}

function commandNode(id: string, commandId: string): MenuNode {
  return { kind: "command", id, command_id: commandId, visible: true, placement: "direct" };
}

const defaults: readonly MenuEntry[] = [
  { type: "command", id: "explorer.copy" },
  { type: "command", id: "explorer.paste" },
];

function fileMenu(nodes: MenuNode[]): MenuCustomization {
  return { target: "file", nodes };
}

async function renderEditor(
  value: MenuCustomization[],
  onApply: (value: readonly MenuCustomization[]) => Promise<void> = vi.fn(async () => undefined),
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MenuEditor
        target="file"
        value={value}
        defaults={defaults}
        registry={makeRegistry()}
        onApply={onApply}
        onCancel={() => undefined}
        onOpenHelp={() => undefined}
      />,
    );
  });
  return { onApply };
}

function nodeButton(id: string): HTMLButtonElement {
  return container!.querySelector(`button[data-node-id="${id}"]`) as HTMLButtonElement;
}

function buttonWithLabel(label: string): HTMLButtonElement {
  return container!.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
}

function buttonWithText(text: string): HTMLButtonElement {
  return [...container!.querySelectorAll("button")].find((button) => button.textContent?.trim() === text) as HTMLButtonElement;
}

describe("MenuEditor", () => {
  it("previewdoesnotrun: preview does not run a command", async () => {
    runCopy.mockClear();
    await renderEditor([fileMenu([commandNode(uuid(1), "explorer.copy")])]);
    const preview = container!.querySelector(".adp-menu-editor__preview") as HTMLElement;
    await act(async () => {
      preview.click();
      preview.querySelectorAll("li").forEach((row) => row.click());
    });
    expect(runCopy).not.toHaveBeenCalled();
    expect(preview.textContent).toContain(i18n.t("commands.copy"));
  });

  it("shows an unavailable command disabled", async () => {
    await renderEditor([fileMenu([commandNode(uuid(1), "future.command")])]);
    expect(container!.textContent).toContain(i18n.t("toolbarCustom.missing"));
    expect(container!.querySelector(".adp-menu-tree__label--missing")).not.toBeNull();
  });

  it("removedcommandstillpalette: removing a command from a menu keeps it in the palette", async () => {
    const registry = makeRegistry();
    const applied: MenuCustomization[][] = [];
    const onApply = vi.fn(async (value: readonly MenuCustomization[]) => {
      applied.push(value as MenuCustomization[]);
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <MenuEditor
          target="file"
          value={[fileMenu([commandNode(uuid(1), "explorer.copy"), commandNode(uuid(2), "explorer.paste")])]}
          defaults={defaults}
          registry={registry}
          onApply={onApply}
          onCancel={() => undefined}
          onOpenHelp={() => undefined}
        />,
      );
    });
    await act(async () => nodeButton(uuid(1)).click());
    await act(async () => buttonWithLabel(i18n.t("shellCustom.remove")).click());
    await act(async () => buttonWithText(i18n.t("common.apply")).click());
    expect(onApply).toHaveBeenCalledTimes(1);
    const nodes = applied[0].find((menu) => menu.target === "file")!.nodes;
    expect(nodes.map((node) => (node.kind === "command" ? node.command_id : node.kind))).toEqual(["explorer.paste"]);
    expect(registry.get("explorer.copy")).toBeDefined();
  });

  it("keyboardreorder: reorders with the keyboard", async () => {
    const applied: MenuCustomization[][] = [];
    const onApply = vi.fn(async (value: readonly MenuCustomization[]) => {
      applied.push(value as MenuCustomization[]);
    });
    await renderEditor(
      [fileMenu([commandNode(uuid(1), "explorer.copy"), commandNode(uuid(2), "explorer.paste")])],
      onApply,
    );
    await act(async () => nodeButton(uuid(2)).click());
    await act(async () => {
      nodeButton(uuid(2)).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    });
    await act(async () => buttonWithText(i18n.t("common.apply")).click());
    const nodes = applied[0].find((menu) => menu.target === "file")!.nodes;
    expect(nodes.map((node) => (node.kind === "command" ? node.command_id : node.kind))).toEqual([
      "explorer.paste",
      "explorer.copy",
    ]);
  });

  it("resetonetargetonly: resets only the selected target", async () => {
    const background = fileMenu([commandNode(uuid(3), "explorer.paste")]);
    background.target = "background";
    const original = [fileMenu([commandNode(uuid(1), "explorer.copy")]), background];
    const applied: MenuCustomization[][] = [];
    const onApply = vi.fn(async (value: readonly MenuCustomization[]) => {
      applied.push(value as MenuCustomization[]);
    });
    await renderEditor(original, onApply);
    await act(async () => buttonWithText(i18n.t("shellCustom.reset")).click());
    await act(async () => buttonWithText(i18n.t("common.apply")).click());
    expect(applied[0].map((menu) => menu.target)).toEqual(["background"]);
    expect(applied[0][0]).toEqual(background);
  });

  it("untrustedlabelrenderstext: renders an untrusted submenu label as text", async () => {
    await renderEditor([fileMenu([commandNode(uuid(1), "explorer.copy")])]);
    const newSubmenu = [...container!.querySelectorAll("button")].find(
      (button) => button.textContent?.includes(i18n.t("shellCustom.submenu")),
    ) as HTMLButtonElement;
    await act(async () => newSubmenu.click());
    const input = container!.querySelector(".adp-menu-editor__submenu-row input") as HTMLInputElement;
    const label = "<img src=x onerror=alert(1)>";
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, label);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container!.querySelector(".adp-menu-editor__preview img")).toBeNull();
    expect(container!.querySelector(".adp-menu-editor__preview")!.textContent).toContain(label);
  });

  it("separatorsnormalizeinrenderedcopy: normalizes separators only in the rendered copy", () => {
    const saved = fileMenu([
      { kind: "separator", id: uuid(1) },
      commandNode(uuid(2), "explorer.copy"),
      { kind: "separator", id: uuid(3) },
      { kind: "separator", id: uuid(4) },
      commandNode(uuid(5), "explorer.paste"),
      { kind: "separator", id: uuid(6) },
    ]);
    const entries = resolveCustomMenu("file", [saved], defaults, makeRegistry());
    // Leading, repeated and trailing separators are dropped; the single
    // separator between the two commands is valid and stays.
    expect(entries.map((entry) => entry.type)).toEqual(["command", "separator", "command"]);
    expect(saved.nodes.map((node) => node.kind)).toEqual([
      "separator",
      "command",
      "separator",
      "separator",
      "command",
      "separator",
    ]);
  });
});
