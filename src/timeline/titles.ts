import type { TimeUs } from "../services/mediaEngine";
import type { TimelineTitle } from "./types";
import { TimelineError } from "./types";

/** Animation state in output frame fractions, matching TimelineTitleStyle and
 * the render graph's title node. Multiply x by the output width and y by the
 * output height before rasterizing. Licensed-font rasterization is a separate
 * unresolved producer.
 */
export interface TitleFrameState {
  opacity: number;
  x: number;
  y: number;
}

export function titleAnimation(
  title: Readonly<TimelineTitle>, timeUs: TimeUs, width: number, textWidth: number,
): TitleFrameState {
  if (!Number.isSafeInteger(timeUs) || timeUs < 0 || !Number.isFinite(width) || width <= 0 ||
      !Number.isFinite(textWidth) || textWidth < 0) throw new TimelineError("timeline.bad_request");
  const x = title.style.x;
  const y = title.style.y;
  const elapsed = timeUs - title.start_us;
  const remaining = title.end_us - timeUs;
  if (elapsed < 0 || remaining <= 0) return { opacity: 0, x, y };
  if (title.animation_us === 0 || title.animation === "none") return { opacity: 1, x, y };
  if (title.animation === "fade") {
    return { opacity: Math.min(1, elapsed / title.animation_us, remaining / title.animation_us), x, y };
  }
  if (title.animation === "slide") {
    const f = Math.min(1, elapsed / title.animation_us);
    const from = -textWidth / width;
    return { opacity: 1, x: from + (x - from) * f, y };
  }
  throw new TimelineError("timeline.unsupported");
}
