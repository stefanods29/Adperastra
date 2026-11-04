import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import type { OfficeController } from "../office/OfficeController";
import { BUILTIN_DECK_STYLES } from "../office/deck/styles/builtins";
import { DeckStyleLibrary } from "../office/deck/styles/DeckStyleLibrary";
import { registerAvailableDeckFontAssets } from "../office/deck/styles/styleFonts";
import { listDeckStyles } from "../services/deckStyles";
import { applyDeckStyle, prepareDeckStyle } from "../office/deck/styles/styleApplication";
import type { DeckStylePreview } from "../office/deck/styles/styleTypes";

vi.mock("../services/deckStyles", () => ({ listDeckStyles: vi.fn(), removeDeckStyle: vi.fn() }));
vi.mock("../office/deck/styles/styleApplication", () => ({
  prepareDeckStyle: vi.fn(),
  applyDeckStyle: vi.fn(),
}));

const listMock = vi.mocked(listDeckStyles);
const prepareMock = vi.mocked(prepareDeckStyle);
const applyMock = vi.mocked(applyDeckStyle);
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function controller(mode: "editing" | "viewing" = "editing"): OfficeController {
  return {
    session_id: "220b0001-000a-4000-8000-000000000001",
    family: "deck",
    getState: () => ({
      session_id: "220b0001-000a-4000-8000-000000000001",
      document_id: "220b0001-000b-4000-8000-000000000001",
      family: "deck",
      format: "pptx",
      revision: 5,
      saved_revision: 5,
      content_id: "220b0001-000c-4000-8000-000000000001",
      saved_content_id: "220b0001-000c-4000-8000-000000000001",
      ready: true,
      mode,
      dirty: false,
      can_undo: false,
      can_redo: false,
      capabilities: ["deck_themes"],
      selection: null,
      compatibility: { format: "pptx", entries: [], next_cursor: null, can_preserve_unknown: true, blocks_save: false },
      page_count: 0,
      sheet_count: 0,
      slide_count: 3,
      busy: false,
      status_key: null,
    }),
  } as unknown as OfficeController;
}

const preview = (): DeckStylePreview => ({
  id: "220b0001-0009-4000-8000-000000000001",
  style_id: BUILTIN_DECK_STYLES[0].id,
  theme: structuredClone(BUILTIN_DECK_STYLES[0].theme),
  expected_revision: 5,
  slide_ids: null,
  warnings: [],
  expires_unix: Math.floor(Date.now() / 1000) + 200,
});

async function render(element: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(element);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function cards(): HTMLElement[] {
  return [...(container?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
}

async function press(element: Element, key: string) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  listMock.mockReset();
  prepareMock.mockReset();
  applyMock.mockReset();
  listMock.mockResolvedValue({ schema_version: 1, styles: [], revision: 0 });
  prepareMock.mockResolvedValue(preview());
  applyMock.mockResolvedValue({
    transaction_id: "220b0001-0009-4000-8000-000000000002",
    state: controller().getState(),
    changed: true,
    affected_ids: [],
    warnings: [],
  });
  registerAvailableDeckFontAssets(["inter-regular", "inter-bold"]);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("DeckStyleLibrary", () => {
  it("shows all eight names in the current language", async () => {
    await render(
      <DeckStyleLibrary controller={controller()} selectedSlideIds={[]} onClose={() => undefined} onOpenHelp={() => undefined} />,
    );
    expect(cards()).toHaveLength(8);
    for (const style of BUILTIN_DECK_STYLES) {
      expect(container?.textContent).toContain(i18n.t(style.name_key ?? ""));
    }
  });

  it("disables Apply for a read-only deck", async () => {
    await render(
      <DeckStyleLibrary controller={controller("viewing")} selectedSlideIds={[]} onClose={() => undefined} onOpenHelp={() => undefined} />,
    );
    expect(cards().every((card) => card.getAttribute("aria-disabled") === "true")).toBe(true);
    await press(cards()[0], " ");
    const apply = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === i18n.t("deckStyle.apply"),
    );
    expect(apply).toBeDefined();
    expect((apply as HTMLButtonElement).disabled).toBe(true);
  });

  it("applies with Enter only on the focused card", async () => {
    await render(
      <DeckStyleLibrary controller={controller()} selectedSlideIds={[]} onClose={() => undefined} onOpenHelp={() => undefined} />,
    );
    await press(cards()[0], "ArrowRight");
    expect(document.activeElement).toBe(cards()[1]);
    await press(cards()[1], "Enter");
    expect(prepareMock).toHaveBeenCalledTimes(1);
    expect(prepareMock.mock.calls[0][1].id).toBe(BUILTIN_DECK_STYLES[1].id);
    expect(applyMock).toHaveBeenCalledTimes(1);
  });

  it("opens details with Space", async () => {
    await render(
      <DeckStyleLibrary controller={controller()} selectedSlideIds={[]} onClose={() => undefined} onOpenHelp={() => undefined} />,
    );
    await press(cards()[2], " ");
    const details = container?.querySelector(".adp-deck-style-details");
    expect(details).not.toBeNull();
    expect(details?.textContent).toContain(i18n.t(BUILTIN_DECK_STYLES[2].name_key ?? ""));
  });

  it("closes on Escape and restores ribbon focus", async () => {
    const ribbon = document.createElement("button");
    document.body.appendChild(ribbon);
    ribbon.focus();
    const onClose = vi.fn();
    await render(
      <DeckStyleLibrary controller={controller()} selectedSlideIds={[]} onClose={onClose} onOpenHelp={() => undefined} />,
    );
    await press(cards()[0], "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => root?.unmount());
    root = null;
    expect(document.activeElement).toBe(ribbon);
    ribbon.remove();
  });

  it("passes the actual selected slide IDs to the preview", async () => {
    const selection = ["220b0001-0002-4000-8000-0000000000aa", "220b0001-0002-4000-8000-0000000000bb"];
    await render(
      <DeckStyleLibrary controller={controller()} selectedSlideIds={selection} onClose={() => undefined} onOpenHelp={() => undefined} />,
    );
    const selectedRadio = [...(container?.querySelectorAll('input[type="radio"]') ?? [])][1] as HTMLInputElement;
    await act(async () => selectedRadio.click());
    await press(cards()[0], "Enter");
    expect(prepareMock.mock.calls[0][2]).toEqual(selection);
  });

  it("never copies active document content into a card preview", async () => {
    await render(
      <DeckStyleLibrary controller={controller()} selectedSlideIds={[]} onClose={() => undefined} onOpenHelp={() => undefined} />,
    );
    expect(container?.textContent).not.toContain("SECRET SLIDE");
    expect(container?.querySelector(".adp-deck-style-card-preview")?.getAttribute("aria-hidden")).toBe("true");
  });
});
