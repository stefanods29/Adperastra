# Step 07b: PDF viewer and copy text from anything (OCR) (★★★)

**Needs:** 07a. **Builds:** PDF engine, OCR service. **Figma frames:** File Explorer · PDF abierto (viewing parts; editing tools come in Step 14a).

## Tasks
- **PDF viewer** following the Figma frame's layout: thumbnails sidebar, previous/next page, page number, zoom and fit, rotate, search, outline, print, text selection, with a View ribbon/toolbar. First page within the Fast tier (cached first-page render, then live render); pages render only when visible. PDF rendering runs in a helper process (`rules.md`, section 5); PDF JavaScript never runs.
- **Copy text from anything (OCR):** select and copy text in images, screenshots, and scanned PDFs as if it were normal text; "Copy all text" and "Search in this image" commands. Text recognition runs locally with the Windows built-in OCR engine (Windows.Media.Ocr, using the installed Windows language packs) in the background after the image or page is shown; results are cached so it's instant the second time. An optional OCR pack (Tesseract, Apache-2.0) for languages Windows lacks becomes installable in Step 12a.

## Parts to consider
PDFium (Apache-2.0, via pdfium-render or prebuilt binaries) for fast rendering; PDF.js (Apache-2.0) for the text layer and search; Windows.Media.Ocr; Tesseract (Apache-2.0) later as a pack.

## Help pages
Viewing PDFs; copying text from images and scanned PDFs.

## Done when
PDFs of 1, 100, and 1,000 pages open within the Fast tier; I can copy text from a screenshot and from a scanned PDF in English and Spanish.
