import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { applyPdfAnnotations, findPdfAnnotation, readPdfAnnotation } from "../pdf-write-helper/annotations";
import { ANNOTATION_ID, makeAnnotation, makeModel, makePage } from "./pdfEditFixtures";

async function newPdf(width = 100, height = 200): Promise<PDFDocument> {
  const pdf = await PDFDocument.create();
  pdf.addPage([width, height]);
  return pdf;
}

function numbers(pdf: PDFDocument, dict: ReturnType<typeof findPdfAnnotation>, key: string): number[] {
  const array = dict?.lookupMaybe(PDFName.of(key), PDFArray);
  if (!array) return [];
  return array.asArray().map((entry) => {
    const value = entry instanceof PDFNumber ? entry : pdf.context.lookup(entry);
    return value instanceof PDFNumber ? value.asNumber() : Number.NaN;
  });
}

describe("standard annotation appearances", () => {
  it("highlight_dictionary_Highlight_QuadPoints", async () => {
    const pdf = await newPdf();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const model = makeModel({ pages: [makePage()], annotations: [makeAnnotation()] });
    await applyPdfAnnotations(pdf, model, { ownedAnnotationIds: [], font, images: new Map() });
    const reloaded = await PDFDocument.load(await pdf.save());
    const dict = findPdfAnnotation(reloaded, ANNOTATION_ID);
    expect(dict).not.toBeNull();
    const read = readPdfAnnotation(reloaded, dict!);
    expect(read.subtype).toBe("Highlight");
    expect(read.contents).toBe("");
    expect(numbers(reloaded, dict, "QuadPoints")).toEqual([20, 160, 60, 160, 60, 170, 20, 170]);
    expect(read.rect).toEqual({ x: 20, y: 160, width: 40, height: 10 });
    const appearance = dict!.lookupMaybe(PDFName.of("AP"), PDFDict);
    expect(appearance?.get(PDFName.of("N"))).toBeTruthy();
  });

  it("ink_strokes_exact", async () => {
    const pdf = await newPdf();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const ink = makeAnnotation({
      kind: "ink",
      quads: undefined,
      strokes: [[{ x: 10, y: 20 }, { x: 30, y: 40 }]],
      rect: { x: 10, y: 20, width: 20, height: 20 },
    });
    const model = makeModel({ pages: [makePage()], annotations: [ink] });
    await applyPdfAnnotations(pdf, model, { ownedAnnotationIds: [], font, images: new Map() });
    const reloaded = await PDFDocument.load(await pdf.save());
    const dict = findPdfAnnotation(reloaded, ANNOTATION_ID);
    expect(readPdfAnnotation(reloaded, dict!).subtype).toBe("Ink");
    const list = dict!.lookupMaybe(PDFName.of("InkList"), PDFArray);
    expect(list?.size()).toBe(1);
    const stroke = list?.lookup(0, PDFArray);
    expect(stroke?.asArray().map((entry) => (entry as PDFNumber).asNumber())).toEqual([10, 180, 30, 160]);
  });

  it("freetext_unicode_escaped", async () => {
    const pdf = await newPdf();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const text = makeAnnotation({
      kind: "text",
      quads: undefined,
      text: "Año 2026",
      font_size: 12,
      rect: { x: 10, y: 10, width: 80, height: 40 },
    });
    const model = makeModel({ pages: [makePage()], annotations: [text] });
    await applyPdfAnnotations(pdf, model, { ownedAnnotationIds: [], font, images: new Map() });
    const reloaded = await PDFDocument.load(await pdf.save());
    const dict = findPdfAnnotation(reloaded, ANNOTATION_ID)!;
    const contents = dict.get(PDFName.of("Contents"));
    expect(contents).toBeInstanceOf(PDFHexString);
    expect((contents as PDFHexString).decodeText()).toBe("Año 2026");
    const da = dict.get(PDFName.of("DA"));
    expect(da).toBeInstanceOf(PDFString);
    expect((da as PDFString).decodeText()).toContain("/F0 12 Tf");
    expect(dict.get(PDFName.of("AP"))).toBeTruthy();
  });

  it("existing_unknown_annotation_preserved", async () => {
    const pdf = await newPdf();
    const page = pdf.getPage(0);
    const unknown = pdf.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [1, 2, 11, 22],
      NM: PDFHexString.fromText("unknown-nm"),
      AdpTest: PDFString.of("keep"),
    });
    page.node.addAnnot(pdf.context.register(unknown));
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const model = makeModel({ pages: [makePage()], annotations: [makeAnnotation()] });
    await applyPdfAnnotations(pdf, model, { ownedAnnotationIds: [], font, images: new Map() });
    await applyPdfAnnotations(pdf, model, { ownedAnnotationIds: [ANNOTATION_ID], font, images: new Map() });
    const reloaded = await PDFDocument.load(await pdf.save());
    const preserved = findPdfAnnotation(reloaded, "unknown-nm");
    expect(preserved).not.toBeNull();
    expect(readPdfAnnotation(reloaded, preserved!).subtype).toBe("Link");
    const custom = preserved!.get(PDFName.of("AdpTest"));
    expect(custom).toBeInstanceOf(PDFString);
    expect((custom as PDFString).decodeText()).toBe("keep");
    expect(reloaded.getPage(0).node.Annots()?.size()).toBe(2);
  });

  it("crop_origin_maps_local_geometry_to_pdf_user_space", async () => {
    const pdf = await newPdf();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = makePage({ crop: { x: 10, y: 20, width: 100, height: 200 } });
    const model = makeModel({ pages: [page], annotations: [makeAnnotation()] });
    await applyPdfAnnotations(pdf, model, { ownedAnnotationIds: [], font, images: new Map() });
    const reloaded = await PDFDocument.load(await pdf.save());
    const dict = findPdfAnnotation(reloaded, ANNOTATION_ID)!;
    expect(numbers(reloaded, dict, "QuadPoints")).toEqual([30, 180, 70, 180, 70, 190, 30, 190]);
    expect(readPdfAnnotation(reloaded, dict).rect).toEqual({ x: 30, y: 180, width: 40, height: 10 });
  });
});
