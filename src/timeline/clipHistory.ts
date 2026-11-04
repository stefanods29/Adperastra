/**
 * Bounded gesture history for the timeline (Step 19a T2).
 *
 * One completed gesture is one entry. Entries are immutable project snapshots;
 * the revision and content identity are assigned by the transaction layer, so
 * Undo returns to the exact earlier content identity (09a semantics). When the
 * entry or byte budget is full a new edit is refused with
 * `timeline.history_full`; retained history is never silently dropped.
 */

import type { TimelineProject } from "./types";
import {
  TIMELINE_MAX_HISTORY_BYTES,
  TIMELINE_MAX_HISTORY_ENTRIES,
  TimelineError,
} from "./types";
import { cloneProject, freezeProject } from "./projectValidation";

interface HistoryEntry {
  project: TimelineProject;
  label: string;
  bytes: number;
}

function measure(project: Readonly<TimelineProject>): number {
  return new TextEncoder().encode(JSON.stringify(project)).length;
}

function encoded(project: Readonly<TimelineProject>, label: string): HistoryEntry {
  const snapshot = freezeProject(cloneProject(project));
  return { project: snapshot, label, bytes: measure(snapshot) };
}

function total(entries: readonly HistoryEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.bytes, 0);
}

export class ClipHistory {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private readonly maxEntries: number;
  private readonly maxBytes: number;

  constructor(
    maxEntries: number = TIMELINE_MAX_HISTORY_ENTRIES,
    maxBytes: number = TIMELINE_MAX_HISTORY_BYTES,
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new TimelineError("timeline.bad_request");
    }
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw new TimelineError("timeline.bad_request");
    }
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get entries(): number {
    return this.undoStack.length;
  }

  get bytes(): number {
    return total(this.undoStack) + total(this.redoStack);
  }

  /** Remember the project before one completed gesture. */
  record(before: Readonly<TimelineProject>, label: string): void {
    const entry = encoded(before, label);
    if (
      this.undoStack.length + 1 > this.maxEntries ||
      total(this.undoStack) + entry.bytes > this.maxBytes
    ) {
      throw new TimelineError("timeline.history_full");
    }
    this.undoStack.push(entry);
    this.redoStack = [];
  }

  /** Move one entry back; returns the exact earlier project. */
  undo(current: Readonly<TimelineProject>): TimelineProject | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.pushRedo(encoded(current, entry.label));
    return entry.project;
  }

  /** Move one entry forward; returns the exact later project. */
  redo(current: Readonly<TimelineProject>): TimelineProject | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    return entry.project;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Redo is a convenience stack: when its budget fills, its oldest entry is
   * dropped. Undo entries are never dropped silently. */
  private pushRedo(entry: HistoryEntry): void {
    this.redoStack.push(entry);
    while (
      this.redoStack.length > this.maxEntries ||
      total(this.redoStack) + total(this.undoStack) > this.maxBytes
    ) {
      this.redoStack.shift();
    }
  }
}

/** True when a history error means the edit must be refused, not retried. */
export function isHistoryFull(error: unknown): boolean {
  return error instanceof TimelineError && error.code === "timeline.history_full";
}
