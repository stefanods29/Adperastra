import type { DeckOperation, OfficeAccessibleNode } from "../types";

export function deckTextOperations(
  slideId: string,
  shapeId: string,
  target: NonNullable<OfficeAccessibleNode["deck_text"]>,
  next: string,
  revision: number,
): DeckOperation[] {
  const { span, text } = target;
  if (span.revision !== revision) throw new Error("office_edit.changed");
  if (span.anchor.block_id !== span.focus.block_id ||
      span.focus.offset_utf16 - span.anchor.offset_utf16 !== text.length) {
    throw new Error("office_edit.invalid");
  }
  const before = Array.from(text);
  const after = Array.from(next);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix &&
      before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  const start = span.anchor.offset_utf16 + before.slice(0, prefix).join("").length;
  const end = span.focus.offset_utf16 - before.slice(before.length - suffix).join("").length;
  const position = { block_id: span.anchor.block_id, offset_utf16: start };
  const operations: DeckOperation[] = [];
  if (start < end) operations.push({
    kind: "delete_text", slide_id: slideId, shape_id: shapeId,
    span: { anchor: position, focus: { ...position, offset_utf16: end }, revision },
  });
  const insert = after.slice(prefix, after.length - suffix).join("");
  if (insert) operations.push({ kind: "insert_text", slide_id: slideId, shape_id: shapeId, position, text: insert });
  return operations;
}
