import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import ExtractionReviewPane from "../extraction/ExtractionReviewPane";
import {
  applyCorrections,
  isRectangular,
} from "../extraction/extractionCorrections";
import type {
  ExtractionReview,
  ExtractionTable,
  ExtractionValue,
} from "../services/aiExtractionTypes";

vi.mock("../services/aiExtraction", () => ({
  extractionPage: vi.fn(),
  correctExtraction: vi.fn(),
  releaseExtraction: vi.fn(async () => undefined),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number; estimateSize: (index: number) => number }) => ({
    getTotalSize: () => opts.count * opts.estimateSize(0),
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, index) => ({
        index,
        start: index * opts.estimateSize(index),
        size: opts.estimateSize(index),
        key: index,
      })),
    measure: () => undefined,
    scrollToIndex: () => undefined,
  }),
}));

import { extractionPage, releaseExtraction } from "../services/aiExtraction";

const SOURCE_ID = "99999999-9999-4999-8999-999999999999";
const INPUT_ID = "88888888-8888-4888-8888-888888888888";

function field(
  id: string,
  text: string,
  page: number,
  status: ExtractionValue["status"] = "certain",
  rect = { x: 0.1, y: 0.2, width: 0.2, height: 0.03 },
): ExtractionValue {
  return {
    id,
    original: text,
    value: text,
    confidence: status === "uncertain" ? 0.5 : 0.95,
    status,
    anchors: [{ source_id: SOURCE_ID, page, word_ids: [1], rect, quote: text }],
    correction_revision: 0,
  };
}

function cell(id: string, text: string): ExtractionValue {
  return field(id, text, 1);
}

function lineItems(): ExtractionTable {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    source_ids: [SOURCE_ID],
    columns: [
      { id: "aaaa1111-1111-4111-8111-111111111111", name: field("aaaa2222-2222-4222-8222-222222222222", "Item", 1), type: "text" },
      { id: "bbbb1111-1111-4111-8111-111111111111", name: field("bbbb2222-2222-4222-8222-222222222222", "Total", 1), type: "text" },
    ],
    rows: [
      {
        id: "cccc1111-1111-4111-8111-111111111111",
        cells: [cell("cccc2222-2222-4222-8222-222222222222", "Pen"), cell("cccc3333-3333-4333-8333-333333333333", "R")],
      },
    ],
    header: true,
  };
}

function reviewFixture(): ExtractionReview {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    revision: 3,
    content_id: "55555555-5555-4555-8555-555555555555",
    sources: [
      {
        id: SOURCE_ID,
        input: { kind: "document", id: INPUT_ID, expected_revision: 1 },
        identity: {
          kind: "disk",
          stamp: {
            path_key: "c:\\scans\\receipt.pdf",
            volume_id: "1a2b3c4d",
            file_id: "0011223344556677",
            modified_ticks: "100",
            size_bytes: 2048,
          },
        },
        display_name: "receipt.pdf",
        page_count: 2,
        sensitive: false,
      },
    ],
    blocks: [],
    tables: [],
    receipts: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        source_id: SOURCE_ID,
        vendor: field("11111111-1111-4111-8111-111111111111", "Acme", 1),
        tax_id: field("11111111-1111-4111-8111-111111111112", "000123", 1),
        date: field("11111111-1111-4111-8111-111111111113", "03/04/2026", 2, "uncertain"),
        currency: field("11111111-1111-4111-8111-111111111114", "PEN", 1),
        subtotal: field("11111111-1111-4111-8111-111111111115", "100.00", 1),
        tax: field("11111111-1111-4111-8111-111111111116", "18.00", 1),
        total: field("11111111-1111-4111-8111-111111111117", "118.00", 1),
        line_items: lineItems(),
        date_iso: null,
        currency_code: "PEN",
        subtotal_minor: 10000,
        tax_minor: 1800,
        total_minor: 11800,
        arithmetic_ok: true,
      },
    ],
    complete: true,
    warnings: [],
    next_cursor: null,
    expires_unix: 2_000_000_000,
    sensitive: false,
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function flush(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
  });
}

