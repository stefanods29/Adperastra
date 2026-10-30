# Step 14a: PDF tools (★★★★)

**Needs:** 07b, 12a. **Builds:** PDF edit mode. **Figma frames:** File Explorer · PDF abierto.

## Tasks
- Following the Figma frame's toolbar: **Highlight** (with color choice), **Draw** (freehand ink), **Text** (add text boxes), **Comment** (margin comment cards with replies, author name from Settings), and **Sign** (draw, type, or insert an image of a signature and place it; this is a visual signature, not a certified digital signature, and the help page says so).
- **Page tools:** merge, split, reorder (drag thumbnails), rotate, delete, insert pages from another PDF or images.
- **Forms:** fill in PDF forms and save them.
- Annotations are saved as standard PDF annotations, readable by other PDF apps.
- Undo/redo history; saving goes through the version store; Save a copy; editing tools load behind the viewer and are ready within the Fast tier; downloaded files stay read-only until "Enable editing" (protected view).

## Parts to consider
pdf-lib (MIT), the PDF.js annotation editor (Apache-2.0), PDFium (Apache-2.0); qpdf (Apache-2.0) as an optional external tool.

## Help pages
Highlighting and drawing on PDFs; comments; signing a PDF; rearranging pages; filling forms.

## Done when
I can highlight, comment, and sign a PDF, merge two PDFs and reorder pages, fill a form, and open the result correctly in another PDF app.
