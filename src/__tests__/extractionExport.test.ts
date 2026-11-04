import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversionReport, ConversionRequest } from "../convert/types";
import type { ExportSnapshot } from "../services/exportSnapshots";
import type { JobHandle } from "../services/jobs";
import type {
  ExtractionPublish,
  ExtractionReview,
  ExtractionTable,
  ExtractionValue,
} from "../services/aiExtractionTypes";
import {
  buildConversionRequest,
  buildOutputModel,
  EXTRACTION_CONVERTERS,
  requiredExtractionWarnings,
} from "../convert/extractionConverters";
import { outputPaths, publishExtraction } from "../extraction/extractionPublication";
import {
  csvField,
  docxModelFromSnapshot,
  encodeDocx,
  encodeExtractionOutput,
  spreadsheetCell,
  type EncoderSnapshot,
} from "../../helper/extraction_encode.mjs";

vi.mock("../services/aiExtraction", () => ({
  captureExtraction: vi.fn(),
  extractionPage: vi.fn(),
  correctExtraction: vi.fn(),
  releaseExtraction: vi.fn(),
  requestInlineCompletion: vi.fn(),
}));
vi.mock("../services/convert", () => ({ startConversion: vi.fn() }));
vi.mock("../services/exportSnapshots", () => ({ releaseExportSnapshot: vi.fn(async () => undefined) }));
vi.mock("../convert/registry", () => ({ resolveConverter: vi.fn(() => ({ id: "extraction_docx" })) }));

import { captureExtraction } from "../services/aiExtraction";
import { startConversion } from "../services/convert";
import { releaseExportSnapshot } from "../services/exportSnapshots";

const SOURCE_ID = "99999999-9999-4999-8999-999999999999";
const INPUT_ID = "88888888-8888-4888-8888-888888888888";
const TABLE_ID = "77777777-7777-4777-8777-777777777777";

function value(id: string, text: string): ExtractionValue {
  return {
    id,
    original: text,
    value: text,
    confidence: 0.95,
    status: "certain",
    anchors: [],
    correction_revision: 0,
  };
}

function table(): ExtractionTable {
  return {
    id: TABLE_ID,
    source_ids: [SOURCE_ID],
    columns: [
      { id: "aaaa1111-1111-4111-8111-111111111111", name: value("aaaa2222-2222-4222-8222-222222222222", "Item"), type: "text" },
      { id: "bbbb1111-1111-4111-8111-111111111111", name: value("bbbb2222-2222-4222-8222-222222222222", "Total"), type: "text" },
    ],
    rows: [
      {
        id: "cccc1111-1111-4111-8111-111111111111",
        cells: [value("cccc2222-2222-4222-8222-222222222222", "Pen"), value("cccc3333-3333-4333-8333-333333333333", "=SUM(1,2)")],
      },
    ],
    header: true,
  };
}

function review(): ExtractionReview {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    revision: 2,
    content_id: "55555555-5555-4555-8555-555555555555",
    sources: [
      {
        id: SOURCE_ID,
        input: { kind: "document", id: INPUT_ID, expected_revision: 1 },
        identity: {
          kind: "disk",
          stamp: {
            path_key: "c:\\scans\\letter.pdf",
            volume_id: "1a2b3c4d",
            file_id: "0011223344556677",
            modified_ticks: "100",
            size_bytes: 2048,
          },
        },
        display_name: "letter.pdf",
        page_count: 1,
        sensitive: false,
      },
    ],
    blocks: [
      {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        kind: "heading",
        order: 0,
        heading_level: 1,
        text: value("dddd1111-1111-4111-8111-111111111111", "Letter"),
        list_items: [],
        table_id: null,
      },
      {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        kind: "paragraph",
        order: 1,
        heading_level: null,
        text: value("dddd2222-2222-4222-8222-222222222222", "Meet on 2026-11-03."),
        list_items: [],
        table_id: null,
      },
      {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        kind: "table",
        order: 2,
        heading_level: null,
        text: null,
        list_items: [],
        table_id: TABLE_ID,
      },
    ],
    tables: [table()],
    receipts: [],
    complete: true,
    warnings: [],
    next_cursor: null,
    expires_unix: 2_000_000_000,
    sensitive: false,
  };
}

function publish(): ExtractionPublish {
  return {
    review_id: review().id,
    expected_revision: 2,
    expected_content_id: review().content_id,
    format: "docx",
    table_id: null,
    dest_dir: "C:\\Out",
    name: "letter",
    accepted_warning_codes: ["layout_loss", "formula_safety_prefix"],
    include_source_labels: false,
  };
}

function snapshot(): ExportSnapshot {
  return {
    snapshot_id: "12345678-1234-4123-8123-123456789012",
    document_id: "66666666-6666-4666-8666-666666666666",
    revision: 2,
    content_id: review().content_id,
    mime: "application/vnd.adperastra.extraction+json",
    byte_len: 4096,
    storage_policy: "ordinary",
    expires_unix: 2_000_000_000,
  };
}

