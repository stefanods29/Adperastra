import { Copy, FlipHorizontal, Layers, Merge, Plus, Trash2, type LucideIcon } from "lucide-react";
import type { Command, CommandRegistry } from "../commands/registry";
import { MAX_LAYERS } from "./layerTypes";

/** Step 18a commands for the Advanced presenter. They live in the existing
 * command shape so a later coordinator wiring can hand the same list to the
 * global menu/palette without a second command host. */

export interface AdvancedCommandContext {
  editable: boolean;
  hasModel: boolean;
  layerCount: number;
  selectedCount: number;
  activeLayerId: string | null;
  mergeable: boolean;
  flattenable: boolean;
  addLayer: () => void;
  duplicateLayer: () => void;
  deleteLayer: () => void;
  mergeLayer: () => void;
  flattenLayer: () => void;
  invertSelection: () => void;
  toggleAdvanced: () => void;
}

interface Entry {
  id: string;
  labelKey: string;
  icon: LucideIcon;
  helpSlug: string;
  enabledWhen: (ctx: AdvancedCommandContext) => boolean;
  run: (ctx: AdvancedCommandContext) => void;
}

const ENTRIES: readonly Entry[] = [
  {
    id: "image.advanced",
    labelKey: "layers.advanced",
    icon: Layers,
    helpSlug: "image-layers",
    enabledWhen: (ctx) => ctx.hasModel,
    run: (ctx) => ctx.toggleAdvanced(),
  },
  {
    id: "layer.add",
    labelKey: "layers.add",
    icon: Plus,
    helpSlug: "image-layers",
    enabledWhen: (ctx) => ctx.editable && ctx.layerCount < MAX_LAYERS,
    run: (ctx) => ctx.addLayer(),
  },
  {
    id: "layer.duplicate",
    labelKey: "layers.duplicate",
    icon: Copy,
    helpSlug: "image-layers",
    enabledWhen: (ctx) => ctx.editable && ctx.activeLayerId !== null && ctx.layerCount < MAX_LAYERS,
    run: (ctx) => ctx.duplicateLayer(),
  },
  {
    id: "layer.delete",
    labelKey: "layers.delete",
    icon: Trash2,
    helpSlug: "image-layers",
    enabledWhen: (ctx) =>
      ctx.editable && ctx.layerCount > 1 && ctx.selectedCount > 0 && ctx.selectedCount < ctx.layerCount,
    run: (ctx) => ctx.deleteLayer(),
  },
  {
    id: "layer.merge",
    labelKey: "layers.merge",
    icon: Merge,
    helpSlug: "image-layers",
    enabledWhen: (ctx) => ctx.editable && ctx.mergeable,
    run: (ctx) => ctx.mergeLayer(),
  },
  {
    id: "layer.flatten",
    labelKey: "layers.flatten",
    icon: Layers,
    helpSlug: "image-layers",
    enabledWhen: (ctx) => ctx.editable && ctx.layerCount > 1 && ctx.flattenable,
    run: (ctx) => ctx.flattenLayer(),
  },
  {
    id: "selection.invert",
    labelKey: "selection.invert",
    icon: FlipHorizontal,
    helpSlug: "image-selections",
    enabledWhen: (ctx) => ctx.hasModel,
    run: (ctx) => ctx.invertSelection(),
  },
];

export function createAdvancedImageCommands(): Command<AdvancedCommandContext>[] {
  return ENTRIES.map((entry) => ({
    id: entry.id,
    labelKey: entry.labelKey,
    icon: entry.icon,
    risk: "change",
    helpSlug: entry.helpSlug,
    enabledWhen: entry.enabledWhen,
    run: entry.run,
  }));
}

/** Registers the 18a commands in a shared registry so the Advanced host and
 * any later global menu/palette read one definition. Paint, text, shape and
 * PSD commands belong to 18b and stay absent until that step exists. */
export function registerAdvancedImageCommands(
  registry: CommandRegistry<AdvancedCommandContext>,
): void {
  for (const command of createAdvancedImageCommands()) registry.register(command);
}
