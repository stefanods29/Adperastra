import { zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { boundedUnzlib } from "../book-helper/boundedUnzlib";
import { paginateSection, pageText } from "../book-helper/bookPages";
import { imageHtml, okParagraph, scriptedHtml } from "./step07fFixtures";
import {
  makeMobiFileLike,
  normalizeEntryName,
  resolveBookResource,
  type ByteRangeReader,
} from "../book-helper/bookResources";

describe("book resources", () => {
  it("ebook_resource_cannot_escape_book", () => {
    expect(() => normalizeEntryName("../secret")).toThrowError("extra_view.bad_request");
    expect(() => resolveBookResource("OEBPS/ch1.xhtml", "../secret")).toThrowError(
      "extra_view.bad_request",
    );
    expect(() => resolveBookResource("OEBPS/ch1.xhtml", "https://remote/x.png")).toThrowError(
      "extra_view.bad_request",
    );
    expect(resolveBookResource("OEBPS/text/ch1.xhtml", "images/a.png")).toBe(
      "OEBPS/text/images/a.png",
    );
  });

  it("mobi parser does not request the whole file before the first section", async () => {
    const ranges: [number, number][] = [];
    const reader: ByteRangeReader = {
      async read(start, end) {
        ranges.push([start, end]);
        return new Uint8Array(end - start);
      },
    };
    const file = makeMobiFileLike("book.mobi", 10_000, reader);
    await file.slice(0, 78).arrayBuffer();
    await file.slice(1_000, 2_000).arrayBuffer();
    expect(ranges).toEqual([
      [0, 78],
      [1_000, 2_000],
    ]);
    expect(ranges.reduce((sum, [start, end]) => sum + (end - start), 0)).toBeLessThan(10_000);
  });
});

describe("book pages", () => {
  it("book_script_never_runs", () => {
    const pages = paginateSection(scriptedHtml);
    const html = pages.map((page) => page.html).join("");
    expect(html).not.toContain("<script");
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
    expect(html).toContain(okParagraph);
  });

  it("paragraph_4001_scalars_splits_4000_and_1_without_whitespace", () => {
    const long = "a".repeat(4_001);
    const pages = paginateSection(`<p>${long}</p>`);
    expect(pages).toHaveLength(2);
    expect(pageText(pages[0].html).length).toBe(4_000);
    expect(pageText(pages[1].html).length).toBe(1);
  });

  it("splits at the last whitespace before the limit", () => {
    const long = `${"a".repeat(3_990)} ${"b".repeat(20)}`;
    const pages = paginateSection(`<p>${long}</p>`);
    expect(pageText(pages[0].html)).toBe("a".repeat(3_990));
    expect(pageText(pages[1].html)).toBe("b".repeat(20));
  });

  it("an image stands alone on its page", () => {
    const pages = paginateSection(
      imageHtml,
    );
    expect(pages).toHaveLength(3);
    expect(pages[1].html).toContain("<img");
  });
});

describe("boundedUnzlib", () => {
  const budget = (bytes = 512 * 1024 * 1024, cancelled = () => false) => ({
    remaining_bytes: bytes,
    cancelled,
  });

  it("refuses a compressed bomb before retaining byte 16 MiB + 1", async () => {
    const input = zlibSync(new Uint8Array(16 * 1024 * 1024 + 1));
    await expect(boundedUnzlib(input, budget())).rejects.toThrowError("extra_view.too_large");
  });

  it("refuses an expansion ratio above 500", async () => {
    const input = zlibSync(new Uint8Array(200 * 1024));
    await expect(boundedUnzlib(input, budget())).rejects.toThrowError("extra_view.too_large");
  });

  it("refuses a missing final callback", async () => {
    const input = zlibSync(new Uint8Array(4_096));
    await expect(boundedUnzlib(input.subarray(0, input.length - 2), budget())).rejects.toThrow();
  });

  it("checks cancellation between push calls", async () => {
    const input = zlibSync(new Uint8Array(64 * 1024));
    let calls = 0;
    await expect(
      boundedUnzlib(input, budget(512 * 1024 * 1024, () => {
        calls += 1;
        return calls > 1;
      })),
    ).rejects.toThrowError("extra_view.changed");
  });
});
