import { getTransfer } from "../../services/contentTransfer";
import type {
  TransferAction, TransferBlock, TransferCell, TransferEnvelope, TransferMark, TransferTarget,
} from "../../transfer/types";
import type { OfficeController } from "../OfficeController";
import type {
  DeckOperation, DeckShape, DeckTextParagraph, OfficeColor, TextFormat,
} from "../types";
import { canDeckMutate } from "./deckController";
import {
  buildImageShape, buildTableShape, buildTextShape, defaultParagraphFormat, defaultTextFormat,
  newShapeId, validateShapeRect,
} from "./DeckShapeTools";

/** Content transfer into a deck (Step 22a T4 E3).
 *
 * One accepted transfer becomes exactly one deck transaction, so Undo and
 * the revision increase once. Text lands at the current text box when the
 * selection has a live span; otherwise a new text shape is created. Table
 * cells are typed and formula-like text stays inert. Pictures keep their
 * immutable authorized snapshot. PDF pages need rendered page snapshots
 * from the PDF producer; until that bridge exists no action is offered
 * rather than inserting a PDF file as if it were an image. */

const LOSS_FORMULA = "transfer.lossFormula";
const LOSS_FORMATTING = "transfer.lossFormatting";

function finiteColor(rgba: readonly number[] | undefined): OfficeColor | null {
  if (!rgba || rgba.length !== 4 || !rgba.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
    return null;
  }
  return { r: rgba[0], g: rgba[1], b: rgba[2], a: rgba[3] };
}

function markedFormat(format: TextFormat, marks: readonly TransferMark[]): TextFormat {
  const next = { ...format };
  for (const mark of marks) {
    if (mark.kind === "bold") next.bold = true;
    else if (mark.kind === "italic") next.italic = true;
    else if (mark.kind === "underline") next.underline = "single";
    else if (mark.kind === "strike") next.strike = true;
  }
  const colored = marks.find((mark) => mark.kind === "foreground");
  const rgba = colored?.kind === "foreground" ? colored.foreground_rgba
    : undefined;
  const color = finiteColor(rgba);
  if (color) next.foreground = color;
  return next;
}

function paragraphFromBlock(block: TransferBlock): DeckTextParagraph {
  const runFormat = defaultTextFormat();
  return {
    id: crypto.randomUUID(),
    runs: block.runs.slice(0, 1000).map((run) => ({
      text: run.text.slice(0, 16_384),
      format: markedFormat(runFormat, run.marks),
    })),
    paragraph: {
      ...defaultParagraphFormat(),
      list: block.kind === "list_item" ? (block.list_order === "ordered" ? "decimal" : "disc") : "none",
      outline_level: block.kind === "heading" ? Math.max(0, Math.min(6, (block.level ?? 1) - 1)) : 0,
    },
  };
}

function textParagraphs(text: string): DeckTextParagraph[] {
  const lines = text.split(/\r\n|\n|\r/);
  const format = defaultTextFormat();
  return lines.map((line) => ({
    id: crypto.randomUUID(),
    runs: line ? [{ text: line, format }] : [],
    paragraph: defaultParagraphFormat(),
  }));
}

function richTextShape(value: Extract<TransferEnvelope["payload"], { kind: "rich_text" }>): DeckShape {
  const paragraphs = value.blocks.slice(0, 10_000).map(paragraphFromBlock);
  return {
    id: newShapeId(), kind: "text", rect: { x_pt: 36, y_pt: 72, width_pt: 288, height_pt: 144, rotation_deg: 0 },
    z: 1, alt: "", fill: null, stroke: { color: { r: 0, g: 0, b: 0, a: 255 }, width_pt: 1 },
    paragraphs: paragraphs.length > 0 ? paragraphs : [paragraphFromBlock({ kind: "paragraph", runs: [], depth: 0 })],
  };
}

function cellsShape(value: Extract<TransferEnvelope["payload"], { kind: "cells" }>): DeckShape {
  const cells = value.rows.map((row) => row.map((cell: TransferCell) => {
    if (cell.kind === "text") return (cell.text ?? "").slice(0, 32_767);
    if (cell.kind === "number") return String(cell.number ?? "");
    if (cell.kind === "boolean") return cell.boolean ? "TRUE" : "FALSE";
    return "";
  }));
  return buildTableShape(newShapeId(), cells);
}

