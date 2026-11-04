import type { DocumentHandle } from "../../documents/types";
import type { FileTabStatus } from "../../handlers/types";
import type { OfficeController } from "../OfficeController";
import type { OfficeFormatting, OfficeSelection, OfficeSessionState, OfficeViewport } from "../types";

export const sheetRibbonTabIds = ["sheet.file", "sheet.home", "sheet.insert", "sheet.pageLayout", "sheet.formulas", "sheet.data", "sheet.review", "sheet.view", "sheet.help"] as const;
export type SheetRibbonTabId = typeof sheetRibbonTabIds[number];
export type SheetDialogId = "cellFormat" | "numberFormat" | "conditional" | "validation" | "chart" | "pivot" | "sort" | "filter" | "find" | "replace" | "sheetName" | "print" | "export" | "properties";
export type SheetSelection = Extract<OfficeSelection, { kind: "sheet" }>;

export type SheetEditorViewState = {
  active_sheet_id: string | null;
  selection: SheetSelection | null;
  viewport: OfficeViewport;
  active_ribbon_tab: SheetRibbonTabId;
  formula_bar: boolean;
  gridlines: boolean;
  headings: boolean;
  /** null until supplied by an authoritative engine query (see handoff). */
  freeze: { rows: number; columns: number } | null;
  zoom: number;
}

export interface SheetEditorProps {
  document: DocumentHandle;
  active: boolean;
  savedState: SheetEditorViewState | null;
  onStateChange: (state: SheetEditorViewState) => void;
  onStatus: (status: FileTabStatus) => void;
  onOpenHelp: (slug: string) => void;
  previewOnly?: boolean;
}

export interface SheetCommandContext {
  saveCopy?(): void;
  controller: OfficeController;
  state: OfficeSessionState;
  selection: SheetSelection | null;
  /** Live answer for the current selection; null until the query succeeds.
   * A command never invents a formatting default from a missing answer. */
  formatting: OfficeFormatting | null;
  view: SheetEditorViewState;
  openDialog: (id: SheetDialogId) => void;
}
