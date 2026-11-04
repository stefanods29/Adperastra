import { describe, expect, it } from "vitest";
import { BUILTIN_DECK_STYLES } from "../office/deck/styles/builtins";
import {
  deckStyleByteLength,
  validateDeckStyle,
  validateDeckStyleCatalog,
  validateStyleAddition,
} from "../office/deck/styles/styleValidation";
import {
  DeckStyleError,
  MAX_USER_DECK_STYLES,
  type DeckStyle,
  type DeckStyleCatalog,
} from "../office/deck/styles/styleTypes";

function userStyle(index: number): DeckStyle {
  const base = structuredClone(BUILTIN_DECK_STYLES[0]) as DeckStyle;
  const hex = index.toString(16).padStart(12, "0");
  const id = `220b0100-0000-4000-8000-${hex}`;
  base.id = id;
  base.theme.id = id;
  base.builtin = false;
  base.name_key = null;
  base.name = `User style ${index}`;
  base.description_key = null;
  base.created_unix = 1_700_000_000;
  base.modified_unix = 1_700_000_001;
  return base;
}

function errorCode(run: () => unknown): string {
  try {
    run();
    return "";
  } catch (error) {
    return error instanceof DeckStyleError ? error.code : `unexpected:${String(error)}`;
  }
}

describe("validateDeckStyle", () => {
  it("accepts all eight built-ins with 64 unique layout UUIDs", () => {
    const layouts = new Set<string>();
    const placeholders = new Set<string>();
    for (const style of BUILTIN_DECK_STYLES) {
      expect(validateDeckStyle(style)).toEqual(style);
      expect(style.builtin).toBe(true);
      expect(style.theme.layouts).toHaveLength(8);
      expect(style.theme.default_layout_id).toBe(style.theme.layouts[1].id);
      for (const layout of style.theme.layouts) {
        expect(layout.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4000-8000-[0-9a-f]{12}$/);
        expect(layouts.has(layout.id)).toBe(false);
        layouts.add(layout.id);
        for (const placeholder of layout.placeholders) {
          expect(placeholders.has(placeholder.id)).toBe(false);
          placeholders.add(placeholder.id);
        }
      }
    }
    expect(layouts.size).toBe(64);
  });

  it("refuses unknown keys, class instances, functions and URLs", () => {
    const style = userStyle(1);
    expect(errorCode(() => validateDeckStyle({ ...style, extra: true }))).toBe("deck_style.invalid");
    expect(errorCode(() => validateDeckStyle(new (class Fake {})()))).toBe("deck_style.invalid");
    expect(errorCode(() => validateDeckStyle({ ...style, name: () => "bad" }))).toBe("deck_style.invalid");
    expect(errorCode(() => validateDeckStyle({ ...style, name: "https://example.com/x" }))).toBe(
      "deck_style.invalid",
    );
    expect(errorCode(() => validateDeckStyle({ ...style, name: "a<script>alert(1)</script>" }))).toBe(
      "deck_style.invalid",
    );
    expect(errorCode(() => validateDeckStyle({ ...style, ["__proto__"]: { polluted: true } }))).toBe(
      "deck_style.invalid",
    );
  });

  it("retains a newer schema without downgrading or changing the input", () => {
    const newer = { ...userStyle(2), schema_version: 2 };
    const before = JSON.stringify(newer);
    expect(errorCode(() => validateDeckStyle(newer))).toBe("deck_style.schema_newer");
    expect(JSON.stringify(newer)).toBe(before);
    expect((newer as { schema_version: number }).schema_version).toBe(2);
  });

  it("refuses the 65th user style and a case-folded duplicate name", () => {
    const styles = Array.from({ length: MAX_USER_DECK_STYLES }, (_, index) => userStyle(index + 1));
    const catalog: DeckStyleCatalog = { schema_version: 1, styles, revision: 7 };
    expect(validateDeckStyleCatalog(catalog).styles).toHaveLength(MAX_USER_DECK_STYLES);
    const extra = userStyle(99);
    expect(errorCode(() => validateStyleAddition(catalog, extra))).toBe("deck_style.too_large");

    const small: DeckStyleCatalog = { schema_version: 1, styles: [userStyle(100)], revision: 1 };
    const duplicateName = userStyle(101);
    duplicateName.name = "user STYLE 100";
    expect(errorCode(() => validateStyleAddition(small, duplicateName))).toBe("deck_style.invalid");
  });

  it("never serializes template text, notes, images or active content", () => {
    const style = userStyle(3);
    const serialized = JSON.stringify(style);
    for (const word of ["notes", "images", "scripts", "macros", "relationships"]) {
      expect(serialized.includes(`"${word}"`)).toBe(false);
    }
    expect(deckStyleByteLength(style)).toBeLessThanOrEqual(64 * 1024);
    expect(errorCode(() => validateDeckStyle({ ...style, notes: "template words" }))).toBe(
      "deck_style.invalid",
    );
  });
});
