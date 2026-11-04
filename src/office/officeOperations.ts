import type { DeckOperation } from "./deckOperations";
import type { DocumentOperation } from "./documentOperations";
import type { SheetOperation } from "./sheetOperations";
import type { OfficeSelection, OfficeSessionState } from "./officeValues";

/** The one family-tagged operation union (20a E1). Every element is applied
 * atomically or refused before any change; no arbitrary engine command. */
export type OfficeOperation =
  | { family: "document"; operation: DocumentOperation }
  | { family: "sheet"; operation: SheetOperation }
  | { family: "deck"; operation: DeckOperation };

export interface OfficeTransaction {
  transaction_id: string;
  expected_revision: number;
  operations: OfficeOperation[];
  selection_after: OfficeSelection | null;
  label_key: string;
}

export interface OfficeTransactionResult {
  transaction_id: string;
  state: OfficeSessionState;
  changed: boolean;
  affected_ids: string[];
  warnings: string[];
}

/** Typed atomic restore of the engine's saved content identity (20a E8).
 *
 * `discardOfficeSaved` is not an Undo loop and never writes a file: native
 * restores the exact saved content or refuses with `office_edit.changed`
 * before any visible effect. `changed` is false only for an already-saved
 * session; `state.revision` stays the current public revision in both cases. */
export interface OfficeDiscardSavedResult {
  state: OfficeSessionState;
  changed: boolean;
}
