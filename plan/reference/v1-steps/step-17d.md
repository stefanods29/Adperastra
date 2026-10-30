# Step 17d: AI for scans and PDFs, and writing suggestions (★★★★)

**Needs:** 17a, 07b. **Builds:** document extraction. **Also read:** `plan/ai.md`. **Milestone:** v0.5 after this step.

## Tasks
- **Scan to editable document:** turn a scanned PDF or a photo of a document into an editable .docx (and .md or .txt), keeping headings, paragraphs, lists, and tables as well as possible, from OCR plus layout analysis; shown side by side with the original for checking. Before the Office editor exists (Steps 20-22), the .docx is written with the `docx` library and opened in the viewer.
- **Tables to Excel:** detect tables in PDFs and scans and export them to .xlsx or .csv, with a preview grid to fix columns before saving.
- **Receipts and invoices to a sheet:** extract date, vendor, tax ID, totals, and line items from many receipts or invoices into one spreadsheet, with a confidence mark on uncertain fields and a link back to each source file.
- **Writing suggestions in the text editor (optional, off by default):** gray inline completions in the text, Markdown, and code editors, accepted with Tab, dismissed with Esc; only after I pause typing, cancelled the moment I keep typing, never slowing typing (Instant tier still applies); can be enabled per file type; uses the assistant model or a smaller, faster one if it scores well.
- Add evaluation sets for extraction accuracy and suggestion quality.

## Parts to consider
The OCR service (Step 07b); a permissively licensed table-detection model (verify licenses); the assistant model with constrained JSON output for field extraction; docx (MIT) and ExcelJS (MIT) for writing results.

## Help pages
Turning scans into documents; extracting tables; extracting receipts and invoices; writing suggestions.

## Done when
I can turn a scanned letter into an editable document, export a PDF table to Excel, extract ten receipts into one sheet with uncertain fields marked, and use writing suggestions without any typing delay. I approve and v0.5 is released.
