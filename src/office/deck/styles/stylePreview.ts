import type { DeckTheme, DeckLayout } from "../../types";
import {
  DECK_STYLE_DENSITIES,
  DeckStyleError,
  MAX_STYLE_PREVIEW_WARNINGS,
  STYLE_PREVIEW_TTL_SECONDS,
  isDeckStyleUuid,
  type DeckStyleDensity,
  type DeckStylePreview,
  type StyleWarning,
} from "./styleTypes";
import { validateDeckTheme } from "./styleValidation";

/** Pure preview helpers. Geometry scaling mirrors the native preparation so a
 * 4:3 deck keeps its dimensions and a 16:9 theme applied to a larger canvas
 * keeps 36 pt at twice the size (72 pt). */

export const MIN_STYLE_TEXT_PT = 8;
export const MAX_STYLE_TEXT_PT = 96;

export function scaledTextSize(sizePt: number, scaleX: number, scaleY: number): number {
  const scaled = sizePt * Math.min(scaleX, scaleY);
  return Math.min(MAX_STYLE_TEXT_PT, Math.max(MIN_STYLE_TEXT_PT, Math.round(scaled * 100) / 100));
}

export function scaleDeckThemeForSize(
  theme: DeckTheme,
  widthPt: number,
  heightPt: number,
): DeckTheme {
  if (!Number.isFinite(widthPt) || !Number.isFinite(heightPt) || widthPt <= 0 || heightPt <= 0) {
    throw new DeckStyleError("deck_style.invalid");
  }
  const scaleX = widthPt / theme.slide_width_pt;
  const scaleY = heightPt / theme.slide_height_pt;
  const layouts: DeckLayout[] = theme.layouts.map((layout) => ({
    ...layout,
    placeholders: layout.placeholders.map((placeholder) => ({
      ...placeholder,
      rect: {
        x_pt: placeholder.rect.x_pt * scaleX,
        y_pt: placeholder.rect.y_pt * scaleY,
        width_pt: placeholder.rect.width_pt * scaleX,
        height_pt: placeholder.rect.height_pt * scaleY,
        rotation_deg: placeholder.rect.rotation_deg,
      },
      text: {
        ...placeholder.text,
        size_pt: scaledTextSize(placeholder.text.size_pt, scaleX, scaleY),
      },
    })),
  }));
  return {
    ...theme,
    slide_width_pt: widthPt,
    slide_height_pt: heightPt,
    layouts,
  };
}

export function styleWarningKey(warning: StyleWarning): string {
  return `deckStyle.warning.${warning.kind}`;
}

/** Overflow is never acknowledgeable; the native record refuses Apply. */
export function previewCanApply(preview: DeckStylePreview): boolean {
  return preview.warnings.every((warning) => warning.kind !== "overflow");
}

export function previewExpired(preview: DeckStylePreview, nowUnix: number): boolean {
  return !Number.isSafeInteger(preview.expires_unix) || preview.expires_unix <= nowUnix;
}

function fontAssetId(value: unknown): string {
  if (value !== "inter-regular" && value !== "inter-bold") {
    throw new DeckStyleError("deck_style.invalid");
  }
  return value;
}

function warning(value: unknown): StyleWarning {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DeckStyleError("deck_style.invalid");
  }
  const record = value as Record<string, unknown>;
  if (!isDeckStyleUuid(record.id)) throw new DeckStyleError("deck_style.invalid");
  switch (record.kind) {
    case "font_missing":
      return { id: record.id, kind: "font_missing", asset_id: fontAssetId(record.asset_id) };
    case "font_mapped":
      if (typeof record.from_family !== "string" || record.from_family.length < 1 ||
          record.from_family.length > 128) {
        throw new DeckStyleError("deck_style.invalid");
      }
      return {
        id: record.id,
        kind: "font_mapped",
        from_family: record.from_family,
        to_asset_id: fontAssetId(record.to_asset_id),
      };
    case "overflow":
      if (!isDeckStyleUuid(record.slide_id) || !isDeckStyleUuid(record.shape_id)) {
        throw new DeckStyleError("deck_style.invalid");
      }
      return { id: record.id, kind: "overflow", slide_id: record.slide_id, shape_id: record.shape_id };
    case "manual_format_preserved":
      if (!isDeckStyleUuid(record.slide_id)) throw new DeckStyleError("deck_style.invalid");
      return { id: record.id, kind: "manual_format_preserved", slide_id: record.slide_id };
    case "template_content_omitted":
      return { id: record.id, kind: "template_content_omitted" };
    default:
      throw new DeckStyleError("deck_style.invalid");
  }
}

/** Validate the native-authoritative preview at the service boundary. */
export function validateDeckStylePreview(value: unknown): DeckStylePreview {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DeckStyleError("deck_style.invalid");
  }
  const record = value as Record<string, unknown>;
  if (!isDeckStyleUuid(record.id) || !isDeckStyleUuid(record.style_id)) {
    throw new DeckStyleError("deck_style.invalid");
  }
  const density = record.theme !== null && typeof record.theme === "object"
    ? (record.theme as Record<string, unknown>).density
    : null;
  if (typeof density !== "string" || !(DECK_STYLE_DENSITIES as readonly string[]).includes(density)) {
    throw new DeckStyleError("deck_style.invalid");
  }
  const theme = validateDeckTheme(record.theme, density as DeckStyleDensity);
  if (theme.id !== record.style_id) throw new DeckStyleError("deck_style.invalid");
  if (!Number.isSafeInteger(record.expected_revision) || (record.expected_revision as number) < 0) {
    throw new DeckStyleError("deck_style.invalid");
  }
  let slideIds: string[] | null = null;
  if (record.slide_ids !== null) {
    if (!Array.isArray(record.slide_ids) || record.slide_ids.length < 1 || record.slide_ids.length > 1000) {
      throw new DeckStyleError("deck_style.invalid");
    }
    const unique = new Set(record.slide_ids);
    if (unique.size !== record.slide_ids.length || record.slide_ids.some((id) => !isDeckStyleUuid(id))) {
      throw new DeckStyleError("deck_style.invalid");
    }
    slideIds = record.slide_ids as string[];
  }
  if (!Array.isArray(record.warnings) || record.warnings.length > MAX_STYLE_PREVIEW_WARNINGS) {
    throw new DeckStyleError("deck_style.invalid");
  }
  const warnings = record.warnings.map(warning);
  if (new Set(warnings.map((item) => item.id)).size !== warnings.length) {
    throw new DeckStyleError("deck_style.invalid");
  }
  if (!Number.isSafeInteger(record.expires_unix)) throw new DeckStyleError("deck_style.invalid");
  return {
    id: record.id,
    style_id: record.style_id,
    theme,
    expected_revision: record.expected_revision as number,
    slide_ids: slideIds,
    warnings,
    expires_unix: record.expires_unix as number,
  };
}

export function previewTtlSeconds(): number {
  return STYLE_PREVIEW_TTL_SECONDS;
}
