import { registerAiSchema, type AiSchemaValidation } from "../assistant/schemaRegistry";
import { registerAiPrompt } from "../assistant/promptRegistry";
import documentEn from "../../assets/ai/prompts/extraction/document.en.md?raw";
import documentEs from "../../assets/ai/prompts/extraction/document.es.md?raw";
import tableEn from "../../assets/ai/prompts/extraction/table.en.md?raw";
import tableEs from "../../assets/ai/prompts/extraction/table.es.md?raw";
import receiptEn from "../../assets/ai/prompts/extraction/receipt.en.md?raw";
import receiptEs from "../../assets/ai/prompts/extraction/receipt.es.md?raw";
import inlineEn from "../../assets/ai/prompts/inline/writing.en.md?raw";
import inlineEs from "../../assets/ai/prompts/inline/writing.es.md?raw";

/** Registered extraction and inline assets (Step 17d T1, item 3).
 *
 * Four schema IDs and four prompt templates at revision 1, each in English
 * and Spanish. The schemas are a user-facing guard; the native 17a registry
 * validates the same IDs independently. Registration happens once after the
 * 17a registries exist.
 */

export const EXTRACTION_SCHEMA_IDS = {
  document: "extraction.document.v1",
  table: "extraction.table.v1",
  receipt: "extraction.receipt.v1",
  inline: "writing.inline.v1",
} as const;

export const EXTRACTION_PROMPT_IDS = EXTRACTION_SCHEMA_IDS;
export const EXTRACTION_PROMPT_REVISION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(): AiSchemaValidation {
  return { ok: false, error_code: "ai.schema_invalid" };
}

function wordIds(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 256 &&
    value.every((id) => typeof id === "number" && Number.isSafeInteger(id) && id >= 1)
  );
}

const validateDocument = (value: unknown): AiSchemaValidation => {
  if (!isRecord(value) || !Array.isArray(value.blocks) || value.blocks.length > 10_000) return fail();
  if (Object.keys(value).some((key) => key !== "blocks")) return fail();
  for (const block of value.blocks) {
    if (!isRecord(block) || !wordIds(block.word_ids)) return fail();
    if (!["heading", "paragraph", "list", "table"].includes(String(block.kind))) return fail();
    if (typeof block.text !== "string" && block.text !== undefined) return fail();
    const headingLevel = block.heading_level;
    if (headingLevel !== undefined && headingLevel !== null) {
      if (typeof headingLevel !== "number" || !Number.isInteger(headingLevel) || headingLevel < 1 || headingLevel > 6) return fail();
    }
  }
  return { ok: true, value };
};

const validateTable = (value: unknown): AiSchemaValidation => {
  if (!isRecord(value) || !Array.isArray(value.tables) || value.tables.length > 100) return fail();
  if (Object.keys(value).some((key) => key !== "tables")) return fail();
  for (const table of value.tables) {
    if (!isRecord(table) || !Array.isArray(table.columns) || !Array.isArray(table.rows)) return fail();
    if (table.columns.length < 1 || table.columns.length > 100 || table.rows.length > 10_000) return fail();
    for (const column of table.columns) {
      if (!isRecord(column) || typeof column.name !== "string" || !wordIds(column.word_ids)) return fail();
    }
    for (const row of table.rows) {
      if (!isRecord(row) || !Array.isArray(row.cells) || row.cells.length !== table.columns.length) return fail();
      for (const cell of row.cells) {
        if (!isRecord(cell) || typeof cell.text !== "string" || !wordIds(cell.word_ids)) return fail();
      }
    }
  }
  return { ok: true, value };
};

const validateReceipt = (value: unknown): AiSchemaValidation => {
  if (!isRecord(value) || !isRecord(value.receipt) || !wordIds(value.word_ids)) return fail();
  if (Object.keys(value).some((key) => key !== "receipt" && key !== "word_ids")) return fail();
  const fields = ["vendor", "tax_id", "date", "currency", "subtotal", "tax", "total"];
  if (Object.keys(value.receipt).length !== fields.length) return fail();
  for (const field of fields) {
    const text = value.receipt[field];
    if (typeof text !== "string" || Array.from(text).length > 16_384) return fail();
  }
  return { ok: true, value };
};

