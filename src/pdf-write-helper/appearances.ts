import {
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  PDFRef,
  PDFString,
  type PDFDict,
  type PDFFont,
  type PDFImage,
} from "pdf-lib";
import type { PdfAnnotation, PdfPoint, PdfRect } from "../pdf-edit/types";
import { PDF_EDIT_INK_WIDTH_PT } from "../pdf-edit/types";

/** Annotation appearance streams (Step 14a D4/D6, T2).
 *
 * Every annotation we write gets an `AP/N` Form XObject built from verified
 * pdf-lib operator constructors. Human text is encoded with the embedded
 * font (`PDFFont.encodeText`) and never interpolated into PDF syntax. No
 * viewer-specific regeneration is required for another reader to show the
 * mark. */

type OperatorArg = PDFName | PDFArray | PDFNumber | PDFString | PDFHexString | string;

/** Model coordinates are top-left based; PDF user space is bottom-left
 * based. This converts one point. */
export function editPointToPdf(point: PdfPoint, crop: PdfRect): PdfPoint {
  return { x: crop.x + point.x, y: crop.y + crop.height - point.y };
}

/** One top-left rectangle to the PDF `[x1 y1 x2 y2]` form. */
export function editRectToPdf(rect: PdfRect, crop: PdfRect): { x: number; y: number; width: number; height: number } {
  return {
    x: crop.x + rect.x,
    y: crop.y + crop.height - (rect.y + rect.height),
    width: rect.width,
    height: rect.height,
  };
}

function n(value: number): PDFNumber {
  return PDFNumber.of(value);
}

function op(name: PDFOperatorNames, args: OperatorArg[] = []): PDFOperator {
  return PDFOperator.of(name, args);
}

function rgb(color: readonly [number, number, number, number]): OperatorArg[] {
  return [n(color[0]), n(color[1]), n(color[2])];
}

function formRef(
  pdf: PDFDocument,
  operators: PDFOperator[],
  width: number,
  height: number,
  resources: PDFDict,
): PDFRef {
  const stream = pdf.context.formXObject(operators, {
    Type: "XObject",
    Subtype: "Form",
    FormType: 1,
    BBox: [0, 0, width, height],
    Matrix: [1, 0, 0, 1, 0, 0],
    Resources: resources,
  });
  return pdf.context.register(stream);
}

/** Measure with the embedded font; a missing glyph is a stable refusal, never
 * a `.notdef` box or silently dropped text. */
function textWidth(font: PDFFont, text: string, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    throw new Error("pdf_edit.missing_glyph");
  }
}

function encodeText(font: PDFFont, text: string): PDFHexString {
  try {
    return font.encodeText(text);
  } catch {
    throw new Error("pdf_edit.missing_glyph");
  }
}

function bounds(annotation: PdfAnnotation, crop: PdfRect): { x: number; y: number; width: number; height: number } {
  return editRectToPdf(annotation.rect, crop);
}

function local(point: PdfPoint, box: { x: number; y: number }): PdfPoint {
  return { x: point.x - box.x, y: point.y - box.y };
}

/** Highlight: multiply blending, one filled polygon per quadrilateral. The
 * model stores quads clockwise from the upper-left; the PDF QuadPoints are
 * written counterclockwise from the lower-left (D4). */
