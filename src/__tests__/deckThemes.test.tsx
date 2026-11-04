import { readFileSync } from "node:fs";
import { repoUrl } from "./nodeUrl";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { OfficeController } from "../office/OfficeController";
import { applyDeckTheme, detectLayoutOverflow, validateDeckTheme } from "../office/deck/deckThemes";
import { isDeckTemplateInput } from "../office/deck/deckThemeImport";
import type { DeckLayout, DeckTheme } from "../office/types";

vi.mock("../services/officeDeck", () => ({
  inspectDeckTemplate: vi.fn(),
  importDeckTheme: vi.fn(),
}));

const color = (r: number) => ({ r, g: r, b: r, a: 255 });
const layout = (id: string, x = 36): DeckLayout => ({
  id, name: `Layout ${id}`, kind: "title_body",
  placeholders: [{
    id: `${id}-placeholder`, role: "body",
    rect: { x_pt: x, y_pt: 72, width_pt: 288, height_pt: 144, rotation_deg: 0 },
    text: {
      font: { family: "Noto Sans", source: "installed", embeddable: false }, size_pt: 18,
      bold: false, italic: false, strike: false, underline: "none", script: "normal",
      foreground: color(0), highlight: null, language: "en-US",
    },
    paragraph: {
      align: "left", direction: "ltr", indent_left_pt: 0, indent_right_pt: 0, first_line_pt: 0,
      line_spacing: 1, before_pt: 0, after_pt: 0, list: "none", outline_level: 0,
    },
  }],
});

function theme(overrides: Partial<DeckTheme> = {}): DeckTheme {
  return {
    id: "00000000-0000-4000-8000-0000000000ee",
    name: "Deck theme",
    slide_width_pt: 720, slide_height_pt: 405,
    colors: { background: color(255), text: color(0), muted: color(100), accent: color(196), accent2: color(67), surface: color(245) },
    heading_font: { family: "Noto Sans", source: "installed", embeddable: false },
    body_font: { family: "Noto Sans", source: "installed", embeddable: false },
    layouts: [layout("00000000-0000-4000-8000-0000000000a1")],
    default_layout_id: "00000000-0000-4000-8000-0000000000a1",
    density: "comfortable", version: 1,
    ...overrides,
  };
}

function controller() {
  const state = {
    session_id: "00000000-0000-4000-8000-000000000001",
    document_id: "00000000-0000-4000-8000-0000000000aa",
    family: "deck", format: "pptx", revision: 3, saved_revision: 1,
    content_id: "c", saved_content_id: "d", ready: true, mode: "editing", dirty: true,
    can_undo: true, can_redo: false, capabilities: ["deck_themes"], selection: null,
    compatibility: { format: "pptx", entries: [], next_cursor: null, can_preserve_unknown: true, blocks_save: false },
    page_count: 0, sheet_count: 0, slide_count: 3, busy: false, status_key: null,
  };
  const transact = vi.fn(async (transaction: { transaction_id: string; operations: unknown[] }) => ({
    transaction_id: transaction.transaction_id, state: { ...state, revision: 4 }, changed: true,
    affected_ids: [], warnings: [],
  }));
  return { controller: { getState: () => state, transact } as unknown as OfficeController, transact };
}

describe("deck themes", () => {
  it("a theme change is one transaction and one Undo", async () => {
    const f = controller();
    await applyDeckTheme(f.controller, theme(), ["00000000-0000-4000-8000-000000000002"]);
    expect(f.transact).toHaveBeenCalledTimes(1);
    expect(f.transact.mock.calls[0][0].operations).toHaveLength(1);
  });

  it("manual formatting is retained and unmatched shapes are not deleted", async () => {
    const f = controller();
    await applyDeckTheme(f.controller, theme(), null);
    const operation = f.transact.mock.calls[0][0].operations[0] as { operation: Record<string, unknown> };
    expect(operation.operation).toMatchObject({ kind: "apply_theme", preserve_manual_formatting: true });
    expect(JSON.stringify(operation)).not.toContain("delete_shapes");
  });

  it("layout overflow cancels before any change", async () => {
    const f = controller();
    const overflowing = theme({
      layouts: [layout("00000000-0000-4000-8000-0000000000a2", 700)],
      default_layout_id: "00000000-0000-4000-8000-0000000000a2",
    });
    expect(detectLayoutOverflow(overflowing)).toContain("00000000-0000-4000-8000-0000000000a2-placeholder");
    await expect(applyDeckTheme(f.controller, overflowing, null)).rejects.toThrow("deck.overflow");
    expect(f.transact).not.toHaveBeenCalled();
  });

  it("duplicate layout UUIDs are refused", () => {
    const duplicate = theme({ layouts: [layout("00000000-0000-4000-8000-0000000000a1"), layout("00000000-0000-4000-8000-0000000000a1", 100)] });
    expect(validateDeckTheme(duplicate)).toBe(false);
  });

  it("external template media and remote paths are refused", () => {
    expect(isDeckTemplateInput({ kind: "file", path: "https://example.com/theme.pptx" } as never)).toBe(false);
    expect(isDeckTemplateInput({ kind: "file", path: "C:\\decks\\theme.pptx.exe" } as never)).toBe(false);
    expect(isDeckTemplateInput({ kind: "file", path: "C:\\decks\\theme.potx" } as never)).toBe(true);
  });

  it("22b can import the public entry without private locals", () => {
    const source = readFileSync(fileURLToPath(repoUrl("../office/deck/deckThemes.ts", import.meta.url)), "utf8");
    expect(source).toContain("export async function applyDeckTheme");
    expect(source).not.toMatch(/from ".*styles\//);
    expect(source).not.toMatch(/private|catalog\.json/);
  });
});