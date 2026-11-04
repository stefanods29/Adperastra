import { describe, expect, it } from "vitest";
import {
  BUILTIN_DECK_STYLES,
  builtinDeckStyle,
  builtinDeckStyleBySuffix,
} from "../office/deck/styles/builtins";
import { contrastRatio, hexToOfficeColor } from "../office/deck/styles/stylePalettes";
import { deckStyleByteLength, validateDeckStyle } from "../office/deck/styles/styleValidation";
import { deckStyleGuidanceStatus } from "../office/deck/styles/styleTypes";

describe("built-in deck styles", () => {
  it("keeps the exact business title layout and placeholder IDs", () => {
    const business = builtinDeckStyleBySuffix("business");
    const title = business.theme.layouts[0];
    expect(title.kind).toBe("title");
    expect(title.id).toBe("220b0001-0001-4000-8000-000000000000");
    expect(title.placeholders[0].id).toBe("220b0001-0001-4000-8000-000000000001");
    expect(title.placeholders[1].id).toBe("220b0001-0001-4000-8000-000000000002");
    expect(title.placeholders[2].id).toBe("220b0001-0001-4000-8000-000000000003");
    expect(business.theme.default_layout_id).toBe("220b0001-0002-4000-8000-000000000000");
  });

  it("uses the exact two-column rectangles", () => {
    for (const style of BUILTIN_DECK_STYLES) {
      const layout = style.theme.layouts[2];
      expect(layout.kind).toBe("two_column");
      expect(layout.placeholders.map((item) => item.role)).toEqual([
        "title",
        "body_left",
        "body_right",
        "footer",
      ]);
      expect(layout.placeholders[1].rect).toMatchObject({ x_pt: 36, width_pt: 312 });
      expect(layout.placeholders[2].rect).toMatchObject({ x_pt: 372, width_pt: 312 });
    }
  });

  it("keeps every rectangle inside the 720x405 point slide", () => {
    for (const style of BUILTIN_DECK_STYLES) {
      for (const layout of style.theme.layouts) {
        for (const placeholder of layout.placeholders) {
          const rect = placeholder.rect;
          expect(rect.x_pt).toBeGreaterThanOrEqual(0);
          expect(rect.y_pt).toBeGreaterThanOrEqual(0);
          expect(rect.x_pt + rect.width_pt).toBeLessThanOrEqual(720);
          expect(rect.y_pt + rect.height_pt).toBeLessThanOrEqual(405);
          expect(rect.rotation_deg).toBe(0);
        }
      }
    }
  });

  it("keeps the blank layout truly empty and the technical background dark", () => {
    for (const style of BUILTIN_DECK_STYLES) {
      const blank = style.theme.layouts[7];
      expect(blank.kind).toBe("blank");
      expect(blank.placeholders).toHaveLength(0);
    }
    expect(builtinDeckStyleBySuffix("technical").theme.colors.background).toEqual({
      r: 16,
      g: 24,
      b: 32,
      a: 255,
    });
    expect(hexToOfficeColor("#101820")).toMatchObject({ r: 16, g: 24, b: 32, a: 255 });
  });

  it("keeps body and muted text at 4.5 contrast or better", () => {
    for (const style of BUILTIN_DECK_STYLES) {
      const background = style.theme.colors.background;
      expect(contrastRatio(style.theme.colors.text, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(style.theme.colors.muted, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("reports guidance overruns without rewriting text", () => {
    const minimal = builtinDeckStyleBySuffix("minimal");
    const bullets = ["one", "two", "three", "four", "five", "six"];
    const before = JSON.stringify(bullets);
    const status = deckStyleGuidanceStatus(minimal, bullets.length, [30, 11]);
    expect(status.over_bullets).toBe(true);
    expect(status.over_words).toBe(true);
    expect(JSON.stringify(bullets)).toBe(before);
    expect(validateDeckStyle(minimal)).toEqual(minimal);
    expect(deckStyleByteLength(minimal)).toBeLessThanOrEqual(64 * 1024);
  });

  it("is deep-frozen application data with eight unique IDs", () => {
    expect(BUILTIN_DECK_STYLES).toHaveLength(8);
    expect(new Set(BUILTIN_DECK_STYLES.map((style) => style.id)).size).toBe(8);
    expect(Object.isFrozen(BUILTIN_DECK_STYLES)).toBe(true);
    expect(Object.isFrozen(BUILTIN_DECK_STYLES[0].theme.layouts)).toBe(true);
    expect(Object.isFrozen(BUILTIN_DECK_STYLES[0].theme.layouts[0].placeholders[0].rect)).toBe(true);
    expect(builtinDeckStyle("220b0001-0000-4000-8000-000000000000")).toBe(BUILTIN_DECK_STYLES[0]);
    expect(builtinDeckStyle("00000000-0000-4000-8000-000000000000")).toBeUndefined();
  });
});
