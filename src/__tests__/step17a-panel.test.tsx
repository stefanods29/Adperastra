import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobHandle } from "../services/jobs";
import type { AssistantConversation, AssistantTurnResult } from "../assistant/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../services/assistant", () => ({
  createAssistantChat: vi.fn(),
  sendAssistantTurn: vi.fn(),
  stopAssistantTurn: vi.fn(),
  assistantMessages: vi.fn(),
}));
vi.mock("../services/assistantScope", () => ({
  assistantScope: vi.fn(),
  requestAssistantScope: vi.fn(),
  revokeAssistantScope: vi.fn(),
}));
vi.mock("../services/assistantActions", () => ({
  applyAssistantDraft: vi.fn(),
  cancelAssistantDraft: vi.fn(),
  confirmAssistantRecycle: vi.fn(),
  previewAssistantAction: vi.fn(),
}));

import { AssistantPanel } from "../assistant/AssistantPanel";
import { AssistantComposer } from "../assistant/AssistantComposer";
import { AssistantActionCard } from "../assistant/AssistantActionCard";
import { AssistantCitations } from "../assistant/AssistantCitations";
import { AssistantTurnController } from "../assistant/turnController";
import { createAssistantChat, sendAssistantTurn, stopAssistantTurn } from "../services/assistant";
import { assistantScope } from "../services/assistantScope";
import { applyAssistantDraft } from "../services/assistantActions";
import type { AiCitation } from "../services/localAiTypes";

const conversation: AssistantConversation = {
  id: "11111111-1111-4111-8111-111111111111",
  backend: "local",
  provider_id: null,
  model_id: "qwen3.5-4b",
  locale: "en",
  revision: 1,
  messages: [],
  created_unix: 1,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.mocked(createAssistantChat).mockResolvedValue(conversation);
  vi.mocked(assistantScope).mockResolvedValue({
    id: "22222222-2222-4222-8222-222222222222",
    chat_id: conversation.id,
    generation: 1,
    files: [],
    roots: [],
    read_contents: false,
    denied_folders: [],
  });
});

async function render(node: ReactNode): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(node));
  return container;
}

const citationPage: AiCitation = {
  input_id: "33333333-3333-4333-8333-333333333333",
  revision: 1,
  location: { kind: "page", page: 2 },
  quote: "The budget is 120 dollars.",
};

const citationTime: AiCitation = {
  input_id: "44444444-4444-4444-8444-444444444444",
  revision: 1,
  location: { kind: "time", start_us: 65_000_000, end_us: 66_000_000 },
  quote: "At one minute.",
};

