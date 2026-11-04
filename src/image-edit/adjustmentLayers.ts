import i18n from "../i18n";
import { getImageEditorModel } from "./ImageDocument";
import { commitImageTransaction } from "./transactions";
import { validateImageAdjustment } from "./adjustmentWorker";
import { MAX_LAYERS, validateLayerName } from "./layerTypes";
import { fail, newUuid, type AdjustmentLayer, type ImageAdjustment, type ImageModel } from "./types";

/** Non-destructive adjustment layers (Step 18b D4/E4).
 *
 * An adjustment layer stores only its typed adjustment. Its pixels are
 * produced by the compositor from the layers below it, so the original tiles
 * are never rewritten. Adding or changing one is a single 14b transaction. */

export function adjustmentLayerLabel(adjustment: ImageAdjustment): string {
  switch (adjustment.kind) {
    case "curves":
      return i18n.t("adjust.curves");
    case "levels":
      return i18n.t("adjust.levels");
    case "hue_saturation":
      return i18n.t("adjust.hue");
    case "color_balance":
      return i18n.t("adjust.balance");
    case "gaussian":
      return i18n.t("imageEdit.blur");
    case "unsharp":
      return i18n.t("imageEdit.sharpness");
    case "noise_reduce":
      return i18n.t("adjust.noise");
    case "artistic":
      return i18n.t("adjust.artistic");
    default:
      fail("image_edit.bad_request");
  }
}

export function createAdjustmentLayer(adjustment: ImageAdjustment, name?: string): AdjustmentLayer {
  validateImageAdjustment(adjustment);
  const label = validateLayerName(name ?? adjustmentLayerLabel(adjustment));
  return {
    kind: "adjustment",
    id: newUuid(),
    name: label,
    visible: true,
    locked: false,
    opacity: 1,
    blend: "normal",
    transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    mask_id: null,
    adjustment,
  };
}

/** E4. Appends (or inserts) one adjustment layer. The model's original tiles
 * and raster tiles are not copied or changed. */
export async function addAdjustmentLayer(
  documentId: string,
  expectedContentId: string,
  adjustment: ImageAdjustment,
  index: number,
): Promise<void> {
  if (typeof documentId !== "string" || documentId.length === 0) fail("image_edit.bad_request");
  if (typeof expectedContentId !== "string" || expectedContentId.length === 0) fail("image_edit.bad_request");
  validateImageAdjustment(adjustment);
  if (!Number.isInteger(index) || index < 0) fail("image_edit.bad_request");
  const model = getImageEditorModel(documentId);
  if (!model || model.content_id !== expectedContentId) fail("image_edit.changed");
  if (index > model.layers.length) fail("image_edit.bad_request");
  if (model.layers.length >= MAX_LAYERS) fail("image_layers.too_large");
  const layer = createAdjustmentLayer(adjustment);
  await commitImageTransaction(documentId, expectedContentId, (current: Readonly<ImageModel>) => {
    if (current.layers.length >= MAX_LAYERS) fail("image_layers.too_large");
    const layers = [...current.layers];
    layers.splice(Math.min(index, layers.length), 0, layer);
    return { ...current, layers };
  });
}

/** Replaces the typed adjustment of one existing adjustment layer. */
export async function updateAdjustmentLayer(
  documentId: string,
  expectedContentId: string,
  layerId: string,
  adjustment: ImageAdjustment,
): Promise<void> {
  if (typeof documentId !== "string" || documentId.length === 0) fail("image_layers.bad_request");
  if (typeof expectedContentId !== "string" || expectedContentId.length === 0) fail("image_layers.bad_request");
  validateImageAdjustment(adjustment);
  const model = getImageEditorModel(documentId);
  if (!model || model.content_id !== expectedContentId) fail("image_layers.changed");
  const layer = model.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.kind !== "adjustment") fail("image_layers.bad_request");
  if (layer.locked) fail("image_layers.locked");
  await commitImageTransaction(documentId, expectedContentId, (current: Readonly<ImageModel>) => ({
    ...current,
    layers: current.layers.map((candidate) =>
      candidate.id === layerId && candidate.kind === "adjustment" ? { ...candidate, adjustment } : candidate,
    ),
  }));
}
