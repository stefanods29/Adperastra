import type { PresentationIntent } from "../office/presentationTypes";
import { PRESENTATION_MAX_QUEUE } from "../services/presentationHelperTypes";

/** Audience keyboard intents (Step 22a T7, D8).
 *
 * The audience queues at most 16 typed navigation intents. Text, notes and
 * current-document controls never enter this queue. Adjacent duplicate
 * next/previous events coalesce; when the queue is full the newest repeat is
 * dropped and an Escape/end request keeps its place by removing the newest
 * non-end entry. A sequence number is assigned only to a retained event. */

export interface QueuedIntent {
  sequence: number;
  intent: PresentationIntent;
}

export function intentFromKey(key: string, modifiers: { ctrl: boolean; meta: boolean; alt: boolean }): PresentationIntent | null {
  if (modifiers.ctrl || modifiers.meta || modifiers.alt) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
    case "PageDown":
      return { kind: "next" };
    case "ArrowLeft":
    case "ArrowUp":
    case "PageUp":
      return { kind: "previous" };
    case "Home":
      return { kind: "first" };
    case "End":
      return { kind: "last" };
    case "Escape":
      return { kind: "end" };
    case "b":
    case "B":
      return { kind: "toggle_black" };
    case "p":
    case "P":
      return { kind: "toggle_pause" };
    default:
      return null;
  }
}

function sameDirection(a: PresentationIntent, b: PresentationIntent): boolean {
  return (a.kind === "next" || a.kind === "previous") && a.kind === b.kind;
}

/** Newest non-end entry, used to make room for Escape/end. */
function newestNonEndIndex(entries: readonly QueuedIntent[]): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index].intent.kind !== "end") return index;
  }
  return -1;
}

export class AudienceIntentQueue {
  private entries: QueuedIntent[] = [];
  private sequence = 0;

  push(intent: PresentationIntent): number | null {
    const last = this.entries[this.entries.length - 1];
    if (last && sameDirection(last.intent, intent)) return null;
    if (this.entries.length >= PRESENTATION_MAX_QUEUE) {
      const index = newestNonEndIndex(this.entries);
      if (index < 0) return null;
      this.entries.splice(index, 1);
    }
    this.sequence += 1;
    this.entries.push({ sequence: this.sequence, intent });
    return this.sequence;
  }

  /** The next retained intent after `afterSequence`, without consuming it;
   * the parent acknowledges the exact sequence once its reply is accepted. */
  peek(afterSequence: number): QueuedIntent | null {
    return this.entries.find((entry) => entry.sequence > afterSequence) ?? null;
  }

  acknowledge(sequence: number): void {
    if (!Number.isSafeInteger(sequence) || sequence < 0) return;
    this.entries = this.entries.filter((entry) => entry.sequence > sequence);
  }

  clear(): void {
    this.entries = [];
  }

  size(): number {
    return this.entries.length;
  }
}

export const PRESENTATION_HELPER_ACTIONS = [
  "presentation.frame",
  "presentation.wait_intent",
  "presentation.end",
] as const;

export type PresentationHelperAction = (typeof PRESENTATION_HELPER_ACTIONS)[number];

export function isPresentationAction(value: unknown): value is PresentationHelperAction {
  return typeof value === "string" &&
    (PRESENTATION_HELPER_ACTIONS as readonly string[]).includes(value);
}

/** Map an already-received intent from a reply; only a typed known variant
 * is delivered, never a raw engine string. */
export function isPresentationIntent(value: unknown): value is PresentationIntent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "next" || kind === "previous" || kind === "first" || kind === "last" ||
      kind === "end" || kind === "toggle_black" || kind === "toggle_pause" || kind === "reset_timer") {
    return Object.keys(value).length === 1;
  }
  if (kind === "go_to") {
    const slide = (value as { slide_id?: unknown }).slide_id;
    return typeof slide === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(slide) &&
      Object.keys(value).length === 2;
  }
  return false;
}
