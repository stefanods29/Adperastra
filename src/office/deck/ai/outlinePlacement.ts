import type {
  DeckLayout,
  DeckShape,
  OfficeAiContext,
  OfficeColor,
  OfficeOperation,
  OfficeRect,
  TextPosition,
} from "../../types";
import type { DeckStyle } from "../styles/styleTypes";
import type { DeckAiLayoutKind, DeckAiOutline, DeckAiSlide } from "./deckAiTypes";

/** A4: the model never draws. Every slide maps to a real style layout and
 * typed operations; IDs are application-owned, never model IDs. */

const MIN_READABLE_PT = 16;

function paragraph(text: string, placeholder: DeckLayout["placeholders"][number]) {
  const format = placeholder.text;
  const readable = Math.max(MIN_READABLE_PT, Math.min(96, format.size_pt));
  return {
    id: crypto.randomUUID(),
    runs: [{ text, format: { ...format, size_pt: readable } }],
    paragraph: { ...placeholder.paragraph },
  };
}

function textShape(layout: DeckLayout, role: string, text: string, stroke: OfficeColor): DeckShape | null {
  if (!text) return null;
  const placeholder = layout.placeholders.find((item) => item.role === role);
  if (!placeholder) return null;
  const rect: OfficeRect = { ...placeholder.rect };
  return {
    id: crypto.randomUUID(),
    kind: "text",
    rect,
    z: 1,
    alt: "",
    fill: null,
    stroke: { color: stroke, width_pt: 0 },
    paragraphs: [paragraph(text, placeholder)],
  } as DeckShape;
}

function layoutFor(style: DeckStyle, kind: DeckAiLayoutKind): DeckLayout {
  const layout = style.theme.layouts.find((item) => item.kind === kind);
  if (!layout) throw new Error("deck_ai.unsupported");
  return layout;
}

function slideShapes(style: DeckStyle, slide: DeckAiSlide, layout: DeckLayout): DeckShape[] {
  if (slide.layout_kind === "blank") return [];
  const color = style.theme.colors.text;
  const shapes: DeckShape[] = [];
  const push = (role: string, text: string) => {
    const shape = textShape(layout, role, text, color);
    if (shape) shapes.push(shape);
  };
  if (slide.layout_kind === "quote") {
    push("quote", slide.quote);
    push("caption", slide.caption);
    return shapes;
  }
  push("title", slide.title);
  if (slide.layout_kind === "two_column") {
    push("body_left", slide.bullets.map((item) => `• ${item}`).join("\n"));
    push("body_right", slide.right_bullets.map((item) => `• ${item}`).join("\n"));
  } else if (slide.layout_kind === "image_caption") {
    push("caption", slide.caption);
  } else if (slide.layout_kind === "section") {
    push("subtitle", slide.bullets.join(" "));
  } else if (slide.layout_kind === "chart") {
    throw new Error("deck_ai.unsupported");
  } else {
    push("body", slide.bullets.map((item) => `• ${item}`).join("\n"));
  }
  return shapes;
}

export function outlineToDeckOperations(
  outline: DeckAiOutline,
  style: DeckStyle,
  target: OfficeAiContext,
): readonly OfficeOperation[] {
  if (target.family !== "deck") throw new Error("deck_ai.invalid");
  if (outline.action === "style") return [];
  if (outline.action === "layout") {
    return outline.layout_choices.map((choice) => {
      const layout = style.theme.layouts.find((item) => item.kind === choice.layout_kind);
      if (!layout) throw new Error("deck_ai.unsupported");
      return {
        family: "deck" as const,
        operation: {
          kind: "apply_layout" as const,
          slide_ids: [choice.slide_id],
          layout_id: layout.id,
          preserve_content: true as const,
        },
      };
    });
  }
  if (outline.action === "notes") {
    const slideIds = target.selection.kind === "deck" ? target.selection.slide_ids : [];
    return outline.slides.slice(0, slideIds.length).map((slide, index) => ({
      family: "deck" as const,
      operation: {
        kind: "set_notes" as const,
        slide_id: slideIds[index],
        text: slide.speaker_notes,
      },
    }));
  }
  if (outline.action === "shorten") {
    if (target.selection.kind !== "deck" || target.selection.slide_ids.length === 0) {
      throw new Error("deck_ai.changed");
    }
    const slideId = target.selection.slide_ids[0];
    const shapeId = target.selection.shape_ids[0];
    if (!shapeId) throw new Error("deck_ai.unsupported");
    const operations: OfficeOperation[] = [];
    for (const slide of outline.slides) {
      for (const run of target.text_runs) {
        const replacement = slide.title || slide.bullets[0] || "";
        if (!replacement || [...replacement].length >= [...run.text].length) continue;
        operations.push({
          family: "deck",
          operation: { kind: "delete_text", slide_id: slideId, shape_id: shapeId, span: run.span },
        } as OfficeOperation);
        operations.push({
          family: "deck",
          operation: { kind: "insert_text", slide_id: slideId, shape_id: shapeId, position: run.span.anchor, text: replacement },
        } as OfficeOperation);
      }
    }
    if (operations.length > 1000) throw new Error("deck_ai.too_large");
    return operations;
  }
  const operations: OfficeOperation[] = [];
  let after: string | null = null;
  for (const slide of outline.slides) {
    const layout = layoutFor(style, slide.layout_kind);
    const slideId = crypto.randomUUID();
    operations.push({
      family: "deck",
      operation: {
        kind: "add_slide_with_id",
        slide_id: slideId,
        after_id: after,
        layout_id: layout.id,
      },
    });
    for (const shape of slideShapes(style, slide, layout)) {
      operations.push({
        family: "deck",
        operation: { kind: "add_shape", slide_id: slideId, shape },
      });
    }
    if (slide.speaker_notes) {
      operations.push({
        family: "deck",
        operation: { kind: "set_notes", slide_id: slideId, text: slide.speaker_notes },
      });
    }
    after = slideId;
  }
  if (operations.length > 1000) throw new Error("deck_ai.too_large");
  return operations;
}

export function firstTextPosition(shape: Extract<DeckShape, { kind: "text" }>): TextPosition {
  const paragraphId = shape.paragraphs[0]?.id;
  if (!paragraphId) throw new Error("deck_ai.invalid");
  return { block_id: paragraphId, offset_utf16: 0 };
}
