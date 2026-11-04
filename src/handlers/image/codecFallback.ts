import type { FileTypeInfo } from "../../services/files";

/** AVIF fallback capability (Step 07g D6).
 *
 * The existing image handler keeps its AVIF extension/MIME claim and is
 * still chosen first. Only when the WebView's own AVIF decoder fails does
 * the view offer the installed Windows codec path. No second AVIF handler
 * is registered and no codec is installed or bought. */
export const CODEC_FALLBACK_MIME = "image/avif";

export function avifNeedsNativeFallback(info: FileTypeInfo): boolean {
  return info.ext.toLowerCase() === "avif" || info.mime.toLowerCase() === CODEC_FALLBACK_MIME;
}

/** The fallback is an explicit user action, never an automatic download. */
export const CODEC_FALLBACK_HELP_SLUG = "viewing-heic-and-avif";
