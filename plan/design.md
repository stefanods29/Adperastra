# Design: the Figma file

Design example for the look and feel:
https://www.figma.com/design/k2e0mSpowgAtyCt1ph0DAx/Adperastra-prototype?node-id=0-1&t=hEOV2fS3Dxl7cwen-1

The Figma file is an **example of the design style**, not a specification of content. Follow its visual language (layout, spacing, colors, typography, components, accent colors); all text comes from the translation files in the user's chosen language.

## Rules

1. **How to read it:** use `plan/design-spec.md` (every color, font, size, spacing, radius, shadow and icon measured from the Figma file) and the screenshots in `plan/design/screens/`. Do not connect to Figma.
2. **Tokens only:** colors, sizes, radii and shadows come from the CSS variables in `src/styles/tokens.css` (generated from `themes/*.tokens.json`). Never type a hex color in a component.
3. **Text:** the Figma text is Spanish example content. Every label comes from the translation files (`plan/rules.md` R-LANG).
4. **New screens:** where Figma has nothing (dialogs, panels, viewers), the step recipe gives the layout and sizes, built from the same tokens. Follow the recipe; where it misses a value, use the closest value from `plan/design-spec.md` and list it under "Design deviations" in the step report and in `DESIGN_DEVIATIONS.md`.
5. **Open-source parts** (editors, PDF viewer, 3D view) are styled with our tokens; never ship a library's default look.
6. **Checks:** each step's screenshots (English light, Spanish dark, pseudo-locale) are compared with the matching Figma frame; differences go in the report. Low contrast or a missing focus state is flagged, not copied.
7. **Assets:** icons from Lucide (ISC) and the Inter font (SIL OFL) only. No Microsoft icons or fonts.

## What the Figma file contains (read on 27 Oct 2026)

One page, six frames, all 1200 × 900, light theme only, window corner radius 10, white surfaces with a #E5E5E5 border. The file has no Figma variables or styles; all measured values are in `plan/design-spec.md`. UI names below are given in English; the frames show them in Spanish.

| Frame | What it shows | Built in |
|---|---|---|
| File Explorer · Light | The Explorer tab on its Home page | Steps 02, 03a |
| File Explorer · Excel abierto | An .xlsx open with an Excel-style ribbon | Steps 13, 21a |
| File Explorer · PDF abierto | A PDF open with an annotation toolbar | Steps 07b, 14a |
| File Explorer · Word abierto | A .docx open with a Word-style ribbon, plus a tab group | Steps 09a, 13, 20b |
| File Explorer · PNG abierto | An image open in Edit mode | Step 14b |
| File Explorer · PNG abierto · Dibujo | Same image with the Draw mode toggle selected; the panels are still the Edit panels, so Draw mode itself is not designed yet | Steps 14b, 18b |

### Shared window chrome (every frame)
- **Tab bar:** the permanent Explorer tab is labeled "Home" with a home icon when it's the only tab, and shrinks to an icon-only home tab at the far left once files are open. File tabs show a colored file-type icon (Excel green, PDF red, Word blue, image teal), the name truncated with an ellipsis, and a close button. Then "+" and the window controls.
- **Tab groups:** in the Word and PNG frames, the Excel, PDF, and Word tabs sit inside a purple named group (example name "Finanzas"), like browser tab groups.
- **Navigation row on every tab, including file tabs:** Back, Forward, Up, Refresh, a breadcrumb that ends in the open file with its icon, and a search box scoped to the active tab ("Search in Home", "Search in the workbook", "Search in the document", "Search in the image"). On a file tab, Up returns to the containing folder in the Explorer tab and search looks inside the file.
- **Status bar on every tab:** Explorer shows item count, selection count and size, and list/grid view buttons; file tabs show context (page and word count, "Ready", image size, format, file size), an accessibility checker, view-mode buttons, and a zoom slider with a percentage.
- **One accent color per file type**, used for the primary button (Share or Save), the active ribbon tab underline, and focus states: Explorer blue, Excel green, Word blue, PDF red, image teal. This is a per-handler accent token, customizable later (Step 10a).

### Explorer · Home page
- Command bar: New ▾ | Cut, Copy, Paste, Rename, Share, Delete (icons) | Sort ▾ | View ▾ | •••. Figma has no "Details" toggle at the right, but the Windows 11 Explorer does; keep it and propose its look.
- Navigation pane in Figma: Home (selected), Gallery, OneDrive, pinned folders with pin icons (Desktop, Downloads, Documents, Pictures, Music, Videos, Projects), This PC, and Network. **We don't include OneDrive** (no cloud integration); the rest stays.
- Content: a collapsible "Quick access" section with a 3-column grid of folder cards (colored icon, name, location); a pill switch "Recent | Favorites"; a file list with Name, Date modified (sorted), Type, Size, colored file-type icons, and a light-blue selected row.
- "Gallery" is a photo view of chosen picture folders, grouped by date.

### Office-style tabs (Excel and Word frames)
- Header row: AutoSave toggle, Save, Undo, Redo, document title, save status ("Saved"); at the right, a "Comments" button and a "Share" split button in the type accent color.
- Ribbon tabs. Excel-style: File, Home, Insert, Page Layout, Formulas, Data, Review, View, Help. Word-style: File, Home, Insert, Design, Layout, References, Review, View, Help. At the right, an "Editing" mode dropdown (editing, reviewing, viewing).
- Ribbon groups with labels under them. Excel-style Home: Clipboard, Font, Alignment, Number, Styles (conditional formatting, format as table, cell styles), Cells, Editing (AutoSum, Sort and filter, Find). Word-style Home: Clipboard, Font, Paragraph, Styles (gallery: Normal, No Spacing, Heading 1), Editing (Find, Replace, Select), Voice (Dictate, Editor).
- Excel-style: name box, formula bar with cancel/confirm/fx, column and row headers, sheet tabs with arrows, "+", and •••.
- Word-style: page on a gray canvas; a comment card in the right margin (avatar, name, time, text, "Reply").

### PDF tab
- One toolbar row: thumbnails toggle, previous/next page, page "1 of 3", zoom − 90% +, select tool, Highlight (with a color dot), Draw, Text, Comment, Sign; at the right, search, print, download, and a red "Share" split button.
- A Thumbnails sidebar, the page on a gray canvas, and a margin comment card like the Word-style one.

### Image tab (Edit and Draw modes)
- Top row: Undo, Redo, Compare (before/after), an "Edit | Draw" mode switch, zoom − 90% +; at the right, "Export ▾", "Save a copy ▾", and a teal "Save".
- Left tool rail: Crop, Size, Adjust, Filters, Markup, Erase.
- Right properties panel with collapsible sections: "Crop and rotate" (aspect presets Free, Original, 1:1, 16:9, 4:3, 3:2; rotate left/right, flip; angle slider), "Resize" (pixels/percentage, width/height with a lock, keep proportions), "Filters" (Original, Vivid, Warm, Cool, B/W, Sepia, with thumbnails), "Adjustments" (collapsed).
- Crop overlay on the canvas with rule-of-thirds lines and a size label.

## Screens Figma does not have

Figma has no frames for these, so each step recipe specifies them from the same tokens (rule 4): the other built-in themes; the Explorer view modes and Column view; file-tab viewers (text, Markdown, images, media, PDF, archives, tables, e-books, 3D, fonts); the ribbon on viewers; toolbars docked at the bottom, left and right; the Settings sections; the Quick Convert window and job queue; version history; the privacy cleaner; the Gallery; later: tab-group menus, the copy and conflict windows, the shelf, Draw mode panels, the File (backstage) page, App storage and Background work pages.
