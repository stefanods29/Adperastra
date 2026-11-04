/** The bars the app registers with the command-layout registry (Step 10b
 * E1/D2-D3). Descriptors are trusted runtime data only: the Settings editor
 * reads them to build its lists, and nothing here is ever serialized. */
import { COMMAND_BAR } from "../commands/menus";
import { ARCHIVE_RIBBON } from "../handlers/archive/archiveCommands";
import { IMAGE_RIBBON } from "../handlers/image/ribbon";
import { MODEL_RIBBON } from "../handlers/model/ribbon";
import { deckRibbon } from "../office/deck/deckRibbon";
import { documentRibbon } from "../office/document/documentRibbon";
import { sheetRibbon } from "../office/sheet/sheetRibbon";
import type { RibbonControl, RibbonDef, RibbonGroup } from "../ribbon/types";
import {
  CLASSIC_MENU_BAR_ID,
  CommandLayoutRegistry,
  DEFAULT_QUICK_ACCESS,
  EXPLORER_COMMAND_BAR_ID,
  QUICK_ACCESS_BAR_ID,
  ribbonBarId,
  type CommandLayoutEntry,
  type ToolbarCustomSettings,
  type ToolbarDescriptor,
} from "../services/commandLayout";
import type { ClassicMenuGroup } from "./ClassicMenuBar";

/** Classic menu mode's File/Edit/View/Tools/Help groups (D3), drawn from
 * the same command registry as every other bar. */
export const CLASSIC_MENU_GROUPS: readonly ClassicMenuGroup[] = [
  {
    id: "file",
    labelKey: "editor.file",
    command_ids: ["explorer.newFolder", "explorer.newTextFile", "explorer.open", "explorer.delete"],
  },
  {
    id: "edit",
    labelKey: "editor.edit",
    command_ids: [
      "explorer.undo",
      "explorer.redo",
      "explorer.cut",
      "explorer.copy",
      "explorer.paste",
      "explorer.rename",
      "explorer.selectAll",
    ],
  },
  {
    id: "view",
    labelKey: "commands.view",
    command_ids: [
      "explorer.viewDetails",
      "explorer.viewList",
      "explorer.toggleDetailsPane",
      "explorer.toggleHiddenItems",
      "explorer.toggleExtensions",
      "explorer.toggleCheckboxes",
    ],
  },
  {
    id: "tools",
    labelKey: "classicMenu.tools",
    command_ids: [
      "app.customizeToolbar",
      "app.customizeShortcuts",
      "app.commandPalette",
      "app.search",
    ],
  },
  {
    id: "help",
    labelKey: "help.title",
    command_ids: ["app.reportProblem", "app.recovery"],
  },
];

function commandEntry(id: string): CommandLayoutEntry {
  return { kind: "command", id, visible: true };
}

/** The Explorer bar's ordinary command buttons; menus, overflow and the
 * spacer are not command-layout entries (they stay outside customization). */
const EXPLORER_COMMAND_DEFAULTS: readonly CommandLayoutEntry[] = COMMAND_BAR.flatMap((entry) =>
  entry.type === "command" ? [commandEntry(entry.id)] : [],
);

export const EXPLORER_COMMAND_DESCRIPTOR: ToolbarDescriptor = {
  id: EXPLORER_COMMAND_BAR_ID,
  default_entries: EXPLORER_COMMAND_DEFAULTS,
  compatible_groups: [],
  // Details stays editable but never removable (D2); Help itself is drawn
  // by the bar outside customization.
  mandatory_ids: ["explorer.toggleDetailsPane"],
};

export const QUICK_ACCESS_DESCRIPTOR: ToolbarDescriptor = {
  id: QUICK_ACCESS_BAR_ID,
  default_entries: DEFAULT_QUICK_ACCESS.map(commandEntry),
  compatible_groups: [],
  mandatory_ids: [],
};

/** Each command appears once in the Classic list; the menus that share an
 * id keep drawing it themselves. */
const CLASSIC_MENU_DEFAULTS: readonly CommandLayoutEntry[] = [
  ...new Set(CLASSIC_MENU_GROUPS.flatMap((group) => group.command_ids)),
].map(commandEntry);

export const CLASSIC_MENU_DESCRIPTOR: ToolbarDescriptor = {
  id: CLASSIC_MENU_BAR_ID,
  default_entries: CLASSIC_MENU_DEFAULTS,
  compatible_groups: [],
  mandatory_ids: [],
};

