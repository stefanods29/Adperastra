import type { DocumentOperation } from "../types";

/** Caller displays the returned count and confirms this exact immutable ID list. */
export function previewDocumentReview(changeIds: readonly string[], decision: "accept" | "reject") {
  const ids = [...new Set(changeIds)];
  if (ids.length === 0 || ids.length > 1000 || ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))) {
    throw new Error("office_edit.invalid");
  }
  const operations: DocumentOperation[] = ids.map((change_id) => ({ kind: "review_change", change_id, decision }));
  return { count: ids.length, operations };
}