const validateInline = (value: unknown): AiSchemaValidation => {
  if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value.completion !== "string") return fail();
  const text = value.completion;
  if (text === "" || Array.from(text).length > 256 || /[\r\n]/.test(text)) return fail();
  return { ok: true, value };
};

function example(user: string, expected: string) {
  return { user, expected_canonical_json: expected };
}

const PROMPTS = [
  {
    id: EXTRACTION_PROMPT_IDS.document,
    locale: "en" as const,
    system_text: documentEn,
    source_argument_names: ["ocr_blocks", "layout"],
    examples: [
      example("Letter / Meet on 2026-11-03.", '{"blocks":[{"kind":"heading","heading_level":1,"word_ids":[1],"text":"Letter"},{"kind":"paragraph","word_ids":[2,3,4],"text":"Meet on 2026-11-03."}]}'),
      example("Bulleted items with visible markers.", '{"blocks":[{"kind":"list","word_ids":[1,2,3,4]}]}'),
      example("Two aligned columns and two rows.", '{"blocks":[{"kind":"table","word_ids":[7,8,9,10]}]}'),
    ],
  },
  {
    id: EXTRACTION_PROMPT_IDS.document,
    locale: "es" as const,
    system_text: documentEs,
    source_argument_names: ["ocr_blocks", "layout"],
    examples: [
      example("Carta / Reunión el 2026-11-03.", '{"blocks":[{"kind":"heading","heading_level":1,"word_ids":[1],"text":"Carta"},{"kind":"paragraph","word_ids":[2,3,4],"text":"Reunión el 2026-11-03."}]}'),
      example("Elementos con viñeta visible.", '{"blocks":[{"kind":"list","word_ids":[1,2,3,4]}]}'),
      example("Dos columnas alineadas y dos filas.", '{"blocks":[{"kind":"table","word_ids":[7,8,9,10]}]}'),
    ],
  },
  {
    id: EXTRACTION_PROMPT_IDS.table,
    locale: "en" as const,
    system_text: tableEn,
    source_argument_names: ["ocr_rows", "page_width"],
    examples: [
      example("Item/Total/Pen/6.00/Book/12.00.", '{"tables":[{"columns":[{"name":"Item","word_ids":[1]},{"name":"Total","word_ids":[2]}],"rows":[{"cells":[{"text":"Pen","word_ids":[3]},{"text":"6.00","word_ids":[4]}]},{"cells":[{"text":"Book","word_ids":[5]},{"text":"12.00","word_ids":[6]}]}]}]}'),
      example("Boundaries disagree beyond 2%.", '{"tables":[]}'),
      example("One column and one row.", '{"tables":[]}'),
    ],
  },
  {
    id: EXTRACTION_PROMPT_IDS.table,
    locale: "es" as const,
    system_text: tableEs,
    source_argument_names: ["ocr_rows", "page_width"],
    examples: [
      example("Artículo/Total/Lápiz/6.00/Libro/12.00.", '{"tables":[{"columns":[{"name":"Artículo","word_ids":[1]},{"name":"Total","word_ids":[2]}],"rows":[{"cells":[{"text":"Lápiz","word_ids":[3]},{"text":"6.00","word_ids":[4]}]},{"cells":[{"text":"Libro","word_ids":[5]},{"text":"12.00","word_ids":[6]}]}]}]}'),
      example("Los límites se alejan más del 2%.", '{"tables":[]}'),
      example("Una columna y una fila.", '{"tables":[]}'),
    ],
  },
  {
    id: EXTRACTION_PROMPT_IDS.receipt,
    locale: "en" as const,
    system_text: receiptEn,
    source_argument_names: ["ocr_words"],
    examples: [
      example("Acme PEN 100.00 18.00 118.00 2026-11-03.", '{"receipt":{"vendor":"Acme","tax_id":"","date":"2026-11-03","currency":"PEN","subtotal":"100.00","tax":"18.00","total":"118.00"},"word_ids":[1,2,3,4,5,6]}'),
      example("Ambiguous 03/04 date, no currency.", '{"receipt":{"vendor":"Acme","tax_id":"","date":"03/04/2026","currency":"","subtotal":"","tax":"","total":"118.00"},"word_ids":[1,2,3]}'),
      example("Tax ID 000123 printed.", '{"receipt":{"vendor":"Acme","tax_id":"000123","date":"","currency":"","subtotal":"","tax":"","total":""},"word_ids":[1]}'),
    ],
  },
  {
    id: EXTRACTION_PROMPT_IDS.receipt,
    locale: "es" as const,
    system_text: receiptEs,
    source_argument_names: ["ocr_words"],
    examples: [
      example("Acme PEN 100.00 18.00 118.00 2026-11-03.", '{"receipt":{"vendor":"Acme","tax_id":"","date":"2026-11-03","currency":"PEN","subtotal":"100.00","tax":"18.00","total":"118.00"},"word_ids":[1,2,3,4,5,6]}'),
      example("Fecha ambigua 03/04 sin moneda.", '{"receipt":{"vendor":"Acme","tax_id":"","date":"03/04/2026","currency":"","subtotal":"","tax":"","total":"118.00"},"word_ids":[1,2,3]}'),
      example("Identificación fiscal 000123.", '{"receipt":{"vendor":"Acme","tax_id":"000123","date":"","currency":"","subtotal":"","tax":"","total":""},"word_ids":[1]}'),
    ],
  },
  {
    id: EXTRACTION_PROMPT_IDS.inline,
    locale: "en" as const,
    system_text: inlineEn,
    source_argument_names: ["before", "after"],
    examples: [
      example('before "The meeting begins ".', '{"completion":"at ten."}'),
      example('before "Gracias por tu ".', '{"completion":"ayuda."}'),
      example('before "const total = items.".', '{"completion":"reduce((sum, item) => sum + item.price, 0);"}'),
    ],
  },
  {
    id: EXTRACTION_PROMPT_IDS.inline,
    locale: "es" as const,
    system_text: inlineEs,
    source_argument_names: ["before", "after"],
    examples: [
      example('antes "La reunión comienza ".', '{"completion":"a las diez."}'),
      example('antes "Thank you for your ".', '{"completion":"help."}'),
      example('antes "const total = items.".', '{"completion":"reduce((sum, item) => sum + item.price, 0);"}'),
    ],
  },
];

