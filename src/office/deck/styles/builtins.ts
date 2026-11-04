import type { DeckTheme, OfficeColor } from "../../types";
import { buildDeckStyleLayouts, deckStyleLayoutId } from "./styleLayouts";
import { DECK_STYLE_PALETTES, hexToOfficeColor } from "./stylePalettes";
import { INTER_FONT_FAMILY } from "./styleFonts";
import {
  DECK_STYLE_BUILTIN_IDS,
  DECK_STYLE_DENSITIES,
  DECK_STYLE_VERSION,
  type DeckStyle,
  type DeckStyleBuiltinId,
  type DeckStyleDensity,
  type DeckStyleSuffix,
} from "./styleTypes";

/** E1: the eight read-only built-in presentation styles, in fixed table
 * order. Deep-frozen application data; never editable catalog records. */

interface BuiltinRow {
  suffix: DeckStyleSuffix;
  heading_pt: number;
  body_pt: number;
  density: DeckStyleDensity;
  max_bullets: number;
  max_words_per_bullet: number;
}

const ROWS: readonly BuiltinRow[] = [
  { suffix: "business", heading_pt: 32, body_pt: 18, density: "comfortable", max_bullets: 6, max_words_per_bullet: 12 },
  { suffix: "report", heading_pt: 30, body_pt: 16, density: "compact", max_bullets: 6, max_words_per_bullet: 14 },
  { suffix: "education", heading_pt: 32, body_pt: 20, density: "comfortable", max_bullets: 5, max_words_per_bullet: 14 },
  { suffix: "minimal", heading_pt: 36, body_pt: 20, density: "comfortable", max_bullets: 4, max_words_per_bullet: 10 },
  { suffix: "creative", heading_pt: 36, body_pt: 20, density: "comfortable", max_bullets: 4, max_words_per_bullet: 8 },
  { suffix: "technical", heading_pt: 30, body_pt: 16, density: "compact", max_bullets: 7, max_words_per_bullet: 16 },
  { suffix: "training", heading_pt: 32, body_pt: 18, density: "comfortable", max_bullets: 6, max_words_per_bullet: 12 },
  { suffix: "personal", heading_pt: 34, body_pt: 20, density: "comfortable", max_bullets: 4, max_words_per_bullet: 10 },
];

function officeFont() {
  return { family: INTER_FONT_FAMILY, source: "bundled" as const, embeddable: true };
}

function palette(suffix: DeckStyleSuffix): DeckTheme["colors"] {
  const row = DECK_STYLE_PALETTES[suffix];
  return {
    background: hexToOfficeColor(row.background),
    text: hexToOfficeColor(row.text),
    muted: hexToOfficeColor(row.muted),
    accent: hexToOfficeColor(row.accent),
    accent2: hexToOfficeColor(row.accent2),
    surface: hexToOfficeColor(row.surface),
  };
}

function buildStyle(row: BuiltinRow, index: number): DeckStyle {
  const id = DECK_STYLE_BUILTIN_IDS[index];
  const prefix = id.slice(0, 8);
  const colors = palette(row.suffix);
  const theme: DeckTheme = {
    id,
    name: `deckStyle.name.${row.suffix}`,
    slide_width_pt: 720,
    slide_height_pt: 405,
    colors,
    heading_font: officeFont(),
    body_font: officeFont(),
    layouts: buildDeckStyleLayouts(
      {
        suffix: row.suffix,
        id_prefix: prefix,
        heading_pt: row.heading_pt,
        body_pt: row.body_pt,
        density: row.density,
      },
      { text: colors.text as OfficeColor, muted: colors.muted as OfficeColor },
    ),
    default_layout_id: deckStyleLayoutId(prefix, 2),
    density: row.density,
    version: DECK_STYLE_VERSION,
  };
  return {
    id,
    builtin: true,
    name_key: `deckStyle.name.${row.suffix}`,
    name: null,
    description_key: `deckStyle.description.${row.suffix}`,
    theme,
    density: row.density,
    guidance: {
      max_bullets: row.max_bullets,
      max_words_per_bullet: row.max_words_per_bullet,
      advice_key: `deckStyle.advice.${row.suffix}`,
    },
    created_unix: 0,
    modified_unix: 0,
    version: DECK_STYLE_VERSION,
  };
}

const styles = ROWS.map(buildStyle);
deepFreeze(styles);

export const BUILTIN_DECK_STYLES: readonly DeckStyle[] = Object.freeze(styles) as readonly DeckStyle[];

const byId = new Map<string, DeckStyle>(BUILTIN_DECK_STYLES.map((style) => [style.id, style]));

export function builtinDeckStyle(id: string): DeckStyle | undefined {
  return byId.get(id);
}

export function builtinDeckStyleBySuffix(suffix: DeckStyleSuffix): DeckStyle {
  const index = ROWS.findIndex((row) => row.suffix === suffix);
  return BUILTIN_DECK_STYLES[index];
}

export function isDeckStyleDensity(value: string): value is DeckStyleDensity {
  return (DECK_STYLE_DENSITIES as readonly string[]).includes(value);
}

export type { DeckStyleBuiltinId };

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