export function buildHighlightAppearance(pdf: PDFDocument, annotation: PdfAnnotation, crop: PdfRect): PDFRef {
  const box = bounds(annotation, crop);
  const gs = pdf.context.register(
    pdf.context.obj({
      Type: "ExtGState",
      BM: "Multiply",
      ca: annotation.opacity,
      CA: annotation.opacity,
    }),
  );
  const resources = pdf.context.obj({ ExtGState: pdf.context.obj({ GS0: gs }) });
  const operators: PDFOperator[] = [op(PDFOperatorNames.PushGraphicsState), op(PDFOperatorNames.SetGraphicsStateParams, [PDFName.of("GS0")])];
  operators.push(op(PDFOperatorNames.NonStrokingColorRgb, rgb(annotation.color)));
  for (const quad of annotation.quads ?? []) {
    const points = quad.map((point) => local(editPointToPdf(point, crop), box));
    if (points.length !== 4) continue;
    operators.push(op(PDFOperatorNames.MoveTo, [n(points[0].x), n(points[0].y)]));
    for (let index = 1; index < 4; index += 1) {
      operators.push(op(PDFOperatorNames.LineTo, [n(points[index].x), n(points[index].y)]));
    }
    operators.push(op(PDFOperatorNames.ClosePath), op(PDFOperatorNames.FillNonZero));
  }
  operators.push(op(PDFOperatorNames.PopGraphicsState));
  return formRef(pdf, operators, box.width, box.height, resources);
}

/** Ink: round caps/joins, one stroked polyline per stroke. */
export function buildInkAppearance(pdf: PDFDocument, annotation: PdfAnnotation, crop: PdfRect): PDFRef {
  const box = bounds(annotation, crop);
  const resources = pdf.context.obj({});
  const operators: PDFOperator[] = [
    op(PDFOperatorNames.PushGraphicsState),
    op(PDFOperatorNames.StrokingColorRgb, rgb(annotation.color)),
    op(PDFOperatorNames.SetLineWidth, [n(PDF_EDIT_INK_WIDTH_PT)]),
    op(PDFOperatorNames.SetLineCapStyle, [n(1)]),
    op(PDFOperatorNames.SetLineJoinStyle, [n(1)]),
  ];
  for (const stroke of annotation.strokes ?? []) {
    const points = stroke.map((point) => local(editPointToPdf(point, crop), box));
    if (points.length < 2) continue;
    operators.push(op(PDFOperatorNames.MoveTo, [n(points[0].x), n(points[0].y)]));
    for (let index = 1; index < points.length; index += 1) {
      operators.push(op(PDFOperatorNames.LineTo, [n(points[index].x), n(points[index].y)]));
    }
    operators.push(op(PDFOperatorNames.StrokePath));
  }
  operators.push(op(PDFOperatorNames.PopGraphicsState));
  return formRef(pdf, operators, box.width, box.height, resources);
}

function wrapLines(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line.length === 0 ? word : `${line} ${word}`;
      if (textWidth(font, candidate, size) <= width || line.length === 0) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line.length > 0) lines.push(line);
  }
  return lines;
}

/** Text box: the embedded font draws wrapped text; the full text also lives
 * in /Contents so another reader can show it. */
export function buildTextAppearance(
  pdf: PDFDocument,
  annotation: PdfAnnotation,
  crop: PdfRect,
  font: PDFFont,
): PDFRef {
  const box = bounds(annotation, crop);
  const size = annotation.font_size ?? 12;
  const resources = pdf.context.obj({ Font: pdf.context.obj({ F0: font.ref }) });
  const operators: PDFOperator[] = [
    op(PDFOperatorNames.PushGraphicsState),
    op(PDFOperatorNames.NonStrokingColorRgb, rgb(annotation.color)),
    op(PDFOperatorNames.BeginText),
    op(PDFOperatorNames.SetFontAndSize, [PDFName.of("F0"), n(size)]),
  ];
  const lines = wrapLines(annotation.text, font, size, Math.max(1, box.width - 4));
  const lineHeight = size * 1.2;
  let baseline = box.height - size - 2;
  for (const line of lines) {
    if (baseline < 2) break;
    operators.push(op(PDFOperatorNames.SetTextMatrix, [n(1), n(0), n(0), n(1), n(2), n(baseline)]));
    operators.push(op(PDFOperatorNames.ShowText, [encodeText(font, line)]));
    baseline -= lineHeight;
  }
  operators.push(op(PDFOperatorNames.EndText), op(PDFOperatorNames.PopGraphicsState));
  return formRef(pdf, operators, box.width, box.height, resources);
}

