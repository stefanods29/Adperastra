import { readFileSync } from "node:fs";
import { repoUrl } from "./nodeUrl";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentHandle } from "../documents/types";
import type { OfficeController } from "../office/OfficeController";
import {
  acquireDeckController,
  canDeckMutate,
  mergeDeckEditorSettings,
  normalizeDeckEditorSettings,
  registerDeckEditorController,
} from "../office/deck/deckController";
import { deckViewStateCodec, normalizeDeckViewState } from "../office/deck/deckViewState";
import { defaultDeckViewState } from "../office/deck/deckUiTypes";
import type { OfficeSessionState } from "../office/types";

const office = vi.hoisted(() => ({
  acquire: vi.fn(),
  register: vi.fn(),
  can: vi.fn(),
}));

vi.mock("../office/OfficeController", () => ({
  acquireOfficeController: office.acquire,
  registerOfficeControllerFactory: office.register,
}));
vi.mock("../office/officeCompatibility", () => ({ canOfficeCommand: office.can }));

function document(overrides: Partial<DocumentHandle["info"]> = {}): DocumentHandle {
  return {
    id: "00000000-0000-4000-8000-0000000000aa",
    source: { kind: "disk", path: "C:\\decks\\deck.pptx" },
    info: {
      document_id: "00000000-0000-4000-8000-0000000000aa",
      source: { kind: "disk", path: "C:\\decks\\deck.pptx" },
      name: "deck.pptx",
      ext: "pptx",
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      size: 1024,
      modified_unix: 1,
      read_only: false,
      from_internet: false,
      sensitive: false,
      disk_path: "C:\\decks\\deck.pptx",
      ...overrides,
    },
    getState: () => ({
      revision: 1, saved_revision: 1, content_id: "c", saved_content_id: "c",
      dirty: false, ready: true, editing_enabled: true, can_save_existing: true, can_save_copy: true,
    }),
    subscribe: () => () => undefined,
    readRange: async () => new Uint8Array(),
    captureSnapshot: async () => ({}) as never,
    save: async () => true,
    saveCopy: async () => true,
    discard: async () => undefined,
    release: () => undefined,
  };
}

function deckState(overrides: Partial<OfficeSessionState> = {}): OfficeSessionState {
  return {
    session_id: "00000000-0000-4000-8000-000000000001",
    document_id: "00000000-0000-4000-8000-0000000000aa",
    family: "deck",
    format: "pptx",
    revision: 1,
    saved_revision: 1,
    content_id: "00000000-0000-4000-8000-0000000000cc",
    saved_content_id: "00000000-0000-4000-8000-0000000000cc",
    ready: true,
    mode: "editing",
    dirty: false,
    can_undo: false,
    can_redo: false,
    capabilities: ["deck_slides", "deck_shapes", "deck_themes"],
    selection: null,
    compatibility: { format: "pptx", entries: [], next_cursor: null, can_preserve_unknown: true, blocks_save: false },
    page_count: 0,
    sheet_count: 0,
    slide_count: 3,
    busy: false,
    status_key: null,
    ...overrides,
  } as OfficeSessionState;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deck controller", () => {
  it("one controller / two views use the same registry-owned model", async () => {
    const shared = { family: "deck" } as unknown as OfficeController;
    office.acquire.mockResolvedValue(shared);
    const handle = document();
    const first = await acquireDeckController(handle);
    const second = await acquireDeckController(handle);
    expect(first).toBe(shared);
    expect(second).toBe(shared);
    expect(office.acquire).toHaveBeenCalledTimes(2);
    expect(office.acquire.mock.calls[0]).toEqual([handle, "deck"]);
  });

  it("registers the existing office-slide handler with the deck family once", () => {
    registerDeckEditorController();
    registerDeckEditorController();
    expect(office.register.mock.calls).toEqual([["office-slide", "deck"]]);
  });

  it("protected view mutation is denied until editing is enabled", () => {
    office.can.mockReturnValue({ enabled: true, reason_key: null });
    const handle = document({ from_internet: true });
    expect(canDeckMutate(handle, deckState({ mode: "viewing" }), "deck_shapes").enabled).toBe(false);
    expect(canDeckMutate(handle, deckState({ mode: "editing" }), "deck_shapes").enabled).toBe(true);
    expect(canDeckMutate(handle, deckState(), "deck_shapes", true).enabled).toBe(false);
  });

  it("read-only source is never mutable", () => {
    office.can.mockReturnValue({ enabled: true, reason_key: null });
    expect(canDeckMutate(document({ read_only: true }), deckState(), "deck_shapes")).toEqual({
      enabled: false,
      reason_key: "office.readOnly",
    });
  });

  it("deck state clip does not depend on a 21b sheet module", () => {
    const files = ["deckUiTypes.ts", "deckViewState.ts", "deckController.ts"];
    for (const file of files) {
      const source = readFileSync(
        fileURLToPath(repoUrl(`../office/deck/${file}`, import.meta.url)),
        "utf8",
      );
      expect(source).not.toMatch(/office\/sheet|sheetUiTypes|21b|sheetController/);
      expect(source).not.toMatch(/from ".*\/(ai|assistant)\//);
    }
  });

  it("unknown view fields, notes and tokens are stripped", () => {
    const decoded = deckViewStateCodec.decode({
      session_id: "secret-session",
      token: "private-token",
      notes: "PRIVATE NOTES",
      text: "private slide text",
      active_ribbon_tab: "deck.unknown",
      slide_id: "00000000-0000-4000-8000-000000000002",
      viewport: { zoom_percent: 900, x_px: Infinity, y_px: -3, view_revision: 77 },
      selection: {
        kind: "deck",
        slide_ids: ["00000000-0000-4000-8000-000000000002"],
        shape_ids: ["00000000-0000-4000-8000-000000000003"],
        text_span: null,
      },
      slides_open: false,
      snap: true,
    });
    expect(decoded).toMatchObject({
      active_ribbon_tab: "deck.home",
      slides_open: false,
      snap: true,
      viewport: { zoom_percent: 400, x_px: 0, y_px: 0, view_revision: 0 },
    });
    expect(JSON.stringify(decoded)).not.toMatch(/secret|private|PRIVATE|token|session_id/);
  });

  it("refuses a malformed selection instead of keeping half of it", () => {
    expect(normalizeDeckViewState({
      selection: { kind: "deck", slide_ids: [], shape_ids: [] },
    }).selection).toBeNull();
    expect(normalizeDeckViewState({
      selection: { kind: "deck", slide_ids: ["not-a-uuid"], shape_ids: [] },
    }).selection).toBeNull();
  });

  it("schema 54 -> 55 keeps previous preferences and adds deck defaults", () => {
    const previous = { schema_version: 54, theme: "dark", language: "es", layout: { toolbar_position: "left" } };
    const merged = mergeDeckEditorSettings(previous, { show_notes: false });
    expect(merged).toMatchObject({ schema_version: 54, theme: "dark", language: "es" });
    expect(merged.deck_editor).toEqual({
      show_notes: false,
      snap_to_grid: false,
      default_aspect: "wide",
      presenter_view: true,
    });
    expect(normalizeDeckEditorSettings({ default_aspect: "4:3" }).default_aspect).toBe("wide");
    expect(defaultDeckViewState().active_ribbon_tab).toBe("deck.home");
  });
});