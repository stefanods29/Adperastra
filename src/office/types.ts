/** Canonical Office barrel (20a E1, office-edit-1). Wire records are
 * snake_case. The proposal diff tag is `kind`; a chart diff carries its chart
 * family in the separate `chart_kind` field (see officeAiTypes). */
export type { OfficeFormat } from "../services/engineTypes";

export * from "./officeValues";
export * from "./presentationTypes";
export * from "./officeAiTypes";
export * from "./officeItems";
export * from "./officeOperations";

export type { DocumentOperation } from "./documentOperations";
export type { SheetOperation } from "./sheetOperations";
export type { DeckOperation } from "./deckOperations";
