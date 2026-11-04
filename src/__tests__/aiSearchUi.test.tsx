import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import type { IndexRoot } from "../services/search";
import type { AiSearchSettings, NaturalQueryPreview } from "../services/aiSearchTypes";
import AiSearchPanel from "../search/ai/AiSearchPanel";
import NaturalQueryPreviewPanel from "../search/ai/NaturalQueryPreviewPanel";
import SortSuggestionChip from "../organize/SortSuggestionChip";
import { defaultAiSearchSettings } from "../services/aiSearchTypes";

const ROOT_A = "11111111-1111-4111-8111-111111111111";

const roots: IndexRoot[] = [
  {
    id: ROOT_A,
    path: "C:\\Documents",
    filename: true,
    content: true,
    ocr: false,
    enabled: true,
  },
];

const preview: NaturalQueryPreview = {
  id: "33333333-3333-4333-8333-333333333333",
  request_revision: 1,
  status: "ready",
  query: {
    mode: "filters",
    text: "",
    roots: [ROOT_A],
    filter: { kind: "string", field: "ext", op: "eq", value: "pdf" },
    regex_scope: "name",
    match_case: false,
    sort: { key: "modified", direction: "descending" },
  },
  explanation: "PDF files in the chosen folder.",
  unsupported: [],
  captured_now_unix: 1_793_577_600,
  expires_unix: 1_793_577_900,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(element: ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(element));
  return container;
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("AI search UI", () => {
  it("ai_query_keyboard_confirm", async () => {
    const onSearch = vi.fn();
    const onCancel = vi.fn();
    const view = await render(
      <NaturalQueryPreviewPanel
        preview={preview}
        roots={roots}
        onSearch={onSearch}
        onCancel={onCancel}
        onOpenHelp={() => undefined}
      />,
    );
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSearch).not.toHaveBeenCalled();

    const body = view.querySelector(".ai-query-preview__body") as HTMLElement;
    await act(async () => {
      body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it("ai_modes_respect_opt_in", async () => {
    const settings: AiSearchSettings = defaultAiSearchSettings();
    const view = await render(
      <AiSearchPanel
        settings={settings}
        indexRoots={roots}
        onOpenHelp={() => undefined}
      />,
    );
    const tabs = [...view.querySelectorAll<HTMLElement>("[role='tab']")];
    expect(tabs).toHaveLength(4);
    expect(tabs.every((tab) => tab.getAttribute("aria-disabled") === "true")).toBe(true);
    expect(view.textContent).toContain("Index text by meaning");
  });

  it("ai_sort_chip_no_focus_steal", async () => {
    const view = await render(
      <div>
        <input aria-label="active" />
        <SortSuggestionChip
          suggestion={{
            id: "44444444-4444-4444-8444-444444444444",
            identity: { volume_id: "00000001", file_id: "0000000000000001", path_key: "c:\\a.jpg", stable: true },
            source_stamp: {
              path_key: "c:\\a.jpg",
              volume_id: "00000001",
              file_id: "0000000000000001",
              modified_ticks: "133000000000000000",
              size_bytes: 1,
            },
            destination_id: "22222222-2222-4222-8222-222222222222",
            score: 0.8,
            basis: "history",
            reason: "history",
            extension: "jpg",
            expires_unix: 2_000_000_000,
          }}
          destinationLabel="C:\\Pictures"
          onMove={async () => undefined}
          onNotNow={() => undefined}
          onNever={async () => undefined}
          onOpenHelp={() => undefined}
        />
      </div>,
    );
    const input = view.querySelector("input") as HTMLInputElement;
    input.focus();
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
    expect(document.activeElement).toBe(input);
  });

  it("ai_search_pseudo_bounds", async () => {
    const view = await render(
      <NaturalQueryPreviewPanel
        preview={{
          ...preview,
          explanation: "Eine sehr lange Erklärung, die in mehrere Zeilen umbrechen muss.",
          unsupported: [],
          query: {
            ...preview.query!,
            roots: [ROOT_A, ROOT_A, ROOT_A],
          },
        }}
        roots={roots}
        onSearch={() => undefined}
        onCancel={() => undefined}
        onOpenHelp={() => undefined}
      />,
    );
    const chips = view.querySelector(".ai-query-chips") as HTMLElement;
    expect(chips.className).toContain("ai-query-chips");
    const items = [...view.querySelectorAll<HTMLElement>(".ai-query-chip")];
    expect(items.length).toBeGreaterThan(1);
    expect(items.every((item) => item.style.width === "" && item.style.minWidth === "")).toBe(true);
    expect(view.querySelector(".ai-query-preview")).not.toBeNull();
  });
});
