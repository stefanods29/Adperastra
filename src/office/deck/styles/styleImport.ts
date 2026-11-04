import type { ConversionInput } from "../../../convert/types";
import {
  exportDeckStyleFile,
  importDeckStyleFile,
} from "../../../services/deckStyles";
import type {
  DeckTemplateInspection,
  OfficeFontMapping,
} from "../../../services/officeDeck";
import { importDeckTheme } from "../deckThemeImport";
import type { DeckTheme } from "../../types";
import {
  INTER_BOLD_ASSET_ID,
  INTER_REGULAR_ASSET_ID,
  interOfficeFont,
} from "./styleFonts";
import { validateDeckStyle } from "./styleValidation";
import {
  DECK_STYLE_FILE_EXTENSION,
  DeckStyleError,
  MAX_DECK_STYLE_NAME,
  type DeckStyle,
  type DeckStyleFontMapping,
} from "./styleTypes";

/** E5: import a style from an owned template or a style file; export a style
 * file. Catalog save stays a separate explicit action after preview. */

export const DECK_STYLE_TEMPLATE_FORMATS = ["pptx", "potx", "odp", "otp"] as const;
export type DeckStyleTemplateFormat = (typeof DECK_STYLE_TEMPLATE_FORMATS)[number];

export function isDeckTemplateFormatSupported(format: string): format is DeckStyleTemplateFormat {
  return (DECK_STYLE_TEMPLATE_FORMATS as readonly string[]).includes(format.toLowerCase());
}

export type StyleFontMapping = DeckStyleFontMapping;

function validateName(name: string): string {
  const length = [...name].length;
  if (length < 1 || length > MAX_DECK_STYLE_NAME || name.trim() !== name) {
    throw new DeckStyleError("deck_style.invalid");
  }
  if (name.includes("<") || /(?:https?|file|javascript|data):/i.test(name)) {
    throw new DeckStyleError("deck_style.invalid");
  }
  return name;
}

function validateFontMap(fontMap: readonly StyleFontMapping[]): readonly StyleFontMapping[] {
  if (fontMap.length > 32) throw new DeckStyleError("deck_style.invalid");
  const seen = new Set<string>();
  for (const mapping of fontMap) {
    if (mapping.from_family.length < 1 || mapping.from_family.length > 128) {
      throw new DeckStyleError("deck_style.invalid");
    }
    if (seen.has(mapping.from_family.toLocaleLowerCase("en-US"))) {
      throw new DeckStyleError("deck_style.invalid");
    }
    seen.add(mapping.from_family.toLocaleLowerCase("en-US"));
    if (mapping.to_asset_id !== INTER_REGULAR_ASSET_ID && mapping.to_asset_id !== INTER_BOLD_ASSET_ID) {
      throw new DeckStyleError("deck_style.invalid");
    }
  }
  return fontMap;
}

/** 20a `OfficeFontMapping`: explicit licensed Inter, never a system font. */
function officeFontMappings(fontMap: readonly StyleFontMapping[]): OfficeFontMapping[] {
  return fontMap.map((mapping) => ({
    from_family: mapping.from_family,
    to_font: interOfficeFont(),
  }));
}

export function normalizeImportedTheme(
  theme: DeckTheme,
  name: string,
  now: number = Math.floor(Date.now() / 1000),
): DeckStyle {
  validateName(name);
  const fontReady = (font: DeckTheme["heading_font"]) =>
    font.family === "Inter" && font.source === "bundled" && font.embeddable;
  if (!fontReady(theme.heading_font) || !fontReady(theme.body_font)) {
    throw new DeckStyleError("deck_style.font_missing");
  }
  if (theme.layouts.length < 1 || theme.layouts.length > 8) {
    throw new DeckStyleError("deck_style.unsupported");
  }
  const kinds = new Set<string>();
  const layouts = theme.layouts.map((layout) => {
    if (kinds.has(layout.kind)) throw new DeckStyleError("deck_style.invalid");
    kinds.add(layout.kind);
    return { ...layout, name: `deckStyle.layout.${layout.kind}` };
  });
  const style: DeckStyle = {
    id: theme.id,
    builtin: false,
    name_key: null,
    name,
    description_key: null,
    theme: {
      ...theme,
      name,
      density: "comfortable",
      layouts,
    },
    density: "comfortable",
    guidance: { max_bullets: 6, max_words_per_bullet: 12, advice_key: null },
    created_unix: now,
    modified_unix: now,
    version: 1,
  };
  return validateDeckStyle(style);
}

/** Uses 22a E7 `importDeckTheme` after the approved inspection. */
export async function importTemplateStyle(
  inspectionId: string,
  themeId: string,
  name: string,
  fontMap: readonly StyleFontMapping[],
): Promise<DeckStyle> {
  validateName(name);
  const mappings = officeFontMappings(validateFontMap(fontMap));
  const theme = await importDeckTheme(inspectionId, themeId, name, mappings);
  return normalizeImportedTheme(theme, name);
}

export async function importStyleFile(input: ConversionInput): Promise<DeckStyle> {
  // A file must carry the one exchange extension; snapshots are already
  // bounded by their snapshot metadata and are checked natively.
  if (input.kind === "file" && !input.path.toLowerCase().endsWith(DECK_STYLE_FILE_EXTENSION)) {
    throw new DeckStyleError("deck_style.invalid");
  }
  const handle = await importDeckStyleFile(input);
  const style = validateDeckStyle(await handle.completion);
  if (style.builtin || style.name_key !== null) throw new DeckStyleError("deck_style.invalid");
  return style;
}

export async function exportStyleFile(styleId: string, destPath: string): Promise<void> {
  const handle = await exportDeckStyleFile(styleId, destPath);
  await handle.completion;
}

/** The UI shows exactly what was inspected; the inspected type is never
 * re-created here. */
export function inspectedThemes(inspection: DeckTemplateInspection): DeckTemplateInspection["themes"] {
  return inspection.themes;
}
