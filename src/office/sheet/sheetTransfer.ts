import type { TransferAction, TransferCell, TransferEnvelope, TransferTarget } from "../../transfer/types";
import { getTransfer } from "../../services/contentTransfer";
import type { OfficeController } from "../OfficeController";
import type { CellInput, CellRange } from "../types";
import { canOfficeCommand } from "../officeCompatibility";

function cellInput(cell: TransferCell): CellInput {
  switch (cell.kind) {
    case "blank": return { kind: "blank" };
    case "text":
      if (typeof cell.text !== "string" || cell.text.length > 32_767) break;
      return { kind: "text", text: cell.text };
    case "number":
      if (typeof cell.number !== "number" || !Number.isFinite(cell.number)) break;
      return { kind: "number", value: cell.number };
    case "boolean":
      if (typeof cell.boolean !== "boolean") break;
      return { kind: "boolean", value: cell.boolean };
  }
  throw new Error("transfer.invalid");
}

export function sheetTransferTarget(controller: OfficeController): TransferTarget {
  function describe(envelope: TransferEnvelope): readonly TransferAction[] {
    const state = controller.getState();
    if (!canOfficeCommand(state, "sheet_cells", true).enabled || state.selection?.kind !== "sheet" ||
      (envelope.sensitive && !controller.document.info.sensitive)) return [];
    if (envelope.payload.kind === "cells") return [{ id: "insert_cells", label_key: "transfer.insertCells", losses:
      envelope.payload.rows.some((row) => row.some((cell) => cell.format !== undefined)) ? ["transfer.lossFormatting"] : [], mutates: true }];
    if (envelope.payload.kind === "text") return [{ id: "insert_text", label_key: "transfer.insertText", losses: [], mutates: true }];
    // No imported-drawing preservation capability is exposed by office-edit-1.
    return [];
  }
  return {
    target_id: `office-sheet:${controller.document.id}`, document_id: controller.document.id,
    accepted_kinds: ["cells", "text"], describe,
    async accept(envelope, actionId) {
      // Resolve the native source lease; do not trust caller-provided classification.
      const authoritative = await getTransfer(envelope.transfer_id);
      const action = describe(authoritative).find((item) => item.id === actionId);
      if (!action) throw new Error("transfer.unsupported");
      const state = controller.getState();
      if (state.selection?.kind !== "sheet") throw new Error("transfer.invalid");
      const active = state.selection.active;
      let values: CellInput[][];
      if (authoritative.payload.kind === "text") {
        if (authoritative.payload.text.length > 32_767) throw new Error("transfer.too_large");
        values = [[{ kind: "text", text: authoritative.payload.text }]];
      } else if (authoritative.payload.kind === "cells") {
        const payload = authoritative.payload;
        if (!Number.isInteger(payload.row_count) || !Number.isInteger(payload.column_count) || payload.row_count < 1 || payload.column_count < 1 ||
          payload.column_count > 2000 || payload.row_count * payload.column_count > 100_000 || payload.rows.length !== payload.row_count ||
          payload.rows.some((row) => row.length !== payload.column_count)) throw new Error("transfer.too_large");
        values = payload.rows.map((row) => row.map(cellInput));
      } else throw new Error("transfer.unsupported");
      const range: CellRange = { sheet_id: active.sheet_id, first_row: active.row, first_column: active.column,
        last_row: active.row + values.length - 1, last_column: active.column + values[0].length - 1 };
      if (range.last_row >= 1_048_576 || range.last_column >= 16_384) throw new Error("transfer.too_large");
      const transaction = {
        transaction_id: crypto.randomUUID(), expected_revision: state.revision,
        operations: [{ family: "sheet" as const, operation: { kind: "set_cells" as const, range, values, mode: "values" as const } }],
        selection_after: null, label_key: "office.transaction",
      };
      // Large leased set_cells transport lacks a public DTO; fail before mutation.
      if (new TextEncoder().encode(JSON.stringify(transaction)).byteLength > 768 * 1024) throw new Error("transfer.too_large");
      const result = await controller.transact(transaction);
      return { transaction_id: result.transaction_id, target_document_id: controller.document.id,
        revision: result.state.revision, inserted_count: values.length * values[0].length, losses: action.losses, complete: true };
    },
  };
}
