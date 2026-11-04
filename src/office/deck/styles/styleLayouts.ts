import type {
  DeckLayout,
  OfficeColor,
  OfficeRect,
  ParagraphFormat,
  TextFormat,
} from "../../types";
import { INTER_FONT_FAMILY } from "./styleFonts";
import type {
  DeckStyleDensity,
  DeckStyleLayoutKind,
  DeckStylePlaceholderRole,
  DeckStyleSuffix,
} from "./styleTypes";

/** Deterministic layout and placeholder IDs.
 *
 * Layout:     `<style prefix>-<0001..0008>-4000-8000-000000000000`
 * Placeholder `<same groups>-<last 12 hex ordinal>`
 *
 * No UUIDv5 dependency and no translated text inside an ID. */

export interface DeckStyleLayoutSpec {
  suffix: DeckStyleSuffix;
  id_prefix: string;
  heading_pt: number;
  body_pt: number;
  density: DeckStyleDensity;
}

const RECTS: Readonly<
  Record<
    DeckStyleLayoutKind,
    readonly (readonly [DeckStylePlaceholderRole, number, number, number, number])[]
  >
> = {
  title: [
    ["title", 54, 108, 612, 78],
    ["subtitle", 54, 204, 612, 64],
    ["footer", 54, 365, 612, 18],
  ],
  title_body: [
    ["title", 36, 24, 648, 54],
    ["body", 48, 96, 624, 244],
    ["footer", 36, 365, 648, 18],
  ],
  two_column: [
    ["title", 36, 24, 648, 54],
    ["body_left", 36, 96, 312, 244],
    ["body_right", 372, 96, 312, 244],
    ["footer", 36, 365, 648, 18],
  ],
  section: [
    ["title", 54, 132, 612, 96],
    ["subtitle", 54, 240, 612, 48],
    ["footer", 54, 365, 612, 18],
  ],
  image_caption: [
    ["title", 36, 24, 648, 54],
    ["image", 36, 90, 420, 252],
    ["caption", 474, 90, 210, 252],
    ["footer", 36, 365, 648, 18],
  ],
  chart: [
    ["title", 36, 24, 648, 54],
    ["chart", 36, 90, 648, 252],
    ["footer", 36, 365, 648, 18],
  ],
  quote: [
    ["quote", 72, 100, 576, 160],
    ["caption", 72, 280, 576, 36],
    ["footer", 36, 365, 648, 18],
  ],
  blank: [],
};

export const DECK_STYLE_LAYOUT_ORDER: readonly DeckStyleLayoutKind[] = [
  "title",
  "title_body",
  "two_column",
  "section",
  "image_caption",
  "chart",
  "quote",
  "blank",
];

export function deckStyleLayoutKey(kind: DeckStyleLayoutKind): string {
  return `deckStyle.layout.${kind}`;
}

export function deckStyleLayoutId(stylePrefix: string, ordinal: number): string {
  if (!/^[0-9a-f]{8}$/.test(stylePrefix) || ordinal < 1 || ordinal > 8) {
    throw new Error("deck_style.invalid");
  }
  return `${stylePrefix}-${ordinal.toString(16).padStart(4, "0")}-4000-8000-000000000000`;
}

export function deckStylePlaceholderId(stylePrefix: string, layoutOrdinal: number, placeholderOrdinal: number): string {
  if (placeholderOrdinal < 1 || placeholderOrdinal > 10) throw new Error("deck_style.invalid");
  return `${stylePrefix}-${layoutOrdinal.toString(16).padStart(4, "0")}-4000-8000-${placeholderOrdinal
    .toString(16)
    .padStart(12, "0")}`;
}

function rect(x: number, y: number, width: number, height: number): OfficeRect {
  return { x_pt: x, y_pt: y, width_pt: width, height_pt: height, rotation_deg: 0 };
}

function font() {
  return { family: INTER_FONT_FAMILY, source: "bundled" as const, embeddable: true };
}

function textFormat(size: number, bold: boolean, color: OfficeColor): TextFormat {
  return {
    font: font(),
    size_pt: size,
    bold,
    italic: false,
    strike: false,
    underline: "none",
    script: "normal",
    foreground: color,
    highlight: null,
    // Placeholder defaults carry no language decision; inserted runs use the
    // document locale ("und" is BCP 47 for undetermined).
    language: "und",
  };
}

function paragraph(list: ParagraphFormat["list"], lineSpacing: number): ParagraphFormat {
  return {
    align: "left",
    direction: "ltr",
    indent_left_pt: 0,
    indent_right_pt: 0,
    first_line_pt: 0,
    line_spacing: lineSpacing,
    before_pt: 0,
    after_pt: 8,
    list,
    outline_level: 0,
  };
}

function bodyLineSpacing(spec: DeckStyleLayoutSpec): number {
  if (spec.density === "compact") return spec.suffix === "report" || spec.suffix === "technical" ? 1.1 : 1.2;
  if (spec.suffix === "education" || spec.suffix === "training") return 1.35;
  return 1.2;
}

function placeholderFormat(
  spec: DeckStyleLayoutSpec,
  role: DeckStylePlaceholderRole,
  colors: { text: OfficeColor; muted: OfficeColor },
): { text: TextFormat; paragraph: ParagraphFormat } {
  const heading = spec.heading_pt;
  const body = spec.body_pt;
  switch (role) {
    case "title":
      return { text: textFormat(heading, true, colors.text), paragraph: paragraph("none", 1.2) };
    case "subtitle":
      return { text: textFormat(20, false, colors.text), paragraph: paragraph("none", 1.2) };
    case "body":
    case "body_left":
    case "body_right":
      return { text: textFormat(body, false, colors.text), paragraph: paragraph("disc", bodyLineSpacing(spec)) };
    case "caption":
      return { text: textFormat(16, false, colors.muted), paragraph: paragraph("none", 1.2) };
    case "footer":
      return { text: textFormat(10, false, colors.muted), paragraph: paragraph("none", 1.2) };
    case "quote":
      return { text: textFormat(heading, false, colors.text), paragraph: paragraph("none", 1.2) };
    case "image":
    case "chart":
      return { text: textFormat(body, false, colors.text), paragraph: paragraph("none", 1.2) };
  }
}

/** All eight fixed layouts, in the frozen table order. */
export function buildDeckStyleLayouts(
  spec: DeckStyleLayoutSpec,
  colors: { text: OfficeColor; muted: OfficeColor },
): DeckLayout[] {
  return DECK_STYLE_LAYOUT_ORDER.map((kind, index) => {
    const ordinal = index + 1;
    const layoutId = deckStyleLayoutId(spec.id_prefix, ordinal);
    const placeholders = RECTS[kind].map(([role, x, y, width, height], placeholderIndex) => {
      const formats = placeholderFormat(spec, role, colors);
      return {
        id: deckStylePlaceholderId(spec.id_prefix, ordinal, placeholderIndex + 1),
        role,
        rect: rect(x, y, width, height),
        text: formats.text,
        paragraph: formats.paragraph,
      };
    });
    return {
      id: layoutId,
      name: deckStyleLayoutKey(kind),
      kind,
      placeholders,
    } as DeckLayout;
  });
}
