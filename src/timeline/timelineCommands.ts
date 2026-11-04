import {
  Blend,
  Captions,
  Clapperboard,
  Download,
  Film,
  Magnet,
  Plus,
  Scissors,
  SlidersHorizontal,
  Split,
  Type,
  Volume2,
} from "lucide-react";

import type { Command } from "../commands/registry";

/** What the timeline commands can read from the active editor. */
export interface TimelineCommandContext {
  hasProject: boolean;
  /** A selected media item can become a new timeline project. */
  canEditMedia: boolean;
  hasSelection: boolean;
  canSplit: boolean;
  snapEnabled: boolean;
  /** True when the editor can open the bounded export review dialog. The
   * dialog only validates settings and reports capability state; starting an
   * export still needs a real audited native provider, so this is not a claim
   * that output is possible. */
  canExportTimeline?: boolean;
}

export interface TimelineCommandActions {
  newProject: () => void;
  editInTimeline: () => void;
  addVideoTrack: () => void;
  addAudioTrack: () => void;
  split: () => void;
  ripple: () => void;
  toggleSnap: () => void;
  openTransition: () => void;
  openTitle: () => void;
  openEffects: () => void;
  openAudio: () => void;
  openSubtitles: () => void;
  openExport: () => void;
}

/**
 * Timeline commands (Step 19a). They carry no global shortcut: the editor's
 * scoped key handling owns Space/arrows/Delete, and the app's editor Undo is
 * never replaced by a timeline-global one.
 */
export function createTimelineCommands(
  actions: TimelineCommandActions,
): Command<TimelineCommandContext>[] {
  const enabled = (context: TimelineCommandContext) => context.hasProject;
  return [
    {
      id: "timeline.new",
      labelKey: "timeline.new",
      icon: Clapperboard,
      risk: "change",
      helpSlug: "timeline",
      enabledWhen: () => true,
      run: () => actions.newProject(),
    },
    {
      id: "timeline.edit",
      labelKey: "timeline.edit",
      icon: Film,
      risk: "change",
      helpSlug: "timeline",
      enabledWhen: (context) => context.canEditMedia,
      run: () => actions.editInTimeline(),
    },
    {
      id: "timeline.addVideo",
      labelKey: "timeline.addVideo",
      icon: Plus,
      risk: "change",
      helpSlug: "timeline",
      enabledWhen: enabled,
      run: () => actions.addVideoTrack(),
    },
    {
      id: "timeline.addAudio",
      labelKey: "timeline.addAudio",
      icon: Plus,
      risk: "change",
      helpSlug: "timeline",
      enabledWhen: enabled,
      run: () => actions.addAudioTrack(),
    },
    {
      id: "timeline.split",
      labelKey: "timeline.split",
      icon: Split,
      risk: "change",
      helpSlug: "timeline-clips",
      enabledWhen: (context) => context.hasProject && context.canSplit,
      run: () => actions.split(),
    },
    {
      id: "timeline.ripple",
      labelKey: "timeline.ripple",
      icon: Scissors,
      risk: "change",
      helpSlug: "timeline-clips",
      enabledWhen: (context) => context.hasProject && context.hasSelection,
      run: () => actions.ripple(),
    },
    {
      id: "timeline.snap",
      labelKey: "timeline.snap",
      icon: Magnet,
      risk: "read-only",
      helpSlug: "timeline-clips",
      enabledWhen: enabled,
      checkedWhen: (context) => context.snapEnabled,
      checkKind: "toggle",
      run: () => actions.toggleSnap(),
    },
    {
      id: "timeline.transition",
      labelKey: "timelineEffects.transitions",
      icon: Blend,
      risk: "change",
      helpSlug: "timeline-transitions",
      enabledWhen: enabled,
      run: () => actions.openTransition(),
    },
    {
      id: "timeline.title",
      labelKey: "timelineEffects.title",
      icon: Type,
      risk: "change",
      helpSlug: "timeline-transitions",
      enabledWhen: enabled,
      run: () => actions.openTitle(),
    },
    {
      id: "timeline.effects",
      labelKey: "timelineEffects.color",
      icon: SlidersHorizontal,
      risk: "change",
      helpSlug: "timeline-effects",
      enabledWhen: enabled,
      run: () => actions.openEffects(),
    },
    {
      id: "timeline.audio",
      labelKey: "timelineEffects.audio",
      icon: Volume2,
      risk: "change",
      helpSlug: "timeline-audio",
      enabledWhen: enabled,
      run: () => actions.openAudio(),
    },
    {
      id: "timeline.subtitles",
      labelKey: "timelineEffects.subtitles",
      icon: Captions,
      risk: "change",
      helpSlug: "timeline-audio",
      enabledWhen: enabled,
      run: () => actions.openSubtitles(),
    },
    {
      id: "timeline.export",
      labelKey: "timelineEffects.export",
      icon: Download,
      risk: "change",
      helpSlug: "timeline-export",
      // The bounded dialog reviews the fixed presets and the verified encoder
      // pack state; this build has no native graph executor, so the dialog's
      // Start action stays disabled and no job or output is claimed.
      enabledWhen: (context) => context.hasProject && context.canExportTimeline === true,
      run: () => actions.openExport(),
    },
  ];
}
