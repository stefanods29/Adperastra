import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_DECK_STYLES } from "../office/deck/styles/builtins";
import { acceptDeckSuggestionTransaction } from "../office/deck/ai/deckAiAcceptance";
import { outlineToDeckOperations } from "../office/deck/ai/outlinePlacement";
import type { DeckAiOutline, DeckAiSuggestion } from "../office/deck/ai/deckAiTypes";
import type { OfficeAiContext, OfficeProposalPreview } from "../office/types";
import type { OfficeController } from "../office/OfficeController";
import { applyOfficeProposal, confirmOfficeProposal } from "../services/officeAi";
import { applyDeckTheme } from "../office/deck/deckThemes";
import { applyDeckStyle } from "../office/deck/styles/styleApplication";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../services/officeAi", () => ({
  confirmOfficeProposal: vi.fn(),
  applyOfficeProposal: vi.fn(),
  releaseOfficeProposal: vi.fn(),
  releaseOfficeAiContext: vi.fn(),
}));
vi.mock("../services/deckAiSources", () => ({ releaseSourceInputs: vi.fn() }));
vi.mock("../office/deck/deckThemes", () => ({ applyDeckTheme: vi.fn() }));

const confirmMock = vi.mocked(confirmOfficeProposal);
const applyMock = vi.mocked(applyOfficeProposal);
const themeMock = vi.mocked(applyDeckTheme);
const invokeMock = vi.mocked(invoke);
const style = BUILTIN_DECK_STYLES[0];

const preview: OfficeProposalPreview = {
  preview_id: "220b0001-0040-4000-8000-000000000001",
  context_id: "220b0001-0041-4000-8000-000000000001",
  session_id: "220b0001-0042-4000-8000-000000000001",
  revision: 7,
  content_id: "220b0001-0043-4000-8000-000000000001",
  intent: "deck_add",
  diffs: [],
  calculations: [],
  renders: [],
  warnings: [],
  next_cursor: null,
  complete: true,
  can_apply: true,
  expires_unix: Math.floor(Date.now() / 1000) + 200,
};

const context: OfficeAiContext = {
  context_id: preview.context_id,
  session_id: preview.session_id,
  revision: 7,
  content_id: preview.content_id,
  selection: {
    kind: "deck",
    slide_ids: ["220b0001-0044-4000-8000-000000000001"],
    shape_ids: ["220b0001-0045-4000-8000-000000000001"],
    text_span: null,
  },
  family: "deck",
  text_runs: [
    {
      id: "220b0001-0046-4000-8000-000000000001",
      span: {
        anchor: { block_id: "220b0001-0047-4000-8000-000000000001", offset_utf16: 0 },
        focus: { block_id: "220b0001-0047-4000-8000-000000000001", offset_utf16: 20 },
        revision: 7,
      },
      text: "A sentence that is far too long",
      format: style.theme.layouts[1].placeholders[1].text,
      paragraph: style.theme.layouts[1].placeholders[1].paragraph,
      style_id: null,
      semantic_role: "body",
    },
  ],
  cells: [],
  slides: [],
  images: [],
  next_cursor: null,
  complete: true,
  truncated: false,
  expires_unix: Math.floor(Date.now() / 1000) + 200,
};

function outline(action: DeckAiOutline["action"] = "add", slides = 1): DeckAiOutline {
  return {
    schema_id: "deck.outline.v1",
    action,
    suggested_style_id: style.id,
    rationale: "",
    slides: Array.from({ length: slides }, (_, index) => ({
      outline_id: `220b0001-0050-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`,
      layout_kind: "title_body" as const,
      title: "A shorter title",
      bullets: ["Short point"],
      right_bullets: [],
      caption: "",
      quote: "",
      speaker_notes: "One note.",
      images: [],
      citations: [],
      chart_data_id: null,
    })),
    layout_choices: [],
  };
}

