import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { isCommandVisible, type Command } from "../commands/registry";
import ToolbarCustomizer from "../layout/ToolbarCustomizer";
import { toolbarLayoutFor, tooltipPlacement } from "../layout/toolbarLayout";
import {
  addEntry,
  canMoveEntryToBar,
  entriesForBar,
  moveEntry,
  removeEntry,
  resetBar,
  setEntryVisible,
} from "../layout/toolbarCustomization";
import {
  CommandLayoutRegistry,
  type CommandLayoutEntry,
  type ToolbarCustomSettings,
  type ToolbarDescriptor,
} from "../services/commandLayout";

const cmd = (id: string): CommandLayoutEntry => ({ kind: "command", id, visible: true });

const descriptor: ToolbarDescriptor = {
  id: "explorer.command",
  default_entries: [cmd("explorer.cut"), cmd("explorer.copy"), cmd("explorer.properties")],
  compatible_groups: [],
  mandatory_ids: ["explorer.properties"],
};

const ribbonSource: ToolbarDescriptor = {
  id: "ribbon.image.view.zoom",
  default_entries: [{ kind: "custom", id: "zoomBox", visible: true }],
  compatible_groups: [],
  mandatory_ids: [],
};
const ribbonTarget: ToolbarDescriptor = {
  id: "ribbon.image.view.show",
  default_entries: [],
  compatible_groups: [],
  mandatory_ids: [],
};

const settings = (entries: CommandLayoutEntry[]): ToolbarCustomSettings => ({
  classic_menu: false,
  bars: [{ bar_id: descriptor.id, entries }],
  quick_access: [],
});

let container: HTMLDivElement | null = null;
afterEach(() => {
  container?.remove();
  container = null;
});

describe("toolbar customization (step-10b/T2)", () => {
  it("hidekeepspalettecommand", () => {
    const hidden = setEntryVisible(descriptor.default_entries, "command", "explorer.copy", false);
    expect(hidden).toContainEqual({ kind: "command", id: "explorer.copy", visible: false });
    const registry = new CommandLayoutRegistry();
    registry.register(descriptor);
    expect(registry.resolve(descriptor.id, settings(hidden)).map((e) => e.id)).not.toContain("explorer.copy");
    const command = { id: "explorer.copy", visibleWhen: () => true } as unknown as Command;
    expect(isCommandVisible(command, {} as never)).toBe(true);
  });

  it("customcontrolcannotcrossincompatiblegroup", () => {
    const custom: CommandLayoutEntry = { kind: "custom", id: "zoomBox", visible: true };
    expect(canMoveEntryToBar(custom, ribbonSource, ribbonTarget)).toBe(false);
    const compatible: ToolbarDescriptor = { ...ribbonSource, compatible_groups: ["zoom", "show"] };
    expect(canMoveEntryToBar(custom, compatible, ribbonTarget)).toBe(true);
    expect(canMoveEntryToBar(cmd("explorer.copy"), compatible, ribbonTarget)).toBe(false);
    expect(canMoveEntryToBar(custom, ribbonSource, ribbonSource)).toBe(true);
  });

  it("mandatoryHelpreachable", () => {
    const kept = removeEntry(descriptor.default_entries, descriptor, "command", "explorer.properties");
    expect(kept.map((e) => e.id)).toContain("explorer.properties");
    const removed = removeEntry(descriptor.default_entries, descriptor, "command", "explorer.cut");
    expect(removed.map((e) => e.id)).not.toContain("explorer.cut");
  });

  it("Cancelpreserves", async () => {
    const value = settings([cmd("explorer.cut"), cmd("explorer.copy"), cmd("explorer.properties")]);
    const snapshot = JSON.parse(JSON.stringify(value)) as ToolbarCustomSettings;
    const onApply = vi.fn(async () => undefined);
    const onCancel = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <ToolbarCustomizer descriptors={[descriptor]} value={value} onApply={onApply} onCancel={onCancel} onOpenHelp={() => undefined} />,
      ),
    );
    const buttons = [...container.querySelectorAll("button")];
    const copyRow = buttons.find((b) => b.textContent === "explorer.copy");
    await act(async () => copyRow?.click());
    const up = [...container.querySelectorAll("button")].find((b) => b.textContent === "toolbarCustom.up");
    await act(async () => up?.click());
    const cancel = [...container.querySelectorAll("button")].find((b) => b.textContent === "Cancel");
    await act(async () => cancel?.click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
    expect(value).toEqual(snapshot);
    await act(async () => root.unmount());
  });

  it("verticaloverflowstillworks", () => {
    const reordered = moveEntry(descriptor.default_entries, "command", "explorer.copy", -1);
    const registry = new CommandLayoutRegistry();
    registry.register(descriptor);
    const resolved = registry.resolve(descriptor.id, settings(reordered));
    expect(resolved.map((e) => e.id)).toEqual(["explorer.copy", "explorer.cut", "explorer.properties"]);
    expect(toolbarLayoutFor("left", "full")).toEqual({ side: "left", orientation: "vertical", mode: "full" });
    expect(tooltipPlacement(toolbarLayoutFor("left", "full"))).toBe("right");
    expect(addEntry(resetBar(descriptor), cmd("explorer.refresh"))?.map((e) => e.id)).toContain("explorer.refresh");
    expect(entriesForBar(settings(reordered), descriptor).map((e) => e.id)).toEqual(resolved.map((e) => e.id));
  });
});
