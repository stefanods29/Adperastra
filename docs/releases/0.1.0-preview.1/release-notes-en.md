# Adperastra 0.1.0-preview.1 — Office preview

Download **Adperastra-0.1.0-preview.1-windows-x64-portable.zip**, verify it against **SHA256SUMS.txt**, extract the entire archive into a writable folder, and run **Adperastra.exe**. Windows 11 x64, WebView2 and the Microsoft Visual C++ x64 runtime are required. Runtime download links are in the README. A separate LibreOffice installation is not required: this ZIP includes the signed Office renderer and compatible fonts.

- **+** opens a new independent Home tab. Browse different folders in different tabs.
- Office files open in preview first. Choose **Enable editing** to edit supported content.
- DOCX and PPTX text can be edited directly on visible pages and slides. Enter applies; Escape cancels.
- XLSX opens in a cell grid with workbook tabs and a formula bar. Eligible literal/empty cells are editable.
- Save a copy or Ctrl+S writes a new Office file and keeps the original unchanged.
- Word supports continuous scrolling. Slides support Left/Right and Page Up/Page Down when the workspace is focused. Toolbar and footer zoom controls are synchronized.

Read the included README for complete instructions. This is a preview, not full Office parity: advanced formatting, object editing, formula calculation, complete spreadsheet display formatting and legacy Office editing remain unfinished. Compatible fonts and LibreOffice rendering may differ from Microsoft Office. See KNOWN_ISSUES.md in the released source.

The Windows executable is unsigned. The Office catalog has its own independent pack signature. GitHub's automatic source archives do not include the runnable app or its Office pack. AI models, API credentials and media engine packs are not included.

This is a clean portable package: no developer profile, history or personal documents are distributed. Keep the entire extracted folder together. Extract future previews into a new folder and retain your previous folder until you have checked the update.
