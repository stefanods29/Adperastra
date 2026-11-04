import { FileOutput, KeyRound, Lock, LockKeyhole, Save } from "lucide-react";
import type { Command, CommandContext } from "./registry";

/** Locked-folder commands (Step 09k). The create command says "encrypted
 * copy", never that an original folder becomes protected. */

export interface LockedCommandContext extends CommandContext {
  /** True while the active tab has a live unlocked container. */
  lockedSession: boolean;
}

export interface LockedCommandActions {
  createEncryptedCopy: (sourceDir: string) => void;
  unlock: (containerPath: string) => void;
  lock: () => void;
  saveCopy: () => void;
  exportCopy: () => void;
}

export function createLockedCommands(
  actions: LockedCommandActions,
): Command<LockedCommandContext>[] {
  return [
    {
      id: "explorer.createEncryptedCopy",
      labelKey: "commands.createEncryptedCopy",
      icon: LockKeyhole,
      risk: "change",
      helpSlug: "locked-folders",
      enabledWhen: (ctx) =>
        ctx.selectedKind === "folder" ||
        (ctx.currentPath !== null && ctx.selectedKind === null),
      run: (ctx) => {
        const source =
          ctx.selectedKind === "folder" && ctx.selectedPath
            ? ctx.selectedPath
            : ctx.currentPath;
        if (source) actions.createEncryptedCopy(source);
      },
    },
    {
      id: "locked.unlock",
      labelKey: "commands.unlockLocked",
      icon: KeyRound,
      risk: "read-only",
      helpSlug: "recovery-keys",
      enabledWhen: (ctx) =>
        ctx.selection.count === 1 &&
        ctx.selectedKind === "file" &&
        Boolean(ctx.selectedPath?.toLowerCase().endsWith(".adplock")),
      run: (ctx) => {
        if (ctx.selectedPath) actions.unlock(ctx.selectedPath);
      },
    },
    {
      id: "locked.lock",
      labelKey: "commands.lockFolder",
      icon: Lock,
      risk: "change",
      helpSlug: "locking-protection",
      enabledWhen: (ctx) => ctx.lockedSession,
      run: () => actions.lock(),
    },
    {
      id: "locked.saveCopy",
      labelKey: "commands.saveLockedCopy",
      icon: Save,
      risk: "change",
      helpSlug: "locked-folders",
      enabledWhen: (ctx) => ctx.lockedSession,
      run: () => actions.saveCopy(),
    },
    {
      id: "locked.exportCopy",
      labelKey: "commands.exportUnlockedCopy",
      icon: FileOutput,
      risk: "change",
      helpSlug: "locking-protection",
      enabledWhen: (ctx) => ctx.lockedSession,
      run: () => actions.exportCopy(),
    },
  ];
}
