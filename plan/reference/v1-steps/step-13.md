# Step 13: Accurate Office viewers (★★★★)

**Needs:** 12b. **Builds:** Office view handlers, fonts, warm Office engine. **Figma frames:** Excel abierto and Word abierto (viewing layout; editing comes in Steps 20-22). **Milestone:** v0.3 after this step.

## Tasks
- Read-only views of docx, xlsx, pptx, odt/ods/odp, rtf, and legacy doc/xls/ppt: an instant first view (cached preview within the Fast tier), then exact rendering from the Office engine pack in the background (cached). All sheets, slide navigation, presentation mode, comments shown read-only, and a View ribbon. The Office engine stays warm after first use (memory limits and idle timeout apply).
- Without the Office engine pack, show the instant preview only and a message linking to App storage; or open in the user's chosen app.
- Bundle open, metric-compatible fonts so layouts match (Carlito for Calibri, Caladea for Cambria, Liberation for Arial/Times New Roman/Courier New, Noto for broad coverage; check each font's license).
- Prepare the "view now, edit when ready" structure that Steps 20-22 will use.

## Parts to consider
docx-preview (Apache-2.0) for an instant Word-style view; SheetJS Community Edition (Apache-2.0) or ExcelJS (MIT) for a quick spreadsheet grid; LibreOffice (MPL-2.0) for exact rendering.

## Help pages
Viewing Word, Excel, and PowerPoint files; presentation mode; fonts and layout accuracy.

## Done when
My sample Word, Excel, and PowerPoint files open within their speed tier and look right compared with the PDFs exported from Microsoft Office. I approve and v0.3 is released.
