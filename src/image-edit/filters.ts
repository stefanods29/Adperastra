import { applyAdjustments, presetAdjustments } from "./adjustments";
import type { AdjustmentPreset, ImageAdjustments } from "./types";

/** Named presets and their thumbnail algorithm revision (D6). A thumbnail
 * uses exactly the same adjustment code as the full preview. */

export const FILTER_ALGORITHM_REVISION = 1;

export const FILTER_PRESETS: readonly Exclude<AdjustmentPreset, "custom">[] = [
  "original",
  "vivid",
  "warm",
  "cool",
  "bw",
  "sepia",
] as const;

export interface FilterDefinition {
  id: Exclude<AdjustmentPreset, "custom">;
  labelKey: string;
  adjustments: ImageAdjustments;
}

/** Presets replace values only; geometry and marks are untouched. */
export function filterDefinitions(): FilterDefinition[] {
  return FILTER_PRESETS.map((id) => ({
    id,
    labelKey: `imageEdit.${id}`,
    adjustments: presetAdjustments(id),
  }));
}

export function filterThumbnail(
  rgba: Uint8Array,
  width: number,
  height: number,
  preset: Exclude<AdjustmentPreset, "custom">,
): Uint8Array {
  return applyAdjustments(rgba, width, height, presetAdjustments(preset));
}
