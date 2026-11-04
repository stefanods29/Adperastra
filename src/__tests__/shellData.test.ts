import { Copy } from "lucide-react";
import { describe, expect, it } from "vitest";
import { CommandRegistry, type Command, type CommandContext } from "../commands/registry";
import { ITEM_MENU, type MenuEntry } from "../commands/menus";
import { menuCustomizationFromDefaults, missingCommandIds, resolveCustomMenu } from "../shell/menuCustomization";
import { defaultHomeCustomization, defaultNavigationCustomization, defaultStatusCustomization } from "../shell/registries";
import type { MenuCustomization, MenuNode, NavigationCustomization } from "../shell/types";
import { validateMenuCustomizations, validateNavigationCustomization } from "../shell/validation";

const uuid = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;

function command(id: string): Command<CommandContext> {
  return {
    id,
    labelKey: `commands.${id.replace(".", "")}`,
    icon: Copy,
    risk: "read-only",
    helpSlug: "editing-menus",
    enabledWhen: () => true,
    run: () => undefined,
  };
}

const registry = new CommandRegistry<CommandContext>();
registry.register(command("explorer.copy"));
registry.register(command("explorer.paste"));

function commandNode(id: string, commandId: string): MenuNode {
  return { kind: "command", id, command_id: commandId, visible: true, placement: "direct" };
}

function menu(nodes: MenuNode[]): MenuCustomization {
  return { target: "file", nodes };
}

describe("shell customization data", () => {
  it("depth4refused: refuses a node at depth 4", () => {
    const depthFour: MenuNode = {
      kind: "submenu",
      id: uuid(1),
      label: "One",
      visible: true,
      placement: "direct",
      children: [
        {
          kind: "submenu",
          id: uuid(2),
          label: "Two",
          visible: true,
          placement: "direct",
          children: [
            {
              kind: "submenu",
              id: uuid(3),
              label: "Three",
              visible: true,
              placement: "direct",
              children: [commandNode(uuid(4), "explorer.copy")],
            },
          ],
        },
      ],
    };
    expect(validateMenuCustomizations([menu([depthFour])])).toBeNull();
  });

  it("duplicateIDrefused: refuses duplicate node ids", () => {
    expect(
      validateMenuCustomizations([menu([commandNode(uuid(1), "explorer.copy"), commandNode(uuid(1), "explorer.paste")])]),
    ).toBeNull();
  });

  it("unknowncommanddisabled: keeps an unknown command in the model, disabled and never rendered", () => {
    const saved = menu([commandNode(uuid(1), "future.command")]);
    expect(validateMenuCustomizations([saved])).toEqual([saved]);
    expect(missingCommandIds(saved, registry)).toEqual(["future.command"]);
    const rendered = resolveCustomMenu("file", [saved], ITEM_MENU, registry);
    expect(rendered.some((entry) => entry.type === "command" && entry.id === "future.command")).toBe(false);
    expect(registry.get("future.command")).toBeUndefined();
  });

  it("custompathnotOSrename: changes a navigation display label without renaming the folder path", () => {
    const navigation: NavigationCustomization = defaultNavigationCustomization();
    navigation.sections[2].items.push({
      id: uuid(9),
      kind: "folder",
      target_id: "C:\\Work\\Data",
      display_label: "Projects",
      visible: true,
      section_id: "pinned",
    });
    const validated = validateNavigationCustomization(navigation)!;
    expect(validated.sections[2].items[0].display_label).toBe("Projects");
    expect(validated.sections[2].items[0].target_id).toBe("C:\\Work\\Data");
  });

  it("defaultsretainFigmaorder: keeps the Figma Home order and the default menu order", () => {
    expect(defaultHomeCustomization().sections.map((section) => section.id)).toEqual([
      "quick_access",
      "recent",
      "favorites",
    ]);
    const entries: readonly MenuEntry[] = ITEM_MENU;
    const resolved = resolveCustomMenu("file", [], entries, registry);
    expect(resolved).toBe(ITEM_MENU);
    const converted = menuCustomizationFromDefaults("file", entries, (key) => key);
    const ids = converted.nodes.flatMap((node) => (node.kind === "command" ? [node.command_id] : []));
    expect(ids.slice(0, 3)).toEqual(["explorer.cut", "explorer.copy", "explorer.rename"]);
  });

  it("converts defaults into a stable editable model", () => {
    const first = menuCustomizationFromDefaults("file", ITEM_MENU, (key) => key);
    const second = menuCustomizationFromDefaults("file", ITEM_MENU, (key) => key);
    expect(first).toEqual(second);
    expect(first.target).toBe("file");
    expect(first.nodes.length).toBeGreaterThan(0);
    expect(validateMenuCustomizations([first])).toEqual([first]);
  });

  it("ships visible Explorer status fields and all six kinds", () => {
    const status = defaultStatusCustomization();
    expect(status.visible).toBe(true);
    expect(status.orders.explorer.map((field) => field.id)).toEqual([
      "item_count",
      "selection_count",
      "selection_size",
      "free_space",
      "view_buttons",
    ]);
    for (const kind of ["explorer", "text", "pdf", "image", "media", "office"] as const) {
      expect(Array.isArray(status.orders[kind])).toBe(true);
    }
  });
});
