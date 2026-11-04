/** Types for the plain ESM extraction encoder used by the isolated helper
 * and its tests (Step 17d T5). */

import type { ExtractionReview } from "../src/services/aiExtractionTypes";

export interface EncoderSnapshot {
  schema: 1;
  review: ExtractionReview;
  publish: {
    name: string;
    table_id: string | null;
    include_source_labels: boolean;
    accepted_warning_codes: string[];
  };
  labels?: {
    receipt_columns?: readonly string[];
    source_labels?: readonly string[];
  };
  /** Native capture writes source labels at the envelope level. */
  source_labels?: readonly string[];
}

export interface EncoderDraft {
  name_hint: string;
  name_part: { kind: "none" };
  mime: string;
  input_indices: [number];
}

export interface EncoderResult {
  bytes: Uint8Array;
  draft: EncoderDraft;
  warnings: string[];
}

export function spreadsheetCell(value: unknown, type?: string): string | number;
export function needsFormulaSafety(values: readonly unknown[]): boolean;
export function csvField(value: unknown, delimiter?: string): string;
export function delimiterOf(name: string): string;
export function docxModelFromSnapshot(snapshot: EncoderSnapshot): {
  title: string;
  blocks: Array<
    | { type: "heading"; level: number; text: string }
    | { type: "paragraph"; text: string }
    | { type: "list"; items: string[] }
    | { type: "table"; columns: string[]; rows: string[][] }
  >;
};
export function encodeDocx(snapshot: EncoderSnapshot): Promise<Uint8Array>;
export function spreadsheetRows(snapshot: EncoderSnapshot): { columns: string[]; rows: string[][] };
export function encodeXlsx(snapshot: EncoderSnapshot): Promise<Uint8Array>;
export function encodeExtractionOutput(
  snapshot: EncoderSnapshot,
  format: "docx" | "md" | "txt" | "xlsx" | "csv",
  options?: { delimiter?: "comma" | "semicolon" | "tab" },
): Promise<EncoderResult>;
