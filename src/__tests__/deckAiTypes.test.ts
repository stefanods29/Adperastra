import { describe, expect, it } from "vitest";
import {
  DECK_AI_SCHEMA_ID,
  type DeckAiSlide,
} from "../office/deck/ai/deckAiTypes";
import { validateDeckAiOutline } from "../office/deck/ai/deckAiValidation";
import {
  deckAiActionEnabled,
  defaultDeckAiSettings,
  normalizeDeckAiSettings,
} from "../services/deckAiSettings";

const style = "220b0001-0000-4000-8000-000000000000";

function slide(index: number): DeckAiSlide {
  return {
    outline_id: `220b0001-0001-4000-8000-${index.toString(16).padStart(12, "0")}`,
    layout_kind: "title_body",
    title: "A clear next step",
    bullets: ["Check the source", "Choose one owner"],
    right_bullets: [],
    caption: "",
    quote: "",
    speaker_notes: "Ask for one decision.",
    images: [],
    citations: [],
    chart_data_id: null,
  };
}

function outline(count: number) {
  return {
    schema_id: DECK_AI_SCHEMA_ID,
    action: "create",
    suggested_style_id: style,
    rationale: "A short outline.",
    slides: Array.from({ length: count }, (_, index) => slide(index + 1)),
    layout_choices: [],
  };
}

function errorOf(run: () => unknown): string {
  try {
    run();
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "unknown";
  }
}

describe("deck AI contracts", () => {
  it("defaults to off with no experimental actions", () => {
    const settings = defaultDeckAiSettings();
    expect(settings.enabled).toBe(false);
    expect(settings.experimental_actions).toEqual([]);
    expect(deckAiActionEnabled(settings, "create")).toBe(false);
    expect(normalizeDeckAiSettings({ enabled: "yes", experimental_actions: ["create", "create", "delete"] })).toEqual({
      enabled: false,
      experimental_actions: ["create"],
    });
  });

  it("refuses model geometry and XML", () => {
    const withGeometry = outline(1);
    (withGeometry.slides[0] as unknown as Record<string, unknown>).x = 36;
    expect(errorOf(() => validateDeckAiOutline(withGeometry))).toBe("deck_ai.invalid");

    const withXml = outline(1);
    (withXml.slides[0] as unknown as Record<string, unknown>).xml = "<p:sp/>";
    expect(errorOf(() => validateDeckAiOutline(withXml))).toBe("deck_ai.invalid");

    const withFont = outline(1);
    (withFont.slides[0] as unknown as Record<string, unknown>).font = "Arial";
    expect(errorOf(() => validateDeckAiOutline(withFont))).toBe("deck_ai.invalid");
  });

  it("refuses more than thirty slides", () => {
    expect(errorOf(() => validateDeckAiOutline(outline(31)))).toBe("deck_ai.too_large");
    expect(validateDeckAiOutline(outline(30)).slides).toHaveLength(30);
  });

  it("accepts only a built-in style ID", () => {
    const unknown = outline(1);
    unknown.suggested_style_id = "220b00ff-0000-4000-8000-000000000000";
    expect(errorOf(() => validateDeckAiOutline(unknown))).toBe("deck_ai.invalid");

    const known = outline(1);
    known.suggested_style_id = "220b0008-0000-4000-8000-000000000000";
    expect(validateDeckAiOutline(known).suggested_style_id).toBe("220b0008-0000-4000-8000-000000000000");
  });

  it("refuses unknown fields and blank slide content", () => {
    const extra = outline(1) as unknown as Record<string, unknown>;
    extra.operations = [];
    expect(errorOf(() => validateDeckAiOutline(extra))).toBe("deck_ai.invalid");

    const blank = outline(1);
    blank.slides[0].layout_kind = "blank";
    expect(errorOf(() => validateDeckAiOutline(blank))).toBe("deck_ai.invalid");

    const cleanBlank = outline(1);
    cleanBlank.slides[0] = {
      ...slide(1),
      layout_kind: "blank",
      title: "",
      bullets: [],
      speaker_notes: "",
    };
    expect(validateDeckAiOutline(cleanBlank).slides[0].layout_kind).toBe("blank");
  });
});
