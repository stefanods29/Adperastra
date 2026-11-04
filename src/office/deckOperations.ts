import type { OfficeSelection, ParagraphFormatPatch, TextFormatPatch, TextPosition, TextSpan } from "./officeValues";
import type { DeckAnimation, DeckShape, DeckShapePatch, DeckTheme, DeckTransition } from "./presentationTypes";

/** office-edit-1, including the additive proposal-owned fresh-slide variant. */
export type DeckOperation =
  | { kind: "insert_text"; slide_id: string; shape_id: string; position: TextPosition; text: string }
  | { kind: "delete_text"; slide_id: string; shape_id: string; span: TextSpan }
  | { kind: "format_text"; slide_id: string; shape_id: string; span: TextSpan; patch: TextFormatPatch }
  | { kind: "format_paragraph"; slide_id: string; shape_id: string; block_ids: string[]; patch: ParagraphFormatPatch }
  | { kind: "add_slide"; after_id: string | null; layout_id: string }
  | { kind: "add_slide_with_id"; slide_id: string; after_id: string | null; layout_id: string }
  | { kind: "duplicate_slide"; slide_id: string }
  | { kind: "delete_slides"; slide_ids: string[] }
  | { kind: "move_slides"; slide_ids: string[]; before_id: string | null }
  | { kind: "hide_slides"; slide_ids: string[]; hidden: boolean }
  | { kind: "set_notes"; slide_id: string; text: string }
  | { kind: "add_shape"; slide_id: string; shape: DeckShape }
  | { kind: "patch_shapes"; slide_id: string; patches: DeckShapePatch[] }
  | { kind: "delete_shapes"; slide_id: string; shape_ids: string[] }
  | { kind: "arrange_shapes"; slide_id: string; shape_ids: string[]; action:
      | "front" | "back" | "forward" | "backward" | "align_left" | "align_center" | "align_right"
      | "align_top" | "align_middle" | "align_bottom" | "distribute_horizontal" | "distribute_vertical" }
  | { kind: "group_shapes"; slide_id: string; shape_ids: string[] }
  | { kind: "ungroup_shapes"; slide_id: string; group_id: string }
  | { kind: "apply_layout"; slide_ids: string[]; layout_id: string; preserve_content: true }
  | { kind: "upsert_master"; theme: DeckTheme }
  | { kind: "apply_theme"; theme: DeckTheme; slide_ids: string[] | null; preserve_manual_formatting: true }
  | { kind: "set_transition"; slide_ids: string[]; transition: DeckTransition }
  | { kind: "set_animation"; slide_id: string; shape_id: string; animation_id: string; animation: DeckAnimation }
  | { kind: "remove_animation"; slide_id: string; animation_id: string }
  | { kind: "comment_add"; anchor: OfficeSelection; text: string; author: string }
  | { kind: "comment_reply"; comment_id: string; text: string; author: string }
  | { kind: "comment_resolve"; comment_id: string; resolved: boolean }
  | { kind: "comment_delete"; comment_id: string };