export function deckTransferTarget(controller: OfficeController): TransferTarget {
  const actions = (envelope: TransferEnvelope): readonly TransferAction[] => {
    const state = controller.getState();
    if (!canDeckMutate(controller.document, state, "deck_shapes").enabled) return [];
    if (envelope.sensitive && !controller.document.info.sensitive) return [];
    if (!state.selection || state.selection.kind !== "deck" || state.selection.slide_ids.length === 0) return [];
    switch (envelope.payload.kind) {
      case "text":
        return envelope.payload.text.length > 0 && [...envelope.payload.text].length <= 1_048_576
          ? [{ id: "insert_text", label_key: "transfer.insertText", losses: [], mutates: true }]
          : [];
      case "rich_text":
        return envelope.payload.blocks.length > 0
          ? [{ id: "insert_rich_text", label_key: "transfer.insertRich", losses: [LOSS_FORMATTING], mutates: true }]
          : [];
      case "cells": {
        const formula = envelope.payload.rows.some((row) => row.some((cell) => cell.kind === "text" && (cell.text ?? "").startsWith("=")));
        return [{ id: "insert_cells", label_key: "transfer.insertCells", losses: formula ? [LOSS_FORMULA] : [], mutates: true }];
      }
      case "image":
        return [{ id: "insert_image", label_key: "transfer.insertImage", losses: [], mutates: true }];
      default:
        // pdf_pages and files need a rendered snapshot / differens pipeline
        // that this step does not own; no fake insertion is offered.
        return [];
    }
  };

  return {
    target_id: `office-deck:${controller.document.id}`,
    document_id: controller.document.id,
    accepted_kinds: ["text", "rich_text", "cells", "image", "pdf_pages"],
    describe: actions,
    async accept(envelope, actionId) {
      const before = controller.getState();
      const beforeSelection = JSON.stringify(before.selection);
      const authorized = await getTransfer(envelope.transfer_id);
      const live = controller.getState();
      if (before.revision !== live.revision || before.content_id !== live.content_id ||
          beforeSelection !== JSON.stringify(live.selection)) throw new Error("office_edit.changed");
      if (actions(authorized).every((action) => action.id !== actionId)) throw new Error("office_edit.unsupported");
      const selection = live.selection;
      if (!selection || selection.kind !== "deck") throw new Error("office_edit.unsupported");
      const slideId = selection.slide_ids[0];
      let operation: DeckOperation;
      let inserted = 1;

      if (authorized.payload.kind === "text" && actionId === "insert_text") {
        const text = authorized.payload.text;
        inserted = [...text].length;
        const active = selection.text_span && selection.shape_ids[0]
          ? { shapeId: selection.shape_ids[0], span: selection.text_span }
          : null;
        if (active) {
          operation = {
            kind: "insert_text", slide_id: slideId, shape_id: active.shapeId,
            position: active.span.focus, text,
          };
        } else {
          const shape = buildTextShape(newShapeId(), text);
          if (!validateShapeRect(shape.rect)) throw new Error("office_edit.invalid");
          operation = { kind: "add_shape", slide_id: slideId, shape };
        }
      } else if (authorized.payload.kind === "rich_text" && actionId === "insert_rich_text") {
        operation = { kind: "add_shape", slide_id: slideId, shape: richTextShape(authorized.payload) };
      } else if (authorized.payload.kind === "cells" && actionId === "insert_cells") {
        operation = { kind: "add_shape", slide_id: slideId, shape: cellsShape(authorized.payload) };
      } else if (authorized.payload.kind === "image" && actionId === "insert_image") {
        operation = {
          kind: "add_shape", slide_id: slideId,
          shape: buildImageShape(newShapeId(), authorized.payload.snapshot, ""),
        };
      } else {
        throw new Error("office_edit.unsupported");
      }

      const result = await controller.transact({
        transaction_id: crypto.randomUUID(),
        expected_revision: live.revision,
        operations: [{ family: "deck", operation }],
        selection_after: null,
        label_key: "office.transaction",
      });
      const losses = actions(authorized).find((action) => action.id === actionId)?.losses ?? [];
      return {
        transaction_id: result.transaction_id,
        target_document_id: result.state.document_id,
        revision: result.state.revision,
        inserted_count: result.changed ? inserted : 0,
        losses,
        complete: true,
      };
    },
  };
}
