import type { DocumentHandle } from "../../documents/types";
import type { FileTabStatus } from "../../handlers/types";
import type { OfficeController } from "../OfficeController";
import type { OfficeSelection, OfficeSessionState, OfficeViewport } from "../types";

/** Canonical UI types of the slide editor (Step 22a, office-deck-ui-1).
 * The persisted view state is deliberately small: selection, viewport and
 * panel/tab choices only. Document content, notes, tokens and engine handles
 * never enter it (R-SEC, plan/pitfalls.md P-34). */

export const deckRibbonTabIds = [
  "deck.file",
  "deck.home",
  "deck.insert",
  "deck.design",
  "deck.transitions",
  "deck.animations",
  "deck.slideShow",
  "deck.review",
  "deck.view",
  "deck.help",
] as const;

export type DeckRibbonTabId = (typeof deckRibbonTabIds)[number];

export const deckDialogIds = [
  "shape",
  "image",
  "table",
  "chart",
  "layout",
  "theme",
  "transition",
  "animation",
  "notes",
  "comment",
  "pageSetup",
  "export",
  "print",
  "properties",
  "compatibility",
  "present",
  "styleLibrary",
] as const;

export type DeckDialogId = (typeof deckDialogIds)[number];

/** The deck member of the shared tagged selection union. */
export type DeckSelection = Extract<OfficeSelection, { kind: "deck" }>;

/** One deck view's saved state (09a codec version 1). */
export type DeckEditorViewState = {
  slide_id: string | null;
  selection: DeckSelection | null;
  viewport: OfficeViewport;
  active_ribbon_tab: DeckRibbonTabId;
  notes_open: boolean;
  slides_open: boolean;
  comments_open: boolean;
  snap: boolean;
}

export interface DeckEditorProps {
  document: DocumentHandle;
  active: boolean;
  savedState: DeckEditorViewState | null;
  onStateChange: (state: DeckEditorViewState) => void;
  onStatus: (status: FileTabStatus) => void;
  onOpenHelp: (slug: string) => void;
  previewOnly?: boolean;
}

/** What a deck command may read. `openDialog` is the only way a command
 * asks the editor to show a dialog; commands never mount components. */
export interface DeckCommandContext {
  controller: OfficeController;
  state: OfficeSessionState;
  selection: DeckSelection | null;
  view: DeckEditorViewState;
  openDialog: (id: DeckDialogId) => void;
}

/** Viewport used before the first render measurement arrives. */
export function defaultDeckViewport(): OfficeViewport {
  return {
    x_px: 0,
    y_px: 0,
    width_px: 960,
    height_px: 540,
    zoom_percent: 100,
    device_scale: 1,
    view_revision: 0,
  };
}

/** A fresh, clean view state before a codec restored anything. */
export function defaultDeckViewState(): DeckEditorViewState {
  return {
    slide_id: null,
    selection: null,
    viewport: defaultDeckViewport(),
    active_ribbon_tab: "deck.home",
    notes_open: true,
    slides_open: true,
    comments_open: false,
    snap: false,
  };
}
