import { invoke } from "@tauri-apps/api/core";
import type { PdfSourceIdentity } from "./pdf";
import { runJob, type JobHandle } from "./jobs";

/** Text recognition for images and PDF pages (Step 07e, interface `ocr-1`).
 *
 * Rust mirrors these shapes in `src-tauri/src/ocr_types.rs`; every field
 * keeps its snake_case name. Recognition runs in a separate
 * `Adperastra.exe --ocr-helper` process and never changes the source file.
 * This is the only module that calls the OCR commands.
 */

/** Longest absolute image path Rust accepts, in UTF-16 units. */
export const OCR_MAX_PATH_UNITS = 32_768;
/** Most words one page keeps. */
export const OCR_MAX_WORDS = 20_000;
/** Most characters one page keeps (including separators). */
export const OCR_MAX_TEXT_CHARS = 500_000;
/** Longest single word. */
export const OCR_MAX_WORD_CHARS = 4_096;
/** Most installed languages one answer carries. */
export const OCR_MAX_LANGUAGES = 128;
/** Bounded chunk every `ocr_page` answer respects. */
export const OCR_MAX_CHUNK_BYTES = 768 * 1024;
/** Ordinary-disk cache blob cap. */
export const OCR_MAX_CACHE_BLOB = 4 * 1024 * 1024;
/** The render bucket the PDF adapter asks for. */
export const OCR_PDF_RENDER_EDGE = 2048;

export type OcrRotation = 0 | 90 | 180 | 270;

/** One recognition language Windows offers (data, never a hard-coded list). */
export interface OcrLanguage {
  tag: string;
  name: string;
  available: boolean;
}

/** What to recognise: one local image, or one page of an open PDF. */
export type OcrInput =
  | { kind: "image"; path: string }
  | { kind: "pdf"; session_id: string; page: number };

/** One recognised word, in pixels of the recognised raster (export E2). */
export interface OcrWord {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  line: number;
  order: number;
}

/** One bounded page of recognised text. */
export interface OcrPage {
  source: PdfSourceIdentity;
  page: number;
  language: string;
  original_width: number;
  original_height: number;
  recognized_width: number;
  recognized_height: number;
  words: OcrWord[];
  /** Reading-order text; chunk texts concatenate to exactly this value. */
  text: string;
  partial: boolean;
  next_word?: number | null;
  rotation: number;
  text_angle?: number | null;
}

export interface OcrRequest {
  input: OcrInput;
  /** `auto` or an exact installed BCP47 tag. */
  language: string;
  consumer_id: string;
  rotation: OcrRotation;
  request_revision: number;
}

// ---------------------------------------------------------------------------
// Services: only this file calls the OCR commands (plan/conventions.md 4.1).
// ---------------------------------------------------------------------------

/** Installed Windows recogniser languages, at most 128. */
export async function ocrLanguages(): Promise<OcrLanguage[]> {
  return (await invoke("ocr_languages")) as OcrLanguage[];
}

/** Start one cancellable recognition; completion carries the first chunk. */
export async function recognizeText(request: OcrRequest): Promise<JobHandle<OcrPage>> {
  return runJob<OcrPage>("ocr", async (requestId) => {
    await invoke("ocr_start", { requestId, request });
  });
}

/** One bounded chunk after `afterWord` (the previous `next_word`). */
export async function ocrPage(consumerId: string, afterWord?: number): Promise<OcrPage> {
  return (await invoke("ocr_page", { consumerId, afterWord })) as OcrPage;
}

/** Forget a retained page. Unknown consumers are already released. */
export async function releaseOcr(consumerId: string): Promise<void> {
  await invoke("ocr_release", { consumerId });
}

// ---------------------------------------------------------------------------
// Pure rules: shared by Settings, the hook and their tests.
// ---------------------------------------------------------------------------

const LANGUAGE_TAG = /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/;

/** Same rule as Rust `ocr_types::is_valid_language_tag`. */
export function isValidOcrLanguageTag(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    LANGUAGE_TAG.test(value)
  );
}

/** `auto` for anything that is not a valid explicit tag. */
export function normalizeOcrLanguagePreference(value: unknown): string {
  return isValidOcrLanguageTag(value) ? value : "auto";
}

/** Keep valid, unique, bounded Windows language entries. */
export function normalizeOcrLanguages(value: unknown): OcrLanguage[] {
  if (!Array.isArray(value)) return [];
  const result: OcrLanguage[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (result.length >= OCR_MAX_LANGUAGES) break;
    if (entry === null || typeof entry !== "object") continue;
    const { tag, name } = entry as { tag?: unknown; name?: unknown };
    const cleanTag = typeof tag === "string" ? tag.trim() : "";
    if (!isValidOcrLanguageTag(cleanTag)) continue;
    const key = cleanTag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const trimmed = typeof name === "string" ? name.trim() : "";
    result.push({
      tag: cleanTag,
      name: (trimmed || cleanTag).slice(0, 128),
      available: true,
    });
  }
  return result;
}

function primaryLanguage(tag: string): string | null {
  if (!isValidOcrLanguageTag(tag)) return null;
  return tag.split("-")[0].toLowerCase();
}

/**
 * The plan D2 rule, mirrored for the Settings preview. The native service
 * is authoritative; both implementations return the exact installed tag or
 * null (never an unrelated language).
 */
export function chooseOcrLanguage(
  preference: string,
  appLanguage: string,
  installed: readonly OcrLanguage[],
  userProfile?: string | null,
): string | null {
  const available = installed.filter(
    (language) => language.available && isValidOcrLanguageTag(language.tag),
  );
  if (preference !== "auto") {
    if (!isValidOcrLanguageTag(preference)) return null;
    return (
      available.find((language) => language.tag.toLowerCase() === preference.toLowerCase())
        ?.tag ?? null
    );
  }
  if (appLanguage === "pseudo") return null;
  const appPrimary = primaryLanguage(appLanguage);
  if (!appPrimary) return null;
  const sameLanguage = available.find(
    (language) => primaryLanguage(language.tag) === appPrimary,
  );
  if (sameLanguage) return sameLanguage.tag;
  if (userProfile && primaryLanguage(userProfile) === appPrimary) {
    return (
      available.find(
        (language) => language.tag.toLowerCase() === userProfile.toLowerCase(),
      )?.tag ?? null
    );
  }
  return null;
}
