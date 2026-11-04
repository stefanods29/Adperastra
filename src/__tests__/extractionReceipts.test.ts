import { describe, expect, it } from "vitest";
import type { ExtractionPreparedRequest } from "../services/aiExtractionTypes";
import {
  guardExtractionStart,
  canSendPrepared,
  EXTRACTION_SENDS_PER_PREPARED,
  requiresOutboundConsent,
} from "../services/aiExtraction";
import { validateExtractionModelReply } from "../services/aiExtractionValidation";
import {
  computeReceipt,
  explicitCurrency,
  parseMinorAmount,
  parseReceiptDate,
  taxIdText,
  RECEIPT_DATE_AMBIGUOUS,
  RECEIPT_MISMATCH_WARNING,
  type ReceiptFieldText,
} from "../extraction/receipts";

function field(overrides: Partial<ReceiptFieldText> = {}): ReceiptFieldText {
  return {
    vendor: "Acme",
    tax_id: "000123",
    date: "2026-11-03",
    currency: "PEN",
    subtotal: "100.00",
    tax: "18.00",
    total: "118.00",
    ...overrides,
  };
}

function prepared(backend: "local" | "api", sensitive = false): ExtractionPreparedRequest {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    request: {
      inputs: [
        {
          kind: "document",
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          expected_revision: 1,
        },
      ],
      kind: "receipts",
      locale: "en",
      ocr_language: "auto",
      request_revision: 1,
    },
    sources: [
      {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        input: {
          kind: "document",
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          expected_revision: 1,
        },
        identity: {
          kind: "disk",
          stamp: {
            path_key: "c:\\scans\\receipts",
            volume_id: "1a2b3c4d",
            file_id: "0011223344556677",
            modified_ticks: "100",
            size_bytes: 2048,
          },
        },
        display_name: "receipt.pdf",
        page_count: 1,
        sensitive,
      },
    ],
    outbound_preview: {
      preview_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      backend,
      provider_id: backend === "api" ? "meta" : null,
      model_id: backend === "api" ? "muse-spark-1.3" : "qwen3.5-4b",
      payload_sha256: backend === "api" ? "a".repeat(64) : null,
      sources: [],
      byte_len: 1024,
      requires_consent: backend === "api",
      expires_unix: 2_000_000_000,
      includes_chat_history: false,
      local_server: false,
    },
    expires_unix: 1_900_000_000,
  };
}

describe("receipt rules", () => {
  it("receipt_minor_units", () => {
    const result = computeReceipt(field());
    expect(result.currency_code).toBe("PEN");
    expect(result.subtotal_minor).toBe(10000);
    expect(result.tax_minor).toBe(1800);
    expect(result.total_minor).toBe(11800);
    expect(result.arithmetic_ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("receipt_mismatch", () => {
    const result = computeReceipt(field({ total: "117.98" }));
    expect(result.arithmetic_ok).toBe(false);
    expect(result.warnings).toContain(RECEIPT_MISMATCH_WARNING);
    expect(result.total_minor).toBe(11798);
  });

  it("receipt_ambiguous_date", () => {
    expect(parseReceiptDate("03/04/2026")).toBeNull();
    expect(parseReceiptDate("13/04/2026")).toBe("2026-04-13");
    expect(parseReceiptDate("04/13/2026")).toBe("2026-04-13");
    const result = computeReceipt(field({ date: "03/04/2026" }));
    expect(result.date_iso).toBeNull();
    expect(result.warnings).toContain(RECEIPT_DATE_AMBIGUOUS);
  });

  it("receipt_tax_id", () => {
    expect(taxIdText("000123")).toBe("000123");
    expect(taxIdText("000123")).not.toBe("123");
    expect(taxIdText(" 000 123 ")).toBe("000 123");
  });

  it("receipt_invented_word", () => {
    const known = new Map<number, string>([[1, "Total"], [2, "118.00"]]);
    expect(() =>
      validateExtractionModelReply(
        { blocks: [{ kind: "paragraph", word_ids: [1, 2], text: "Total 118.00" }] },
        known,
      ),
    ).not.toThrow();
    expect(() =>
      validateExtractionModelReply({ blocks: [{ kind: "paragraph", word_ids: [99] }] }, known),
    ).toThrow("ai_extract.invalid");
    expect(() =>
      validateExtractionModelReply(
        { blocks: [{ kind: "paragraph", word_ids: [1], text: "Refund approved" }] },
        known,
      ),
    ).toThrow("ai_extract.invalid");
  });

  it("receipt_currency_not_guessed", () => {
    expect(explicitCurrency("PEN")).toBe("PEN");
    expect(explicitCurrency("xyz")).toBeNull();
    expect(parseMinorAmount("100.00", null)).toBeNull();
    const result = computeReceipt(field({ currency: "" }));
    expect(result.currency_code).toBeNull();
    expect(result.subtotal_minor).toBeNull();
    expect(result.arithmetic_ok).toBeNull();
    expect(parseMinorAmount("1.234", "PEN")).toBeNull();
    expect(parseMinorAmount("1,234.56", "PEN")).toBe(123456);
  });
});

describe("extraction outbound guard", () => {
  it("extraction_api_requires_send", () => {
    const api = prepared("api");
    expect(requiresOutboundConsent(api)).toBe(true);
    expect(guardExtractionStart(api, null)).toEqual({
      ok: false,
      network: 0,
      error: "assistant.outbound_required",
    });
    expect(guardExtractionStart(api, "consent-1")).toEqual({ ok: true, network: 1, error: null });
    // Local AI prepared without any consent and never touches the network.
    const local = prepared("local");
    expect(requiresOutboundConsent(local)).toBe(false);
    expect(guardExtractionStart(local, null)).toEqual({ ok: true, network: 0, error: null });
  });

  it("extraction_api_source_changed", () => {
    const api = prepared("api");
    expect(guardExtractionStart(api, "consent-1", { source_changed: true })).toEqual({
      ok: false,
      network: 0,
      error: "ai_extract.changed",
    });
  });

  it("extraction_api_sensitive_refused", () => {
    expect(guardExtractionStart(prepared("api", true), "consent-1")).toEqual({
      ok: false,
      network: 0,
      error: "ai_extract.unsupported",
    });
  });

  it("extraction_no_automatic_retry", () => {
    expect(EXTRACTION_SENDS_PER_PREPARED).toBe(1);
    expect(canSendPrepared(0)).toBe(true);
    expect(canSendPrepared(1)).toBe(false);
  });
});
