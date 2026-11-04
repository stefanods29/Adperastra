import { readFileSync } from "node:fs";
import { repoUrl } from "./nodeUrl";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { CommandRegistry } from "../commands/registry";
import type { DocumentHandle } from "../documents/types";
import { registerDeckCommands, setDeckLayoutContext } from "../office/deck/deckCommands";
import type { DeckCommandContext, DeckEditorViewState } from "../office/deck/deckUiTypes";
import { defaultDeckViewState } from "../office/deck/deckUiTypes";
import { deckRibbon } from "../office/deck/deckRibbon";
import { textFormatControlValue } from "../office/deck/DeckTextControls";
import type { OfficeController } from "../office/OfficeController";
import type { OfficeFormatting, OfficeSessionState } from "../office/types";

vi.mock("../office/OfficeController", () => ({ acquireOfficeController: vi.fn(), registerOfficeControllerFactory: vi.fn() }));
vi.mock("../services/officeEdit", () => ({ officeFormatting: vi.fn() }));
vi.mock("../office/officeCompatibility", () => ({
  canOfficeCommand: (state: OfficeSessionState, capability: string) => ({
    enabled: state.ready && !state.busy && state.mode === "editing" && state.capabilities.includes(capability as never),
    reason_key: null,
  }),
}));

function state(capabilities: OfficeSessionState["capabilities"]): OfficeSessionState {
  return {
    session_id: "00000000-0000-4000-8000-000000000001",
    document_id: "00000000-0000-4000-8000-0000000000aa",
    family: "deck", format: "pptx", revision: 1, saved_revision: 1,
    content_id: "00000000-0000-4000-8000-0000000000cc",
    saved_content_id: "00000000-0000-4000-8000-0000000000cc",
    ready: true, mode: "editing", dirty: false, can_undo: false, can_redo: false,
    capabilities,
    selection: { kind: "deck", slide_ids: ["00000000-0000-4000-8000-000000000002"], shape_ids: [], text_span: null },
    compatibility: { format: "pptx", entries: [], next_cursor: null, can_preserve_unknown: true, blocks_save: false },
    page_count: 0, sheet_count: 0, slide_count: 3, busy: false, status_key: null,
  } as OfficeSessionState;
}

function document(): DocumentHandle {
  return {
    id: "00000000-0000-4000-8000-0000000000aa",
    source: { kind: "disk", path: "C:\\decks\\deck.pptx" },
    info: {
      document_id: "00000000-0000-4000-8000-0000000000aa",
      source: { kind: "disk", path: "C:\\decks\\deck.pptx" },
      name: "deck.pptx", ext: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      size: 1, modified_unix: 1, read_only: false, from_internet: false, sensitive: false,
    },
    getState: () => ({}) as never,
    subscribe: () => () => undefined,
    readRange: async () => new Uint8Array(),
    captureSnapshot: async () => ({}) as never,
    save: async () => true, saveCopy: async () => true, discard: async () => undefined, release: () => undefined,
  };
}

function context(capabilities: OfficeSessionState["capabilities"]): DeckCommandContext {
  return {
    controller: { document: document(), getState: () => state(capabilities), transact: vi.fn() } as unknown as OfficeController,
    state: state(capabilities),
    selection: state(capabilities).selection as DeckCommandContext["selection"],
    view: defaultDeckViewState(),
    openDialog: vi.fn(),
  };
}

describe("deck ribbon", () => {
  it("has exactly the ten ordered tabs and key tips", () => {
    expect(deckRibbon().tabs.map((tab) => tab.id)).toEqual([
      "deck.file", "deck.home", "deck.insert", "deck.design", "deck.transitions",
      "deck.animations", "deck.slideShow", "deck.review", "deck.view", "deck.help",
    ]);
    expect(deckRibbon().tabs.map((tab) => tab.keyTip)).toEqual(["F", "H", "I", "D", "T", "A", "S", "R", "V", "Y"]);
    for (const tab of deckRibbon().tabs) {
      expect(tab.labelKey).toMatch(/^officeDeck\.tab\./);
      for (const group of tab.groups) expect(group.labelKey).toMatch(/^officeDeck\.group\./);
    }
  });

  it("every ribbon control resolves to a registered deck command", () => {
    const registry = new CommandRegistry<DeckCommandContext>();
    registerDeckCommands(registry);
    const ids = new Set(registry.list().map((command) => command.id));
    for (const tab of deckRibbon().tabs) {
      for (const group of tab.groups) {
        for (const control of group.controls) {
          if (control.type === "custom") continue;
          expect(control.command).toMatch(/^deck\.[A-Za-z]+$/);
          expect(ids.has(control.command)).toBe(true);
        }
      }
    }
  });

  it("a missing capability disables the mutation", () => {
    const registry = new CommandRegistry<DeckCommandContext>();
    registerDeckCommands(registry);
    setDeckLayoutContext({ defaultLayoutId: "00000000-0000-4000-8000-0000000000ff" });
    const command = registry.get("deck.newSlide")!;
    expect(command.enabledWhen(context([]))).toBe(false);
    expect(command.enabledWhen(context(["deck_slides"]))).toBe(true);
  });

  it("all four ribbon docks and keyboard ownership stay in the shared framework", () => {
    const header = readFileSync(fileURLToPath(repoUrl("../office/deck/DeckHeader.tsx", import.meta.url)), "utf8");
    const css = readFileSync(fileURLToPath(repoUrl("../styles/office-deck.css", import.meta.url)), "utf8");
    expect(header).toContain("<Ribbon");
    expect(header).toContain("initialTabId");
    expect(css).not.toMatch(/position:\s*fixed/);
    expect(css).toMatch(/@media \(max-width: 900px\)/);
  });

  it("File backstage closes on Escape and focuses its first item", () => {
    const source = readFileSync(fileURLToPath(repoUrl("../office/deck/DeckBackstage.tsx", import.meta.url)), "utf8");
    expect(source).toMatch(/event\.key !== "Escape"/);
    expect(source).toContain("firstItem.current?.focus()");
  });

  it("Share offers only local file actions", () => {
    const source = readFileSync(fileURLToPath(repoUrl("../office/deck/DeckHeader.tsx", import.meta.url)), "utf8");
    expect(source).toContain("copyPath");
    expect(source).toContain("saveCopy");
    expect(source).toContain("exportPdf");
    expect(source).not.toMatch(/https?:\/\//);
  });

  it("a mixed text format is not defaulted to false or the first value", () => {
    const formatting = {
      text: { bold: { kind: "mixed" }, italic: { kind: "unavailable", reason_key: "office.unsupported" } },
    } as unknown as OfficeFormatting;
    expect(textFormatControlValue(formatting, "bold")).toBeUndefined();
    expect(textFormatControlValue(formatting, "italic")).toBeUndefined();
    expect(textFormatControlValue(null, "bold")).toBeUndefined();
  });
});