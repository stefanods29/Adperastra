import {
  fail,
  MAX_HISTORY_BYTES,
  MAX_HISTORY_TRANSACTIONS,
  type ImageModel,
} from "./types";

/** Bounded immutable undo/redo history (D2).
 *
 * A history state is an immutable `ImageModel`; tile bytes live once in the
 * tile store, so an entry costs only the changed tile bytes plus metadata.
 * A transaction that cannot retain its inverse is refused instead of
 * silently dropping the oldest Undo state. */

export interface HistoryEntry {
  before: Readonly<ImageModel>;
  after: Readonly<ImageModel>;
  cost_bytes: number;
}

export interface HistoryUndoResult {
  model: Readonly<ImageModel>;
}

export class ImageHistory {
  private readonly limitBytes: number;
  private readonly limitTransactions: number;
  private undoEntries: HistoryEntry[] = [];
  private redoEntries: HistoryEntry[] = [];
  private usedBytes = 0;
  private savedContentId: string;
  private current: Readonly<ImageModel>;

  constructor(initial: Readonly<ImageModel>, limitBytes = MAX_HISTORY_BYTES, limitTransactions = MAX_HISTORY_TRANSACTIONS) {
    if (!Number.isSafeInteger(limitBytes) || limitBytes < 1) fail("image_edit.bad_request");
    if (!Number.isSafeInteger(limitTransactions) || limitTransactions < 1) fail("image_edit.bad_request");
    this.limitBytes = limitBytes;
    this.limitTransactions = limitTransactions;
    this.current = initial;
    this.savedContentId = initial.content_id;
  }

  get model(): Readonly<ImageModel> {
    return this.current;
  }

  get canUndo(): boolean {
    return this.undoEntries.length > 0;
  }

  get canRedo(): boolean {
    return this.redoEntries.length > 0;
  }

  get transactionCount(): number {
    return this.undoEntries.length;
  }

  get byteLength(): number {
    return this.usedBytes;
  }

  /** Makes `contentId` the saved identity; later edits stay dirty. */
  markSaved(contentId: string): void {
    this.savedContentId = contentId;
  }

  isDirty(): boolean {
    return this.current.content_id !== this.savedContentId;
  }

  savedContent(): string {
    return this.savedContentId;
  }

  /** Reserves the exact before/after pair. Returns false when the inverse
   * would not fit; the caller then commits nothing. */
  push(before: Readonly<ImageModel>, after: Readonly<ImageModel>, changedTileBytes: number): boolean {
    if (!Number.isSafeInteger(changedTileBytes) || changedTileBytes < 0) fail("image_edit.bad_request");
    const metadataCost = estimateModelBytes(before) + estimateModelBytes(after);
    const cost = changedTileBytes + metadataCost;
    if (this.undoEntries.length + 1 > this.limitTransactions) return false;
    if (this.usedBytes + cost > this.limitBytes) return false;
    this.undoEntries.push({ before, after, cost_bytes: cost });
    this.usedBytes += cost;
    for (const entry of this.redoEntries) this.usedBytes -= entry.cost_bytes;
    this.redoEntries = [];
    this.current = after;
    return true;
  }

  /** Drops the last committed transaction (used when a later step fails
   * before notification). */
  rollbackLast(): void {
    const entry = this.undoEntries.pop();
    if (!entry) return;
    this.usedBytes -= entry.cost_bytes;
    this.current = entry.before;
  }

  undo(): Readonly<ImageModel> | null {
    const entry = this.undoEntries.pop();
    if (!entry) return null;
    this.usedBytes -= entry.cost_bytes;
    this.redoEntries.push(entry);
    this.current = entry.before;
    return this.current;
  }

  redo(): Readonly<ImageModel> | null {
    const entry = this.redoEntries.pop();
    if (!entry) return null;
    this.undoEntries.push(entry);
    this.usedBytes += entry.cost_bytes;
    this.current = entry.after;
    return this.current;
  }

  /** Drops all edit history and moves to an already validated state. */
  resetTo(model: Readonly<ImageModel>): void {
    this.undoEntries = [];
    this.redoEntries = [];
    this.usedBytes = 0;
    this.current = model;
  }

  /** Finds an immutable model by its content identity (saved-state reset). */
  findContent(contentId: string): Readonly<ImageModel> | null {
    if (this.current.content_id === contentId) return this.current;
    const seen = [...this.undoEntries, ...this.redoEntries];
    for (const entry of seen) {
      if (entry.before.content_id === contentId) return entry.before;
      if (entry.after.content_id === contentId) return entry.after;
    }
    return null;
  }

  /** Tile ids retained by the current state, Undo and Redo entries. */
  retainedTileIds(): string[] {
    const ids = new Set<string>();
    const collect = (model: Readonly<ImageModel>) => {
      for (const tile of model.original_tiles) ids.add(tile.id);
      for (const layer of model.layers) {
        if (layer.kind === "raster") for (const tile of layer.tiles) ids.add(tile.id);
      }
      for (const mask of model.masks) for (const tile of mask.tiles) ids.add(tile.id);
    };
    collect(this.current);
    for (const entry of this.undoEntries) {
      collect(entry.before);
      collect(entry.after);
    }
    for (const entry of this.redoEntries) {
      collect(entry.before);
      collect(entry.after);
    }
    return [...ids];
  }
}

/** A small, deterministic upper bound for history metadata. */
export function estimateModelBytes(model: Readonly<ImageModel>): number {
  let bytes = 1024 + model.original_tiles.length * 128 + model.overlays.length * 256 + model.metadata.length * 128;
  bytes += model.layers.length * 1024;
  bytes += model.masks.length * 768;
  for (const layer of model.layers) {
    if (layer.kind === "raster") bytes += layer.tiles.length * 128;
  }
  for (const mask of model.masks) bytes += mask.tiles.length * 96;
  return bytes;
}
