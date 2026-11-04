import type { PresentationIntent } from "../office/presentationTypes";
import type {
  HelperGrantDTO, HelperReplyEnvelope, HelperRequestEnvelope,
} from "./helperBridge";

/** Audience helper payloads (Step 22a T7, office-deck-ui-1).
 *
 * These records are the audience transport only. They never contain notes,
 * comments, presenter previews, file paths or engine handles; an unknown
 * field (for example `notes`) is rejected before it reaches the canvas. */

export const PRESENTATION_WAIT_MS = 8 as const;
export const PRESENTATION_MAX_QUEUE = 16;
export const PRESENTATION_FRAME_MAX_BYTES = 8 * 1024 * 1024;
export const PRESENTATION_FRAME_MAX_PIXELS = 4_194_304;
export const PRESENTATION_MAX_LIVE_FRAMES = 2;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface PresentationAudienceFrame {
  presentation_id: string;
  slide_id: string;
  frame_revision: number;
  image_grant_id: string;
  width: number;
  height: number;
  black: boolean;
  paused: boolean;
}

export interface PresentationFrameAck {
  presentation_id: string;
  frame_revision: number;
  displayed: boolean;
}

export interface PresentationWaitIntentRequest {
  presentation_id: string;
  after_sequence: number;
  wait_ms: number;
}

export interface PresentationIntentReply {
  presentation_id: string;
  sequence: number;
  intent: PresentationIntent | null;
}

export interface PresentationAudienceEnd {
  presentation_id: string;
}

export interface PresentationEndAck {
  presentation_id: string;
  ended: true;
}

export type PresentationFrameRequest = HelperRequestEnvelope<PresentationAudienceFrame>;
export type PresentationFrameReply = HelperReplyEnvelope<PresentationFrameAck>;
export type PresentationWaitRequest = HelperRequestEnvelope<PresentationWaitIntentRequest>;
export type PresentationWaitReply = HelperReplyEnvelope<PresentationIntentReply>;
export type PresentationEndRequest = HelperRequestEnvelope<PresentationAudienceEnd>;
export type PresentationEndReply = HelperReplyEnvelope<PresentationEndAck>;

export type PresentationHelperRequest =
  | PresentationFrameRequest | PresentationWaitRequest | PresentationEndRequest;

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function safeInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function positiveDimension(value: unknown): value is number {
  return safeInteger(value, 1, 65_535);
}

/** Exact audience frame; any extra field (especially notes/comments) fails. */
export function validateAudienceFrame(value: unknown): value is PresentationAudienceFrame {
  const item = record(value);
  if (!item) return false;
  if (!exactKeys(item, [
    "presentation_id", "slide_id", "frame_revision", "image_grant_id",
    "width", "height", "black", "paused",
  ])) return false;
  return uuid(item.presentation_id) && uuid(item.slide_id) && uuid(item.image_grant_id) &&
    safeInteger(item.frame_revision, 0, 0xffffffff) &&
    positiveDimension(item.width) && positiveDimension(item.height) &&
    item.width * item.height <= PRESENTATION_FRAME_MAX_PIXELS &&
    typeof item.black === "boolean" && typeof item.paused === "boolean";
}

export function validateWaitIntent(value: unknown): value is PresentationWaitIntentRequest {
  const item = record(value);
  if (!item || !exactKeys(item, ["presentation_id", "after_sequence", "wait_ms"])) return false;
  return uuid(item.presentation_id) && safeInteger(item.after_sequence, 0, Number.MAX_SAFE_INTEGER) &&
    item.wait_ms === PRESENTATION_WAIT_MS;
}

export function validateAudienceEnd(value: unknown): value is PresentationAudienceEnd {
  const item = record(value);
  return Boolean(item && exactKeys(item, ["presentation_id"]) && uuid(item.presentation_id));
}

export function validateFrameAck(value: unknown): value is PresentationFrameAck {
  const item = record(value);
  if (!item || !exactKeys(item, ["presentation_id", "frame_revision", "displayed"])) return false;
  return uuid(item.presentation_id) && safeInteger(item.frame_revision, 0, 0xffffffff) &&
    typeof item.displayed === "boolean";
}

export function validateEndAck(value: unknown): value is PresentationEndAck {
  const item = record(value);
  return Boolean(item && exactKeys(item, ["presentation_id", "ended"]) &&
    uuid(item.presentation_id) && item.ended === true);
}

/** A grant that matches this exact frame, never a guessed lease id. */
export function frameGrantOf(
  inputs: readonly HelperGrantDTO[],
  frame: PresentationAudienceFrame,
): HelperGrantDTO | null {
  const grant = inputs.find((input) => input.grant_id === frame.image_grant_id);
  if (!grant) return null;
  if (grant.mime !== "image/png" || grant.byte_len <= 0 || grant.byte_len > PRESENTATION_FRAME_MAX_BYTES) return null;
  return grant;
}
