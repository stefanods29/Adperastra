import type { HelperGrantDTO } from "../services/helperBridge";
import type { PresentationAudienceFrame } from "../services/presentationHelperTypes";
import { PRESENTATION_FRAME_MAX_BYTES } from "../services/presentationHelperTypes";

/** Canvas painting of one audience frame (Step 22a T7).
 *
 * The parent sends exactly one approved PNG grant per frame. This module
 * waits for its decode, verifies the actual pixels, paints the canvas (or a
 * plain black fill), and only then lets the caller acknowledge the exact
 * revision. A decode failure is reported as `presentation.failed`; it never
 * becomes a blank "success". */

export const FRAME_TIMEOUT_MS = 2_000;

export function framePixelsMatch(frame: PresentationAudienceFrame, width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) &&
    width === frame.width && height === frame.height &&
    width > 0 && height > 0 && width * height <= 4_194_304;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(() => {
      image.src = "";
      reject(new Error("presentation.failed"));
    }, FRAME_TIMEOUT_MS);
    image.onload = () => {
      window.clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("presentation.failed"));
    };
    image.src = url;
  });
}

/** Paint the frame and return the displayed revision. `black` shows a black
 * fill without exposing any previous slide; `paused` only freezes the
 * presenter timer and does not hide content. */
export async function paintFrame(
  canvas: HTMLCanvasElement,
  grant: HelperGrantDTO,
  frame: PresentationAudienceFrame,
): Promise<number> {
  if (grant.grant_id !== frame.image_grant_id || grant.mime !== "image/png" ||
      grant.byte_len <= 0 || grant.byte_len > PRESENTATION_FRAME_MAX_BYTES) {
    throw new Error("presentation.failed");
  }
  if (frame.black) {
    canvas.width = frame.width;
    canvas.height = frame.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("presentation.failed");
    context.fillStyle = "#000000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return frame.frame_revision;
  }
  const image = await loadImage(grant.token_url);
  if (!framePixelsMatch(frame, image.naturalWidth, image.naturalHeight)) {
    throw new Error("presentation.failed");
  }
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("presentation.failed");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, frame.width, frame.height);
  return frame.frame_revision;
}

/** Clear every pixel and the canvas dimensions on end. No file data is
 * restored from the audience side. */
export function clearCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  context?.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 1;
  canvas.height = 1;
}
