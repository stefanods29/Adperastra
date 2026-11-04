import type { LucideIcon } from "lucide-react";
import {
  Copy,
  FileOutput,
  FolderPlus,
  PackageOpen,
  Scissors,
  Share2,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import type { ConversionInput } from "../convert/types";
import type { Command } from "../commands/registry";
import type { MenuEntry } from "../commands/menus";
import { parentPathOf } from "../services/explorer";
import { startExternalDrag } from "../services/fileops";
import type { SavedTabDescriptor } from "../services/savedGroups";
import type {
  ShelfActionId,
  ShelfItem,
} from "../services/shelf";
import type { TransferRequest } from "../services/transferJobs";

/** Reviewed shelf actions (Step 09g T4). Every action opens its normal
 * review UI through the coordinator-owned host; the shelf never starts a
 * copy, move, archive, conversion, cleaning or share on its own. A failed
 * item is never silently removed from the shelf list. */

export interface ShelfActionHost {
  startTransfer(request: TransferRequest): Promise<void>;
  openBatch(inputs: ConversionInput[]): Promise<void>;
  openArchive(paths: readonly string[]): Promise<void>;
  share(paths: readonly string[]): Promise<void>;
  openGroup(descriptors: readonly SavedTabDescriptor[]): Promise<void>;
  openPrivacy(inputs: ConversionInput[]): Promise<void>;
}

function badRequest(): Error {
  return new Error("shelf.invalid");
}

function usableDiskPaths(items: readonly ShelfItem[]): string[] {
  return items
    .filter((item) => item.source.kind === "disk" && item.state === "available")
    .map((item) => (item.source.kind === "disk" ? item.source.path : ""))
    .filter((path) => path.length > 0);
}

function fileInputs(paths: readonly string[]): ConversionInput[] {
  return paths.map((path) => ({ kind: "file" as const, path }));
}

function groupDescriptors(items: readonly ShelfItem[]): SavedTabDescriptor[] {
  const descriptors: SavedTabDescriptor[] = [];
  for (const item of items) {
    if (item.source.kind === "disk") {
      descriptors.push({ kind: "file", path: item.source.path, title: item.display_name });
    } else if (item.source.kind === "virtual") {
      // Only the opaque source; no fabricated path, title or view state.
      descriptors.push({ kind: "file", source: item.source });
    }
  }
  return descriptors;
}

/** Run one reviewed shelf action. `id` is a static union, never text from
 * a file or a menu label. */
export async function runShelfAction(
  id: ShelfActionId,
  items: readonly ShelfItem[],
  host: ShelfActionHost,
): Promise<void> {
  const paths = usableDiskPaths(items);
  if (id === "open_group") {
    const descriptors = groupDescriptors(items);
    if (descriptors.length === 0) throw badRequest();
    await host.openGroup(descriptors);
    return;
  }
  if (paths.length === 0) throw badRequest();
  switch (id) {
    case "copy":
    case "move": {
      const dest = parentPathOf(paths[0]);
      if (!dest) throw badRequest();
      await host.startTransfer({
        kind: id,
        sources: paths,
        dest_dir: dest,
        conflict: "skip",
        allow_system: false,
        priority: "normal",
      });
      return;
    }
    case "compress":
      await host.openArchive(paths);
      return;
    case "share":
      await host.share(paths);
      return;
    case "convert":
      await host.openBatch(fileInputs(paths));
      return;
    case "privacy":
      await host.openPrivacy(fileInputs(paths));
      return;
  }
}

/** Drag valid disk references out with native OLE. A sensitive virtual
 * reference has no safe-copy route until Step 09k registers one, so the
 * whole drag is unsupported rather than silently dropping it. */
export async function startShelfDragOut(
  items: readonly ShelfItem[],
): Promise<"copy" | "move" | "link" | "none"> {
  if (items.some((item) => item.runtime_sensitive)) throw new Error("shelf.sensitive");
  const paths = usableDiskPaths(items);
  if (paths.length === 0) throw new Error("shelf.invalid");
  return startExternalDrag(paths);
}

export interface ShelfActionButton {
  id: ShelfActionId;
  labelKey: string;
  icon: LucideIcon;
}

/** The panel toolbar's reviewed actions, in display order. */
export const SHELF_ACTION_BUTTONS: readonly ShelfActionButton[] = [
  { id: "copy", labelKey: "commands.copy", icon: Copy },
  { id: "move", labelKey: "commands.cut", icon: Scissors },
  { id: "compress", labelKey: "commands.compressTo", icon: PackageOpen },
  { id: "share", labelKey: "commands.share", icon: Share2 },
  { id: "convert", labelKey: "commands.convertTo", icon: FileOutput },
  { id: "privacy", labelKey: "commands.removeHiddenInfo", icon: ShieldCheck },
  { id: "open_group", labelKey: "shelf.openGroup", icon: FolderPlus },
];

export interface ShelfCommandContext {
  selectionCount: number;
  run: (id: ShelfActionId | "remove" | "clear") => void;
}

export const SHELF_MENU: MenuEntry[] = [
  { type: "command", id: "shelf.copy" },
  { type: "command", id: "shelf.move" },
  { type: "command", id: "shelf.compress" },
  { type: "command", id: "shelf.share" },
  { type: "command", id: "shelf.convert" },
  { type: "command", id: "shelf.privacy" },
  { type: "command", id: "shelf.openGroup" },
  { type: "separator" },
  { type: "command", id: "shelf.remove" },
  { type: "command", id: "shelf.clear" },
];

interface ActionSpec {
  id: ShelfActionId | "remove" | "clear";
  labelKey: string;
  icon: LucideIcon;
  needsSelection: boolean;
}

const ACTION_SPECS: readonly ActionSpec[] = [
  { id: "copy", labelKey: "commands.copy", icon: Copy, needsSelection: true },
  { id: "move", labelKey: "commands.cut", icon: Scissors, needsSelection: true },
  { id: "compress", labelKey: "commands.compressTo", icon: PackageOpen, needsSelection: true },
  { id: "share", labelKey: "commands.share", icon: Share2, needsSelection: true },
  { id: "convert", labelKey: "commands.convertTo", icon: FileOutput, needsSelection: true },
  { id: "privacy", labelKey: "commands.removeHiddenInfo", icon: ShieldCheck, needsSelection: true },
  { id: "open_group", labelKey: "shelf.openGroup", icon: FolderPlus, needsSelection: true },
  { id: "remove", labelKey: "shelf.remove", icon: XCircle, needsSelection: true },
  { id: "clear", labelKey: "shelf.clear", icon: Trash2, needsSelection: false },
];

/** The shelf menu's commands. They use the same command/menu shape as the
 * app registry; the coordinator may register these ids globally. */
export function createShelfCommands(): Command<ShelfCommandContext>[] {
  return ACTION_SPECS.map((spec) => ({
    id: `shelf.${spec.id === "open_group" ? "openGroup" : spec.id}`,
    labelKey: spec.labelKey,
    icon: spec.icon,
    risk: spec.id === "share" || spec.id === "open_group" ? "read-only" : "change",
    helpSlug: "the-shelf",
    enabledWhen: (context) => !spec.needsSelection || context.selectionCount > 0,
    run: (context) => context.run(spec.id),
  }));
}
