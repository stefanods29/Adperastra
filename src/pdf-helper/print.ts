import { loadPage, type LoadedPdf } from "./load";
import { renderPageToPng } from "./render";
import { PDF_HELPER_LIMITS } from "./types";

/** The trusted print view (Step 07d T6, D8).
 *
 * Pages are rendered one at a time at 150 dpi, placed in a print-only
 * container and then handed to Windows' own print window. Only the pages the
 * user asked for are built (at most 100), the canvases are released after
 * each page, and everything is removed again when the dialog ends. The PDF
 * is never written to. */

/** CSS the print view needs; it never leaves this container. */
const PRINT_STYLE = `
.adp-pdf-print-root { position: fixed; left: 0; top: 0; width: 0; height: 0; overflow: hidden; }
@media print {
  body > *:not(.adp-pdf-print-root) { display: none !important; }
  .adp-pdf-print-root { position: static; width: auto; height: auto; overflow: visible; }
  .adp-pdf-print-page { display: block; page-break-after: always; break-after: page; }
  .adp-pdf-print-page:last-child { page-break-after: auto; break-after: auto; }
  .adp-pdf-print-page img { display: block; width: 100%; height: auto; }
  @page { margin: 0; }
}
`;

export class PdfPrintCancelled extends Error {
  constructor() {
    super("pdf.changed");
  }
}

/**
 * Render the range, open the system print window, then clean everything up.
 * Returns false when the user cancelled before the print window opened.
 */
export async function printRange(
  loaded: LoadedPdf,
  firstPage: number,
  lastPage: number,
  isCancelled: () => boolean = () => false,
): Promise<boolean> {
  if (!Number.isInteger(firstPage) || !Number.isInteger(lastPage)) throw new Error("pdf.bad_request");
  if (firstPage < 1 || lastPage < firstPage || lastPage > loaded.pageCount) throw new Error("pdf.bad_request");
  if (lastPage - firstPage + 1 > PDF_HELPER_LIMITS.printPages) throw new Error("pdf.too_large");
  const root = document.createElement("div");
  root.className = "adp-pdf-print-root";
  root.setAttribute("aria-hidden", "true");
  const style = document.createElement("style");
  style.textContent = PRINT_STYLE;
  root.appendChild(style);
  document.body.appendChild(root);
  const urls: string[] = [];
  try {
    for (let page = firstPage; page <= lastPage; page += 1) {
      if (isCancelled()) throw new PdfPrintCancelled();
      const proxy = await loadPage(loaded, page);
      const rendered = await renderPageToPng(
        proxy,
        { kind: "dpi", value: PDF_HELPER_LIMITS.printDpi },
        0,
        isCancelled,
      );
      const copy = new ArrayBuffer(rendered.bytes.byteLength);
      new Uint8Array(copy).set(rendered.bytes);
      const blob = new Blob([copy], { type: "image/png" });
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const holder = document.createElement("div");
      holder.className = "adp-pdf-print-page";
      const image = document.createElement("img");
      image.src = url;
      image.alt = "";
      image.width = rendered.width;
      image.height = rendered.height;
      holder.appendChild(image);
      root.appendChild(holder);
      proxy.cleanup();
    }
    if (isCancelled()) throw new PdfPrintCancelled();
    window.print();
    return true;
  } finally {
    for (const url of urls) URL.revokeObjectURL(url);
    root.remove();
  }
}