let registered = false;

/** Registers the four schemas and eight prompt templates once. */
export function registerExtractionAiAssets(): void {
  if (registered) return;
  registered = true;
  registerAiSchema({
    id: EXTRACTION_SCHEMA_IDS.document,
    revision: 1,
    task: "structured_text",
    max_output_bytes: 262_144,
    validate: validateDocument,
  });
  registerAiSchema({
    id: EXTRACTION_SCHEMA_IDS.table,
    revision: 1,
    task: "structured_text",
    max_output_bytes: 262_144,
    validate: validateTable,
  });
  registerAiSchema({
    id: EXTRACTION_SCHEMA_IDS.receipt,
    revision: 1,
    task: "structured_text",
    max_output_bytes: 262_144,
    validate: validateReceipt,
  });
  registerAiSchema({
    id: EXTRACTION_SCHEMA_IDS.inline,
    revision: 1,
    task: "structured_text",
    max_output_bytes: 2048,
    validate: validateInline,
  });
  for (const prompt of PROMPTS) {
    registerAiPrompt({
      id: prompt.id,
      revision: EXTRACTION_PROMPT_REVISION,
      locale: prompt.locale,
      system_text: prompt.system_text,
      examples: prompt.examples,
      source_argument_names: prompt.source_argument_names,
    });
  }
}
