import { releaseCacheLease } from "../services/cache";
import { previewConversion } from "../services/convert";
import type { ExportSnapshot } from "../services/exportSnapshots";
import { fileUrl } from "../services/files";

/** 09c coordinator adapter: a validated image envelope is an 08a snapshot.
 * The WebView never reads snapshot bytes directly; the existing conversion
 * preview publishes a leased cache image that can be decoded once. */

const MAX_DECODED_PIXELS = 100_000_000;
const MAX_DECODED_BYTES = 256 * 1024 * 1024;

export interface DecodedSnapshotImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

function transferError(error: unknown): Error {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return new Error(/^transfer\.[a-z_]+$/.test(message) ? message : "transfer.failed");
}

export async function decodeImageSnapshot(snapshot: ExportSnapshot): Promise<DecodedSnapshotImage> {
  if (!snapshot || snapshot.mime !== "image/png" || typeof snapshot.snapshot_id !== "string") {
    throw new Error("transfer.unsupported");
  }
  let lease: string | null = null;
  try {
    const started = await previewConversion({
      inputs: [
        {
          kind: "snapshot",
          snapshot_id: snapshot.snapshot_id,
          document_id: snapshot.document_id,
          revision: snapshot.revision,
        },
      ],
      converter_id: "image/png",
      options: {
        kind: "image",
        value: {
          quality: 100,
          keep_aspect: true,
          allow_upscale: false,
          background_rgba: [0, 0, 0, 0],
          first_frame: false,
          metadata_keep: false,
        },
      },
      request_revision: Number.isSafeInteger(snapshot.revision) && snapshot.revision >= 1 ? snapshot.revision : 1,
    });
    const preview = await started.completion;
    lease = preview.image.lease_id;
    if (preview.image.mime !== "image/png" || preview.image.byte_len > MAX_DECODED_BYTES) {
      throw new Error("transfer.unsupported");
    }
    const response = await fetch(fileUrl(preview.image.token, preview.image.name));
    if (!response.ok) throw new Error("transfer.failed");
    const bitmap = await createImageBitmap(await response.blob());
    try {
      if (
        bitmap.width < 1 ||
        bitmap.height < 1 ||
        bitmap.width > 32768 ||
        bitmap.height > 32768 ||
        bitmap.width * bitmap.height > MAX_DECODED_PIXELS
      ) {
        throw new Error("transfer.too_large");
      }
      const Offscreen = (globalThis as unknown as { OffscreenCanvas?: typeof OffscreenCanvas }).OffscreenCanvas;
      let rgba: Uint8Array;
      if (Offscreen) {
        const canvas = new Offscreen(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | null;
        if (!context) throw new Error("transfer.failed");
        context.drawImage(bitmap, 0, 0);
        const data = context.getImageData(0, 0, bitmap.width, bitmap.height);
        rgba = new Uint8Array(data.data.buffer.slice(0));
      } else {
        if (typeof document === "undefined") throw new Error("transfer.failed");
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("transfer.failed");
        context.drawImage(bitmap, 0, 0);
        const data = context.getImageData(0, 0, bitmap.width, bitmap.height);
        rgba = new Uint8Array(data.data.buffer.slice(0));
      }
      return { width: bitmap.width, height: bitmap.height, rgba };
    } finally {
      if (typeof bitmap.close === "function") bitmap.close();
    }
  } catch (error) {
    throw transferError(error);
  } finally {
    if (lease) await releaseCacheLease(lease).catch(() => undefined);
  }
}
