import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { DeckAiPanel } from "../office/deck/ai/DeckAiPanel";
import type { DeckAiSuggestion } from "../office/deck/ai/deckAiTypes";
import { BUILTIN_DECK_STYLES } from "../office/deck/styles/builtins";
import {
  acceptDeckSuggestion,
  generateDeckSuggestion,
  prepareDeckSuggestion,
  previewEditedDeckSuggestion,
  releaseDeckSuggestion,
} from "../services/deckAi";
import { confirmAssistantOutbound } from "../services/assistantInference";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: { count: number }) => ({
    getTotalSize: () => options.count * 120,
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({ index, start: index * 120, key: index })),
  }),
}));
vi.mock("../services/deckAi", () => ({
  prepareDeckSuggestion: vi.fn(),
  generateDeckSuggestion: vi.fn(),
  previewEditedDeckSuggestion: vi.fn(),
  acceptDeckSuggestion: vi.fn(),
  releaseDeckSuggestion: vi.fn(),
}));
vi.mock("../services/assistantInference", () => ({ confirmAssistantOutbound: vi.fn() }));

const prepareMock = vi.mocked(prepareDeckSuggestion);
const generateMock = vi.mocked(generateDeckSuggestion);
const previewMock = vi.mocked(previewEditedDeckSuggestion);
const acceptMock = vi.mocked(acceptDeckSuggestion);
const releaseMock = vi.mocked(releaseDeckSuggestion);
const consentMock = vi.mocked(confirmAssistantOutbound);

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const style = BUILTIN_DECK_STYLES[0];

function suggestion(): DeckAiSuggestion {
  return {
    id: "220b0001-0060-4000-8000-000000000001",
    request: {
      action: "create",
      source: { kind: "outline", text: "Goal\nPlan\nDecision" },
      style_id: style.id,
      topic: "",
      locale: "en",
      slide_count: 3,
      include_speaker_notes: true,
      request_revision: 1,
    },
    source_context_id: null,
    target_context: null,
    outline: {
      schema_id: "deck.outline.v1",
      action: "create",
      suggested_style_id: style.id,
      rationale: "",
      slides: [1, 2, 3].map((index) => ({
        outline_id: `220b0001-0061-4000-8000-${index.toString(16).padStart(12, "0")}`,
        layout_kind: "title_body",
        title: `Slide ${index}`,
        bullets: ["One point"],
        right_bullets: [],
        caption: "",
        quote: "",
        speaker_notes: "",
        images: [],
        citations: [],
        chart_data_id: null,
      })),
      layout_choices: [],
    },
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

function prepared(api: boolean): import("../office/deck/ai/deckAiTypes").DeckAiPreparedRequest {
  return {
    id: "220b0001-0062-4000-8000-000000000001",
    request: suggestion().request,
    outbound_preview: {
      preview_id: "220b0001-0063-4000-8000-000000000001",
      backend: api ? ("api" as const) : ("local" as const),
      provider_id: api ? "meta" : null,
      model_id: "model",
      payload_sha256: null,
      sources: [],
      byte_len: 12,
      requires_consent: api,
      expires_unix: Math.floor(Date.now() / 1000) + 120,
      includes_chat_history: false,
      local_server: false,
    },
    expires_unix: Math.floor(Date.now() / 1000) + 120,
  };
}

async function render(panel = <DeckAiPanel controller={null} initialAction="create" source={{ kind: "outline", text: "Goal\nPlan\nDecision" }} onClose={() => undefined} onOpenHelp={() => undefined} />) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(panel);
  });
}

function button(label: string): HTMLButtonElement {
  const found = [...(container?.querySelectorAll("button") ?? [])].find((item) => item.textContent?.includes(label));
  if (!found) throw new Error(`missing button ${label}`);
  return found as HTMLButtonElement;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  prepareMock.mockReset();
  generateMock.mockReset();
  previewMock.mockReset();
  acceptMock.mockReset();
  releaseMock.mockReset();
  consentMock.mockReset();
  prepareMock.mockResolvedValue(prepared(false));
  generateMock.mockResolvedValue({
    id: "job-1",
    cancel: vi.fn(),
    completion: Promise.resolve(suggestion()),
  });
  consentMock.mockResolvedValue({ consent_id: "consent-1" });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("DeckAiPanel", () => {
  it("shows all six translated actions", async () => {
    await render();
    for (const key of ["create", "add", "shorten", "notes", "layout", "style"]) {
      expect(container?.textContent).toContain(i18n.t(`deckAi.${key}`));
    }
  });

  it("moves a slide with Alt+Down and announces the position", async () => {
    await render();
    await click(button(i18n.t("deckAi.generate")));
    const headings = [...(container?.querySelectorAll(".deck-ai-slide-heading") ?? [])] as HTMLElement[];
    expect(headings).toHaveLength(3);
    await act(async () => {
      headings[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }));
    });
    expect(container?.textContent).toContain(i18n.t("deckAi.position", { index: 2, total: 3 }));
  });

  it("requires a new preview after editing the outline", async () => {
    await render();
    await click(button(i18n.t("deckAi.generate")));
    const accept = button(i18n.t("deckAi.acceptChanges"));
    expect(accept.disabled).toBe(true);
    const title = container?.querySelector(".deck-ai-slide-card input") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(title, "Edited");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(button(i18n.t("deckAi.acceptChanges")).disabled).toBe(true);
  });

  it("uses Send only for the outbound step, never Accept", async () => {
    prepareMock.mockResolvedValue(prepared(true));
    await render();
    await click(button(i18n.t("deckAi.generate")));
    await click(button(i18n.t("assistant.sendContent")));
    expect(consentMock).toHaveBeenCalledTimes(1);
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(acceptMock).not.toHaveBeenCalled();
  });

  it("keeps focus in the active input when a result arrives", async () => {
    await render();
    const topic = container?.querySelector('input[type="text"]') as HTMLInputElement;
    topic.focus();
    await click(button(i18n.t("deckAi.generate")));
    expect(document.activeElement).toBe(topic);
  });
});
