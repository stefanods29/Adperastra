import type { OfficeController } from "../OfficeController";
import type { DeckLayout, DeckTheme, OfficeColor, OfficeFont, OfficeRect, OfficeTransactionResult } from "../types";

/** One validated theme application (Step 22a T5 E6).
 *
 * This is the only entry point 22b may use for a manual style: geometry and
 * fonts are checked before the single `apply_theme` transaction, the
 * `preserve_manual_formatting` flag is fixed true, and the operation never
 * deletes a shape. Unmatched objects keep their manual position. Layout
 * overflow is reported before the transaction; the engine remains the final
 * authority for shapes this UI cannot inspect. */

const MAX_LAYOUTS = 32;
const MAX_COORD_PT = 14_400;

function colorValid(color: OfficeColor | null | undefined): boolean {
  if (!color) return false;
  return [color.r, color.g, color.b, color.a].every((value) =>
    Number.isInteger(value) && value >= 0 && value <= 255);
}

function fontValid(font: OfficeFont | undefined): boolean {
  return Boolean(font && font.family.length >= 1 && font.family.length <= 128 &&
    (font.source === "bundled" || font.source === "installed" || font.source === "document"));
}

function layoutRectValid(rect: OfficeRect): boolean {
  return [rect.x_pt, rect.y_pt, rect.width_pt, rect.height_pt, rect.rotation_deg]
    .every((value) => Number.isFinite(value)) &&
    Math.abs(rect.x_pt) <= MAX_COORD_PT && Math.abs(rect.y_pt) <= MAX_COORD_PT &&
    rect.width_pt > 0 && rect.height_pt > 0 &&
    rect.width_pt <= MAX_COORD_PT * 2 && rect.height_pt <= MAX_COORD_PT * 2;
}

function layoutValid(layout: DeckLayout): boolean {
  if (!layout.id || layout.name.length > 60) return false;
  if (!["title", "title_body", "two_column", "section", "image_caption", "chart", "quote", "blank"].includes(layout.kind)) return false;
  if (layout.placeholders.length > 16) return false;
  return layout.placeholders.every((placeholder) =>
    Boolean(placeholder.id) && layoutRectValid(placeholder.rect));
}

/** Full theme validation before any operation is sent. */
export function validateDeckTheme(theme: DeckTheme): boolean {
  if (!theme || !theme.id || theme.name.length > 60) return false;
  if (!(theme.slide_width_pt > 0) || !(theme.slide_height_pt > 0)) return false;
  if (theme.slide_width_pt > MAX_COORD_PT || theme.slide_height_pt > MAX_COORD_PT) return false;
  if (!theme.colors || !colorValid(theme.colors.background) || !colorValid(theme.colors.text) ||
      !colorValid(theme.colors.muted) || !colorValid(theme.colors.accent) ||
      !colorValid(theme.colors.accent2) || !colorValid(theme.colors.surface)) return false;
  if (!fontValid(theme.heading_font) || !fontValid(theme.body_font)) return false;
  if (!Array.isArray(theme.layouts) || theme.layouts.length < 1 || theme.layouts.length > MAX_LAYOUTS) return false;
  const ids = new Set(theme.layouts.map((layout) => layout.id));
  if (ids.size !== theme.layouts.length) return false;
  if (!ids.has(theme.default_layout_id)) return false;
  if (theme.density !== "comfortable" && theme.density !== "compact") return false;
  if (theme.version !== 1) return false;
  return theme.layouts.every(layoutValid);
}

/** Placeholder rectangles that would fall outside the slide. The UI shows
 * these for review and cancels before commit, never silently dropping a
 * shape that does not match a placeholder. */
export function detectLayoutOverflow(theme: DeckTheme): string[] {
  const overflow: string[] = [];
  for (const layout of theme.layouts) {
    for (const placeholder of layout.placeholders) {
      const rect = placeholder.rect;
      if (rect.x_pt < 0 || rect.y_pt < 0 ||
          rect.x_pt + rect.width_pt > theme.slide_width_pt + 0.001 ||
          rect.y_pt + rect.height_pt > theme.slide_height_pt + 0.001) {
        overflow.push(placeholder.id);
      }
    }
  }
  return overflow;
}

/** Apply one theme to all slides or the explicitly selected ones. */
export async function applyDeckTheme(
  controller: OfficeController,
  theme: DeckTheme,
  slideIds: readonly string[] | null,
): Promise<OfficeTransactionResult> {
  if (!validateDeckTheme(theme)) throw new Error("deck.invalid_theme");
  if (slideIds !== null && slideIds.length === 0) throw new Error("deck.invalid_selection");
  const overflow = detectLayoutOverflow(theme);
  if (overflow.length > 0) throw new Error("deck.overflow");
  const state = controller.getState();
  if (state.busy || !state.ready) throw new Error("office_edit.busy");
  return controller.transact({
    transaction_id: crypto.randomUUID(),
    expected_revision: state.revision,
    operations: [{
      family: "deck",
      operation: {
        kind: "apply_theme",
        theme,
        slide_ids: slideIds === null ? null : [...slideIds],
        preserve_manual_formatting: true,
      },
    }],
    selection_after: null,
    label_key: "office.transaction",
  });
}
