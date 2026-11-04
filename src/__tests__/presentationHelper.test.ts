import { describe, expect, it } from "vitest";
import { AudienceIntentQueue, intentFromKey, isPresentationAction, isPresentationIntent } from "../presentation-helper/intents";
import {
  PRESENTATION_MAX_QUEUE, frameGrantOf, validateAudienceEnd, validateAudienceFrame,
  validateWaitIntent,
} from "../services/presentationHelperTypes";
import type { PresentationIntent } from "../office/presentationTypes";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

describe("audience intents", () => {
  it("maps only the approved audience keys", () => {
    expect(intentFromKey("ArrowRight", { ctrl: false, meta: false, alt: false })).toEqual({ kind: "next" });
    expect(intentFromKey("PageUp", { ctrl: false, meta: false, alt: false })).toEqual({ kind: "previous" });
    expect(intentFromKey("Home", { ctrl: false, meta: false, alt: false })).toEqual({ kind: "first" });
    expect(intentFromKey("End", { ctrl: false, meta: false, alt: false })).toEqual({ kind: "last" });
    expect(intentFromKey("Escape", { ctrl: false, meta: false, alt: false })).toEqual({ kind: "end" });
    expect(intentFromKey("b", { ctrl: false, meta: false, alt: false })).toEqual({ kind: "toggle_black" });
    expect(intentFromKey("p", { ctrl: false, meta: false, alt: false })).toEqual({ kind: "toggle_pause" });
    expect(intentFromKey("a", { ctrl: false, meta: false, alt: false })).toBeNull();
    expect(intentFromKey("ArrowRight", { ctrl: true, meta: false, alt: false })).toBeNull();
  });

  it("queue16_keeps_end", () => {
    const queue = new AudienceIntentQueue();
    const kinds: PresentationIntent[] = [
      { kind: "next" }, { kind: "previous" }, { kind: "toggle_black" }, { kind: "toggle_pause" },
    ];
    for (let index = 0; index < PRESENTATION_MAX_QUEUE; index += 1) {
      expect(queue.push(kinds[index % kinds.length])).not.toBeNull();
    }
    expect(queue.size()).toBe(16);
    const sequence = queue.push({ kind: "end" });
    expect(sequence).not.toBeNull();
    expect(queue.size()).toBe(16);
    expect(queue.peek(sequence! - 1)?.intent.kind).toBe("end");
    expect(queue.peek(sequence!)).toBeNull();
  });

  it("repeated_intent_sequence_applies_once", () => {
    const queue = new AudienceIntentQueue();
    const sequence = queue.push({ kind: "next" })!;
    expect(queue.peek(sequence - 1)?.sequence).toBe(sequence);
    expect(queue.peek(sequence - 1)?.sequence).toBe(sequence);
    queue.acknowledge(sequence);
    expect(queue.peek(sequence - 1)).toBeNull();
  });

  it("adjacent duplicate next/previous coalesces", () => {
    const queue = new AudienceIntentQueue();
    expect(queue.push({ kind: "next" })).toBe(1);
    expect(queue.push({ kind: "next" })).toBeNull();
    expect(queue.push({ kind: "previous" })).toBe(2);
    expect(queue.size()).toBe(2);
  });

  it("only the three audience actions are accepted", () => {
    expect(isPresentationAction("presentation.frame")).toBe(true);
    expect(isPresentationAction("presentation.wait_intent")).toBe(true);
    expect(isPresentationAction("presentation.end")).toBe(true);
    expect(isPresentationAction("pdf.open")).toBe(false);
    expect(isPresentationAction("presentation.eval")).toBe(false);
    expect(isPresentationIntent({ kind: "next" })).toBe(true);
    expect(isPresentationIntent({ kind: "next", notes: "x" })).toBe(false);
  });
});

describe("audience payloads", () => {
  const frame = {
    presentation_id: id(1), slide_id: id(2), frame_revision: 3, image_grant_id: id(3),
    width: 1280, height: 720, black: false, paused: false,
  };

  it("rejects notes and other unknown fields", () => {
    expect(validateAudienceFrame(frame)).toBe(true);
    expect(validateAudienceFrame({ ...frame, notes: "PRIVATE NOTES" })).toBe(false);
    expect(validateAudienceFrame({ ...frame, next_slide: id(4) })).toBe(false);
    expect(validateAudienceFrame({ ...frame, width: 4096, height: 4096 })).toBe(false);
  });

  it("waits only with the fixed 8 ms and validates end", () => {
    expect(validateWaitIntent({
      presentation_id: id(1), after_sequence: 0, wait_ms: 8,
    })).toBe(true);
    expect(validateWaitIntent({
      presentation_id: id(1), after_sequence: 0, wait_ms: 9,
    })).toBe(false);
    expect(validateAudienceEnd({ presentation_id: id(1) })).toBe(true);
    expect(validateAudienceEnd({ presentation_id: id(1), notes: "x" })).toBe(false);
  });

  it("a frame grant must be the exact PNG grant", () => {
    const grant = {
      grant_id: id(3), token_url: "http://adpfile.localhost/token/frame.png",
      name: "frame.png", mime: "image/png", byte_len: 1024, sensitive: false,
    };
    expect(frameGrantOf([grant], frame)?.grant_id).toBe(id(3));
    expect(frameGrantOf([{ ...grant, grant_id: id(4) }], frame)).toBeNull();
    expect(frameGrantOf([{ ...grant, mime: "text/html" }], frame)).toBeNull();
  });
});
