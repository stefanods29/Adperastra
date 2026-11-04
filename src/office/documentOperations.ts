import type { ExportSnapshot } from "../services/exportSnapshots";
import type {
  PageLayout, ParagraphFormatPatch, TextFormatPatch, TextPosition, TextSpan,
} from "./officeValues";

/** office-edit-1. Native validation resolves every identifier in the live session. */
export type DocumentOperation =
  | { kind: "insert_text"; position: TextPosition; text: string }
  | { kind: "delete_text"; span: TextSpan }
  | { kind: "format_text"; span: TextSpan; patch: TextFormatPatch }
  | { kind: "format_paragraph"; block_ids: string[]; patch: ParagraphFormatPatch }
  | { kind: "apply_style"; block_ids: string[]; style_id: string }
  | { kind: "upsert_style"; style: {
      id: string; name: string; parent_id: string | null;
      text: TextFormatPatch; paragraph: ParagraphFormatPatch;
    } }
  | { kind: "insert_break"; position: TextPosition; break_kind: "page" | "column" | "line" }
  | { kind: "set_page_layout"; section_id: string; layout: PageLayout }
  | { kind: "insert_table"; position: TextPosition; rows: number; columns: number }
  | { kind: "set_table_cells"; table_id: string; first_row: number; first_column: number; values: string[][] }
  | { kind: "insert_image"; position: TextPosition; snapshot: ExportSnapshot; width_pt: number; height_pt: number; alt: string }
  | { kind: "insert_link"; span: TextSpan; target:
      | { kind: "internal"; bookmark_id: string }
      | { kind: "url"; url: string; scheme: "https" | "http" | "mailto" } }
  | { kind: "insert_field"; position: TextPosition; field_kind: "page_number" | "page_count" | "date" | "table_of_contents" }
  | { kind: "refresh_field"; field_id: string }
  | { kind: "add_footnote"; position: TextPosition; text: string }
  | { kind: "add_citation"; position: TextPosition; citation: {
      id: string; author: string; title: string; year: string; url?: string;
    } }
  | { kind: "set_bibliography"; position: TextPosition; citation_ids: string[] }
  | { kind: "comment_add"; span: TextSpan; text: string; author: string }
  | { kind: "comment_reply"; comment_id: string; text: string; author: string }
  | { kind: "comment_resolve"; comment_id: string; resolved: boolean }
  | { kind: "comment_delete"; comment_id: string }
  | { kind: "set_track_changes"; enabled: boolean }
  | { kind: "review_change"; change_id: string; decision: "accept" | "reject" }
  | { kind: "replace_match"; span: TextSpan; expected_text: string; replacement: string }
  // Additive office-ai-proposal-1 operation; no image bytes are changed.
  | { kind: "set_image_alt"; image_id: string; expected_alt: string; alt: string };