async function render(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <ExtractionReviewPane
        reviewId={reviewFixture().id}
        onClose={() => undefined}
        onOpenHelp={() => undefined}
      />,
    );
  });
  await flush();
}

beforeEach(() => {
  vi.mocked(extractionPage).mockReset().mockResolvedValue(reviewFixture());
  vi.mocked(releaseExtraction).mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

describe("extraction review", () => {
  it("review_source_sync", async () => {
    await render();
    const date = container!.querySelector('[data-field="aiExtract.date"]') as HTMLElement;
    act(() => date.focus());
    const source = container!.querySelector(".adp-extraction-source") as HTMLElement;
    expect(source.dataset.page).toBe("2");

    const vendor = container!.querySelector('[data-field="aiExtract.vendor"]') as HTMLElement;
    act(() => vendor.focus());
    expect(source.dataset.page).toBe("1");
    const anchor = container!.querySelector('[data-testid="extraction-anchor"]') as HTMLElement;
    expect(anchor.dataset.page).toBe("1");
    expect(anchor.style.left).toBe("10%");
    expect(anchor.style.top).toBe("20%");
  });

  it("review_uncertain_label", async () => {
    await render();
    const date = container!.querySelector('[data-field="aiExtract.date"]') as HTMLElement;
    expect(date.dataset.status).toBe("uncertain");
    expect(date.querySelector('[data-status-icon="uncertain"]')).not.toBeNull();
    const label = i18n.t("aiExtract.uncertain");
    expect(date.textContent).toContain(label);
    expect(date.getAttribute("aria-label")).toContain(label);
    expect(date.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("review_correct_one_cell", () => {
    const review = reviewFixture();
    const table = review.receipts[0].line_items;
    const row = table.rows[0];
    const column = table.columns[1];
    const next = applyCorrections(review, review.revision, [
      {
        kind: "table_cell",
        table_id: table.id,
        row_id: row.id,
        column_id: column.id,
        expected: "R",
        value: "R+1",
      },
    ]);
    expect(next.revision).toBe(review.revision + 1);
    expect(next.content_id).not.toBe(review.content_id);
    expect(next.receipts[0].line_items.rows[0].cells[1].value).toBe("R+1");
    expect(next.receipts[0].line_items.rows[0].cells[1].status).toBe("corrected");
    // Only the edited value changed.
    expect(next.receipts[0].line_items.rows[0].cells[0].value).toBe("Pen");
    expect(next.receipts[0].vendor.value).toBe("Acme");
    // The source never changes.
    expect(review.receipts[0].line_items.rows[0].cells[1].value).toBe("R");
  });

  it("review_stale_correction", () => {
    const review = reviewFixture();
    const table = review.receipts[0].line_items;
    const corrected = applyCorrections(review, 3, [
      { kind: "field", id: review.receipts[0].vendor.id, expected: "Acme", value: "Acme S.A." },
    ]);
    expect(() =>
      applyCorrections(corrected, 3, [
        { kind: "field", id: review.receipts[0].vendor.id, expected: "Acme S.A.", value: "Other" },
      ]),
    ).toThrow("ai_extract.changed");
    expect(isRectangular(table)).toBe(true);
  });

  it("review_split_column", () => {
    const review = reviewFixture();
    const table = review.receipts[0].line_items;
    table.columns[0].name = { ...table.columns[0].name, original: "A,B", value: "A,B" };
    table.rows[0].cells[0] = { ...table.rows[0].cells[0], original: "A,B", value: "A,B" };
    const next = applyCorrections(review, review.revision, [
      { kind: "split_column", table_id: table.id, column_id: table.columns[0].id, separator: "," },
    ]);
    const changed = next.receipts[0].line_items;
    expect(changed.columns.map((column) => column.name.value)).toEqual(["A", "B", "Total"]);
    expect(changed.columns).toHaveLength(3);
    expect(changed.rows[0].cells.map((entry) => entry.value)).toEqual(["A", "B", "R"]);
    expect(isRectangular(changed)).toBe(true);
  });
});
