import type {
  DeckTheme,
  DeckLayout,
  OfficeColor,
  OfficeFont,
  OfficeRect,
  ParagraphFormat,
  TextFormat,
} from "../../types";
import {
  DECK_STYLE_DENSITIES,
  DECK_STYLE_LAYOUT_KINDS,
  DECK_STYLE_PLACEHOLDER_ROLES,
  DECK_STYLE_VERSION,
  MAX_DECK_STYLE_LAYOUTS,
  MAX_DECK_STYLE_NAME,
  MAX_DECK_STYLE_PLACEHOLDERS,
  DeckStyleError,
  isDeckStyleUuid,
  type DeckStyleDensity,
  type DeckStyleGuidance,
  type DeckStyleLayoutKind,
  type DeckStylePlaceholderRole,
} from "./styleTypes";

/** Value and theme validators for a style; split from styleValidation.ts to
 * keep both files under 400 lines. */

const THEME_KEYS = [
  "id",
  "name",
  "slide_width_pt",
  "slide_height_pt",
  "colors",
  "heading_font",
  "body_font",
  "layouts",
  "default_layout_id",
  "density",
  "version",
] as const;

export const COLOR_ROLES = ["background", "text", "muted", "accent", "accent2", "surface"] as const;
const COLOR_CHANNELS = ["r", "g", "b", "a"] as const;
const FONT_KEYS = ["family", "source", "embeddable"] as const;
const RECT_KEYS = ["x_pt", "y_pt", "width_pt", "height_pt", "rotation_deg"] as const;
const LAYOUT_KEYS = ["id", "name", "kind", "placeholders"] as const;
const PLACEHOLDER_KEYS = ["id", "role", "rect", "text", "paragraph"] as const;
const TEXT_KEYS = [
  "font",
  "size_pt",
  "bold",
  "italic",
  "strike",
  "underline",
  "script",
  "foreground",
  "highlight",
  "language",
] as const;
const PARAGRAPH_KEYS = [
  "align",
  "direction",
  "indent_left_pt",
  "indent_right_pt",
  "first_line_pt",
  "line_spacing",
  "before_pt",
  "after_pt",
  "list",
  "outline_level",
] as const;
const GUIDANCE_KEYS = ["max_bullets", "max_words_per_bullet", "advice_key"] as const;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const URL_TEXT = /(?:https?|file|ftp|mailto|javascript|data):/i;
const MARKUP_TEXT = /<[a-z!/]/i;

export function fail(message: string): never {
  throw new DeckStyleError("deck_style.invalid");
}

export function failCode(code: ConstructorParameters<typeof DeckStyleError>[0]): never {
  throw new DeckStyleError(code);
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype === null || prototype === Object.prototype) return true;
  // `structuredClone` and other realms hand back objects whose prototype is
  // that realm's Object.prototype. A plain object stays plain; a class
  // instance keeps a prototype with its own non-null prototype.
  return (
    typeof prototype === "object" &&
    prototype !== null &&
    Object.getPrototypeOf(prototype) === null &&
    Object.prototype.hasOwnProperty.call(prototype, "constructor") &&
    typeof (prototype as { constructor?: unknown }).constructor === "function"
  );
}

/** Reject functions, prototype keys, URLs and markup anywhere in the tree. */
export function scan(value: unknown, depth = 0): void {
  if (depth > 16) fail("depth");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("number");
    return;
  }
  if (typeof value === "function") fail("function");
  if (typeof value === "string") {
    if (value.includes("\0") || URL_TEXT.test(value) || MARKUP_TEXT.test(value)) fail("text");
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 4096) fail("array");
    for (const item of value) scan(item, depth + 1);
    return;
  }
  if (!isPlainRecord(value)) fail("class");
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) fail("prototype");
    scan(item, depth + 1);
  }
}

export function record(value: unknown, keys: readonly string[], where: string): Record<string, unknown> {
  if (!isPlainRecord(value)) fail(where);
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(`${where}:${key}`);
  }
  return value;
}

export function member(object: Record<string, unknown>, key: string, where: string): unknown {
  if (!(key in object)) fail(`${where}:${key}`);
  return object[key];
}

export function text(value: unknown, max: number, where: string, min = 1): string {
  if (typeof value !== "string") fail(`${where}:string`);
  const length = [...value].length;
  if (length < min || length > max) fail(`${where}:length`);
  if (value.trim() !== value && min > 0) fail(`${where}:space`);
  return value;
}

export function nullableText(value: unknown, max: number, where: string): string | null {
  if (value === null) return null;
  return text(value, max, where);
}

