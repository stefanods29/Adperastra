import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_DECK_STYLES } from "../office/deck/styles/builtins";
import { canAcceptPreview } from "../office/deck/ai/deckAiLayoutValidation";
import { outlineToDeckOperations } from "../office/deck/ai/outlinePlacement";
import { buildDeckSuggestionPreview } from "../office/deck/ai/deckAiDraft";
import type { DeckAiSuggestion } from "../office/deck/ai/deckAiTypes";
import type { OfficeAiContext, OfficeProposalPreview } from "../office/types";
import { captureOfficeAiContext, evaluateOfficeProposal } from "../services/officeAi";
import { createOfficeDraft } from "../services/officeDrafts";

vi.mock("../services/officeAi", () => ({ captureOfficeAiContext: vi.fn(), evaluateOfficeProposal: vi.fn() }));
vi.mock("../services/officeDrafts", () => ({ createOfficeDraft: vi.fn() }));

const captureMock = vi.mocked(captureOfficeAiContext);
const evaluateMock = vi.mocked(evaluateOfficeProposal);
const draftMock = vi.mocked(createOfficeDraft);
const style = BUILTIN_DECK_STYLES[0];

const context: OfficeAiContext = {
  context_id: "220b0001-0030-4000-8000-000000000001",
  session_id: "220b0001-0031-4000-8000-000000000001",
  revision: 1,
  content_id: "220b0001-0032-4000-8000-000000000001",
  selection: {
    kind: "deck",
    slide_ids: ["220b0001-0033-4000-8000-000000000001"],
    shape_ids: [],
    text_span: null,
  },
  family: "deck",
  text_runs: [],
  cells: [],
  slides: [],
  images: [],
  next_cursor: null,
  complete: true,
  truncated: false,
  expires_unix: Math.floor(Date.now() / 1000) + 200,
};

const previewBase: OfficeProposalPreview = {
  preview_id: "220b0001-0034-4000-8000-000000000001",
  context_id: context.context_id,
  session_id: context.session_id,
  revision: 1,
  content_id: context.content_id,
  intent: "deck_create",
  diffs: [],
  calculations: [],
  renders: [],
  warnings: [],
  next_cursor: null,
  complete: true,
  can_apply: true,
  expires_unix: Math.floor(Date.now() / 1000) + 200,
};

const outline = (kind: "title_body" | "blank" = "title_body") => ({
  schema_id: "deck.outline.v1" as const,
  action: "create" as const,
  suggested_style_id: style.id,
  rationale: "",
  slides: [
    {
      outline_id: "220b0001-0035-4000-8000-000000000001",
      layout_kind: kind,
      title: kind === "blank" ? "" : "A clear goal",
      bullets: kind === "blank" ? [] : ["Find the right file"],
      right_bullets: [],
      caption: "",
      quote: "",
      speaker_notes: kind === "blank" ? "" : "One message.",
      images: [],
      citations: [],
      chart_data_id: null,
    },
  ],
  layout_choices: [],
});

function operations() {
  return outlineToDeckOperations(outline(), style, context);
}

function suggestion(): DeckAiSuggestion {
  return {
    id: "220b0001-0036-4000-8000-000000000001",
    request: {
      action: "create",
      source: { kind: "outline", text: "Goal: find the right file." },
      style_id: style.id,
      topic: "",
      locale: "en",
      slide_count: 1,
      include_speaker_notes: true,
      request_revision: 1,
    },
    source_context_id: null,
    target_context: null,
    outline: outline(),
    warnings: [],
    preview: null,
    draft_id: null,
    model_id: "local",
    model_revision: "1",
    prompt_revision: 1,
    status: "ready",
    expires_unix: Math.floor(Date.now() / 1000) + 200,
  };
}

beforeEach(() => {
  captureMock.mockReset();
  evaluateMock.mockReset();
  draftMock.mockReset();
});

describe("deck outline placement", () => {
  it("uses the real business title_body rectangles", () => {
    const ops = operations();
    const shapes = ops.filter((operation) => operation.operation.kind === "add_shape");
    const title = shapes
      .map((operation) => operation.operation)
      .find((operation) => operation.kind === "add_shape" && operation.shape.rect.y_pt === 24);
    expect(title && title.kind === "add_shape" ? title.shape.rect : null).toMatchObject({
      x_pt: 36,
      y_pt: 24,
      width_pt: 648,
      height_pt: 54,
    });
    const body = shapes
      .map((operation) => operation.operation)
      .find((operation) => operation.kind === "add_shape" && operation.shape.rect.y_pt === 96);
    expect(body && body.kind === "add_shape" ? body.shape.rect : null).toMatchObject({
      x_pt: 48,
      y_pt: 96,
      width_pt: 624,
      height_pt: 244,
    });
  });

  it("never draws a model image or chart as a full slide", () => {
    for (const operation of operations()) {
      if (operation.operation.kind === "add_shape") {
        expect(operation.operation.shape.kind).toBe("text");
      }
    }
    const kinds = new Set(operations().map((operation) => operation.operation.kind));
    expect([...kinds].sort()).toEqual(["add_shape", "add_slide_with_id", "set_notes"]);
  });

  it("blocks acceptance when the actual clone overflows", () => {
    expect(canAcceptPreview({ ...previewBase, can_apply: false })).toBe(false);
    expect(
      canAcceptPreview({
        ...previewBase,
        warnings: [
          {
            id: "220b0001-0037-4000-8000-000000000001",
            kind: "overflow",
            object_id: "220b0001-0038-4000-8000-000000000001",
            message_key: "officeDeck.overflow",
          },
        ],
      }),
    ).toBe(false);
  });

  it("keeps blank layouts empty with no hidden placeholders", () => {
    const ops = outlineToDeckOperations(outline("blank"), style, context);
    expect(ops).toHaveLength(1);
    expect(ops[0].operation.kind).toBe("add_slide_with_id");
  });

  it("creates an unsaved draft and never writes the source", async () => {
    const sourceBytes = "original source bytes";
    const save = vi.fn();
    const controller = {
      session_id: context.session_id,
      getState: () => ({
        revision: 1,
        content_id: context.content_id,
        family: "deck",
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const document = { id: "220b0001-0039-4000-8000-000000000001", save, release: vi.fn().mockResolvedValue(undefined) };
    draftMock.mockResolvedValue({
      id: "draft-1",
      cancel: vi.fn(),
      completion: Promise.resolve({
        document,
        controller,
        initial_slide_id: "220b0001-003a-4000-8000-000000000001",
      }),
    } as never);
    captureMock.mockResolvedValue({ id: "ctx", cancel: vi.fn(), completion: Promise.resolve(context) } as never);
    evaluateMock.mockResolvedValue({
      id: "eval-1",
      cancel: vi.fn(),
      completion: Promise.resolve(previewBase),
    } as never);

    const result = await buildDeckSuggestionPreview(suggestion(), null, outline());
    expect(draftMock).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(sourceBytes).toBe("original source bytes");
    expect(result.draft_id).toBe(document.id);
    expect(result.preview?.preview_id).toBe(previewBase.preview_id);
  });
});