/** The controls a group exposes to the layout editor: commands by command
 * id and custom controls by their trusted runtime id. */
function ribbonEntries(group: RibbonGroup): CommandLayoutEntry[] {
  const entries: CommandLayoutEntry[] = [];
  const seen = new Set<string>();
  for (const control of group.controls) {
    const entry: CommandLayoutEntry =
      control.type === "custom"
        ? { kind: "custom", id: control.id, visible: true }
        : { kind: "command", id: control.command, visible: true };
    const key = `${entry.kind}:${entry.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  return entries;
}

/** One registered bar per ribbon group (`ribbon.<handlerId>.<tabId>.<groupId>`),
 * built from the same data the ribbon draws. */
export function ribbonDescriptorsFor(handlerId: string, def: RibbonDef): ToolbarDescriptor[] {
  return def.tabs.flatMap((tab) =>
    tab.groups.map((group): ToolbarDescriptor => ({
      id: ribbonBarId(handlerId, tab.id, group.id),
      default_entries: ribbonEntries(group),
      compatible_groups: [],
      mandatory_ids: [],
    })),
  );
}

/** Ribbons whose definition is static data today. Handlers that build their
 * ribbon inline keep the default order until they pass a handler id. */
const RIBBON_DESCRIPTORS: readonly ToolbarDescriptor[] = [
  ...ribbonDescriptorsFor("archive", ARCHIVE_RIBBON),
  ...ribbonDescriptorsFor("image", IMAGE_RIBBON),
  ...ribbonDescriptorsFor("model", MODEL_RIBBON),
  ...ribbonDescriptorsFor("office-word", documentRibbon()),
  ...ribbonDescriptorsFor("office-sheet", sheetRibbon()),
  ...ribbonDescriptorsFor("office-slide", deckRibbon()),
];

/** Every registered bar, in editor order. */
export const TOOLBAR_DESCRIPTORS: readonly ToolbarDescriptor[] = [
  EXPLORER_COMMAND_DESCRIPTOR,
  QUICK_ACCESS_DESCRIPTOR,
  CLASSIC_MENU_DESCRIPTOR,
  ...RIBBON_DESCRIPTORS,
];

/** One registry for the bars a window draws (E1). */
export function createCommandLayoutRegistry(): CommandLayoutRegistry {
  const registry = new CommandLayoutRegistry();
  for (const descriptor of TOOLBAR_DESCRIPTORS) registry.register(descriptor);
  return registry;
}

/** The registry the Explorer and the viewer ribbons read. Descriptors are
 * static runtime data, so one instance per webview is enough. */
export const COMMAND_LAYOUT_REGISTRY = createCommandLayoutRegistry();

/** The controls of one ribbon group after the saved layout: order, hidden
 * entries and unknown ids follow the registry, while each known control
 * keeps the `showLabel`, key tip and render callback from the trusted
 * definition. Without a saved bar the definition is returned untouched. */
export function resolveRibbonGroupControls(
  handlerId: string,
  tabId: string,
  group: RibbonGroup,
  settings: ToolbarCustomSettings | null,
  registry: CommandLayoutRegistry = COMMAND_LAYOUT_REGISTRY,
): RibbonControl[] {
  if (!settings) return group.controls;
  const barId = ribbonBarId(handlerId, tabId, group.id);
  if (!registry.get(barId) || !settings.bars.some((bar) => bar.bar_id === barId)) {
    return group.controls;
  }
  const commands = new Map<string, RibbonControl>();
  const customs = new Map<string, RibbonControl>();
  for (const control of group.controls) {
    if (control.type === "custom") customs.set(control.id, control);
    else commands.set(control.command, control);
  }
  const controls: RibbonControl[] = [];
  const seen = new Set<string>();
  for (const entry of registry.resolve(barId, settings)) {
    if (!entry.visible || entry.kind === "separator") continue;
    const key = `${entry.kind}:${entry.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (entry.kind === "custom") {
      // A custom control renders only through its trusted definition;
      // an id from another group has no renderer here and is skipped.
      const control = customs.get(entry.id);
      if (control) controls.push(control);
      continue;
    }
    const known = commands.get(entry.id);
    if (known) {
      controls.push(known);
      continue;
    }
    controls.push({ type: "button", command: entry.id });
  }
  return controls;
}