/** Visual signature: a Stamp appearance made of raster, strokes or typed
 * text. No `/Sig`, `/ByteRange` or certificate keys are ever created. */
export function buildSignatureAppearance(
  pdf: PDFDocument,
  annotation: PdfAnnotation,
  crop: PdfRect,
  font: PDFFont,
  image?: PDFImage,
): PDFRef {
  const box = bounds(annotation, crop);
  const resources = pdf.context.obj({});
  const operators: PDFOperator[] = [op(PDFOperatorNames.PushGraphicsState)];
  if (image) {
    resources.set(PDFName.of("XObject"), pdf.context.obj({ Im0: image.ref }));
    operators.push(
      op(PDFOperatorNames.ConcatTransformationMatrix, [n(box.width), n(0), n(0), n(box.height), n(0), n(0)]),
      op(PDFOperatorNames.DrawObject, [PDFName.of("Im0")]),
    );
  } else {
    if (annotation.strokes && annotation.strokes.length > 0) {
      operators.push(
        op(PDFOperatorNames.StrokingColorRgb, rgb(annotation.color)),
        op(PDFOperatorNames.SetLineWidth, [n(PDF_EDIT_INK_WIDTH_PT)]),
        op(PDFOperatorNames.SetLineCapStyle, [n(1)]),
        op(PDFOperatorNames.SetLineJoinStyle, [n(1)]),
      );
      for (const stroke of annotation.strokes) {
        const points = stroke.map((point) => local(editPointToPdf(point, crop), box));
        if (points.length < 2) continue;
        operators.push(op(PDFOperatorNames.MoveTo, [n(points[0].x), n(points[0].y)]));
        for (let index = 1; index < points.length; index += 1) {
          operators.push(op(PDFOperatorNames.LineTo, [n(points[index].x), n(points[index].y)]));
        }
        operators.push(op(PDFOperatorNames.StrokePath));
      }
    }
    if (annotation.text.trim().length > 0) {
      const size = Math.min(24, Math.max(8, box.height / 2));
      resources.set(PDFName.of("Font"), pdf.context.obj({ F0: font.ref }));
      const text = annotation.text.trim();
      const width = textWidth(font, text, size);
      operators.push(
        op(PDFOperatorNames.BeginText),
        op(PDFOperatorNames.SetFontAndSize, [PDFName.of("F0"), n(size)]),
        op(PDFOperatorNames.SetTextMatrix, [
          n(1),
          n(0),
          n(0),
          n(1),
          n(Math.max(2, (box.width - width) / 2)),
          n(Math.max(2, (box.height - size) / 2)),
        ]),
        op(PDFOperatorNames.ShowText, [encodeText(font, text)]),
        op(PDFOperatorNames.EndText),
      );
    }
  }
  operators.push(op(PDFOperatorNames.PopGraphicsState));
  return formRef(pdf, operators, box.width, box.height, resources);
}

export function buildAnnotationAppearance(
  pdf: PDFDocument,
  annotation: PdfAnnotation,
  crop: PdfRect,
  font: PDFFont,
  image?: PDFImage,
): PDFRef {
  switch (annotation.kind) {
    case "highlight":
      return buildHighlightAppearance(pdf, annotation, crop);
    case "ink":
      return buildInkAppearance(pdf, annotation, crop);
    case "text":
      return buildTextAppearance(pdf, annotation, crop, font);
    case "signature":
      return buildSignatureAppearance(pdf, annotation, crop, font, image);
    case "comment":
      // Comment icons are standard /Text annotations; a tiny transparent form
      // still satisfies the "always provide an appearance" rule.
      return formRef(
        pdf,
        [op(PDFOperatorNames.PushGraphicsState), op(PDFOperatorNames.PopGraphicsState)],
        annotation.rect.width,
        annotation.rect.height,
        pdf.context.obj({}),
      );
    default:
      throw new Error("pdf_edit.bad_request");
  }
}
