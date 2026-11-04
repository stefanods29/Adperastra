import {
  Calendar,
  CalendarDays,
  FolderSearch,
  History,
  LayoutGrid,
  Map as MapIcon,
  Tag,
  Tags,
} from "lucide-react";
import type { Command, CommandContext } from "../commands/registry";

/** The indexed view a navigation entry opens (Step 11b revisions
 * `smart-views-1` and `map-tiles-1`). */
export type IndexedViewId =
  | "timeline"
  | "calendar"
  | "by_kind"
  | "recent_activity"
  | "map";

/** What the tag and view commands ask the Explorer to do. */
export interface TagCommandActions {
  addTags: () => void;
  removeTags: () => void;
  manageTags: () => void;
  saveSmartFolder: () => void;
  openIndexedView: (view: IndexedViewId) => void;
  /** True while a search result is on screen; the search surface owns it. */
  canSaveSmartFolder?: () => boolean;
  /** Settings > Views can switch a single indexed view off. */
  isIndexedViewEnabled?: (view: IndexedViewId) => boolean;
}

const hasSelection = (ctx: CommandContext) => ctx.selection.count > 0;

/** The tag and view commands (Step 11b). Deliberately no `shortcut`: the
 * tab shortcuts own Ctrl+1..9 and tag defaults stay unassigned. */
export function createTagCommands(actions: TagCommandActions): Command[] {
  const view = (
    id: string,
    labelKey: string,
    icon: Command["icon"],
    helpSlug: string,
    target: IndexedViewId,
  ): Command => ({
    id,
    labelKey,
    icon,
    risk: "read-only",
    helpSlug,
    enabledWhen: () => actions.isIndexedViewEnabled?.(target) ?? true,
    run: () => actions.openIndexedView(target),
  });

  return [
    {
      id: "explorer.tags",
      labelKey: "commands.tags",
      icon: Tag,
      risk: "change",
      helpSlug: "tags",
      enabledWhen: hasSelection,
      run: () => actions.addTags(),
    },
    {
      id: "explorer.removeTags",
      labelKey: "commands.removeTags",
      icon: Tags,
      risk: "change",
      helpSlug: "tags",
      enabledWhen: hasSelection,
      run: () => actions.removeTags(),
    },
    {
      id: "app.manageTags",
      labelKey: "commands.manageTags",
      icon: Tags,
      risk: "change",
      helpSlug: "managing-tags",
      enabledWhen: () => true,
      run: () => actions.manageTags(),
    },
    {
      id: "search.saveSmartFolder",
      labelKey: "commands.saveSmartFolder",
      icon: FolderSearch,
      risk: "change",
      helpSlug: "smart-folders",
      enabledWhen: () => actions.canSaveSmartFolder?.() ?? false,
      run: () => actions.saveSmartFolder(),
    },
    view(
      "app.timeline",
      "commands.timeline",
      CalendarDays,
      "timeline-calendar-kind-views",
      "timeline",
    ),
    view(
      "app.calendar",
      "commands.calendar",
      Calendar,
      "timeline-calendar-kind-views",
      "calendar",
    ),
    view(
      "app.byKind",
      "commands.byKind",
      LayoutGrid,
      "timeline-calendar-kind-views",
      "by_kind",
    ),
    view(
      "app.recentActivity",
      "commands.recentActivity",
      History,
      "recent-activity",
      "recent_activity",
    ),
    view("app.map", "commands.map", MapIcon, "photo-map", "map"),
  ];
}

/** The command ids this module owns, for the coordinator's registry check. */
export const TAG_COMMAND_IDS = [
  "explorer.tags",
  "explorer.removeTags",
  "app.manageTags",
  "search.saveSmartFolder",
  "app.timeline",
  "app.calendar",
  "app.byKind",
  "app.recentActivity",
  "app.map",
] as const;
