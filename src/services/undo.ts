/** Undo stack (contract 11, Step 03b). One history shared by Ctrl+Z /
 * Ctrl+Y, the undo toasts, and the Recent actions list. Entries store
 * what to do as data (a FileAction), never as closures, so the Recent
 * actions list can show and run them long after the toast is gone. */

export type FileAction =
  /** Replay exact file-transfer effects retained in Rust. */
  | { type: "transfer"; id: string; reverse: boolean }
  /** Move one item to an exact path (same-folder renames included). */
  | { type: "rename"; from: string; to: string }
  /** Move several items, each `from` to its exact `to`. */
  | { type: "movePairs"; pairs: { from: string; to: string }[] }
  /** Copy items into a folder (redo of a copy; undo of a move is pairs). */
  | { type: "copy"; sources: string[]; destDir: string; conflict: "replace" | "skip" | "keepBoth" }
  /** Send items to the Recycle Bin (undo of copy/new). */
  | { type: "recycle"; paths: string[] }
  /** Restore items from the Recycle Bin to these original paths. With
   * `binIds` (one per original), restore exactly those bin entries: the
   * items a Replace sent there, never a newer item with the same path. */
  | { type: "restore"; originals: string[]; binIds?: string[] }
  /** Run actions one after another (a grouped entry). */
  | { type: "sequence"; actions: FileAction[] };

export interface UndoEntry {
  id: number;
  /** i18n key for the toast / Recent actions label. */
  labelKey: string;
  labelArgs?: Record<string, string | number>;
  undo: FileAction;
  redo: FileAction;
  at: number;
}

export interface UndoEntryInput {
  labelKey: string;
  labelArgs?: Record<string, string | number>;
  undo: FileAction;
  redo: FileAction;
}

const MAX_ENTRIES = 100;

export class UndoStack {
  private list: UndoEntry[] = [];
  /** Entries at indices < cursor can be undone; the rest can be redone. */
  private cursor = 0;
  private nextId = 1;
  private group: { labelKey: string; labelArgs?: Record<string, string | number>; inputs: UndoEntryInput[] } | null =
    null;

  get entries(): readonly UndoEntry[] {
    return this.list;
  }

  /** Plans referenced by redo history or an unfinished group stay alive. */
  get retainedEntries(): readonly UndoEntryInput[] {
    return this.group ? [...this.list, ...this.group.inputs] : this.list;
  }

  get canUndo(): boolean {
    return this.cursor > 0;
  }

  get canRedo(): boolean {
    return this.cursor < this.list.length;
  }

  push(input: UndoEntryInput): void {
    if (this.group) {
      this.group.inputs.push(input);
      return;
    }
    // A new action invalidates everything that could have been redone.
    this.list.length = this.cursor;
    this.list.push({ ...input, id: this.nextId, at: Date.now() });
    this.nextId += 1;
    if (this.list.length > MAX_ENTRIES) {
      this.list.splice(0, this.list.length - MAX_ENTRIES);
    }
    this.cursor = this.list.length;
  }

  beginGroup(labelKey: string, labelArgs?: Record<string, string | number>): void {
    if (!this.group) this.group = { labelKey, labelArgs, inputs: [] };
  }

  endGroup(): void {
    const group = this.group;
    this.group = null;
    if (!group || group.inputs.length === 0) return;
    if (group.inputs.length === 1) {
      this.push(group.inputs[0]);
      return;
    }
    this.push({
      labelKey: group.labelKey,
      labelArgs: group.labelArgs,
      // Undo the group's steps newest-first; redo in the original order.
      undo: { type: "sequence", actions: group.inputs.map((input) => input.undo).reverse() },
      redo: { type: "sequence", actions: group.inputs.map((input) => input.redo) },
    });
  }

  /** The entry Ctrl+Z would undo, without changing anything yet. The
   * caller executes it and calls confirmUndo() only on success, so a
   * failed undo (item deleted elsewhere) stays undoable. */
  peekUndo(): UndoEntry | null {
    return this.canUndo ? this.list[this.cursor - 1] : null;
  }

  peekRedo(): UndoEntry | null {
    return this.canRedo ? this.list[this.cursor] : null;
  }

  confirmUndo(): void {
    if (this.canUndo) this.cursor -= 1;
  }

  confirmRedo(): void {
    if (this.canRedo) this.cursor += 1;
  }

  /** Newest first, for the Recent actions list. Entries below the cursor
   * can still be undone; the rest can be redone. */
  recent(limit: number): { entry: UndoEntry; canUndo: boolean; canRedo: boolean }[] {
    const out: { entry: UndoEntry; canUndo: boolean; canRedo: boolean }[] = [];
    for (let index = this.list.length - 1; index >= 0 && out.length < limit; index -= 1) {
      out.push({
        entry: this.list[index],
        canUndo: index < this.cursor,
        canRedo: index >= this.cursor,
      });
    }
    return out;
  }

  /** Undo one specific entry from Recent actions (it must be the top
   * undoable one; history is strictly ordered). */
  isTopUndo(entry: UndoEntry): boolean {
    return this.peekUndo()?.id === entry.id;
  }

  isTopRedo(entry: UndoEntry): boolean {
    return this.peekRedo()?.id === entry.id;
  }
}