export function numberValue(
  value: unknown,
  min: number,
  max: number,
  where: string,
  integer = false,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${where}:number`);
  if (value < min || value > max) fail(`${where}:range`);
  if (integer && !Number.isInteger(value)) fail(`${where}:integer`);
  return value;
}

export function bool(value: unknown, where: string): boolean {
  if (typeof value !== "boolean") fail(`${where}:bool`);
  return value;
}

export function uuid(value: unknown, where: string): string {
  if (!isDeckStyleUuid(value)) fail(`${where}:uuid`);
  return value;
}

export function enumValue<T extends string>(value: unknown, allowed: readonly T[], where: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    fail(`${where}:enum`);
  }
  return value as T;
}

function color(value: unknown, where: string): OfficeColor {
  const channels = record(value, COLOR_CHANNELS, where);
  const result = {} as Record<string, number>;
  for (const channel of COLOR_CHANNELS) {
    result[channel] = numberValue(member(channels, channel, where), 0, 255, `${where}.${channel}`, true);
  }
  return result as unknown as OfficeColor;
}

function nullableColor(value: unknown, where: string): OfficeColor | null {
  return value === null ? null : color(value, where);
}

function font(value: unknown, where: string): OfficeFont {
  const object = record(value, FONT_KEYS, where);
  const family = text(member(object, "family", where), 128, `${where}.family`);
  const source = enumValue(member(object, "source", where), ["bundled", "installed", "document"], `${where}.source`);
  const embeddable = bool(member(object, "embeddable", where), `${where}.embeddable`);
  if (family !== "Inter" || source !== "bundled" || !embeddable) fail(`${where}:font`);
  return { family, source, embeddable };
}

function rect(value: unknown, where: string, widthPt: number, heightPt: number): OfficeRect {
  const object = record(value, RECT_KEYS, where);
  const x = numberValue(member(object, "x_pt", where), -14400, 14400, `${where}.x`);
  const y = numberValue(member(object, "y_pt", where), -14400, 14400, `${where}.y`);
  const width = numberValue(member(object, "width_pt", where), Number.MIN_VALUE, 28800, `${where}.width`);
  const height = numberValue(member(object, "height_pt", where), Number.MIN_VALUE, 28800, `${where}.height`);
  const rotation = numberValue(member(object, "rotation_deg", where), 0, 359.999, `${where}.rotation`);
  if (x < 0 || y < 0 || x + width > widthPt || y + height > heightPt) fail(`${where}:outside`);
  return { x_pt: x, y_pt: y, width_pt: width, height_pt: height, rotation_deg: rotation };
}

function textFormat(value: unknown, where: string): TextFormat {
  const object = record(value, TEXT_KEYS, where);
  return {
    font: font(member(object, "font", where), `${where}.font`),
    size_pt: numberValue(member(object, "size_pt", where), 1, 400, `${where}.size`),
    bold: bool(member(object, "bold", where), `${where}.bold`),
    italic: bool(member(object, "italic", where), `${where}.italic`),
    strike: bool(member(object, "strike", where), `${where}.strike`),
    underline: enumValue(member(object, "underline", where), ["none", "single", "double"], `${where}.underline`),
    script: enumValue(member(object, "script", where), ["normal", "subscript", "superscript"], `${where}.script`),
    foreground: color(member(object, "foreground", where), `${where}.foreground`),
    highlight: nullableColor(member(object, "highlight", where), `${where}.highlight`),
    language: text(member(object, "language", where), 64, `${where}.language`),
  };
}

function paragraphFormat(value: unknown, where: string): ParagraphFormat {
  const object = record(value, PARAGRAPH_KEYS, where);
  return {
    align: enumValue(member(object, "align", where), ["left", "center", "right", "justify"], `${where}.align`),
    direction: enumValue(member(object, "direction", where), ["ltr", "rtl"], `${where}.direction`),
    indent_left_pt: numberValue(member(object, "indent_left_pt", where), 0, 720, `${where}.indent_left`),
    indent_right_pt: numberValue(member(object, "indent_right_pt", where), 0, 720, `${where}.indent_right`),
    first_line_pt: numberValue(member(object, "first_line_pt", where), -720, 720, `${where}.first_line`),
    line_spacing: numberValue(member(object, "line_spacing", where), 0.5, 5, `${where}.line_spacing`),
    before_pt: numberValue(member(object, "before_pt", where), 0, 200, `${where}.before`),
    after_pt: numberValue(member(object, "after_pt", where), 0, 200, `${where}.after`),
    list: enumValue(member(object, "list", where), ["none", "disc", "decimal"], `${where}.list`),
    outline_level: numberValue(member(object, "outline_level", where), 0, 6, `${where}.outline`, true),
  };
}

function layout(value: unknown, where: string, widthPt: number, heightPt: number): DeckLayout {
  const object = record(value, LAYOUT_KEYS, where);
  const kind = enumValue<DeckStyleLayoutKind>(
    member(object, "kind", where),
    DECK_STYLE_LAYOUT_KINDS,
    `${where}.kind`,
  );
  const placeholders = member(object, "placeholders", where);
  if (!Array.isArray(placeholders) || placeholders.length > MAX_DECK_STYLE_PLACEHOLDERS) {
    fail(`${where}.placeholders`);
  }
  if ((kind === "blank" && placeholders.length !== 0) || (kind !== "blank" && placeholders.length === 0)) {
    fail(`${where}.blank`);
  }
  const roles = new Set<string>();
  const ids = new Set<string>();
  const result = placeholders.map((item, index) => {
    const at = `${where}.placeholders[${index}]`;
    const placeholder = record(item, PLACEHOLDER_KEYS, at);
    const id = uuid(member(placeholder, "id", at), `${at}.id`);
    if (ids.has(id)) fail(`${at}.duplicate`);
    ids.add(id);
    const role = enumValue<DeckStylePlaceholderRole>(
      member(placeholder, "role", at),
      DECK_STYLE_PLACEHOLDER_ROLES,
      `${at}.role`,
    );
    if (roles.has(role)) fail(`${at}.role_duplicate`);
    roles.add(role);
    return {
      id,
      role,
      rect: rect(member(placeholder, "rect", at), `${at}.rect`, widthPt, heightPt),
      text: textFormat(member(placeholder, "text", at), `${at}.text`),
      paragraph: paragraphFormat(member(placeholder, "paragraph", at), `${at}.paragraph`),
    } as DeckLayout["placeholders"][number];
  });
  return {
    id: uuid(member(object, "id", where), `${where}.id`),
    name: text(member(object, "name", where), MAX_DECK_STYLE_NAME, `${where}.name`),
    kind,
    placeholders: result,
  };
}

export function validateDeckTheme(value: unknown, density: DeckStyleDensity): DeckTheme {
  const object = record(value, THEME_KEYS, "theme");
  const width = numberValue(member(object, "slide_width_pt", "theme"), Number.MIN_VALUE, 14400, "theme.width");
  const height = numberValue(member(object, "slide_height_pt", "theme"), Number.MIN_VALUE, 14400, "theme.height");
  const colors = record(member(object, "colors", "theme"), COLOR_ROLES, "theme.colors");
  const palette = {} as Record<string, OfficeColor>;
  for (const role of COLOR_ROLES) {
    palette[role] = color(member(colors, role, "theme.colors"), `theme.colors.${role}`);
  }
  const layoutsValue = member(object, "layouts", "theme");
  if (!Array.isArray(layoutsValue) || layoutsValue.length < 1 || layoutsValue.length > MAX_DECK_STYLE_LAYOUTS) {
    fail("theme.layouts");
  }
  const layouts = layoutsValue.map((item, index) => layout(item, `theme.layouts[${index}]`, width, height));
  const layoutIds = new Set(layouts.map((item) => item.id));
  if (layoutIds.size !== layouts.length) fail("theme.layouts.duplicate");
  const defaultLayout = uuid(member(object, "default_layout_id", "theme"), "theme.default_layout_id");
  if (!layoutIds.has(defaultLayout)) fail("theme.default_layout");
  if (enumValue(member(object, "density", "theme"), DECK_STYLE_DENSITIES, "theme.density") !== density) {
    fail("theme.density_mismatch");
  }
  const version = numberValue(member(object, "version", "theme"), 1, 1, "theme.version", true);
  if (version !== DECK_STYLE_VERSION) fail("theme.version");
  return {
    id: uuid(member(object, "id", "theme"), "theme.id"),
    name: text(member(object, "name", "theme"), MAX_DECK_STYLE_NAME, "theme.name"),
    slide_width_pt: width,
    slide_height_pt: height,
    colors: palette as unknown as DeckTheme["colors"],
    heading_font: font(member(object, "heading_font", "theme"), "theme.heading_font"),
    body_font: font(member(object, "body_font", "theme"), "theme.body_font"),
    layouts,
    default_layout_id: defaultLayout,
    density,
    version: DECK_STYLE_VERSION,
  };
}

export function guidance(value: unknown, where: string): DeckStyleGuidance {
  const object = record(value, GUIDANCE_KEYS, where);
  return {
    max_bullets: numberValue(member(object, "max_bullets", where), 1, 10, `${where}.bullets`, true),
    max_words_per_bullet: numberValue(
      member(object, "max_words_per_bullet", where),
      1,
      30,
      `${where}.words`,
      true,
    ),
    advice_key: nullableText(member(object, "advice_key", where), 96, `${where}.advice_key`),
  };
}

export function utf8Length(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}
