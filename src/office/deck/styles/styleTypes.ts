import type { DeckTheme } from "../../types";

/** Style-name suffixes and palettes are canonical in `stylePalettes.ts`;
 * re-exporting the suffix keeps style data importable from this contract
 * module without a second list. */
export type { DeckStyleSuffix } from "./stylePalettes";

/** Manual presentation styles (Step 22b, contract deck-style-library-1).
 *
 * A style is bounded plain data: one DeckTheme, a density and display-only
 * writing guidance. Built-ins are application assets; imported styles are
 * normalized copies stored in the user catalog. A style name is never used as
 * a component CSS class suffix. */

export const DECK_STYLE_SCHEMA_VERSION = 1 as const;
export const DECK_STYLE_FILE_SCHEMA_VERSION = 1 as const;
export const DECK_STYLE_VERSION = 1 as const;
export const DECK_STYLE_FILE_MIME = "application/vnd.adperastra.deck-style+json";
export const DECK_STYLE_FILE_EXTENSION = ".adp-deck-style";

/** Hard bounds from D7/D8/D9. */
export const MAX_USER_DECK_STYLES = 64;
export const MAX_DECK_STYLE_BYTES = 64 * 1024;
export const MAX_DECK_STYLE_CATALOG_BYTES = 4 * 1024 * 1024;
export const MAX_DECK_STYLE_LAYOUTS = 8;
export const MAX_DECK_STYLE_PLACEHOLDERS = 16;
export const MAX_DECK_STYLE_NAME = 60;
export const MAX_DECK_STYLE_ADVICE_BULLETS = 10;
export const MAX_DECK_STYLE_ADVICE_WORDS = 30;
export const MAX_STYLE_PREVIEW_WARNINGS = 32;
export const STYLE_PREVIEW_TTL_SECONDS = 300;

export const DECK_STYLE_DENSITIES = ["comfortable", "compact"] as const;
export type DeckStyleDensity = (typeof DECK_STYLE_DENSITIES)[number];

export const DECK_STYLE_LAYOUT_KINDS = [
  "title",
  "title_body",
  "two_column",
  "section",
  "image_caption",
  "chart",
  "quote",
  "blank",
] as const;
export type DeckStyleLayoutKind = (typeof DECK_STYLE_LAYOUT_KINDS)[number];

/** Placeholder roles frozen by 20a. Imported unknown roles are refused until
 * the user maps them to one of these roles. */
export const DECK_STYLE_PLACEHOLDER_ROLES = [
  "title",
  "subtitle",
  "body",
  "body_left",
  "body_right",
  "image",
  "caption",
  "chart",
  "quote",
  "footer",
] as const;
export type DeckStylePlaceholderRole = (typeof DECK_STYLE_PLACEHOLDER_ROLES)[number];

export interface DeckStyleGuidance {
  max_bullets: number;
  max_words_per_bullet: number;
  advice_key: string | null;
}

/** Exactly one of `name_key` (built-in) and `name` (user style) is set.
 * `id` always equals `theme.id`. */
export interface DeckStyle {
  id: string;
  builtin: boolean;
  name_key: string | null;
  name: string | null;
  description_key: string | null;
  theme: DeckTheme;
  density: DeckStyleDensity;
  guidance: DeckStyleGuidance;
  created_unix: number;
  modified_unix: number;
  version: number;
}

/** Stored catalog: user styles only. Built-ins live in `builtins.ts`. */
export interface DeckStyleCatalog {
  schema_version: 1;
  styles: DeckStyle[];
  revision: number;
}

/** `.adp-deck-style` exchange payload (D9). */
export interface DeckStyleFile {
  schema_version: 1;
  style: DeckStyle;
}

/** Explicit template-font replacement chosen by the user (D8). */
export interface DeckStyleFontMapping {
  from_family: string;
  to_asset_id: "inter-regular" | "inter-bold";
}

export type StyleWarning =
  | { id: string; kind: "font_missing"; asset_id: string }
  | { id: string; kind: "font_mapped"; from_family: string; to_asset_id: string }
  | { id: string; kind: "overflow"; slide_id: string; shape_id: string }
  | { id: string; kind: "manual_format_preserved"; slide_id: string }
  | { id: string; kind: "template_content_omitted" };

export type StyleWarningKind = StyleWarning["kind"];

/** Native-authoritative preview record (E4). The UI never edits this record.
 * `slide_ids` is null for the whole presentation. */
export interface DeckStylePreview {
  id: string;
  style_id: string;
  theme: DeckTheme;
  expected_revision: number;
  slide_ids: string[] | null;
  warnings: StyleWarning[];
  expires_unix: number;
}

export const DECK_STYLE_ERROR_CODES = [
  "deck_style.invalid",
  "deck_style.too_large",
  "deck_style.font_missing",
  "deck_style.unsupported",
  "deck_style.schema_newer",
  "deck_style.changed",
  "deck_style.history_full",
  "deck_style.failed",
] as const;

export type DeckStyleErrorCode = (typeof DECK_STYLE_ERROR_CODES)[number];

/** Thrown by validation and the service wrappers. `code` is a stable error
 * code that the UI translates under `errors.deck_style.<reason>`. */
export class DeckStyleError extends Error {
  readonly code: DeckStyleErrorCode;

  constructor(code: DeckStyleErrorCode) {
    super(code);
    this.name = "DeckStyleError";
    this.code = code;
  }
}

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isDeckStyleUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== "00000000-0000-0000-0000-000000000000" &&
    UUID_PATTERN.test(value)
  );
}

/** The eight built-in IDs, in fixed table order. */
export const DECK_STYLE_BUILTIN_IDS = [
  "220b0001-0000-4000-8000-000000000000",
  "220b0002-0000-4000-8000-000000000000",
  "220b0003-0000-4000-8000-000000000000",
  "220b0004-0000-4000-8000-000000000000",
  "220b0005-0000-4000-8000-000000000000",
  "220b0006-0000-4000-8000-000000000000",
  "220b0007-0000-4000-8000-000000000000",
  "220b0008-0000-4000-8000-000000000000",
] as const;

export type DeckStyleBuiltinId = (typeof DECK_STYLE_BUILTIN_IDS)[number];

export function isBuiltinDeckStyleId(id: string): id is DeckStyleBuiltinId {
  return (DECK_STYLE_BUILTIN_IDS as readonly string[]).includes(id);
}

/** Display-only guidance check. Excess bullets or words are reported and the
 * caller keeps every character; nothing here edits text. */
export function deckStyleGuidanceStatus(
  style: DeckStyle,
  bulletCount: number,
  wordsPerBullet: readonly number[],
): { over_bullets: boolean; over_words: boolean } {
  return {
    over_bullets: bulletCount > style.guidance.max_bullets,
    over_words: wordsPerBullet.some((count) => count > style.guidance.max_words_per_bullet),
  };
}
