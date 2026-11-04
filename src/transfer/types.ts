import type { DocumentRef } from "../documents/types";
import type { ExportSnapshot } from "../services/exportSnapshots";

/** Content transfer contracts (Step 09c, `content-transfer-1`). One
 * canonical definition for every editor, clipboard and drop target. An
 * envelope is opaque data: `kind` is a hint for negotiation, never
 * authority, and the only bytes that travel are 08a snapshot identities.
 * The native mirror is `src-tauri/src/transfer_types.rs`. */

export type TransferKind = "text" | "rich_text" | "cells" | "image" | "pdf_pages" | "files";

export const TRANSFER_KINDS: readonly TransferKind[] = [
  "text",
  "rich_text",
  "cells",
  "image",
  "pdf_pages",
  "files",
];

/** Four 8-bit channels, red/green/blue/alpha. No CSS color strings: the
 * native side and every target must agree on the exact bytes. */
export type TransferRgba = readonly [number, number, number, number];

/** One style mark. Only the marks below exist; links, fonts, sizes and
 * arbitrary CSS are refused rather than silently dropped by the model. */
export type TransferMark =
  | { kind: "bold" }
  | { kind: "italic" }
  | { kind: "underline" }
  | { kind: "strike" }
  | { kind: "code" }
  | { kind: "foreground"; foreground_rgba: TransferRgba };

export interface TransferTextRun {
  text: string;
  marks: TransferMark[];
}

export type TransferBlockKind = "paragraph" | "heading" | "list_item";
export type TransferListOrder = "ordered" | "unordered";

/** One block of the allowlisted rich-text tree (D6). `depth` is the
 * nesting level, 0 at the top; `level` belongs to headings and
 * `list_order` to list items. There is no HTML anywhere in this tree. */
export interface TransferBlock {
  kind: TransferBlockKind;
  runs: TransferTextRun[];
  level?: number;
  list_order?: TransferListOrder;
  depth: number;
}

export type TransferCellKind = "text" | "number" | "boolean" | "blank";

export interface TransferCellFormat {
  number_format?: string;
  bold?: boolean;
  italic?: boolean;
  foreground_rgba?: TransferRgba;
  background_rgba?: TransferRgba;
}

/** One typed cell value plus optional formatting. `=1+1` stays a text
 * value: content-transfer-1 has no formula field and no formula action. */
export interface TransferCell {
  kind: TransferCellKind;
  text?: string;
  number?: number;
  boolean?: boolean;
  format?: TransferCellFormat;
}

export type TransferPayload =
  | { kind: "text"; text: string }
  | { kind: "rich_text"; blocks: TransferBlock[] }
  | {
      kind: "cells";
      rows: TransferCell[][];
      row_count: number;
      column_count: number;
    }
  | { kind: "image"; snapshot: ExportSnapshot; width: number; height: number }
  | { kind: "pdf_pages"; snapshot: ExportSnapshot; pages: number[] }
  | { kind: "files"; sources: DocumentRef[] };

/** The transferred values plus their provenance. `sensitive` is only a
 * hint on the wire; the native registry re-derives it from the source and
 * the snapshot policy, so a caller can never downgrade it. */
export interface TransferEnvelope {
  transfer_id: string;
  source_document_id?: string;
  source_revision?: number;
  sensitive: boolean;
  payload: TransferPayload;
  expires_unix: number;
  source_tab_id?: string;
}

export type TransferActionId =
  | "insert_text"
  | "insert_rich_text"
  | "insert_cells"
  | "insert_image"
  | "insert_pdf_pages"
  | "insert_page_images"
  | "add_layers"
  | "add_clips"
  | "attach_files"
  | "open_files"
  | "copy_files"
  | "move_files";

export const TRANSFER_ACTION_IDS: readonly TransferActionId[] = [
  "insert_text",
  "insert_rich_text",
  "insert_cells",
  "insert_image",
  "insert_pdf_pages",
  "insert_page_images",
  "add_layers",
  "add_clips",
  "attach_files",
  "open_files",
  "copy_files",
  "move_files",
];

/** The only losses content-transfer-1 knows how to explain before an
 * insertion. An unknown key would render untranslated, so it is refused. */
export type TransferLossKey = "transfer.lossFormatting" | "transfer.lossFormula";

export const TRANSFER_LOSS_KEYS: readonly TransferLossKey[] = [
  "transfer.lossFormatting",
  "transfer.lossFormula",
];

export interface TransferAction {
  id: TransferActionId;
  label_key: string;
  losses: TransferLossKey[];
  mutates: boolean;
}

/** What a target proves after a completed insertion. There are no bytes
 * here; `complete` is true only after the whole edit transaction committed. */
export interface TransferReceipt {
  transaction_id: string;
  target_document_id?: string;
  revision?: number;
  inserted_count: number;
  losses: TransferLossKey[];
  complete: boolean;
}

/** A statically registered destination (E2). A target describes what it
 * can do with an envelope and accepts exactly one advertised action. */
export interface TransferTarget {
  target_id: string;
  document_id?: string;
  accepted_kinds: readonly TransferKind[];
  describe: (envelope: TransferEnvelope) => readonly TransferAction[];
  accept: (envelope: TransferEnvelope, actionId: string) => Promise<TransferReceipt>;
}

export interface TransferChoiceProps {
  envelope: TransferEnvelope;
  actions: readonly TransferAction[];
  onChoose: (actionId: string) => Promise<void>;
  onCancel: () => void;
}

export type TransferErrorCode =
  | "transfer.invalid"
  | "transfer.too_large"
  | "transfer.expired"
  | "transfer.unsupported"
  | "transfer.read_only"
  | "transfer.changed"
  | "transfer.sensitive"
  | "transfer.failed";

/** Known failures carry the stable code the UI translates. */
export function transferError(code: TransferErrorCode): Error {
  return new Error(code);
}
