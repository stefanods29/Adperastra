import {
  DECK_STYLE_SCHEMA_VERSION,
  DECK_STYLE_VERSION,
  MAX_DECK_STYLE_BYTES,
  MAX_DECK_STYLE_CATALOG_BYTES,
  MAX_DECK_STYLE_NAME,
  MAX_USER_DECK_STYLES,
  isBuiltinDeckStyleId,
  isDeckStyleUuid,
  type DeckStyle,
  type DeckStyleCatalog,
  type DeckStyleDensity,
} from "./styleTypes";
import {
  bool,
  enumValue,
  fail,
  failCode,
  guidance,
  member,
  nullableText,
  numberValue,
  record,
  scan,
  utf8Length,
  uuid,
  validateDeckTheme,
} from "./styleThemeValidation";

/** Validation boundary for manual styles (E6). Unknown is accepted only at
 * this boundary; every public style payload is fully typed afterwards.
 *
 * Refused without exception: class instances, prototype keys, functions,
 * URLs, markup/code and unknown keys. No private per-style type exists. */

const STYLE_KEYS = [
  "id",
  "builtin",
  "name_key",
  "name",
  "description_key",
  "theme",
  "density",
  "guidance",
  "created_unix",
  "modified_unix",
  "version",
] as const;
const CATALOG_KEYS = ["schema_version", "styles", "revision"] as const;

export { validateDeckTheme };

/** Validate one style, including its complete theme. Throws DeckStyleError. */
export function validateDeckStyle(input: unknown): DeckStyle {
  scan(input);
  if (input === null || typeof input !== "object" || Array.isArray(input)) fail("style");
  const object = { ...(input as Record<string, unknown>) };
  if ("schema_version" in object) {
    const schema = object.schema_version;
    if (typeof schema !== "number") fail("schema");
    if (schema > DECK_STYLE_SCHEMA_VERSION) failCode("deck_style.schema_newer");
    if (schema !== DECK_STYLE_SCHEMA_VERSION) fail("schema");
    delete object.schema_version;
  }
  record(object, STYLE_KEYS, "style");
  if (utf8Length(input) > MAX_DECK_STYLE_BYTES) failCode("deck_style.too_large");

  const id = uuid(member(object, "id", "style"), "style.id");
  const builtin = bool(member(object, "builtin", "style"), "style.builtin");
  const nameKey = nullableText(member(object, "name_key", "style"), 96, "style.name_key");
  const name = nullableText(member(object, "name", "style"), MAX_DECK_STYLE_NAME, "style.name");
  if ((nameKey === null) === (name === null)) fail("style.name_exclusive");
  if (builtin && nameKey === null) fail("style.builtin_key");
  // User styles are identified by their visible name; an i18n key belongs to
  // read-only application built-ins only.
  if (!builtin && name === null) fail("style.user_name");
  const descriptionKey = nullableText(member(object, "description_key", "style"), 96, "style.description_key");
  const density = enumValue<DeckStyleDensity>(
    member(object, "density", "style"),
    ["comfortable", "compact"],
    "style.density",
  );
  const themeValue = validateDeckTheme(member(object, "theme", "style"), density);
  if (themeValue.id !== id) fail("style.id_mismatch");
  const created = numberValue(member(object, "created_unix", "style"), 0, Number.MAX_SAFE_INTEGER, "style.created", true);
  const modified = numberValue(member(object, "modified_unix", "style"), 0, Number.MAX_SAFE_INTEGER, "style.modified", true);
  if (builtin && (created !== 0 || modified !== 0)) fail("style.builtin_time");
  const rawVersion = member(object, "version", "style");
  if (typeof rawVersion === "number" && rawVersion > DECK_STYLE_VERSION) {
    failCode("deck_style.schema_newer");
  }
  const version = numberValue(rawVersion, 1, 1, "style.version", true);
  if (version !== DECK_STYLE_VERSION) fail("style.version");
  return {
    id,
    builtin,
    name_key: nameKey,
    name,
    description_key: descriptionKey,
    theme: themeValue,
    density,
    guidance: guidance(member(object, "guidance", "style"), "style.guidance"),
    created_unix: created,
    modified_unix: modified,
    version,
  };
}

/** Validate a stored catalog (user styles only). */
export function validateDeckStyleCatalog(input: unknown): DeckStyleCatalog {
  scan(input);
  if (utf8Length(input) > MAX_DECK_STYLE_CATALOG_BYTES) failCode("deck_style.too_large");
  const object = record(input, CATALOG_KEYS, "catalog");
  const rawSchema = member(object, "schema_version", "catalog");
  if (typeof rawSchema === "number" && rawSchema > DECK_STYLE_SCHEMA_VERSION) {
    failCode("deck_style.schema_newer");
  }
  const schema = numberValue(rawSchema, 1, 1, "catalog.schema_version", true);
  if (schema !== DECK_STYLE_SCHEMA_VERSION) failCode("deck_style.schema_newer");
  const stylesValue = member(object, "styles", "catalog");
  if (!Array.isArray(stylesValue) || stylesValue.length > MAX_USER_DECK_STYLES) failCode("deck_style.too_large");
  const styles = stylesValue.map(validateDeckStyle);
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const style of styles) {
    if (style.builtin || isBuiltinDeckStyleId(style.id)) fail("catalog.builtin");
    if (ids.has(style.id)) fail("catalog.id");
    ids.add(style.id);
    const key = style.name?.toLocaleLowerCase("en-US") ?? "";
    if (names.has(key)) fail("catalog.name");
    names.add(key);
  }
  const revision = numberValue(member(object, "revision", "catalog"), 0, Number.MAX_SAFE_INTEGER, "catalog.revision", true);
  return { schema_version: DECK_STYLE_SCHEMA_VERSION, styles, revision };
}

/** UI guard before Remove. Native repeats the same check authoritatively. */
export function assertRemovableDeckStyle(catalog: DeckStyleCatalog, id: string): DeckStyle {
  if (!isDeckStyleUuid(id)) fail("style.id");
  const style = catalog.styles.find((item) => item.id === id);
  if (!style || style.builtin) fail("style.builtin_remove");
  return style;
}

export function deckStyleNameCollision(
  catalog: DeckStyleCatalog,
  name: string,
  exceptId?: string,
): boolean {
  const key = name.toLocaleLowerCase("en-US");
  return catalog.styles.some(
    (style) => style.id !== exceptId && (style.name ?? "").toLocaleLowerCase("en-US") === key,
  );
}

/** The 65th user style is refused, as is a case-folded duplicate name.
 * Call before a save so the catalog and its revision stay unchanged. */
export function validateStyleAddition(catalog: DeckStyleCatalog, style: DeckStyle): void {
  if (style.builtin || isBuiltinDeckStyleId(style.id)) fail("style.builtin_save");
  if (catalog.styles.length >= MAX_USER_DECK_STYLES) failCode("deck_style.too_large");
  if (deckStyleNameCollision(catalog, style.name ?? "")) fail("catalog.name_collision");
  if (utf8Length(style) > MAX_DECK_STYLE_BYTES) failCode("deck_style.too_large");
  if (utf8Length({ schema_version: 1, styles: [...catalog.styles, style], revision: catalog.revision }) > MAX_DECK_STYLE_CATALOG_BYTES) {
    failCode("deck_style.too_large");
  }
}

export function deckStyleByteLength(style: DeckStyle): number {
  return utf8Length(style);
}
