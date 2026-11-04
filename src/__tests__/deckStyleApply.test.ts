import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OfficeController } from "../office/OfficeController";
import { BUILTIN_DECK_STYLES } from "../office/deck/styles/builtins";
import { applyDeckStyle, prepareDeckStyle } from "../office/deck/styles/styleApplication";
import { scaleDeckThemeForSize } from "../office/deck/styles/stylePreview";
import type { DeckStylePreview } from "../office/deck/styles/styleTypes";
import { applyDeckTheme } from "../office/deck/deckThemes";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../office/deck/deckThemes", () => ({ applyDeckTheme: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const applyMock = vi.mocked(applyDeckTheme);
const style = BUILTIN_DECK_STYLES[0];
const slideId = "220b0001-0002-4000-8000-0000000000aa";

function preview(overrides: Partial<DeckStylePreview> = {}): DeckStylePreview {
  return {
    id: "220b0001-0009-4000-8000-000000000001",
    style_id: style.id,
    theme: structuredClone(style.theme),
    expected_revision: 5,
    slide_ids: null,
    warnings: [],
    expires_unix: Math.floor(Date.now() / 1000) + 200,
    ...overrides,
  };
}

function controller(): OfficeController {
  return {
    session_id: "220b0001-000a-4000-8000-000000000001",
    family: "deck",
    getState: () => ({
      session_id: "220b0001-000a-4000-8000-000000000001",
      document_id: "220b0001-000b-4000-8000-000000000001",
      family: "deck",
      format: "pptx",
      revision: 5,
      saved_revision: 4,
      content_id: "220b0001-000c-4000-8000-000000000001",
      saved_content_id: "220b0001-000c-4000-8000-000000000001",
      ready: true,
      mode: "editing",
      dirty: true,
      can_undo: true,
      can_redo: false,
      capabilities: ["deck_themes", "deck_slides"],
      selection: null,
      compatibility: { format: "pptx", entries: [], next_cursor: null, can_preserve_unknown: true, blocks_save: false },
      page_count: 0,
      sheet_count: 0,
      slide_count: 3,
      busy: false,
      status_key: null,
    }),
    subscribe: () => () => undefined,
    transact: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    capture: vi.fn(),
    close: vi.fn(),
  } as unknown as OfficeController;
}

beforeEach(() => {
  invokeMock.mockReset();
  applyMock.mockReset();
});

describe("style application", () => {
  it("scales 720x405 geometry to 1440x810 exactly", () => {
    const scaled = scaleDeckThemeForSize(style.theme, 1440, 810);
    const title = scaled.layouts[1].placeholders[0];
    const body = scaled.layouts[1].placeholders[1];
    expect(title.rect.x_pt).toBe(72);
    expect(body.text.size_pt).toBe(36);
    expect(scaled.slide_width_pt).toBe(1440);
    expect(scaled.slide_height_pt).toBe(810);
  });

  it("preserves 4:3 dimensions instead of changing the aspect ratio", () => {
    const scaled = scaleDeckThemeForSize(style.theme, 960, 720);
    expect(scaled.slide_width_pt).toBe(960);
    expect(scaled.slide_height_pt).toBe(720);
    for (const layout of scaled.layouts) {
      for (const placeholder of layout.placeholders) {
        expect(placeholder.rect.x_pt + placeholder.rect.width_pt).toBeLessThanOrEqual(960);
        expect(placeholder.rect.y_pt + placeholder.rect.height_pt).toBeLessThanOrEqual(720);
      }
    }
  });

  it("cancels overflow without editing the document", async () => {
    const host = controller();
    const overflow = preview({
      warnings: [
        {
          id: "220b0001-0009-4000-8000-000000000002",
          kind: "overflow",
          slide_id: slideId,
          shape_id: "220b0001-0009-4000-8000-000000000003",
        },
      ],
    });
    await expect(applyDeckStyle(host, overflow)).rejects.toMatchObject({ code: "deck_style.unsupported" });
    expect(invokeMock).not.toHaveBeenCalled();
    expect(applyMock).not.toHaveBeenCalled();
  });

  it("fails when the source revision changed after preview", async () => {
    const host = controller();
    invokeMock.mockRejectedValueOnce("deck_style.changed");
    await expect(applyDeckStyle(host, preview())).rejects.toBe("deck_style.changed");
    expect(applyMock).not.toHaveBeenCalled();
  });

  it("applies one theme transaction with its captured scope", async () => {
    const host = controller();
    const ready = preview({ slide_ids: [slideId] });
    invokeMock.mockResolvedValueOnce(ready).mockResolvedValueOnce(ready);
    const result = {
      transaction_id: "220b0001-0009-4000-8000-000000000004",
      state: host.getState(),
      changed: true,
      affected_ids: [slideId],
      warnings: [],
    };
    applyMock.mockResolvedValueOnce(result);

    const prepared = await prepareDeckStyle(host, style, [slideId]);
    const applied = await applyDeckStyle(host, prepared);

    expect(invokeMock).toHaveBeenNthCalledWith(1, "deck_style_prepare", {
      request: {
        session_id: host.session_id,
        style,
        slide_ids: [slideId],
      },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "deck_style_apply", {
      previewId: prepared.id,
      acknowledgedWarningIds: [],
    });
    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(applyMock).toHaveBeenCalledWith(host, prepared.theme, [slideId]);
    expect(applied).toBe(result);
    // No second operation rewrites notes, animations or unmatched objects.
    expect((host.transact as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});
