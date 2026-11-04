import type { DocumentHandle } from "../../documents/types";
import type { FileTabStatus } from "../../handlers/types";
import type { OfficeController } from "../OfficeController";
import type { OfficeFormatting, OfficeSelection, OfficeSessionState, OfficeViewport } from "../types";

export const documentTabIds = [
  "doc.file", "doc.home", "doc.insert", "doc.design", "doc.layout",
  "doc.references", "doc.review", "doc.view", "doc.help",
] as const;

export type DocumentDialogId = "font" | "paragraph" | "page" | "table" | "image" |
  "link" | "style" | "citation" | "comment" | "find" | "replace" | "export" |
  "print" | "properties" | "compatibility";

export type DocumentEditorViewState = {
  selection: OfficeSelection | null;
  viewport: OfficeViewport;
  navigation_open: boolean;
  comments_open: boolean;
  ruler: boolean;
  active_ribbon_tab: typeof documentTabIds[number];
}

export interface DocumentEditorProps {
  document: DocumentHandle;
  active: boolean;
  savedState: DocumentEditorViewState | null;
  onStateChange: (state: DocumentEditorViewState) => void;
  onStatus: (status: FileTabStatus) => void;
  onOpenHelp: (slug: string) => void;
  previewOnly?: boolean;
}

export interface OfficeCommandContext {
  controller: OfficeController;
  state: OfficeSessionState;
  selection: OfficeSelection | null;
  formatting: OfficeFormatting | null;
  view: DocumentEditorViewState;
  openDialog: (id: DocumentDialogId) => void;
}
