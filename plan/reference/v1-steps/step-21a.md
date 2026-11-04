# Step 21a: Excel-style editing (★★★★★)

**Needs:** 20a. **Builds:** spreadsheet ribbon and grid. **Figma frames:** File Explorer · Excel abierto.

## Tasks
- **Our own movable header row and ribbon** as in the Figma frame: tabs File, Home, Insert, Page Layout, Formulas, Data, Review, View, Help (all translated); Home groups Clipboard, Font, Alignment, Number, Styles (conditional formatting, format as table, cell styles), Cells, Editing (AutoSum, Sort and filter, Find); the Editing mode dropdown.
- Name box, formula bar with cancel/confirm/fx, sheet tabs (add, rename, reorder, color), row and column headers, freeze panes, number formats, conditional formatting, data validation, charts, pivot tables, sort and filter, find and replace.
- Formulas with function names and separators in the user's locale (as Excel does), with formula and function parity checks against my sample files.
- Large sheets (100,000 rows) stay virtualized; scrolling in the Smooth tier; editing a cell in the Instant tier.
- Saving through the version store; copy and paste with other tabs (for example cells into a document table).

## Help pages
Editing spreadsheets; formulas; formatting and conditional formatting; charts; pivot tables; sorting and filtering.

## Done when
I can edit my sample workbooks with our ribbon, formulas calculate the same as in Microsoft Office on the parity tests, a 100,000-row sheet scrolls smoothly, and round-trip tests pass.
