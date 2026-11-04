import { OfficeViewportView } from "../OfficeViewport";
import type { OfficeController } from "../OfficeController";
import type { OfficeSelection, OfficeViewport } from "../types";

export interface DocumentCanvasProps {
  controller: OfficeController;
  active: boolean;
  revision: number;
  canEditText: boolean;
  selection: OfficeSelection | null;
  onSelection: (selection: OfficeSelection) => void;
  viewport: OfficeViewport;
  onViewport: (viewport: OfficeViewport) => void;
  onOpenHelp: (slug: string) => void;
}

/** E9 owns accessible editing, stale render suppression and binary lease cleanup. */
export function DocumentCanvas(props: DocumentCanvasProps) {
  return <div className="adp-office-document-canvas"><OfficeViewportView {...props} /></div>;
}
