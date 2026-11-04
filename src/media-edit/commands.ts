import { Crop, Download, Music, RotateCw, Scissors, Split } from "lucide-react";
import type { Command } from "../commands/registry";

/**
 * The media editor's commands (`E2` UI half, T2/T4).
 *
 * IDs, labels, icons and help pages are fixed by the step guide. No global
 * shortcut is registered: the same keys already belong to other editors.
 */

export interface MediaEditContext {
  ready: boolean;
  /** False for a recipe document the registry opened read-only. */
  editable: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  hasVideo: boolean;
  canExport: boolean;
}

export interface MediaEditActions {
  trim: () => void;
  cut: () => void;
  split: () => void;
  extractAudio: () => void;
  crop: () => void;
  rotate: () => void;
  exportMedia: () => void;
}

const HELP_TRIM = "media-trimming";
const HELP_EXTRACT = "media-extract-audio";
const HELP_EXPORT = "media-exporting";

export function createMediaEditCommands(actions: MediaEditActions): Command<MediaEditContext>[] {
  return [
    {
      id: "media.trim",
      labelKey: "mediaEdit.trim",
      icon: Scissors,
      risk: "change",
      helpSlug: HELP_TRIM,
      enabledWhen: (ctx) => ctx.ready && ctx.editable,
      run: () => actions.trim(),
    },
    {
      id: "media.cut",
      labelKey: "mediaEdit.cut",
      icon: Scissors,
      risk: "change",
      helpSlug: HELP_TRIM,
      enabledWhen: (ctx) => ctx.ready && ctx.editable && ctx.hasSelection,
      run: () => actions.cut(),
    },
    {
      id: "media.split",
      labelKey: "mediaEdit.split",
      icon: Split,
      risk: "change",
      helpSlug: HELP_TRIM,
      enabledWhen: (ctx) => ctx.ready && ctx.editable,
      run: () => actions.split(),
    },
    {
      id: "media.extract",
      labelKey: "mediaEdit.extract",
      icon: Music,
      risk: "change",
      helpSlug: HELP_EXTRACT,
      enabledWhen: (ctx) => ctx.ready && ctx.editable && ctx.hasVideo && ctx.canExport,
      run: () => actions.extractAudio(),
    },
    {
      id: "media.crop",
      labelKey: "mediaEdit.crop",
      icon: Crop,
      risk: "change",
      helpSlug: HELP_TRIM,
      enabledWhen: (ctx) => ctx.ready && ctx.editable && ctx.hasVideo,
      run: () => actions.crop(),
    },
    {
      id: "media.rotate",
      labelKey: "mediaEdit.rotate",
      icon: RotateCw,
      risk: "change",
      helpSlug: HELP_TRIM,
      enabledWhen: (ctx) => ctx.ready && ctx.editable && ctx.hasVideo,
      run: () => actions.rotate(),
    },
    {
      id: "media.export",
      labelKey: "mediaEdit.export",
      icon: Download,
      risk: "change",
      helpSlug: HELP_EXPORT,
      enabledWhen: (ctx) => ctx.ready && ctx.canExport,
      run: () => actions.exportMedia(),
    },
  ];
}
