import type { OfficeController } from "../OfficeController";
import type { CellInput, CellRange } from "../types";
import { parseFormula } from "./formulaLocale";

/** One view-local buffer. Never put this object in a session codec. */
export function createFormulaEditing(controller: OfficeController, range: CellRange, original: string, locale: "en-US" | "es-419") {
  const expected_revision = controller.getState().revision;
  const target = { ...range };
  let buffer = original;
  let editing = true;
  let error_offset_utf16: number | null = null;
  let pending: Promise<boolean> | null = null;
  let committing = false;
  let generation = 0;

  const getState = () => ({ buffer, editing, pending: pending !== null, committing, error_offset_utf16 });
  const setBuffer = (value: string) => {
    if (!editing || pending) return;
    buffer = value; error_offset_utf16 = null;
  };
  const cancel = () => {
    // An admitted native transaction cannot be represented as cancelled locally.
    if (committing) return false;
    generation += 1; buffer = original; editing = false; error_offset_utf16 = null;
    return true;
  };
  const confirm = (fillRange?: CellRange): Promise<boolean> => {
    if (pending) return pending;
    if (!editing) return Promise.resolve(false);
    if (!fillRange && buffer === original) { editing = false; return Promise.resolve(true); }
    const token = generation;
    const text = buffer;
    pending = (async () => {
      const destination = fillRange ? { ...fillRange } : target;
      if (destination.sheet_id !== target.sheet_id ||
        ![destination.first_row, destination.last_row, destination.first_column, destination.last_column].every(Number.isInteger) ||
        destination.first_row < 0 || destination.first_column < 0 || destination.last_row >= 1_048_576 || destination.last_column >= 16_384) throw new Error("office_edit.invalid");
      const rows = destination.last_row - destination.first_row + 1;
      const columns = destination.last_column - destination.first_column + 1;
      if (rows < 1 || columns < 1 || rows * columns > 100_000) throw new Error("office_edit.too_large");
      let input: CellInput;
      if (text.startsWith("=")) {
        const parsed = await parseFormula(controller, text, locale);
        if (generation !== token) return false;
        if (!parsed.valid) { error_offset_utf16 = parsed.error_offset_utf16; return false; }
        input = { kind: "formula", canonical: parsed.canonical };
      } else if (text === "") input = { kind: "blank" };
      else if (/^[+-]?(?:(?:0|[1-9]\d*)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) && Number.isFinite(Number(text))) {
        input = { kind: "number", value: Number(text) };
      } else {
        if (text.length > 32_767) throw new Error("office_edit.too_large");
        input = { kind: "text", text };
      }
      if (generation !== token) return false;
      // Reject before constructing a potentially enormous filled rectangle.
      if (new TextEncoder().encode(JSON.stringify(input)).byteLength * rows * columns > 768 * 1024) throw new Error("office_edit.too_large");
      const transaction = {
        transaction_id: crypto.randomUUID(), expected_revision,
        operations: [{ family: "sheet" as const, operation: { kind: "set_cells" as const, range: destination,
          values: Array.from({ length: rows }, () => Array.from({ length: columns }, () => ({ ...input }))), mode: "all" as const } }],
        selection_after: null, label_key: "office.transaction",
      };
      if (new TextEncoder().encode(JSON.stringify(transaction)).byteLength > 768 * 1024) throw new Error("office_edit.too_large");
      committing = true;
      await controller.transact(transaction);
      editing = false; return true;
    })().finally(() => { pending = null; committing = false; });
    return pending;
  };
  return { getState, setBuffer, cancel, confirm };
}
