/** Central registration for commands whose hosts arrived after the Explorer
 * factories were written (Steps 09a-22b). Every command is defined exactly
 * once by its owning module; this file only decides whether the host is
 * present. A missing host leaves its command out of the registry instead of
 * registering a second definition that could drift from the real one. The one
 * explicit pending entry is `timeline.export`: no native render provider
 * exists yet, so it stays visible but disabled. */

import { FolderMinus, FolderPlus, Layers, ListOrdered, PanelsTopLeft, Pencil, Save } from "lucide-react";
import {
  createTagCommands,
  type IndexedViewId,
  type TagCommandActions,
} from "../tags/tagCommands";
import {
  createAccessibilityCommands,
  type AccessibilityCommandActions,
} from "./accessibilityCommands";
import {
  createAiSearchCommands,
  type AiSearchCommandActions,
  type AiSearchCommandMode,
} from "./aiSearchCommands";
import { createTimelineCommands, type TimelineCommandActions } from "../timeline/timelineCommands";
import { createLockedCommands } from "./lockedCommands";
import type { Command, CommandContext } from "./registry";
import { createThemeCommands, type ThemeActions } from "./themeCommands";
import {
  AUDIO_EXTENSIONS,
  VIDEO_EXTENSIONS,
} from "../handlers/media/helpers";
import {
  createWindowsIntegrationCommands,
  type WindowsIntegrationActions,
} from "./windowsIntegrationCommands";

/** Optional hosts for the integrated main-window features. The Explorer
 * creates a command only when its real host exists; the palette never shows
 * a command that would call an empty stub. */
export interface FeatureCommandActions {
  /** Tabs and groups (Steps 09a/09b). The App owns the tab strip. */
  newFolderTab?: () => void;
  tabGroupNew?: () => void;
  tabGroupRemove?: () => void;
  tabGroupSave?: () => void;
  openSavedGroups?: () => void;
  /** Bulk rename and batch actions (Step 09e). The Explorer supplies both
   * hosts; Rename stays disabled in the dialog until native receipt replay
   * exists (`fileops.executeFileAction`). */
  bulkRename?: () => void;
  batchActions?: () => void;
  /** Tags and indexed views (Step 11b). */
  addTags?: () => void;
  removeTags?: () => void;
  manageTags?: () => void;
  saveSmartFolder?: () => void;
  canSaveSmartFolder?: () => boolean;
  openIndexedView?: (view: IndexedViewId) => void;
  isIndexedViewEnabled?: (view: IndexedViewId) => boolean;
  /** Custom themes (Step 10a). */
  editTheme?: () => void;
  toggleDayNight?: () => void;
  /** Windows integration (Step 16). */
  openWindowsIntegration?: () => void;
  openStayBackground?: () => void;
  /** Media editing (Step 15). The host creates a new recipe document and
   * never touches the selected media file. */
  editMedia?: (path: string) => void;
  /** Timeline projects (Steps 19a/19b). The App owns creating/opening a
   * project; the mounted editor owns its own local commands. Export has no
   * native render provider in this build, so it stays unavailable. */
  newTimelineProject?: () => void;
  editInTimeline?: (path: string) => void;
  /** AI search and name suggestions (Step 17c). */
  openSearchMode?: (mode: AiSearchCommandMode) => void;
  suggestName?: () => void;
  sortSuggestions?: () => void;
  /** Locked folders (Step 09k). The App owns the one session and its
   * dialogs; the Explorer only supplies selection context. */
  lockedSession?: boolean;
  createEncryptedCopy?: (sourceDir: string) => void;
  unlockLockedFolder?: (containerPath: string) => void;
  lockLockedFolder?: () => void;
  saveLockedCopy?: () => void;
  exportLockedCopy?: () => void;
  /** Accessibility (Step 10f T5): Settings, read aloud names, click-pick,
   * focus layout. A missing host keeps that command out of the registry. */
  openAccessibility?: () => void;
  readAloud?: (paths: readonly string[]) => void;
  pickSelection?: (paths: readonly string[]) => void;
  cancelPick?: () => void;
  pickActive?: () => boolean;
  focusLayout?: () => void;
  focusLayoutActive?: () => boolean;
}

const noop = (): void => undefined;

const inList = (ctx: CommandContext): boolean =>
  ctx.location === "folder" || ctx.location === "home";

