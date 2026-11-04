import { describe, expect, it, vi } from "vitest";
import {
  MAX_BLOCKS_PER_PAGE,
  isBoundedHtmlBlock,
  paginateBlocks,
  type HtmlBlock,
} from "../convert/documentTypes";
import { parseDocumentBlocks, renderDocumentHtml } from "../pdf-write-helper/documentParser";
import { pageBox, wrapParagraph, type MeasuredFont } from "../pdf-write-helper/documentLayout";
import { assertCanDisplay, canDisplay, type FontkitFont } from "../pdf-write-helper/fontAdapter";

const font: MeasuredFont = {
  measure: (text) => text.length * 6,
  canDisplay: () => true,
};

function kit(map: (codePoint: number) => boolean): FontkitFont {
  return {
    hasGlyphForCodePoint: map,
    unitsPerEm: 1000,
    layout: () => ({ glyphs: [] }),
  };
}

describe("safe document conversion", () => {
  it("never executes a script or fetches a remote image", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const html = `<p>Hello</p><script>alert(1)</script><img src="https://example.test/x.png"><p onclick="alert(2)">World</p>`;
    const analysis = parseDocumentBlocks({ kind: "html", text: html });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(analysis.blocks).toEqual([
      { kind: "paragraph", text: "Hello" },
      { kind: "paragraph", text: "World" },
    ]);
    expect(analysis.removed_images).toBe(1);
    expect(analysis.layout_loss).toBe(true);
    fetchSpy.mockRestore();
  });

  it("keeps markdown html disabled", () => {
    const analysis = parseDocumentBlocks({ kind: "markdown", text: "<script>alert(1)</script>\n\n# Title" });
    expect(analysis.blocks.some((block) => block.kind === "heading")).toBe(true);
    expect(analysis.blocks.some((block) => block.kind === "code" && block.text.includes("<script>"))).toBe(false);
  });

  it("wraps at the measured font width", () => {
    const lines = wrapParagraph("one two three four", font, 11, 50, "inter-regular");
    expect(lines.map((line) => line.text)).toEqual(["one two", "three", "four"]);
  });

  it("computes the exact A4 available width", () => {
    const box = pageBox("a4", 20);
    expect(box.available_width_pt).toBeCloseTo(595.28 - 2 * (20 * 72) / 25.4, 4);
    expect(box.available_width_pt).toBeCloseTo(481.89417, 4);
  });

  it("fails an unmappable glyph instead of dropping text", () => {
    const onlyAscii = kit((codePoint) => codePoint < 128);
    expect(canDisplay(onlyAscii, "hello")).toBe(true);
    expect(canDisplay(onlyAscii, "España")).toBe(false);
    expect(() => assertCanDisplay(onlyAscii, "España")).toThrow("convert.missing_glyph");
  });

  it("escapes every text node in the HTML export", () => {
    const blocks: HtmlBlock[] = [
      { kind: "paragraph", text: "<script>alert(1)</script>" },
      { kind: "heading", level: 1, text: "& < >" },
    ];
    const html = renderDocumentHtml(blocks, { title: "<Title>" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;Title&gt;");
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
  });

  it("bounds a block page to 256 blocks", () => {
    const blocks = Array.from({ length: 300 }, (_, index) => ({
      kind: "paragraph" as const,
      text: `p${index}`,
    }));
    const first = paginateBlocks(blocks, 0);
    expect(first.blocks).toHaveLength(MAX_BLOCKS_PER_PAGE);
    expect(first.complete).toBe(false);
    expect(isBoundedHtmlBlock({ kind: "table", cells: [["a"]], header: true })).toBe(true);
    expect(isBoundedHtmlBlock({ kind: "image", image: { mime: "image/png", alt: "x" } })).toBe(false);
  });
});
