import type { AiInputRef } from "../services/localAiTypes";
import type { TimeUs } from "../services/engineTypes";
import type { AiActionId, AiActionOptions, AiActionRequest } from "../services/aiActionTypes";
import { AI_ACTION_MAX_QUERY } from "../services/aiActionTypes";
import type { SpeechLanguage } from "../services/speechTypes";

/**
 * Requests for transcribe / summarize / find moments (D11).
 *
 * A moment range must sit inside the real media duration. Summaries and
 * searches reuse the local transcript; the selected text backend only sees
 * the transcript after its own outbound review.
 */

export type MediaActionId = "transcribe" | "summarize_media" | "find_moments";

export const MEDIA_ACTION_IDS: readonly MediaActionId[] = ["transcribe", "summarize_media", "find_moments"];
export const MAX_SAMPLED_FRAMES = 16;
export const SAMPLED_FRAME_EDGE = 2048;

export interface MediaActionOptions {
  startUs?: TimeUs | null;
  endUs?: TimeUs | null;
  language?: SpeechLanguage;
  query?: string;
}

function checkedRange(start: TimeUs | null, end: TimeUs | null, durationUs: TimeUs | null): [TimeUs, TimeUs | null] {
  const startValue = start ?? 0;
  if (!Number.isSafeInteger(startValue) || startValue < 0) throw new Error("ai_actions.invalid");
  if (end === null || end === undefined) return [startValue, null];
  if (!Number.isSafeInteger(end) || end <= startValue) throw new Error("ai_actions.invalid");
  if (durationUs !== null && end > durationUs) throw new Error("ai_actions.invalid");
  return [startValue, end];
}

export function buildMediaOptions(
  action: MediaActionId,
  options: MediaActionOptions = {},
  durationUs: TimeUs | null = null,
): AiActionOptions {
  const [start, end] = checkedRange(options.startUs ?? null, options.endUs ?? null, durationUs);
  const language = options.language ?? "auto";
  if (!["auto", "en", "es"].includes(language)) throw new Error("ai_actions.invalid");
  if (action === "transcribe") return { kind: "transcribe", start_us: start, end_us: end, language };
  if (action === "summarize_media") return { kind: "summarize_media", start_us: start, end_us: end, language };
  const query = options.query?.trim() ?? "";
  if (query.length === 0 || Array.from(query).length > AI_ACTION_MAX_QUERY) {
    throw new Error("ai_actions.invalid");
  }
  return { kind: "find_moments", query, start_us: start, end_us: end };
}

export function buildMediaRequest(
  action: MediaActionId,
  input: AiInputRef,
  options: MediaActionOptions = {},
  durationUs: TimeUs | null = null,
  revision = 1,
): AiActionRequest {
  return {
    action: action as AiActionId,
    inputs: [input],
    options: buildMediaOptions(action, options, durationUs),
    request_revision: revision,
    expected_content_id: null,
    scope_id: null,
    outbound_consent_id: null,
  };
}

/** Every returned moment stays inside both the request range and duration. */
export function momentWithinRange(
  moment: { start_us: TimeUs; end_us: TimeUs },
  durationUs: TimeUs,
  range?: { startUs: TimeUs; endUs: TimeUs | null },
): boolean {
  if (!Number.isSafeInteger(moment.start_us) || !Number.isSafeInteger(moment.end_us)) return false;
  if (moment.end_us <= moment.start_us || moment.end_us > durationUs) return false;
  if (range) {
    if (moment.start_us < range.startUs) return false;
    if (range.endUs !== null && moment.end_us > range.endUs) return false;
  }
  return true;
}

/** Frame sampling is uniform, bounded and labeled with its real timestamps. */
export function sampledFrameTimes(startUs: TimeUs, endUs: TimeUs, count: number): TimeUs[] {
  if (!Number.isSafeInteger(startUs) || !Number.isSafeInteger(endUs) || endUs <= startUs) {
    throw new Error("ai_actions.invalid");
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_SAMPLED_FRAMES) {
    throw new Error("ai_actions.invalid");
  }
  if (count === 1) return [startUs];
  const step = (endUs - startUs) / (count - 1);
  return Array.from({ length: count }, (_, index) => Math.round(startUs + step * index));
}

/** The UI must state how many frames were sampled and over which range. */
export function sampledFrameNotice(count: number): { count: number; exhaustive: false } {
  if (!Number.isInteger(count) || count < 0 || count > MAX_SAMPLED_FRAMES) {
    throw new Error("ai_actions.invalid");
  }
  return { count, exhaustive: false };
}