describe("assistant panel", () => {
  it("panel_open_no_model_load", async () => {
    const view = await render(
      <AssistantPanel active onClose={() => undefined} onOpenHelp={() => undefined} />,
    );
    expect(view.querySelector(".adp-assistant")).not.toBeNull();
    expect(createAssistantChat).not.toHaveBeenCalled();
    expect(assistantScope).not.toHaveBeenCalled();
  });

  it("IMEEnter_no_send", async () => {
    const sent = vi.fn();
    const view = await render(
      <AssistantComposer value="hello" busy={false} onChange={() => undefined} onSend={sent} onStop={() => undefined} />,
    );
    const textarea = view.querySelector("textarea")!;
    await act(async () => {
      textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(sent).not.toHaveBeenCalled();
    await act(async () => {
      textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it("Entercomposer_no_Apply", async () => {
    const sent = vi.fn();
    const applied = vi.fn();
    const draft = {
      id: "55555555-5555-4555-8555-555555555555",
      chat_id: conversation.id,
      revision: 1,
      operation: {
        tool_id: "create_file" as const,
        parent_root_id: "66666666-6666-4666-8666-666666666666",
        name: "notes.txt",
        format: "text" as const,
        content: "Meeting at 10.",
      },
      source_ids: [],
      preview_rows: [
        {
          input_id: null,
          source_label: "Folder",
          destination_label: "notes.txt",
          before_excerpt: null,
          after_excerpt: "Meeting at 10.",
          operation_key: "create_file",
        },
      ],
      warnings: [],
      accepted_warning_codes: [],
      accepted_losses: [],
      draft_sha256: "a".repeat(64),
      expires_unix: 10,
      risk: "change" as const,
    };
    const view = await render(
      <div>
        <AssistantComposer value="hello" busy={false} onChange={() => undefined} onSend={sent} onStop={() => undefined} />
        <AssistantActionCard draft={draft} onApply={applied} onCancel={() => undefined} />
      </div>,
    );
    const textarea = view.querySelector("textarea")!;
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(sent).toHaveBeenCalledTimes(1);
    expect(applied).not.toHaveBeenCalled();
    expect(applyAssistantDraft).not.toHaveBeenCalled();
  });

  it("Stop_once", async () => {
    const cancel = vi.fn();
    const never = new Promise<AssistantTurnResult>(() => undefined);
    const handle: JobHandle<AssistantTurnResult> = {
      id: "assistant-1",
      cancel,
      completion: never,
    };
    vi.mocked(sendAssistantTurn).mockResolvedValue(handle);
    vi.mocked(stopAssistantTurn).mockResolvedValue(undefined);
    const view = await render(
      <AssistantPanel active onClose={() => undefined} onOpenHelp={() => undefined} />,
    );
    const textarea = view.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, "hello");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = [...view.querySelectorAll("button")].find((button) =>
      button.getAttribute("aria-label")?.includes("assistant.send"),
    )!;
    await act(async () => {
      send.click();
      await Promise.resolve();
    });
    const stop = [...view.querySelectorAll("button")].find((button) =>
      button.getAttribute("aria-label")?.includes("assistant.stop"),
    )!;
    await act(async () => {
      stop.click();
      stop.click();
      await Promise.resolve();
    });
    expect(stopAssistantTurn).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("citations_seek_correctpage_time", async () => {
    const seek = vi.fn();
    const view = await render(
      <AssistantCitations citations={[citationPage, citationTime]} onSeek={seek} />,
    );
    const buttons = [...view.querySelectorAll("button")];
    await act(async () => {
      buttons[0].click();
      buttons[1].click();
    });
    expect(seek).toHaveBeenNthCalledWith(1, citationPage);
    expect(seek).toHaveBeenNthCalledWith(2, citationTime);
  });

  it("provider_notice_visible", async () => {
    const view = await render(
      <AssistantPanel active onClose={() => undefined} onOpenHelp={() => undefined} />,
    );
    const api = [...view.querySelectorAll("input[type='radio']")][1];
    await act(async () => {
      (api as HTMLElement).click();
    });
    expect(view.textContent).toContain("assistant.apiNotice");
    expect(view.textContent).toContain("assistant.apiHistoryNotice");
  });

  it("screenreader_not_token_spam", async () => {
    const announced: string[] = [];
    let now = 0;
    const controller = new AssistantTurnController({
      send: async () => ({
        id: "j",
        cancel: async () => undefined,
        completion: new Promise<AssistantTurnResult>(() => undefined),
      }),
      stop: async () => undefined,
      messages: async () => [
        {
          id: "m1",
          role: "assistant",
          plain_text: "One. Two. Three.",
          citations: [],
          status: "streaming",
          error_code: null,
          backend: "local",
          provider_id: null,
          model_id: "qwen3.5-4b",
        },
      ],
      announce: (text) => announced.push(text),
      now: () => now,
    });
    controller.setConversation(conversation);
    void controller.begin({
      chat_id: conversation.id,
      expected_revision: 1,
      user_text: "hello",
      scope_id: "22222222-2222-4222-8222-222222222222",
      request_id: "j",
      chat_send_nonce: "nonce",
    });
    await Promise.resolve();
    await Promise.resolve();
    for (let index = 0; index < 10; index += 1) {
      now = index * 100;
      await controller.pollOnce();
    }
    expect(announced.length).toBeLessThanOrEqual(1);
    now = 2_100;
    await controller.pollOnce();
    expect(announced.length).toBeLessThanOrEqual(2);
  });

  it("300percent_all_controls_reachable", async () => {
    document.documentElement.style.fontSize = "48px";
    const view = await render(
      <AssistantPanel active onClose={() => undefined} onOpenHelp={() => undefined} />,
    );
    const controls = [...view.querySelectorAll<HTMLElement>("button,input,textarea,select")];
    expect(controls.length).toBeGreaterThan(3);
    for (const control of controls) {
      const name =
        control.getAttribute("aria-label") ??
        control.getAttribute("aria-labelledby") ??
        control.closest("label")?.textContent ??
        control.textContent;
      expect(name && name.trim().length > 0).toBe(true);
      expect(control.getAttribute("tabindex")).not.toBe("-1");
    }
    document.documentElement.style.fontSize = "";
  });
});
