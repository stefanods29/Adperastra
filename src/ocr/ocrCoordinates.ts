/** OCR box geometry (Step 07e export E2).
 *
 * Two coordinate systems are involved:
 *
 * - the recognised raster (`OcrWord` boxes, `recognized_width/height`);
 * - the orientation-corrected original picture (`original_width/height`).
 *
 * `ocrBoxToSource` converts the first to the second with one checked ratio.
 * `ocrSourceToView` then places that box in the image viewer: the picture is
 * scaled by `zoom` (1 = 100 %), rotated around its centre and centred inside
 * the `viewWidth × viewHeight` box. Rounding happens only at display, never
 * in these functions.
 */

export interface OcrBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function assertPositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`ocr.bad_geometry: ${name}`);
  }
}

function assertBox(box: OcrBox): void {
  if (
    !Number.isFinite(box.x) ||
    !Number.isFinite(box.y) ||
    !Number.isFinite(box.width) ||
    !Number.isFinite(box.height) ||
    box.x < 0 ||
    box.y < 0 ||
    box.width < 0 ||
    box.height < 0
  ) {
    throw new RangeError("ocr.bad_geometry: box");
  }
}

function assertRotation(rotation: number): void {
  if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270) {
    throw new RangeError("ocr.bad_geometry: rotation");
  }
}

/** A word box on the recognised raster to the oriented original picture. */
export function ocrBoxToSource(
  box: OcrBox,
  recognizedWidth: number,
  recognizedHeight: number,
  originalWidth: number,
  originalHeight: number,
): OcrBox {
  assertBox(box);
  assertPositive(recognizedWidth, "recognizedWidth");
  assertPositive(recognizedHeight, "recognizedHeight");
  assertPositive(originalWidth, "originalWidth");
  assertPositive(originalHeight, "originalHeight");
  const scaleX = originalWidth / recognizedWidth;
  const scaleY = originalHeight / recognizedHeight;
  return {
    x: box.x * scaleX,
    y: box.y * scaleY,
    width: box.width * scaleX,
    height: box.height * scaleY,
  };
}

/** A source box to the image viewer's rotated, zoomed box. */
export function ocrSourceToView(
  box: OcrBox,
  originalWidth: number,
  originalHeight: number,
  viewWidth: number,
  viewHeight: number,
  rotation: number,
  zoom: number,
): OcrBox {
  assertBox(box);
  assertPositive(originalWidth, "originalWidth");
  assertPositive(originalHeight, "originalHeight");
  assertPositive(viewWidth, "viewWidth");
  assertPositive(viewHeight, "viewHeight");
  assertPositive(zoom, "zoom");
  assertRotation(rotation);
  const swapped = rotation === 90 || rotation === 270;
  const displayedWidth = (swapped ? originalHeight : originalWidth) * zoom;
  const displayedHeight = (swapped ? originalWidth : originalHeight) * zoom;
  const offsetX = (viewWidth - displayedWidth) / 2;
  const offsetY = (viewHeight - displayedHeight) / 2;
  const width = box.width * zoom;
  const height = box.height * zoom;
  switch (rotation) {
    case 90:
      return {
        x: offsetX + originalHeight * zoom - box.y * zoom - height,
        y: offsetY + box.x * zoom,
        width: height,
        height: width,
      };
    case 180:
      return {
        x: offsetX + originalWidth * zoom - box.x * zoom - width,
        y: offsetY + originalHeight * zoom - box.y * zoom - height,
        width,
        height,
      };
    case 270:
      return {
        x: offsetX + box.y * zoom,
        y: offsetY + originalWidth * zoom - box.x * zoom - width,
        width: height,
        height: width,
      };
    default:
      return {
        x: offsetX + box.x * zoom,
        y: offsetY + box.y * zoom,
        width,
        height,
      };
  }
}

/** True when a box can be displayed at all (used to skip bad words). */
export function isFiniteOcrBox(box: OcrBox): boolean {
  return (
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height) &&
    box.x >= 0 &&
    box.y >= 0 &&
    box.width >= 0 &&
    box.height >= 0
  );
}
