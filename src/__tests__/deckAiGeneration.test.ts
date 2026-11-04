import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantOutboundPreview } from "../assistant/types";
import { BUILTIN_DECK_STYLES } from "../office/deck/styles/builtins";
import type { DeckAiRequest } from "../office/deck/ai/deckAiTypes";
import type { AiTaskResult } from "../services/localAiTypes";
import {
  assistantDeckAiBackend,
  clearDeckAiRecordsForTest,
  generateDeckSuggestion,
  prepareDeckSuggestion,
} from "../services/deckAi";
import { captureDocumentSource } from "../services/deckAiSources";
import { acquireAiInput } from "../services/localAiArtifacts";

vi.mock("../services/localAiArtifacts", () => ({
  acquireAiInput: vi.fn(),
  releaseAiInput: vi.fn(),
}));

const acquireMock = vi.mocked(acquireAiInput);
const styleId = BUILTIN_DECK_STYLES[0].id;

function request(overrides: Partial<DeckAiRequest> = {}): DeckAiRequest {
  return {
    action: "create",
    source: { kind: "outline", text: "Goal: find one file. Plan: review it." },
    style_id: styleId,
    topic: "",
    locale: "en",
    slide_count: 1,
    include_speaker_notes: true,
    request_revision: 1,
    ...overrides,
  };
}

function outbound(requiresConsent: boolean): AssistantOutboundPreview {
  return {
    preview_id: "220b0001-0020-4000-8000-000000000001",
    backend: "api",
    provider_id: "meta",
    model_id: "meta-test",
    payload_sha256: null,
    sources: [],
    byte_len: 10,
    requires_consent: requiresConsent,
    expires_unix: Math.floor(Date.now() / 1000) + 120,
    includes_chat_history: false,
    local_server: false,
  };
}

function resultWith(citationId: string | null): AiTaskResult {
  return {
    job_id: "deckai-1",
    task: "structured_text",
    model_id: "local",
    model_revision: "1",
    result: {
      kind: "structured",
      schema_id: "deck.outline.v1",
      canonical_json: JSON.stringify({
        schema_id: "deck.outline.v1",
        action: "create",
        suggested_style_id: styleId,
        rationale: "A short outline.",
        slides: [
          {
            outline_id: "220b0001-0021-4000-8000-000000000001",
            layout_kind: "title_body",
            title: "Find one file",
            bullets: ["Review it"],
            right_bullets: [],
            caption: "",
            quote: "",
            speaker_notes: "",
            images: [],
            citations: citationId
              ? [
                  {
                    input_id: citationId,
                    revision: 1,
                    location: { kind: "text", start: 0, end: 4 },
                    quote: "Goal",
                  },
                ]
              : [],
            chart_data_id: null,
          },
        ],
        layout_choices: [],
      }),
    },
    citations: [],
    warnings: [],
  };
}

beforeEach(() => {
  clearDeckAiRecordsForTest();
  acquireMock.mockReset();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deck AI generation", () => {
  it("sends zero API requests without an explicit consent", async () => {
    vi.spyOn(assistantDeckAiBackend, "prepare").mockResolvedValue(outbound(true));
    const start = vi.spyOn(assistantDeckAiBackend, "start");
    const prepared = await prepareDeckSuggestion(null, request());
    await expect(generateDeckSuggestion(prepared.id, null)).rejects.toThrow("deck_ai.invalid");
    expect(start).not.toHaveBeenCalled();
  });

  it("never sends sensitive content to an API", async () => {
    vi.spyOn(assistantDeckAiBackend, "prepare").mockRejectedValue(new Error("assistant.sensitive_api"));
    const start = vi.spyOn(assistantDeckAiBackend, "start");
    await expect(
      prepareDeckSuggestion(null, request({ source: { kind: "outline", text: "Sensitive source" } })),
    ).rejects.toThrow("assistant.sensitive_api");
    expect(start).not.toHaveBeenCalled();
  });

  it("captures unsaved source through a snapshot", async () => {
    acquireMock.mockResolvedValue({
      kind: "snapshot",
      id: "220b0001-0022-4000-8000-000000000001",
      expected_revision: 4,
    });
    const snapshot = {
      kind: "snapshot" as const,
      snapshot_id: "220b0001-0023-4000-8000-000000000001",
      document_id: "220b0001-0024-4000-8000-000000000001",
      revision: 4,
    };
    const captured = await captureDocumentSource(snapshot, null);
    expect(acquireMock).toHaveBeenCalledWith(snapshot);
    expect(captured.source.kind).toBe("document");
    if (captured.source.kind === "document") {
      expect(captured.source.input.kind).toBe("snapshot");
      expect(captured.source.input.expected_revision).toBe(4);
    }
  });

  it("refuses a citation to an unknown source", async () => {
    const known = "220b0001-0025-4000-8000-000000000001";
    vi.spyOn(assistantDeckAiBackend, "prepare").mockResolvedValue(outbound(false));
    vi.spyOn(assistantDeckAiBackend, "start").mockResolvedValue({
      id: "deckai-1",
      cancel: vi.fn(),
      completion: Promise.resolve(resultWith("220b0001-0099-4000-8000-000000000001")),
    });
    const prepared = await prepareDeckSuggestion(null, request({
      source: { kind: "document", input: { kind: "snapshot", id: known, expected_revision: 1 }, selection: null },
    }));
    const handle = await generateDeckSuggestion(prepared.id, null);
    await expect(handle.completion).rejects.toThrow("deck_ai.invalid");
  });

  it("never falls back to a cloud provider after a local failure", async () => {
    vi.spyOn(assistantDeckAiBackend, "prepare").mockResolvedValue({ ...outbound(false), backend: "local", provider_id: null });
    const start = vi.spyOn(assistantDeckAiBackend, "start").mockResolvedValue({
      id: "deckai-1",
      cancel: vi.fn(),
      completion: Promise.reject(new Error("deck_ai.failed")),
    });
    const prepared = await prepareDeckSuggestion(null, request());
    const handle = await generateDeckSuggestion(prepared.id, null);
    await expect(handle.completion).rejects.toThrow("deck_ai.failed");
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0][1]).toBeNull();
  });
});
