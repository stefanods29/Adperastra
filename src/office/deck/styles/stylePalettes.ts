import type { OfficeColor } from "../../types";

/** Exact palettes from the Step 22b table. All colors are opaque (alpha 255).
 * Values are document data, never application UI theme tokens. */

export const DECK_STYLE_SUFFIXES = [
  "business",
  "report",
  "education",
  "minimal",
  "creative",
  "technical",
  "training",
  "personal",
] as const;

export type DeckStyleSuffix = (typeof DECK_STYLE_SUFFIXES)[number];

export interface DeckStylePalette {
  background: string;
  text: string;
  muted: string;
  accent: string;
  accent2: string;
  surface: string;
}

export const DECK_STYLE_PALETTES: Readonly<Record<DeckStyleSuffix, DeckStylePalette>> =
  deepFreeze({
    business: {
      background: "#FFFFFF",
      text: "#17212B",
      muted: "#556473",
      accent: "#185ABD",
      accent2: "#0F766E",
      surface: "#EAF1FB",
    },
    report: {
      background: "#FAFBFD",
      text: "#182230",
      muted: "#526070",
      accent: "#1D4ED8",
      accent2: "#0E7490",
      surface: "#E8EEF7",
    },
    education: {
      background: "#FFFDF5",
      text: "#202820",
      muted: "#586048",
      accent: "#2D6A4F",
      accent2: "#92400E",
      surface: "#F1F5DE",
    },
    minimal: {
      background: "#FFFFFF",
      text: "#202020",
      muted: "#606060",
      accent: "#303030",
      accent2: "#2563EB",
      surface: "#F2F2F2",
    },
    creative: {
      background: "#FFF7F0",
      text: "#2B1634",
      muted: "#6A4D72",
      accent: "#7E22CE",
      accent2: "#C2410C",
      surface: "#F4E4FA",
    },
    technical: {
      background: "#101820",
      text: "#F2F6FA",
      muted: "#B2C2D0",
      accent: "#66C2FF",
      accent2: "#5EE0C0",
      surface: "#1C2B38",
    },
    training: {
      background: "#F7FBFF",
      text: "#172554",
      muted: "#475569",
      accent: "#1E40AF",
      accent2: "#0369A1",
      surface: "#E0EDFF",
    },
    personal: {
      background: "#FFF9FB",
      text: "#3A2030",
      muted: "#6B4F60",
      accent: "#9D174D",
      accent2: "#7C3AED",
      surface: "#FCE7F3",
    },
  });

/** `#RRGGBB` to the 20a RGBA record. Alpha is always 255 for a style. */
export function hexToOfficeColor(hex: string): OfficeColor {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error("deck_style.invalid");
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
    a: 255,
  } as OfficeColor;
}

function channel(color: OfficeColor, name: "r" | "g" | "b"): number {
  return (color as unknown as Record<"r" | "g" | "b", number>)[name] / 255;
}

function luminance(color: OfficeColor): number {
  const linear = (value: number) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(channel(color, "r")) + 0.7152 * linear(channel(color, "g")) + 0.0722 * linear(channel(color, "b"));
}

/** WCAG contrast ratio, used by the palette test and the dark-theme check. */
export function contrastRatio(foreground: OfficeColor, background: OfficeColor): number {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
