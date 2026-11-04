import { PDFDict, PDFDocument, PDFName, PDFRef, degrees } from "pdf-lib";
import { PDF_EDIT_MAX_PAGES, PDF_EDIT_MAX_SOURCE_BYTES, type PdfPageState } from "../pdf-edit/types";
import type { PdfSplitRange } from "../pdf-edit/pages";
import { inspectPdfFormFields } from "./formWriter";

/** Bounded page copying for merge, split and page order (Step 14a D7, T4).
 *
 * `copyPages` is the verified pdf-lib API for moving pages between
 * documents. The output is always a newly built document; the source is
 * never modified and never written in place. Callers publish the returned
 * bytes through owned outputs that cannot replace an existing file. */

export const PAGE_COPY_MAX_BYTES = PDF_EDIT_MAX_SOURCE_BYTES;

export async function loadPdfForEdit(bytes: Uint8Array): Promise<PDFDocument> {
  if (bytes.byteLength === 0 || bytes.byteLength > PAGE_COPY_MAX_BYTES) throw new Error("pdf_edit.too_large");
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    if (pdf.getPageCount() > PDF_EDIT_MAX_PAGES) throw new Error("pdf_edit.too_large");
    return pdf;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("pdf_edit.")) throw error;
    throw new Error("pdf_edit.unsupported");
  }
}

async function saveBounded(pdf: PDFDocument): Promise<Uint8Array> {
  const bytes = await pdf.save({ useObjectStreams: false, updateFieldAppearances: false });
  if (bytes.byteLength === 0 || bytes.byteLength > PAGE_COPY_MAX_BYTES) throw new Error("pdf_edit.too_large");
  return bytes;
}

/** A copied page cannot carry document-level structures. Refuse rather than
 * produce a new file with orphaned widgets, a broken outline or XFA loss. */
function assertPageCopySupported(pdf: PDFDocument): void {
  const form = inspectPdfFormFields(pdf);
  if (
    form.values.length > 0 ||
    form.xfa ||
    pdf.catalog.get(PDFName.of("Outlines")) ||
    pdf.catalog.get(PDFName.of("StructTreeRoot")) ||
    pdf.catalog.get(PDFName.of("Names")) ||
    pdf.catalog.get(PDFName.of("PageLabels")) ||
    pdf.catalog.get(PDFName.of("OCProperties")) ||
    pdf.catalog.get(PDFName.of("Perms"))
  ) {
    throw new Error("pdf_edit.unsupported");
  }
  for (let pageIndex = 0; pageIndex < pdf.getPageCount(); pageIndex += 1) {
    const annots = pdf.getPage(pageIndex).node.Annots();
    if (!annots) continue;
    for (let index = 0; index < annots.size(); index += 1) {
      const entry = annots.lookup(index);
      const dictionary = entry instanceof PDFRef ? pdf.context.lookup(entry) : entry;
      if (!(dictionary instanceof PDFDict)) continue;
      const subtype = dictionary.lookupMaybe(PDFName.of("Subtype"), PDFName);
      if (subtype?.asString() === "Sig") throw new Error("pdf_edit.unsupported");
    }
  }
}

/** Copy the selected 1-based pages of one source, in the requested order. */
export async function copyPdfPages(
  target: PDFDocument,
  source: PDFDocument,
  pages: readonly number[],
): Promise<void> {
  if (!Array.isArray(pages) || pages.length === 0) throw new Error("pdf_edit.bad_request");
  const indices = pages.map((page) => {
    if (!Number.isSafeInteger(page) || page < 1 || page > source.getPageCount()) throw new Error("pdf_edit.bad_request");
    return page - 1;
  });
  const copied = await target.copyPages(source, indices);
  for (const page of copied) target.addPage(page);
}

/** Build one merged PDF in selection order. `A1` then `B1` stays that order;
 * duplicates are the caller's explicit choice and each listed page is copied
 * once per entry. */
export async function mergePdfDocuments(
  inputs: readonly { bytes: Uint8Array; pages: readonly number[] }[],
): Promise<Uint8Array> {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new Error("pdf_edit.bad_request");
  const output = await PDFDocument.create();
  let total = 0;
  for (const input of inputs) {
    const source = await loadPdfForEdit(input.bytes);
    assertPageCopySupported(source);
    total += input.pages.length;
    if (total > PDF_EDIT_MAX_PAGES) throw new Error("pdf_edit.too_large");
    await copyPdfPages(output, source, input.pages);
  }
  return saveBounded(output);
}

/** Split one PDF into independent outputs for each normalized range. */
export async function splitPdfDocument(
  bytes: Uint8Array,
  ranges: readonly PdfSplitRange[],
): Promise<Array<{ range: PdfSplitRange; bytes: Uint8Array }>> {
  const source = await loadPdfForEdit(bytes);
  assertPageCopySupported(source);
  const outputs: Array<{ range: PdfSplitRange; bytes: Uint8Array }> = [];
  for (const range of ranges) {
    if (
      !Number.isSafeInteger(range.first) ||
      !Number.isSafeInteger(range.last) ||
      range.first < 1 ||
      range.last < range.first ||
      range.last > source.getPageCount()
    ) {
      throw new Error("pdf_edit.bad_request");
    }
    const pages: number[] = [];
    for (let page = range.first; page <= range.last; page += 1) pages.push(page);
    const output = await PDFDocument.create();
    await copyPdfPages(output, source, pages);
    outputs.push({ range: { ...range }, bytes: await saveBounded(output) });
  }
  return outputs;
}

/** Rebuild the document from stable page states: order, rotation and crop
 * come from the model, page content from each authorized origin snapshot. */
export async function rebuildPdfInPageOrder(
  pages: readonly PdfPageState[],
  sources: ReadonlyMap<string, Uint8Array>,
): Promise<PDFDocument> {
  if (!Array.isArray(pages) || pages.length === 0 || pages.length > PDF_EDIT_MAX_PAGES) {
    throw new Error("pdf_edit.bad_request");
  }
  const cache = new Map<string, PDFDocument>();
  const output = await PDFDocument.create();
  for (const pageState of pages) {
    const key = pageState.origin_source.snapshot_id;
    let source = cache.get(key);
    if (!source) {
      const bytes = sources.get(key);
      if (!bytes) throw new Error("pdf_edit.changed");
      source = await loadPdfForEdit(bytes);
      assertPageCopySupported(source);
      cache.set(key, source);
    }
    if (pageState.origin_page < 1 || pageState.origin_page > source.getPageCount()) {
      throw new Error("pdf_edit.changed");
    }
    const [page] = await output.copyPages(source, [pageState.origin_page - 1]);
    page.setRotation(degrees(pageState.rotation));
    page.setCropBox(pageState.crop.x, pageState.crop.y, pageState.crop.width, pageState.crop.height);
    output.addPage(page);
  }
  return output;
}
