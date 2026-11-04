import type { DeckTheme } from "./presentationTypes";
import type {
  OfficeChart, OfficeColor, OfficeEditComment, TextPosition, TextSpan,
} from "./officeValues";
import type { DocumentOperation } from "./documentOperations";
import type { SheetOperation } from "./sheetOperations";

/** Paged item catalogues (20a E6). Every page ends before 768 KiB even when
 * the item count is below 256; cursors belong to one session/query/revision. */

export type OfficeItemKind =
  | "headings" | "styles" | "comments" | "changes" | "sheets"
  | "slides" | "masters" | "charts" | "pivots";

export interface OfficeHeadingItem {
  id: string;
  title: string;
  level: number;
  page: number;
  position: TextPosition;
}

export type OfficeStyleItem = Extract<DocumentOperation, { kind: "upsert_style" }>["style"];

export interface OfficeChangeItem {
  id: string;
  author: string;
  kind: "insert" | "delete" | "format";
  excerpt: string;
  span: TextSpan;
}

export interface OfficeSheetItem {
  id: string;
  name: string;
  index: number;
  hidden: boolean;
  color: OfficeColor | null;
  rows: number;
  columns: number;
}

export interface OfficeSlideItem {
  id: string;
  index: number;
  layout_id: string;
  hidden: boolean;
  title: string;
  notes_preview: string;
}

export type OfficePivotItem = Extract<SheetOperation, { kind: "upsert_pivot" }>["pivot"];

interface OfficeItemPageBase {
  next_cursor: string | null;
  complete: boolean;
  revision: number;
}

export type OfficeItemPage =
  | (OfficeItemPageBase & { kind: "headings"; items: OfficeHeadingItem[] })
  | (OfficeItemPageBase & { kind: "styles"; items: OfficeStyleItem[] })
  | (OfficeItemPageBase & { kind: "comments"; items: OfficeEditComment[] })
  | (OfficeItemPageBase & { kind: "changes"; items: OfficeChangeItem[] })
  | (OfficeItemPageBase & { kind: "sheets"; items: OfficeSheetItem[] })
  | (OfficeItemPageBase & { kind: "slides"; items: OfficeSlideItem[] })
  | (OfficeItemPageBase & { kind: "masters"; items: DeckTheme[] })
  | (OfficeItemPageBase & { kind: "charts"; items: OfficeChart[] })
  | (OfficeItemPageBase & { kind: "pivots"; items: OfficePivotItem[] });