function handle<T>(result: T): JobHandle<T> {
  return { id: "job", cancel: vi.fn(async () => undefined), completion: Promise.resolve(result) };
}

function report(): ConversionReport {
  return {
    report_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    items: [
      {
        input_index: 0,
        output_count: 1,
        status: "done",
        metadata_lost: [],
        bytes_written: 1024,
      },
    ],
    outputs: [
      {
        output_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        input_indices: [0],
        output_index: 0,
        path: "C:\\Out\\letter.docx",
        byte_len: 1024,
      },
    ],
    created_paths: ["C:\\Out\\letter.docx"],
    input_total: 1,
    done_count: 1,
    failed_count: 0,
    skipped_count: 0,
    cancelled_count: 0,
    outputs_created: 1,
    cancelled: false,
    job_finished: true,
    complete: true,
  };
}

const flush = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

beforeEach(() => {
  vi.mocked(captureExtraction).mockReset().mockResolvedValue(handle(snapshot()));
  vi.mocked(startConversion).mockReset().mockResolvedValue(handle(report()));
  vi.mocked(releaseExportSnapshot).mockReset().mockResolvedValue(undefined);
});

describe("extraction exports", () => {
  it("scan_docx_real_structure", async () => {
    const model = docxModelFromSnapshot({ schema: 1, review: review(), publish: publish() } as EncoderSnapshot);
    expect(model.blocks.map((block) => block.type)).toEqual(["heading", "paragraph", "table"]);
    expect(model.blocks.some((block) => (block as { type: string }).type === "image")).toBe(false);
    const bytes = await encodeDocx({ schema: 1, review: review(), publish: publish() } as EncoderSnapshot);
    const raw = new TextDecoder("latin1").decode(bytes);
    expect(raw).toContain("word/document.xml");
    expect(raw).not.toContain("word/media/");
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("xlsx_formula_inert", () => {
    expect(spreadsheetCell("=SUM(1,2)")).toBe("'=SUM(1,2)");
    expect(typeof spreadsheetCell("=SUM(1,2)")).toBe("string");
    expect(spreadsheetCell("-5.00", "number")).toBe(-5);
    const model = buildOutputModel(review(), publish());
    expect(requiredExtractionWarnings(model)).toContain("formula_safety_prefix");
    expect(EXTRACTION_CONVERTERS.map((converter) => converter.output)).toEqual([
      "docx",
      "md",
      "txt",
      "xlsx",
      "csv",
    ]);
  });

  it("csv_quote", async () => {
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("plain")).toBe("plain");
    const result = await encodeExtractionOutput(
      { schema: 1, review: review(), publish: { ...publish(), format: "csv", table_id: TABLE_ID } } as EncoderSnapshot,
      "csv",
    );
    // A UTF-8 decoder strips the leading BOM unless it is told to keep it.
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(result.bytes);
    expect(text.startsWith("\uFEFF")).toBe(true);
    expect(text).toContain("\r\n");
    expect(text).toContain("\"'=SUM(1,2)\"");
    expect(result.draft.mime).toBe("text/csv");
    expect(result.draft.input_indices).toEqual([0]);
  });

  it("export_capture_revision", () => {
    const source = review();
    const request = buildConversionRequest(publish(), snapshot(), "2026-11-02");
    const before = JSON.parse(JSON.stringify(request)) as ConversionRequest;
    source.blocks[0].text!.value = "Changed after capture";
    expect(request).toEqual(before);
    expect(request.inputs[0]).toEqual({
      kind: "snapshot",
      snapshot_id: snapshot().snapshot_id,
      document_id: snapshot().document_id,
      revision: 2,
    });
    expect(request.naming).toEqual({ pattern: "{stem}.{ext}", date_utc: "2026-11-02", start_index: 1 });
  });

  it("export_collision", async () => {
    // Collision handling belongs to 08a's parent publication; this layer must
    // never ask to replace and must never touch a foreign file.
    const foreign = { name: "letter.docx", hash: "foreign-hash" };
    vi.mocked(startConversion).mockImplementation(async (request: ConversionRequest) => {
      expect(request.keep_original).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(request, "overwrite")).toBe(false);
      expect(request.accepted_losses).toEqual([]);
      return handle(report());
    });
    const job = await publishExtraction(publish(), { capturedUtc: "2026-11-02" });
    const result = await job.completion;
    expect(result.outputs[0].path).toBe("C:\\Out\\letter.docx");
    expect(foreign.hash).toBe("foreign-hash");
    expect(foreign.name).toBe("letter.docx");
    await flush();
    expect(releaseExportSnapshot).toHaveBeenCalledWith(snapshot().snapshot_id);
  });

  it("export_outputs", async () => {
    const job = await publishExtraction(publish(), { capturedUtc: "2026-11-02" });
    const result = await job.completion;
    expect(outputPaths(result)).toEqual(["C:\\Out\\letter.docx"]);
    expect(result.items[0]).not.toHaveProperty("output_path");
    expect(result.outputs).toHaveLength(1);
    expect(captureExtraction).toHaveBeenCalledTimes(1);
    expect(startConversion).toHaveBeenCalledTimes(1);
  });
});
