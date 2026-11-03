import { getDocument, GlobalWorkerOptions, PermissionFlag, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist";
import { pdfDocumentInit } from "./types";

/** Loading and unloading the one PDF of this helper (Step 07d D1/D4).
 *
 * PDF.js runs here, in the helper's own hidden webview, with its own worker
 * and only the packaged CMaps and standard fonts. The document URL is the
 * helper's guarded grant; nothing else is fetched, and no script, action or
 * embedded file of the PDF is ever run. */

/** Where the packaged PDF.js assets are served from (same origin). */
export const CMAP_URL = "/pdfjs/cmaps/";
export const STANDARD_FONTS_URL = "/pdfjs/standard_fonts/";

export type PdfLoadFailure = "pdf.password_required" | "pdf.bad_password" | "pdf.corrupt" | "pdf.too_large";

export class PdfPasswordError extends Error {
  code: "pdf.password_required" | "pdf.bad_password";
  constructor(code: "pdf.password_required" | "pdf.bad_password") {
    super(code);
    this.code = code;
  }
}

export interface LoadedPdf {
  doc: PDFDocumentProxy;
  pageCount: number;
  /** True when the document's permissions allow copying text. */
  canCopy: boolean;
  /** True when the document's permissions allow printing. */
  canPrint: boolean;
  destroy: () => Promise<void>;
}

/** A dedicated worker per document, terminated with it. */
function createPdfWorker(): Worker {
  return new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
}

/** Pinned PDF.js returns a Promise<Set<number>|null>; null means unrestricted. */
export async function readPermissions(doc: PDFDocumentProxy): Promise<{ canCopy: boolean; canPrint: boolean }> {
  try {
    const permissions = await doc.getPermissions();
    if (permissions === null) return { canCopy: true, canPrint: true };
    return {
      canCopy: permissions.has(PermissionFlag.COPY),
      canPrint: permissions.has(PermissionFlag.PRINT) || permissions.has(PermissionFlag.PRINT_HIGH_QUALITY),
    };
  } catch {
    return { canCopy: false, canPrint: false };
  }
}

/**
 * Open one document. A password is kept in memory for this call only: it is
 * never stored, logged or put into a cache key.
 */
export async function loadPdf(url: string, password?: string | null): Promise<LoadedPdf> {
  const worker = createPdfWorker();
  GlobalWorkerOptions.workerPort = worker;
  const task = getDocument(pdfDocumentInit(url, CMAP_URL, STANDARD_FONTS_URL));
  // `onPassword` cannot reject the loading task; remember why it stopped and
  // destroy the task, then translate the rejection below.
  let passwordFailure: "pdf.password_required" | "pdf.bad_password" | null = null;
  task.onPassword = (updatePassword: (value: string) => void, reason: number) => {
    if (passwordFailure) return;
    // PasswordResponses.NEED_PASSWORD = 1, INCORRECT_PASSWORD = 2.
    if (reason === 2) {
      passwordFailure = "pdf.bad_password";
      void task.destroy();
      return;
    }
    if (password) {
      updatePassword(password);
      return;
    }
    passwordFailure = "pdf.password_required";
    void task.destroy();
  };
  try {
    const doc = await task.promise;
    if (passwordFailure) throw new PdfPasswordError(passwordFailure);
    if (doc.numPages < 1 || doc.numPages > 10_000) { await task.destroy(); throw new Error("pdf.too_large"); }
    const permissions = await readPermissions(doc);
    return {
      doc,
      pageCount: doc.numPages,
      canCopy: permissions.canCopy,
      canPrint: permissions.canPrint,
      destroy: async () => {
        try {
          await task.destroy();
        } finally {
          worker.terminate();
        }
      },
    };
  } catch (error) {
    worker.terminate();
    if (passwordFailure) throw new PdfPasswordError(passwordFailure);
    if (error instanceof PdfPasswordError) throw error;
    if (error instanceof Error && error.message === "pdf.too_large") throw error;
    const name = (error as { name?: string } | null)?.name;
    if (name === "PasswordException") throw new PdfPasswordError(password ? "pdf.bad_password" : "pdf.password_required");
    throw new Error("pdf.corrupt");
  }
}

/** The page, refusing numbers outside the document. */
export async function loadPage(loaded: LoadedPdf, page: number): Promise<PDFPageProxy> {
  if (!Number.isInteger(page) || page < 1 || page > loaded.pageCount) throw new Error("pdf.bad_request");
  try {
    return await loaded.doc.getPage(page);
  } catch {
    throw new Error("pdf.corrupt");
  }
}

/** The unrotated page size in PDF points. */
export async function pageInfoOf(page: PDFPageProxy, rotation: 0 | 90 | 180 | 270): Promise<{ page: number; width_pt: number; height_pt: number; rotation: 0 | 90 | 180 | 270 }> {
  const viewport = page.getViewport({ scale: 1, rotation: 0 });
  const width = viewport.width;
  const height = viewport.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("pdf.corrupt");
  }
  if (width > 144_000 || height > 144_000) throw new Error("pdf.too_large");
  return { page: page.pageNumber, width_pt: width, height_pt: height, rotation };
}