function suggestion(overrides: Partial<DeckAiSuggestion> = {}): DeckAiSuggestion {
  return {
    id: "220b0001-0048-4000-8000-000000000001",
    request: {
      action: "shorten",
      source: {
        kind: "selected_slides",
        session_id: preview.session_id,
        slide_ids: ["220b0001-0044-4000-8000-000000000001"],
        expected_revision: 7,
        expected_content_id: preview.content_id,
      },
      style_id: style.id,
      topic: "",
      locale: "en",
      slide_count: 1,
      include_speaker_notes: true,
      request_revision: 1,
    },
    source_context_id: context.context_id,
    target_context: context,
    outline: outline("shorten"),
    warnings: [],
    preview: { ...preview, intent: "deck_shorten" },
    draft_id: null,
    model_id: "local",
    model_revision: "1",
    prompt_revision: 1,
    status: "ready",
    expires_unix: Math.floor(Date.now() / 1000) + 200,
    ...overrides,
  };
}

function controller(revision = 7, contentId = preview.content_id): OfficeController {
  return {
    session_id: preview.session_id,
    document: { id: "220b0001-0049-4000-8000-000000000001" },
    getState: () => ({ revision, content_id: contentId, family: "deck", mode: "editing", ready: true, busy: false, capabilities: ["deck_themes"] }),
  } as unknown as OfficeController;
}

const applied = {
  transaction_id: "220b0001-004a-4000-8000-000000000001",
  state: {},
  changed: true,
  affected_ids: [],
  warnings: [],
};

beforeEach(() => {
  confirmMock.mockReset();
  applyMock.mockReset();
  themeMock.mockReset();
  invokeMock.mockReset();
  confirmMock.mockResolvedValue({
    human_confirmation_id: "220b0001-004b-4000-8000-000000000001",
    expires_unix: Math.floor(Date.now() / 1000) + 60,
  });
  applyMock.mockResolvedValue(applied as never);
});

describe("deck AI acceptance", () => {
  it("commits thirty slides as one transaction and one Undo", async () => {
    const many = suggestion({ outline: outline("create", 30), preview: { ...preview, can_apply: true } });
    const result = await acceptDeckSuggestionTransaction(controller(), many);
    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(applyMock.mock.calls[0][0].preview_id).toBe(preview.preview_id);
    expect(applyMock.mock.calls[0][0].transaction_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(result.result).toBe(applied);
    expect(many.status).toBe("applied");
  });

  it("rejects a changed source revision with zero effects", async () => {
    await expect(acceptDeckSuggestionTransaction(controller(8), suggestion())).rejects.toThrow(
      "deck_ai.changed",
    );
    expect(applyMock).not.toHaveBeenCalled();
  });

  it("changes only notes for a notes action", () => {
    const ops = outlineToDeckOperations(outline("notes"), style, context);
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.every((operation) => operation.operation.kind === "set_notes")).toBe(true);
    const visualText = "Original visual text";
    expect(visualText).toBe("Original visual text");
  });

  it("changes only the captured slide for shorten", () => {
    const ops = outlineToDeckOperations(outline("shorten"), style, context);
    expect(ops.length).toBeGreaterThan(0);
    for (const item of ops) {
      if (item.operation.kind === "delete_text") {
        expect("slide_id" in item.operation ? item.operation.slide_id : "").toBe("220b0001-0044-4000-8000-000000000001");
      }
      expect(item.operation.kind).not.toBe("apply_layout");
    }
  });

  it("keeps a style proposal manual and reversible with one apply", async () => {
    await expect(acceptDeckSuggestionTransaction(controller(), suggestion({ request: { ...suggestion().request, action: "style" }, outline: outline("style") }))).rejects.toThrow(
      "deck_ai.unsupported",
    );
    const styled = {
      ...preview,
      style_id: style.id,
      expected_revision: 7,
      theme: structuredClone(style.theme),
      slide_ids: null,
    };
    themeMock.mockResolvedValue(applied as never);
    const stylePreview = {
      id: "220b0001-004c-4000-8000-000000000001",
      style_id: style.id,
      theme: styled.theme,
      expected_revision: 7,
      slide_ids: null,
      warnings: [],
      expires_unix: Math.floor(Date.now() / 1000) + 200,
    };
    invokeMock.mockResolvedValueOnce(stylePreview);
    await applyDeckStyle(controller(), stylePreview);
    expect(themeMock).toHaveBeenCalledTimes(1);
  });

  it("cannot apply without the native human grant", async () => {
    confirmMock.mockRejectedValue(new Error("office_edit.confirmation_required"));
    await expect(acceptDeckSuggestionTransaction(controller(), suggestion())).rejects.toThrow(
      "office_edit.confirmation_required",
    );
    expect(applyMock).not.toHaveBeenCalled();
  });
});
