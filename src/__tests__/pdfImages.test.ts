import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildImagePdf, imagePlacements, IMAGE_PDF_MAX_IMAGES } from "../pdf-write-helper/pdfImages";
import { pdfRasterDimensions, type PdfPageImage, type PdfSession } from "../services/pdf";
import { convertPdfPages, normalizedPdfPages, type PdfPageConversionPort } from "../convert/pdfPageConversion";

/** A valid 1x1 PNG; the placement metadata supplies the intended page size. */
const ONE_PIXEL_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  ),
  (character) => character.charCodeAt(0),
);

describe("images to PDF", () => {
  it("keeps the selection order, one image per page", async () => {
    const bytes = await buildImagePdf(
      [
        { bytes: ONE_PIXEL_PNG, mime: "image/png", width_px: 100, height_px: 50 },
        { bytes: ONE_PIXEL_PNG, mime: "image/png", width_px: 200, height_px: 100 },
      ],
      { page_size: "source", margin_mm: 20 },
    );
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2);
    const first = pdf.getPage(0).getSize();
    const second = pdf.getPage(1).getSize();
    expect(first.width).toBeCloseTo((100 * 72) / 96, 4);
    expect(second.width).toBeCloseTo((200 * 72) / 96, 4);
    expect(first.height).toBeCloseTo((50 * 72) / 96, 4);
  });

  it("refuses more than 1,000 images", () => {
    const images = Array.from({ length: IMAGE_PDF_MAX_IMAGES + 1 }, () => ({ width_px: 1, height_px: 1 }));
    expect(() => imagePlacements(images, { page_size: "a4", margin_mm: 20 })).toThrow("convert.too_large");
  });

  it("cancels before writing a page", async () => {
    await expect(
      buildImagePdf([{ bytes: ONE_PIXEL_PNG, mime: "image/png", width_px: 1, height_px: 1 }], { page_size: "source", margin_mm: 20 }, () => true),
    ).rejects.toThrow("convert.cancelled");
  });
});

describe("PDF pages to images", () => {
  it("uses dpi 150 and the exact raster math", () => {
    const raster = pdfRasterDimensions({ width_pt: 72, height_pt: 72 }, { kind: "dpi", value: 150 }, 0);
    expect(raster.width).toBe(150);
    expect(raster.height).toBe(150);
    expect(raster.scale).toBeCloseTo(150 / 72, 12);
  });

  it("refuses a requested DPI above the pixel cap instead of lowering it", () => {
    expect(() =>
      pdfRasterDimensions({ width_pt: 1000, height_pt: 1000 }, { kind: "dpi", value: 600 }, 0),
    ).toThrow("pdf.too_large");
  });

  it("refuses invalid ranges before any output", () => {
    expect(() => normalizedPdfPages([{ first: 0, last: 1 }], 3)).toThrow("convert.invalid_range");
    expect(() => normalizedPdfPages([{ first: 2, last: 1 }], 3)).toThrow("convert.invalid_range");
  });

  it("releases the page lease and closes the session when a later page is cancelled", async () => {
    const events: string[] = [];
    const session: PdfSession = {
      session_id: "11111111-1111-4111-8111-111111111111",
      source: {
        kind: "disk",
        stamp: {
          path_key: "C:\\Docs\\a.pdf",
          volume_id: "00000000",
          file_id: "0000000000000000",
          modified_ticks: "1",
          size_bytes: 10,
        },
      },
      page_count: 2,
      password_required: false,
      permissions: { can_copy: false, can_print: false },
    };
    const image = (page: number): PdfPageImage => ({
      info: { page, width_pt: 72, height_pt: 72, rotation: 0 },
      image: {} as never,
      render_width: 150,
      render_height: 150,
      resolved_scale: 150 / 72,
      rendered_rotation: 0,
      request_revision: page,
    });
    const port: PdfPageConversionPort = {
      open: async () => ({ id: "job", cancel: async () => undefined, completion: Promise.resolve(session) }),
      render: async (request) => ({ id: "job", cancel: async () => undefined, completion: Promise.resolve(image(request.page)) }),
      release: async () => {
        events.push("release");
      },
      close: async () => {
        events.push("close");
      },
    };
    await expect(
      convertPdfPages(
        port,
        { kind: "file", path: "C:\\Docs\\a.pdf" },
        { ranges: [], dpi: 150, image_format: "png", quality: 90 },
        (page) => {
          if (page.info.page === 2) throw new Error("convert.cancelled");
        },
      ),
    ).rejects.toThrow("convert.cancelled");
    expect(events).toEqual(["release", "release", "close"]);
  });

  it("keeps snapshot identity and releases each lease before closePdf", async () => {
    const events: string[] = [];
    const session: PdfSession = {
      session_id: "11111111-1111-4111-8111-111111111111",
      source: {
        kind: "snapshot",
        document_id: "doc",
        revision: 1,
        content_id: "22222222-2222-4222-8222-222222222222",
        sensitive: false,
      },
      page_count: 2,
      password_required: false,
      permissions: { can_copy: false, can_print: false },
    };
    const image = (page: number): PdfPageImage => ({
      info: { page, width_pt: 72, height_pt: 72, rotation: 0 },
      image: { lease_id: `lease-${page}`, token: "t", name: "p.png", mime: "image/png" } as never,
      render_width: 150,
      render_height: 150,
      resolved_scale: 150 / 72,
      rendered_rotation: 0,
      request_revision: page,
    });
    const port: PdfPageConversionPort = {
      open: async () => {
        events.push("open");
        return { id: "job", cancel: async () => undefined, completion: Promise.resolve(session) };
      },
      render: async (request) => {
        events.push(`render-${request.page}-${request.raster.kind}-${request.raster.kind === "dpi" ? request.raster.value : request.raster.edge}`);
        return { id: "job", cancel: async () => undefined, completion: Promise.resolve(image(request.page)) };
      },
      release: async (lease) => {
        events.push(`release-${(lease as { lease_id: string }).lease_id}`);
      },
      close: async () => {
        events.push("close");
      },
    };
    await convertPdfPages(
      port,
      { kind: "snapshot", reference: { snapshot_id: "33333333-3333-4333-8333-333333333333", document_id: "doc", revision: 1, content_id: "22222222-2222-4222-8222-222222222222" } },
      { ranges: [], dpi: 150, image_format: "png", quality: 90 },
      (page) => {
        events.push(`page-${page.info.page}`);
        expect(session.source.kind).toBe("snapshot");
        expect(session.source).toMatchObject({ document_id: "doc", revision: 1 });
      },
    );
    expect(events).toEqual([
      "open",
      "render-1-dpi-150",
      "page-1",
      "release-lease-1",
      "render-2-dpi-150",
      "page-2",
      "release-lease-2",
      "close",
    ]);
  });
});
