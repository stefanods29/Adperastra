import { compositePixels, layerPixels } from "./composite";
import { applyStampField, commitBrushResult } from "./brush";
import { resampleStroke } from "./strokeResampler";
import { validateBrushSamples, validateBrushSettings, type BrushSample, type BrushSettings } from "./brushTypes";
import type { SelectionMask } from "./selectionTypes";
import { getImageEditorModel } from "./ImageDocument";
import { fail, sourceSizeOf, type ImageModel, type Point } from "./types";

/** Clone stamp (Step 18b D3).
 *
 * Alt-click sets the anchor; the first dab fixes one stroke offset that never
 * changes. Every sample reads the immutable pixels captured before the first
 * dab (selected layer or composite), so the stroke can never copy its own new
 * paint. */

export interface CloneAnchor {
  x: number;
  y: number;
}

function validateAnchor(anchor: CloneAnchor): void {
  if (!anchor || typeof anchor !== "object") fail("image_edit.bad_request");
  if (typeof anchor.x !== "number" || !Number.isFinite(anchor.x)) fail("image_edit.bad_request");
  if (typeof anchor.y !== "number" || !Number.isFinite(anchor.y)) fail("image_edit.bad_request");
}

/** E1 companion: one clone gesture, one transaction. */
export async function cloneStroke(
  documentId: string,
  expectedContentId: string,
  layerId: string,
  samples: readonly BrushSample[],
  settings: BrushSettings,
  selection: SelectionMask,
  anchor: CloneAnchor,
): Promise<void> {
  validateBrushSettings(settings);
  validateBrushSamples(samples);
  validateAnchor(anchor);
  if (settings.mode !== "clone") fail("image_edit.bad_request");
  const model = getImageEditorModel(documentId);
  if (!model || model.content_id !== expectedContentId) fail("image_edit.changed");
  const sourceSize = sourceSizeOf(model);
  const layer = model.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.kind !== "raster") fail("image_edit.bad_request");
  if (layer.locked) fail("image_edit.read_only");
  if (!selection || selection.width !== sourceSize.width || selection.height !== sourceSize.height) {
    fail("image_edit.bad_request");
  }
  if (selection.kind === "empty" || settings.flow <= 0) return;
  const stamps = resampleStroke(samples, settings);
  if (stamps.length === 0) return;

  // Freeze the pre-stroke pixels once; never re-read after the first dab.
  const full = { x: 0, y: 0, width: sourceSize.width, height: sourceSize.height };
  const snapshot = settings.sample === "composite"
    ? await compositePixels(model, full)
    : await layerPixels(model, layerId, full);
  const offset = { x: samples[0].x - anchor.x, y: samples[0].y - anchor.y };

  const sourcePixel = (x: number, y: number): [number, number, number, number] | null => {
    const sx = Math.floor(x - offset.x);
    const sy = Math.floor(y - offset.y);
    if (sx < 0 || sy < 0 || sx >= snapshot.width || sy >= snapshot.height) return null;
    const at = (sy * snapshot.width + sx) * 4;
    return [snapshot.rgba[at], snapshot.rgba[at + 1], snapshot.rgba[at + 2], snapshot.rgba[at + 3]];
  };

  const result = await applyStampField(
    documentId,
    layer.tiles,
    sourceSize,
    stamps,
    settings,
    selection,
    sourcePixel,
  );
  if (!result) return;
  await commitBrushResult(documentId, expectedContentId, layerId, result.tiles, result.changed_bytes);
}

/** The offset of the first dab from the Alt-click anchor. Exposed for the
 * canvas overlay so the source crosshair can follow the same fixed offset. */
export function cloneOffset(samples: readonly BrushSample[], anchor: CloneAnchor): Point {
  if (!Array.isArray(samples) || samples.length === 0) fail("image_edit.bad_request");
  validateAnchor(anchor);
  return { x: samples[0].x - anchor.x, y: samples[0].y - anchor.y };
}

/** Color picker (D3): the current composite at one canvas pixel, including
 * alpha. The composite is read through 18a's immutable sampler; nothing is
 * written to the document. */
export async function pickCompositeColor(
  model: Readonly<ImageModel>,
  point: Point,
): Promise<[number, number, number, number]> {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) fail("image_edit.bad_request");
  const source = sourceSizeOf(model);
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  if (x < 0 || y < 0 || x >= source.width || y >= source.height) fail("image_edit.bad_request");
  const pixels = await compositePixels(model, { x, y, width: 1, height: 1 });
  if (pixels.width !== 1 || pixels.height !== 1 || pixels.rgba.byteLength !== 4) fail("image_edit.failed");
  return [pixels.rgba[0], pixels.rgba[1], pixels.rgba[2], pixels.rgba[3]];
}
