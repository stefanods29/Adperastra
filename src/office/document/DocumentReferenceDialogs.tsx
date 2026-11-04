import type { DocumentOperation, TextPosition } from "../types";

export function documentInsertField(position: TextPosition,
  fieldKind: "page_number" | "page_count" | "date" | "table_of_contents"): DocumentOperation {
  return { kind: "insert_field", position: { ...position }, field_kind: fieldKind };
}

export function documentRefreshContents(fieldId: string): DocumentOperation {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(fieldId)) throw new Error("office_edit.invalid");
  return { kind: "refresh_field", field_id: fieldId };
}

export function documentFootnote(position: TextPosition, text: string): DocumentOperation {
  if ([...text].length > 16384) throw new Error("office_edit.invalid");
  return { kind: "add_footnote", position: { ...position }, text };
}
