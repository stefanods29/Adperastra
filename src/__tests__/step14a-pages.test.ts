import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  normalizePdfSplitRanges,
  pdfPageDeleteError,
  pdfPagePermutationError,
  planPdfMerge,
  planPdfSplitOutputs,
} from "../pdf-edit/pages";
import { mergePdfDocuments, splitPdfDocument } from "../pdf-write-helper/pageCopy";
import { PAGE_ID, SECOND_PAGE_ID, makePage, makeSecondPage, makeSnapshot } from "./pdfEditFixtures";

const OTHER_SNAPSHOT = "99999999-9999-4999-8999-999999999999";
const DOCUMENT_OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("bounded PDF page operations", () => {
  it("permutation_duplicate_refused", () => {
    const pages = [makePage(), makeSecondPage()];
    expect(pdfPagePermutationError(pages, [PAGE_ID, PAGE_ID])).toBe("pdf_edit.bad_request");
    expect(pdfPagePermutationError(pages, [PAGE_ID])).toBe("pdf_edit.bad_request");
    expect(pdfPagePermutationError(pages, [SECOND_PAGE_ID, PAGE_ID])).toBeNull();
  });

  it("delete_last_refused", () => {
    expect(pdfPageDeleteError([makePage()], [PAGE_ID])).toBe("pdf_edit.bad_request");
    expect(pdfPageDeleteError([makePage(), makeSecondPage()], [SECOND_PAGE_ID])).toBeNull();
    expect(pdfPageDeleteError([makePage(), makeSecondPage()], [PAGE_ID, PAGE_ID])).toBe("pdf_edit.bad_request");
  });

  it("merge_pageorder_A1_B1", async () => {
    const a = makeSnapshot();
    const b = makeSnapshot({ snapshot_id: OTHER_SNAPSHOT, document_id: DOCUMENT_OTHER });
    expect(planPdfMerge([{ snapshot: a, pages: [1] }, { snapshot: b, pages: [1] }])).toEqual([
      { origin_source: a, origin_page: 1 },
      { origin_source: b, origin_page: 1 },
    ]);

    const first = await PDFDocument.create();
    first.addPage([100, 100]);
    const second = await PDFDocument.create();
    second.addPage([300, 300]);
    const merged = await PDFDocument.load(
      await mergePdfDocuments([
        { bytes: await first.save(), pages: [1] },
        { bytes: await second.save(), pages: [1] },
      ]),
    );
    expect(merged.getPageCount()).toBe(2);
    expect(merged.getPage(0).getSize()).toEqual({ width: 100, height: 100 });
    expect(merged.getPage(1).getSize()).toEqual({ width: 300, height: 300 });
  });

  it("split_outputs_owned_noreplace", async () => {
    const ranges = normalizePdfSplitRanges([{ first: 2, last: 3 }, { first: 1, last: 1 }], 3);
    expect(ranges).toEqual([{ first: 1, last: 1 }, { first: 2, last: 3 }]);
    const plans = planPdfSplitOutputs("report.pdf", ranges, 3, new Set(["report-pages-001.pdf"]));
    expect(plans).toEqual([
      { name: "report-pages-001 (1).pdf", range: { first: 1, last: 1 }, publish: "owned-no-replace" },
      { name: "report-pages-002-003.pdf", range: { first: 2, last: 3 }, publish: "owned-no-replace" },
    ]);
    const source = await PDFDocument.create();
    source.addPage([100, 100]);
    source.addPage([200, 200]);
    source.addPage([300, 300]);
    const outputs = await splitPdfDocument(await source.save(), ranges);
    expect(outputs.map((output) => output.bytes.byteLength > 0)).toEqual([true, true]);
    const first = await PDFDocument.load(outputs[0].bytes);
    const second = await PDFDocument.load(outputs[1].bytes);
    expect(first.getPageCount()).toBe(1);
    expect(first.getPage(0).getSize()).toEqual({ width: 100, height: 100 });
    expect(second.getPageCount()).toBe(2);
    expect(second.getPage(0).getSize()).toEqual({ width: 200, height: 200 });
  });

  it("rejects overlapping and out-of-range split ranges", () => {
    expect(() => normalizePdfSplitRanges([{ first: 1, last: 2 }, { first: 2, last: 3 }], 3)).toThrow(
      "pdf_edit.bad_request",
    );
    expect(() => normalizePdfSplitRanges([{ first: 1, last: 4 }], 3)).toThrow("pdf_edit.bad_request");
  });
});
