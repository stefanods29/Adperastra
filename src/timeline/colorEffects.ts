import type { TimelineEffect } from "./types";
import {
  TIMELINE_EFFECT_GAMMA_MAX,
  TIMELINE_EFFECT_GAMMA_MIN,
  TIMELINE_EFFECT_VALUE_MAX,
  TIMELINE_EFFECT_VALUE_MIN,
  TIMELINE_MAX_EFFECTS_PER_CLIP,
  TimelineError,
} from "./types";
import { brightnessChannel, contrastChannel, saturationChannels } from "../image-edit/adjustments";

export type ColorPixel = readonly [number, number, number, number];

/** Color stages only: geometry is resolved before calling this function. */
export function applyColorEffects(pixel: ColorPixel, effects: readonly TimelineEffect[]): ColorPixel {
  if (pixel.some((v) => !Number.isFinite(v) || v < 0 || v > 1) || effects.length > TIMELINE_MAX_EFFECTS_PER_CLIP) {
    throw new TimelineError("timeline.bad_request");
  }
  let [r, g, b] = pixel;
  for (const effect of effects) {
    switch (effect.tag) {
      case "brightness":
      case "contrast":
      case "saturation": {
        if (!Number.isFinite(effect.value) || effect.value < TIMELINE_EFFECT_VALUE_MIN || effect.value > TIMELINE_EFFECT_VALUE_MAX) {
          throw new TimelineError("timeline.bad_request");
        }
        if (effect.tag === "brightness") [r, g, b] = [r, g, b].map((v) => brightnessChannel(v, effect.value));
        if (effect.tag === "contrast") [r, g, b] = [r, g, b].map((v) => contrastChannel(v, effect.value));
        if (effect.tag === "saturation") [r, g, b] = saturationChannels(r, g, b, effect.value);
        break;
      }
      case "color": {
        if (effect.gamma.length !== 3 || effect.gamma.some((v) => !Number.isFinite(v) || v < TIMELINE_EFFECT_GAMMA_MIN || v > TIMELINE_EFFECT_GAMMA_MAX)) {
          throw new TimelineError("timeline.bad_request");
        }
        [r, g, b] = [r ** (1 / effect.gamma[0]), g ** (1 / effect.gamma[1]), b ** (1 / effect.gamma[2])];
        break;
      }
      // A pixel function cannot implement a spatial operation. Never ignore it.
      case "crop":
      case "stabilize":
      default: throw new TimelineError("timeline.unsupported");
    }
  }
  return [r, g, b, pixel[3]];
}
