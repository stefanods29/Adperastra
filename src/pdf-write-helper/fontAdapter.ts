/** Embedded export fonts with explicit glyph failure (Step 08b D4).
 *
 * Inter 4.1 is provisioned as a licensed local asset; the helper never asks
 * the operating system for a font and never falls back to a Microsoft font.
 * A missing asset fails with `convert.font_unavailable` before any output.
 * A character without a glyph fails with `convert.missing_glyph`; the export
 * never substitutes .notdef or silently drops text. */

import type { PDFDocument, PDFFont } from "pdf-lib";
import type { MeasuredFont, FontId } from "./documentLayout";

export interface FontkitLike {
  create(buffer: Uint8Array): FontkitFont;
}

export interface FontkitFont {
  hasGlyphForCodePoint(codePoint: number): boolean;
  unitsPerEm: number;
  layout(text: string): { glyphs: { id: number }[] };
}

export interface FontAsset {
  id: FontId;
  /** Path under the helper's packaged resources, never a user path. */
  path: string;
  bytes: Uint8Array;
}

export interface EmbeddedExportFont {
  font: PDFFont;
  kit: FontkitFont;
}

const FONT_PATHS: Readonly<Record<FontId, string>> = {
  "inter-regular": "/fonts/inter-4.1/Inter-Regular.ttf",
  "inter-bold": "/fonts/inter-4.1/Inter-Bold.ttf",
  "inter-italic": "/fonts/inter-4.1/Inter-Italic.ttf",
  "inter-bold-italic": "/fonts/inter-4.1/Inter-BoldItalic.ttf",
};

/** Load one packaged font. A missing resource is a typed failure, never an
 * OS fallback. `base` is the helper's own origin. */
export async function loadFontAsset(id: FontId, base = ""): Promise<FontAsset> {
  const response = await fetch(`${base}${FONT_PATHS[id]}`, { cache: "no-store" });
  if (!response.ok) throw new Error("convert.font_unavailable");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error("convert.font_unavailable");
  return { id, path: FONT_PATHS[id], bytes };
}

/** Register fontkit and embed the exact bytes; subsetting is allowed. */
export async function embedExportFont(
  pdf: PDFDocument,
  asset: FontAsset,
  fontkit: FontkitLike,
): Promise<EmbeddedExportFont> {
  pdf.registerFontkit(fontkit as never);
  const font = await pdf.embedFont(asset.bytes, { subset: true });
  const kit = fontkit.create(asset.bytes);
  return { font, kit };
}

/** True when every code point can be displayed by the embedded font. */
export function canDisplay(kit: FontkitFont, text: string): boolean {
  for (const character of Array.from(text)) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    if (character === "\n" || character === "\r" || character === "\t") continue;
    if (!kit.hasGlyphForCodePoint(codePoint)) return false;
  }
  return true;
}

/** Throw instead of letting pdf-lib draw .notdef. */
export function assertCanDisplay(kit: FontkitFont, text: string): void {
  if (!canDisplay(kit, text)) throw new Error("convert.missing_glyph");
}

/** A `MeasuredFont` over the embedded Inter fonts. */
export function measuredFont(fonts: Readonly<Record<FontId, EmbeddedExportFont>>): MeasuredFont {
  return {
    measure(text: string, sizePt: number, font: FontId): number {
      const embedded = fonts[font];
      if (!embedded) throw new Error("convert.font_unavailable");
      return embedded.font.widthOfTextAtSize(text, sizePt);
    },
    canDisplay(text: string, font: FontId): boolean {
      const embedded = fonts[font];
      if (!embedded) throw new Error("convert.font_unavailable");
      return canDisplay(embedded.kit, text);
    },
  };
}

/** Load, embed and check all four styles in one step. */
export async function loadEmbeddedFonts(
  pdf: PDFDocument,
  fontkit: FontkitLike,
  base = "",
): Promise<Record<FontId, EmbeddedExportFont>> {
  const ids: FontId[] = ["inter-regular", "inter-bold", "inter-italic", "inter-bold-italic"];
  const entries = await Promise.all(
    ids.map(async (id) => {
      const asset = await loadFontAsset(id, base);
      return [id, await embedExportFont(pdf, asset, fontkit)] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<FontId, EmbeddedExportFont>;
}
