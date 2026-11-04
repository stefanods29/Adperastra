import {
  FilePlus,
  Files,
  Highlighter,
  Merge,
  MessageSquare,
  Pencil,
  PenTool,
  RotateCw,
  Split,
  Trash2,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { Command } from "../commands/registry";

/** PDF edit commands (Step 14a). The PDF ribbon adds these to the existing
 * viewer commands; no new global shortcut is registered. Every command opens
 * its own help page with F1 or the panel's "?" button. */

export type PdfEditTool = "highlight" | "draw" | "text" | "comment" | "sign";

export interface PdfEditCommandContext {
  ready: boolean;
  editing: boolean;
  previewOnly: boolean;
  busy: boolean;
  tool: PdfEditTool | null;
  selection: string | null;
  pageSelection: readonly string[];
  canUndo: boolean;
  canRedo: boolean;
}

export interface PdfEditActions {
  setTool(tool: PdfEditTool | null): void;
  openPages(): void;
  openMerge(): void;
  openSplit(): void;
  openInsert(): void;
  rotateSelection(): void;
  deleteSelection(): void;
  undo(): void;
  redo(): void;
}

export const PDF_EDIT_HELP_SLUGS = [
  "pdf-annotations",
  "pdf-comments",
  "pdf-signing",
  "pdf-pages",
  "pdf-forms",
] as const;

export type PdfEditHelpSlug = (typeof PDF_EDIT_HELP_SLUGS)[number];

interface Definition {
  id: string;
  labelKey: string;
  icon: LucideIcon;
  helpSlug: PdfEditHelpSlug;
  enabled: (ctx: PdfEditCommandContext) => boolean;
  run: (actions: PdfEditActions, ctx: PdfEditCommandContext) => void;
}

const TOOL_DEFINITIONS: Array<{
  id: string;
  tool: PdfEditTool;
  labelKey: string;
  icon: LucideIcon;
  helpSlug: PdfEditHelpSlug;
}> = [
  { id: "pdf.highlight", tool: "highlight", labelKey: "pdfTools.highlight", icon: Highlighter, helpSlug: "pdf-annotations" },
  { id: "pdf.draw", tool: "draw", labelKey: "pdfTools.draw", icon: Pencil, helpSlug: "pdf-annotations" },
  { id: "pdf.text", tool: "text", labelKey: "pdfTools.text", icon: Type, helpSlug: "pdf-annotations" },
  { id: "pdf.comment", tool: "comment", labelKey: "pdfTools.comment", icon: MessageSquare, helpSlug: "pdf-comments" },
  { id: "pdf.sign", tool: "sign", labelKey: "pdfTools.sign", icon: PenTool, helpSlug: "pdf-signing" },
];

const DEFINITIONS: Definition[] = [
  ...TOOL_DEFINITIONS.map((definition) => ({
    id: definition.id,
    labelKey: definition.labelKey,
    icon: definition.icon,
    helpSlug: definition.helpSlug,
    enabled: (ctx: PdfEditCommandContext) => ctx.ready && ctx.editing && !ctx.previewOnly && !ctx.busy,
    run: (actions: PdfEditActions, ctx: PdfEditCommandContext) =>
      actions.setTool(ctx.tool === definition.tool ? null : definition.tool),
  })),
  {
    id: "pdf.pages",
    labelKey: "pdfTools.pages",
    icon: Files,
    helpSlug: "pdf-pages",
    enabled: (ctx) => ctx.ready && ctx.editing && !ctx.previewOnly && !ctx.busy,
    run: (actions) => actions.openPages(),
  },
  {
    id: "pdf.merge",
    labelKey: "pdfTools.merge",
    icon: Merge,
    helpSlug: "pdf-pages",
    enabled: (ctx) => ctx.ready && ctx.editing && !ctx.previewOnly && !ctx.busy,
    run: (actions) => actions.openMerge(),
  },
  {
    id: "pdf.split",
    labelKey: "pdfTools.split",
    icon: Split,
    helpSlug: "pdf-pages",
    enabled: (ctx) => ctx.ready && ctx.editing && !ctx.previewOnly && !ctx.busy,
    run: (actions) => actions.openSplit(),
  },
  {
    id: "pdf.rotate",
    labelKey: "pdfTools.rotate",
    icon: RotateCw,
    helpSlug: "pdf-pages",
    enabled: (ctx) => ctx.ready && ctx.editing && !ctx.previewOnly && !ctx.busy && ctx.pageSelection.length > 0,
    run: (actions) => actions.rotateSelection(),
  },
  {
    id: "pdf.delete",
    labelKey: "pdfTools.delete",
    icon: Trash2,
    helpSlug: "pdf-pages",
    enabled: (ctx) => ctx.ready && ctx.editing && !ctx.previewOnly && !ctx.busy && ctx.pageSelection.length > 0,
    run: (actions) => actions.deleteSelection(),
  },
  {
    id: "pdf.insert",
    labelKey: "pdfTools.insert",
    icon: FilePlus,
    helpSlug: "pdf-pages",
    enabled: (ctx) => ctx.ready && ctx.editing && !ctx.previewOnly && !ctx.busy,
    run: (actions) => actions.openInsert(),
  },
  {
    id: "pdf.undo",
    labelKey: "commands.undo",
    icon: RotateCw,
    helpSlug: "pdf-annotations",
    enabled: (ctx) => ctx.ready && ctx.editing && !ctx.previewOnly && !ctx.busy && ctx.canUndo,
    run: (actions) => actions.undo(),
  },
  {
    id: "pdf.redo",
    labelKey: "commands.redo",
    icon: RotateCw,
    helpSlug: "pdf-annotations",
    enabled: (ctx) => ctx.ready && ctx.editing && !ctx.previewOnly && !ctx.busy && ctx.canRedo,
    run: (actions) => actions.redo(),
  },
];

export function createPdfEditCommands(actions: PdfEditActions): Command<PdfEditCommandContext>[] {
  return DEFINITIONS.map((definition) => ({
    id: definition.id,
    labelKey: definition.labelKey,
    icon: definition.icon,
    risk: "change",
    helpSlug: definition.helpSlug,
    enabledWhen: definition.enabled,
    checkedWhen: definition.id.startsWith("pdf.") && TOOL_DEFINITIONS.some((tool) => tool.id === definition.id)
      ? (ctx: PdfEditCommandContext) => {
          const tool = TOOL_DEFINITIONS.find((entry) => entry.id === definition.id);
          return tool !== undefined && ctx.tool === tool.tool;
        }
      : undefined,
    checkKind: TOOL_DEFINITIONS.some((tool) => tool.id === definition.id) ? "radio" : undefined,
    run: (ctx) => definition.run(actions, ctx),
  }));
}

export function pdfEditHelpSlugForCommand(id: string): PdfEditHelpSlug {
  return DEFINITIONS.find((definition) => definition.id === id)?.helpSlug ?? "pdf-annotations";
}

export const PDF_EDIT_COMMAND_IDS = DEFINITIONS.map((definition) => definition.id);