const EDITABLE_MEDIA_EXTENSIONS = new Set<string>([
  ...VIDEO_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
]);

/** "Edit in timeline" starts from a video; audio-only sources are refused
 * by `projectFromMediaSource`. */
const TIMELINE_SOURCE_EXTENSIONS = new Set<string>(VIDEO_EXTENSIONS);

function extensionOf(path: string | null): string | null {
  if (path === null) return null;
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : null;
}

function isEditableMediaPath(path: string | null): path is string {
  const ext = extensionOf(path);
  return ext !== null && EDITABLE_MEDIA_EXTENSIONS.has(ext);
}

function isTimelineSourcePath(path: string | null): path is string {
  const ext = extensionOf(path);
  return ext !== null && TIMELINE_SOURCE_EXTENSIONS.has(ext);
}

/** Result of the owning factory, filtered by the host that can run it. */
function hosted(
  commands: readonly Command[],
  available: (id: string) => boolean,
): Command[] {
  return commands.filter((command) => available(command.id));
}

/**
 * Commands of the features integrated after Step 08a. The owning factories
 * keep their own ids, labels, risks, help pages and enablement rules; this
 * composite adds the tab/group and bulk/batch commands that have no separate
 * factory and returns nothing for a feature whose host was not provided.
 */
export function createFeatureCommands(actions: FeatureCommandActions): Command[] {
  const commands: Command[] = [];

  if (actions.newFolderTab) {
    commands.push({
      id: "tab.newFolder",
      labelKey: "tabs.newFolder",
      icon: FolderPlus,
      risk: "change",
      helpSlug: "working-with-tabs",
      enabledWhen: () => true,
      run: () => actions.newFolderTab?.(),
    });
  }
  if (actions.tabGroupNew) {
    commands.push({
      id: "tab.groupNew",
      labelKey: "groups.new",
      icon: FolderPlus,
      risk: "change",
      helpSlug: "tab-groups",
      enabledWhen: () => true,
      run: () => actions.tabGroupNew?.(),
    });
  }
  if (actions.tabGroupRemove) {
    commands.push({
      id: "tab.groupRemove",
      labelKey: "groups.remove",
      icon: FolderMinus,
      risk: "change",
      helpSlug: "tab-groups",
      enabledWhen: () => true,
      run: () => actions.tabGroupRemove?.(),
    });
  }
  if (actions.tabGroupSave) {
    commands.push({
      id: "tab.groupSave",
      labelKey: "groups.save",
      icon: Save,
      risk: "change",
      helpSlug: "tab-groups",
      enabledWhen: () => true,
      run: () => actions.tabGroupSave?.(),
    });
  }
  if (actions.openSavedGroups) {
    commands.push({
      id: "app.savedGroups",
      labelKey: "groups.saved",
      icon: PanelsTopLeft,
      risk: "read-only",
      helpSlug: "saved-tab-groups",
      enabledWhen: () => true,
      run: () => actions.openSavedGroups?.(),
    });
  }

  // "Edit media" exists only when the App can create the recipe tab; the
  // command never writes the selected source file.
  if (actions.editMedia) {
    commands.push({
      id: "media.edit",
      labelKey: "mediaEdit.edit",
      icon: Pencil,
      risk: "read-only",
      helpSlug: "media-trimming",
      enabledWhen: (ctx) =>
        ctx.selectedKind === "file" && isEditableMediaPath(ctx.selectedPath),
      run: (ctx) => {
        if (isEditableMediaPath(ctx.selectedPath)) actions.editMedia?.(ctx.selectedPath);
      },
    });
  }

  // Timeline projects (Steps 19a/19b). The factory keeps the ids, labels,
  // icons, risks and help pages; this composite supplies the App hosts and
  // maps the Explorer's selection context. New/Edit appear only when their
  // real host exists. Export stays pending because this build has no native
  // render/export provider.
  if (actions.newTimelineProject || actions.editInTimeline) {
    const timelineHost: TimelineCommandActions = {
      newProject: noop,
      editInTimeline: noop,
      addVideoTrack: noop,
      addAudioTrack: noop,
      split: noop,
      ripple: noop,
      toggleSnap: noop,
      openTransition: noop,
      openTitle: noop,
      openEffects: noop,
      openAudio: noop,
      openSubtitles: noop,
      openExport: noop,
    };
    const timelineCommands = createTimelineCommands(timelineHost);
    const mapCommand = (
      id: string,
      enabledWhen: (ctx: CommandContext) => boolean,
      run: (ctx: CommandContext) => void,
    ): Command | null => {
      const source = timelineCommands.find((command) => command.id === id);
      if (!source) return null;
      return {
        id: source.id,
        labelKey: source.labelKey,
        icon: source.icon,
        risk: source.risk,
        helpSlug: source.helpSlug,
        enabledWhen,
        run,
      };
    };
    const newTimeline = actions.newTimelineProject;
    if (newTimeline) {
      const command = mapCommand("timeline.new", () => true, () => newTimeline());
      if (command) commands.push(command);
    }
    const editTimeline = actions.editInTimeline;
    if (editTimeline) {
      const selectedSource = (ctx: CommandContext): string | null => {
        const path = ctx.selectedKind === "file" ? ctx.selectedPath : null;
        return isTimelineSourcePath(path) ? path : null;
      };
      const command = mapCommand(
        "timeline.edit",
        (ctx) => selectedSource(ctx) !== null,
        (ctx) => {
          const path = selectedSource(ctx);
          if (path !== null) editTimeline(path);
        },
      );
      if (command) commands.push(command);
    }
    const exportCommand = mapCommand("timeline.export", () => false, () => undefined);
    if (exportCommand) commands.push({ ...exportCommand, pending: true });
  }

  if (actions.bulkRename) {
    commands.push({
      id: "explorer.bulkRename",
      labelKey: "rename.title",
      icon: ListOrdered,
      risk: "change",
      helpSlug: "bulk-rename",
      advanced: true,
      enabledWhen: (ctx) =>
        inList(ctx) && ctx.selection.count >= 1 && ctx.selection.count <= 1000,
      run: () => actions.bulkRename?.(),
    });
  }
  if (actions.batchActions) {
    commands.push({
      id: "explorer.batchActions",
      labelKey: "batch.title",
      icon: Layers,
      risk: "change",
      helpSlug: "batch-actions",
      advanced: true,
      enabledWhen: (ctx) => inList(ctx) && ctx.selection.count >= 1,
      run: () => actions.batchActions?.(),
    });
  }

  const tagHost: TagCommandActions = {
    addTags: actions.addTags ?? noop,
    removeTags: actions.removeTags ?? noop,
    manageTags: actions.manageTags ?? noop,
    saveSmartFolder: actions.saveSmartFolder ?? noop,
    openIndexedView: actions.openIndexedView ?? noop,
    canSaveSmartFolder: actions.canSaveSmartFolder,
    isIndexedViewEnabled: actions.isIndexedViewEnabled,
  };
  if (
    actions.addTags ||
    actions.removeTags ||
    actions.manageTags ||
    actions.saveSmartFolder ||
    actions.openIndexedView
  ) {
    const availability: Record<string, boolean> = {
      "explorer.tags": actions.addTags !== undefined,
      "explorer.removeTags": actions.removeTags !== undefined,
      "app.manageTags": actions.manageTags !== undefined,
      "search.saveSmartFolder": actions.saveSmartFolder !== undefined,
      "app.timeline": actions.openIndexedView !== undefined,
      "app.calendar": actions.openIndexedView !== undefined,
      "app.byKind": actions.openIndexedView !== undefined,
      "app.recentActivity": actions.openIndexedView !== undefined,
      "app.map": actions.openIndexedView !== undefined,
    };
    commands.push(...hosted(createTagCommands(tagHost), (id) => availability[id] === true));
  }

  if (actions.editTheme || actions.toggleDayNight) {
    const themeHost: ThemeActions = {
      editTheme: actions.editTheme ?? noop,
      toggleDayNight: actions.toggleDayNight ?? noop,
    };
    commands.push(
      ...hosted(createThemeCommands(themeHost), (id) =>
        id === "appearance.editTheme"
          ? actions.editTheme !== undefined
          : actions.toggleDayNight !== undefined,
      ),
    );
  }

  if (actions.openWindowsIntegration || actions.openStayBackground) {
    const integrationHost: WindowsIntegrationActions = {
      openWindowsIntegration: actions.openWindowsIntegration ?? noop,
      openStayBackground: actions.openStayBackground ?? noop,
    };
    commands.push(
      ...hosted(createWindowsIntegrationCommands(integrationHost), (id) =>
        id === "app.windowsIntegration"
          ? actions.openWindowsIntegration !== undefined
          : actions.openStayBackground !== undefined,
      ),
    );
  }

  if (
    actions.createEncryptedCopy ||
    actions.unlockLockedFolder ||
    actions.lockLockedFolder ||
    actions.saveLockedCopy ||
    actions.exportLockedCopy
  ) {
    const active = actions.lockedSession === true;
    const lockedHost = {
      createEncryptedCopy: actions.createEncryptedCopy ?? noop,
      unlock: actions.unlockLockedFolder ?? noop,
      lock: actions.lockLockedFolder ?? noop,
      saveCopy: actions.saveLockedCopy ?? noop,
      exportCopy: actions.exportLockedCopy ?? noop,
    };
    commands.push(
      ...createLockedCommands(lockedHost).map((command) => ({
        ...command,
        enabledWhen: (ctx: CommandContext) =>
          command.enabledWhen({ ...ctx, lockedSession: active }),
        run: (ctx: CommandContext, arg?: string) =>
          command.run({ ...ctx, lockedSession: active }, arg),
      }) as unknown as Command<CommandContext>),
    );
  }

  if (actions.openAccessibility) {
    const accessibilityHost: AccessibilityCommandActions = {
      openAccessibility: actions.openAccessibility,
      readAloud: actions.readAloud,
      pickSelection: actions.pickSelection,
      cancelPick: actions.cancelPick,
      pickActive: actions.pickActive,
      focusLayout: actions.focusLayout,
      focusLayoutActive: actions.focusLayoutActive,
    };
    const availability: Record<string, boolean> = {
      "app.accessibility": true,
      "app.readAloud": actions.readAloud !== undefined,
      "app.pickSelection": actions.pickSelection !== undefined,
      "app.cancelPick": actions.cancelPick !== undefined,
      "app.focusLayout": actions.focusLayout !== undefined,
    };
    commands.push(
      ...hosted(createAccessibilityCommands(accessibilityHost), (id) => availability[id] === true),
    );
  }

  if (actions.openSearchMode || actions.suggestName || actions.sortSuggestions) {
    const searchHost: AiSearchCommandActions = {
      openSearchMode: actions.openSearchMode ?? noop,
      suggestName: actions.suggestName ?? noop,
      sortSuggestions: actions.sortSuggestions ?? noop,
    };
    const availability: Record<string, boolean> = {
      "search.semantic": actions.openSearchMode !== undefined,
      "search.photos": actions.openSearchMode !== undefined,
      "search.similar": actions.openSearchMode !== undefined,
      "search.natural": actions.openSearchMode !== undefined,
      "file.suggestName": actions.suggestName !== undefined,
      "folder.sortSuggestions": actions.sortSuggestions !== undefined,
    };
    commands.push(
      ...hosted(createAiSearchCommands(searchHost), (id) => availability[id] === true).map(
        (command) => ({ ...command, advanced: true }),
      ),
    );
  }

  return commands;
}

/** The ids this composite can add, for registry and test checks. */
export const FEATURE_COMMAND_IDS = [
  "tab.newFolder",
  "tab.groupNew",
  "tab.groupRemove",
  "tab.groupSave",
  "app.savedGroups",
  "explorer.bulkRename",
  "explorer.batchActions",
  "explorer.tags",
  "explorer.removeTags",
  "app.manageTags",
  "search.saveSmartFolder",
  "app.timeline",
  "app.calendar",
  "app.byKind",
  "app.recentActivity",
  "app.map",
  "timeline.new",
  "timeline.edit",
  "timeline.export",
  "appearance.editTheme",
  "appearance.toggleDayNight",
  "app.windowsIntegration",
  "app.stayBackground",
  "search.semantic",
  "search.photos",
  "search.similar",
  "search.natural",
  "file.suggestName",
  "folder.sortSuggestions",
  "explorer.createEncryptedCopy",
  "locked.unlock",
  "locked.lock",
  "locked.saveCopy",
  "locked.exportCopy",
  "app.accessibility",
  "app.readAloud",
  "app.pickSelection",
  "app.cancelPick",
  "app.focusLayout",
] as const;
