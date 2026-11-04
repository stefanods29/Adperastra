import { describe, expect, it } from "vitest";
import { PDF_HELPER_INIT, pdfDocumentInit } from "../pdf-helper/types";
import {
  bucketForDisplay,
  clampPdfZoom,
  defaultPdfViewState,
  isBoundedPdfViewState,
  isUuid,
  pdfInputError,
  pdfPageCacheOptions,
  pdfPrintRangeError,
  pdfRasterDimensions,
  pdfRenderRequestError,
  pdfSourceKey,
  readPdfViewState,
  PDF_MAX_PNG_BYTES,
  PDF_MAX_PRINT_PAGES,
  type PdfInput,
  type PdfPageImage,
  type PdfRenderRequest,
  type PdfTextPage,
} from "../services/pdf";

/** The wire shapes, the bounds and the refusal rules of Step 07d. */

describe("pdf contracts", () => {
  it("refuses a foreign snapshot reference and a page 0 render", () => {
    const foreign: PdfInput = {
      kind: "snapshot",
      reference: {
        snapshot_id: "not-a-uuid",
        document_id: "doc",
        revision: 1,
        content_id: "11111111-1111-1111-1111-111111111111",
      },
    };
    expect(pdfInputError(foreign)).toBe("pdf.bad_request");
    expect(pdfInputError({ kind: "snapshot", reference: null })).toBe("pdf.bad_request");
    const good: PdfInput = {
      kind: "snapshot",
      reference: {
        snapshot_id: "11111111-1111-1111-1111-111111111111",
        document_id: "doc",
        revision: 1,
        content_id: "22222222-2222-2222-2222-222222222222",
      },
    };
    expect(pdfInputError(good)).toBeNull();
    const request: PdfRenderRequest = {
      session_id: "11111111-1111-1111-1111-111111111111",
      page: 0,
      raster: { kind: "bucket", edge: 512 },
      rotation: 0,
      request_revision: 1,
    };
    expect(pdfRenderRequestError(request)).toBe("pdf.bad_request");
    expect(
      pdfRenderRequestError({
        ...request,
        page: 1,
        raster: { kind: "dpi", value: Number.NaN },
      }),
    ).toBe("pdf.bad_request");
    expect(
      pdfRenderRequestError({
        ...request,
        page: 1,
        session_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    ).toBeNull();
    expect(isUuid("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(isUuid("123E4567-E89B-12D3-A456-426614174000")).toBe(false);
  })

  it("round-trips the snake_case DTOs without losing a field", () => {
    const image: PdfPageImage = {
      info: { page: 1, width_pt: 595, height_pt: 842, rotation: 0 },
      image: {
        lease_id: "11111111-1111-1111-1111-111111111111",
        token: "0123456789abcdef0123456789abcdef",
        name: "page-1.png",
        mime: "image/png",
        byte_len: 1024,
        width: 512,
        height: 724,
        sensitive: false,
      },
      render_width: 512,
      render_height: 724,
      resolved_scale: 0.86,
      rendered_rotation: 0,
      request_revision: 3,
    };
    const copy = JSON.parse(JSON.stringify(image)) as PdfPageImage;
    expect(copy).toEqual(image);
    expect(Object.keys(copy)).toEqual([
      "info",
      "image",
      "render_width",
      "render_height",
      "resolved_scale",
      "rendered_rotation",
      "request_revision",
    ]);
    const text: PdfTextPage = {
      page: 1,
      runs: [
        {
          text: "Hello",
          x: 10,
          y: 20,
          width: 30,
          height: 10,
          direction: "ltr",
          font_size: 10,
          order: 0,
        },
      ],
      next_run: null,
      complete: true,
      source: {
        kind: "snapshot",
        document_id: "doc",
        revision: 2,
        content_id: "22222222-2222-2222-2222-222222222222",
        sensitive: true,
      },
    };
    const textCopy = JSON.parse(JSON.stringify(text)) as PdfTextPage;
    expect(textCopy.source).toEqual(text.source);
    expect(textCopy.runs[0].font_size).toBe(10);
  })

  it("keeps the view state to six bounded fields without a password or token", () => {
    const state = readPdfViewState(
      {
        page: 7,
        zoom: Number.NaN,
        fit: "page",
        rotation: 180,
        thumbnails_open: false,
        outline_open: true,
        password: "secret",
        token: "0123456789abcdef0123456789abcdef",
      },
      10,
    );
    expect(state).toEqual({
      page: 7,
      zoom: 100,
      fit: "page",
      rotation: 180,
      thumbnails_open: false,
      outline_open: true,
    });
    expect(isBoundedPdfViewState(state)).toBe(true);
    expect(Object.keys(state)).not.toContain("password");
    expect(JSON.stringify(state)).not.toContain("secret");
    // A page outside the document falls back to the first one.
    expect(readPdfViewState({ page: 99 }, 10).page).toBe(1);
    expect(readPdfViewState(null, 10)).toEqual(defaultPdfViewState());
    expect(clampPdfZoom(1)).toBe(10);
    expect(clampPdfZoom(9999)).toBe(400);
  })

  it("computes the exact raster sizes of the plan", () => {
    expect(
      pdfRasterDimensions({ width_pt: 72, height_pt: 72 }, { kind: "dpi", value: 150 }, 0),
    ).toEqual({ width: 150, height: 150, scale: 150 / 72 });
    expect(() =>
      pdfRasterDimensions({ width_pt: 1000, height_pt: 1000 }, { kind: "dpi", value: 600 }, 0),
    ).toThrowError("pdf.too_large");
    // rotation 90 swaps the sides before the bucket scale is computed.
    expect(
      pdfRasterDimensions({ width_pt: 100, height_pt: 200 }, { kind: "bucket", edge: 512 }, 90),
    ).toEqual({ width: 512, height: 256, scale: 512 / 200 });
    expect(bucketForDisplay(300, 1)).toBe(512);
    expect(bucketForDisplay(300, 2)).toBe(1024);
    expect(bucketForDisplay(5000, 2)).toBe(2048);
  })

  it("writes the cache options key the helper and the store share", () => {
    expect(pdfPageCacheOptions(3, 90, { kind: "bucket", edge: 1024 })).toBe(
      "ver=6.4.299;page=3;rot=90;bucket=1024",
    );
    expect(pdfPageCacheOptions(1, 0, { kind: "dpi", value: 150 })).toBe(
      "ver=6.4.299;page=1;rot=0;dpi=150",
    );
    expect(PDF_MAX_PNG_BYTES).toBe(8 * 1024 * 1024);
  })

  it("bounds the print range and respects the permission", () => {
    expect(pdfPrintRangeError(1, 101, 500, true)).toBe("pdf.too_large");
    expect(pdfPrintRangeError(1, PDF_MAX_PRINT_PAGES, 500, true)).toBeNull();
    expect(pdfPrintRangeError(1, 1, 1, false)).toBe("pdf.permissions");
    expect(pdfPrintRangeError(0, 1, 3, true)).toBe("pdf.bad_request");
    expect(pdfPrintRangeError(2, 1, 3, true)).toBe("pdf.bad_request");
    expect(pdfPrintRangeError(1, 4, 3, true)).toBe("pdf.bad_request");
  })

  it("keys a source identity without a path comparison", () => {
    const disk = pdfSourceKey({
      kind: "disk",
      stamp: {
        path_key: "c:\\docs\\a.pdf",
        volume_id: "01234567",
        file_id: "0123456789abcdef",
        modified_ticks: "10",
        size_bytes: 100,
      },
    });
    expect(disk).toContain("0123456789abcdef");
    expect(disk).toContain("10");
    const snapshot = pdfSourceKey({
      kind: "snapshot",
      document_id: "doc",
      revision: 2,
      content_id: "22222222-2222-2222-2222-222222222222",
      sensitive: true,
    });
    expect(snapshot.startsWith("s:doc:2:")).toBe(true);
  })

  it("keeps the helper init flags of D4 with wasm and eval off", () => {
    expect(PDF_HELPER_INIT).toMatchObject({
      rangeChunkSize: 65_536,
      disableStream: true,
      disableAutoFetch: true,
      useWorkerFetch: false,
      useWasm: false,
      useSystemFonts: false,
      disableFontFace: true,
      enableXfa: false,
      maxImageSize: 100_000_000,
      canvasMaxAreaInBytes: 67_108_864,
    });
    expect("isEvalSupported" in PDF_HELPER_INIT).toBe(false);
    const init = pdfDocumentInit("http://adpfile.localhost/token/a.pdf", "/pdfjs/cmaps/", "/pdfjs/standard_fonts/");
    expect(init.url).toContain("/token/");
    expect(init.cMapPacked).toBe(true);
    expect("enableScripting" in init).toBe(false);
  })
})
