import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, StandardFonts } from "pdf-lib";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import "../i18n";
import SignatureDialog from "../pdf-edit/SignatureDialog";
import {
  createPdfSignatureAnnotation,
  validateSignatureImage,
  signaturePlacementRect,
  type PdfSignatureImage,
} from "../pdf-edit/signature";
import { applyPdfAnnotations, findPdfAnnotation, readPdfAnnotation } from "../pdf-write-helper/annotations";
import { ANNOTATION_ID, PAGE_ID, SECOND_ANNOTATION_ID, makeAnnotation, makeModel, makePage } from "./pdfEditFixtures";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function renderDialog() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<SignatureDialog onCancel={() => undefined} onApply={() => undefined} />);
  });
  return container;
}

async function pdfWithAnnotations(annotations: ReturnType<typeof makeAnnotation>[]) {
  const pdf = await PDFDocument.create();
  pdf.addPage([100, 200]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const model = makeModel({ pages: [makePage()], annotations });
  await applyPdfAnnotations(pdf, model, { ownedAnnotationIds: [], font, images: new Map() });
  return PDFDocument.load(await pdf.save());
}

describe("comments, replies and visual signatures", () => {
  it("reply_IRT_points_parent", async () => {
    const rootComment = makeAnnotation({
      id: ANNOTATION_ID,
      kind: "comment",
      quads: undefined,
      text: "Root comment",
      rect: { x: 10, y: 10, width: 20, height: 20 },
    });
    const reply = makeAnnotation({
      id: SECOND_ANNOTATION_ID,
      kind: "comment",
      parent_id: ANNOTATION_ID,
      quads: undefined,
      text: "Reply",
      rect: { x: 10, y: 10, width: 20, height: 20 },
    });
    const reloaded = await pdfWithAnnotations([rootComment, reply]);
    const rootDict = findPdfAnnotation(reloaded, ANNOTATION_ID);
    const replyDict = findPdfAnnotation(reloaded, SECOND_ANNOTATION_ID);
    expect(rootDict).not.toBeNull();
    expect(replyDict).not.toBeNull();
    expect(readPdfAnnotation(reloaded, replyDict!).contents).toBe("Reply");
    // `lookupMaybe(..., PDFRef)` resolves the reference, so read the raw entry.
    const irt = replyDict!.get(PDFName.of("IRT"));
    expect(irt).toBeInstanceOf(PDFRef);
    const parent = reloaded.context.lookup(irt as PDFRef);
    expect(parent).toBeInstanceOf(PDFDict);
    const nm = (parent as PDFDict).lookupMaybe(PDFName.of("NM"), PDFHexString);
    expect(nm?.decodeText()).toBe(ANNOTATION_ID);
    expect(replyDict!.lookupMaybe(PDFName.of("RT"), PDFName)?.decodeText()).toBe("R");
  });

  it("signature_Stamp_not_Sig", async () => {
    const signature = makeAnnotation({
      kind: "signature",
      quads: undefined,
      rect: { x: 10, y: 10, width: 120, height: 40 },
      strokes: [[{ x: 12, y: 30 }, { x: 40, y: 12 }, { x: 80, y: 35 }]],
      text: "",
    });
    const reloaded = await pdfWithAnnotations([signature]);
    const dict = findPdfAnnotation(reloaded, ANNOTATION_ID)!;
    expect(readPdfAnnotation(reloaded, dict).subtype).toBe("Stamp");
    for (const forbidden of ["Sig", "ByteRange", "Certificate", "SubFilter", "Cert"]) {
      expect(dict.get(PDFName.of(forbidden))).toBeUndefined();
    }
    expect(dict.get(PDFName.of("AP"))).toBeTruthy();
  });

  it("rotated_pointer_maps_original", () => {
    const rect = signaturePlacementRect(
      { pointer: { x: 20, y: 10 }, width: 30, height: 10 },
      { width_pt: 100, height_pt: 200 },
      100,
      90,
      { x: 0, y: 0, width: 100, height: 200 },
    );
    expect(rect.x).toBeCloseTo(10, 6);
    expect(rect.y).toBeCloseTo(20, 6);
    expect(rect.width).toBe(30);
    expect(rect.height).toBe(10);
  });

  it("signature_image_limit_refused", () => {
    const pixels: PdfSignatureImage = { bytes: new Uint8Array([1]), width: 4_000, height: 3_000, mime: "image/png" };
    expect(() => validateSignatureImage(pixels)).toThrow("pdf_edit.too_large");
    const bytes: PdfSignatureImage = { bytes: new Uint8Array(8 * 1024 * 1024 + 1), width: 10, height: 10, mime: "image/png" };
    expect(() => validateSignatureImage(bytes)).toThrow("pdf_edit.too_large");
    const ok: PdfSignatureImage = { bytes: new Uint8Array([1, 2, 3]), width: 100, height: 100, mime: "image/jpeg" };
    expect(() => validateSignatureImage(ok)).not.toThrow();
  });

  it("signature_canvas_points_scale_into_placement_rect", () => {
    const annotation = createPdfSignatureAnnotation(
      {
        kind: "draw",
        strokes: [[{ x: 0, y: 0 }, { x: 560, y: 220 }]],
        text: "",
        canvas_width: 560,
        canvas_height: 220,
      },
      {
        pageId: PAGE_ID,
        rect: { x: 10, y: 20, width: 140, height: 70 },
        author: "Tester",
        anonymousLabel: "Anonymous",
        createdUnix: 1_700_000_000,
        color: [0.1, 0.1, 0.1, 1],
        opacity: 1,
      },
    );
    expect(annotation.kind).toBe("signature");
    expect(annotation.strokes).toEqual([[{ x: 10, y: 20 }, { x: 150, y: 90 }]]);
  });

  it("draws three accessible signature tabs and the visual warning", async () => {
    const rendered = await renderDialog();
    expect(rendered.querySelectorAll("[role='tab']").length).toBe(3);
    expect(rendered.querySelector("[role='note']")).not.toBeNull();
    expect(rendered.querySelector("canvas")).not.toBeNull();
  });
});
