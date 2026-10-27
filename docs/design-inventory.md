# Design inventory — Figma file (Step 00)

Source: the Figma file linked in `plan/design.md`. **Access note:** no Figma
MCP / Dev Mode is connected to this session, so this inventory is built from
the frame-by-frame reading recorded in `plan/design.md` (27 Oct 2026). Exact
token values must be measured in Step 01b — see the measurement plan below.
Nothing is guessed.

## Known global facts (measured, from design.md)

- One page, six frames, each 1200 x 900, light theme only.
- Window corner radius 10; white surfaces; border `#E5E5E5`.
- No Figma variables or styles exist — tokens must be measured from frames.

## Frame inventory and frame-to-step map

| # | Frame | What it shows | Built in steps |
|---|---|---|---|
| 1 | File Explorer - Light | Explorer tab on its Home page | 02, 03a |
| 2 | File Explorer - Excel abierto | .xlsx open, Excel-style ribbon | 13 (view), 21a (edit) |
| 3 | File Explorer - PDF abierto | PDF open, annotation toolbar | 07b (view), 14a (tools) |
| 4 | File Explorer - Word abierto | .docx open, Word-style ribbon, tab group | 09a (groups), 13 (view), 20b (edit) |
| 5 | File Explorer - PNG abierto | Image open in Edit mode | 14b |
| 6 | File Explorer - PNG abierto - Dibujo | Same image, Draw mode selected (panels still show Edit panels — Draw itself is undesigned) | 14b, 18b |

## Component inventory (across frames)

**Window chrome (every frame)**
- Tab bar: permanent Explorer tab ("Home" + home icon alone; icon-only at far
  left once files are open); file tabs with colored file-type icon, truncated
  name, close button; "+" new tab; window controls.
- Tab groups: colored named group (example: purple "Finanzas") holding tabs,
  as in frames 4-6 — built in 09a.
- Navigation row on every tab (incl. file tabs): Back, Forward, Up, Refresh,
  breadcrumb ending in the open file, search box scoped to the tab. Up on a
  file tab returns to its folder; search on a file tab searches inside it.
- Status bar on every tab: Explorer = item/selection counts + size, list/grid
  buttons; file tabs = page/word count, "Ready", image size/format/bytes,
  accessibility checker, view buttons, zoom slider + percentage.
- One accent color per file type (primary button, active ribbon underline,
  focus): Explorer blue, Excel green, Word blue, PDF red, image teal. This is
  a per-handler accent token (customizable in 10a).

**Explorer / Home (frame 1)**
- Command bar: New menu | Cut, Copy, Paste, Rename, Share, Delete | Sort menu
  | View menu | overflow. Details-pane toggle to be added (Windows 11 parity)
  with a proposed look for owner approval.
- Navigation pane: Home (selected), Gallery, pinned folders with pin icons
  (Desktop, Downloads, Documents, Pictures, Music, Videos, Projects), This PC,
  Network. **No OneDrive entry** (decided: no cloud integration).
- Content: collapsible Quick access (3-column folder-card grid: colored icon,
  name, location); Recent | Favorites pill switch; file list (Name, Date
  modified, Type, Size; colored type icons; light-blue selected row).
- Gallery = photo view of chosen picture folders grouped by date (07a).

**Office-style tabs (frames 2 and 4)**
- Header row: AutoSave toggle, Save, Undo, Redo, document title, save status;
  Comments button and accent Share split button at right.
- Ribbon tabs — Excel-style: File, Home, Insert, Page Layout, Formulas, Data,
  Review, View, Help. Word-style: File, Home, Insert, Design, Layout,
  References, Review, View, Help. Editing-mode dropdown at right.
- Ribbon groups (Home): Excel — Clipboard, Font, Alignment, Number, Styles,
  Cells, Editing. Word — Clipboard, Font, Paragraph, Styles gallery, Editing,
  Voice.
- Excel extras: name box, formula bar (cancel/confirm/fx), sheet tabs.
- Word extras: page on gray canvas, margin comment card.

**PDF tab (frame 3)**
- Toolbar: thumbnails toggle, prev/next, "page x of y", zoom, select tool,
  Highlight (color dot), Draw, Text, Comment, Sign; right side: search, print,
  download, red Share split button. Thumbnails sidebar; page on gray canvas;
  margin comment card (same pattern as Word).

**Image tab (frames 5 and 6)**
- Top row: Undo, Redo, Compare, Edit | Draw mode switch, zoom; right: Export
  menu, Save a copy menu, teal Save.
- Left tool rail: Crop, Size, Adjust, Filters, Markup, Erase.
- Right properties panel (collapsible sections): Crop and rotate (aspect
  presets Free/Original/1:1/16:9/4:3/3:2, rotate/flip, angle slider), Resize
  (px/%, locked proportions), Filters (Original, Vivid, Warm, Cool, B/W,
  Sepia thumbnails), Adjustments.
- Crop overlay: rule-of-thirds grid, size label.

## Screens still to design (in the same visual language, owner-approved before building)

From `plan/design.md` section "Screens still to design": dark and other
built-in themes; Explorer inside a folder with Details pane; right-click
menus; setup window + first-run checklist; Quick Convert window + job queue;
toolbars docked bottom/left/right; text/Markdown/code, CSV, archive,
audio/video, e-book, 3D and PowerPoint-style tabs; Draw-mode panels (brushes,
colors, sizes, shapes); Gallery view; File (backstage) page; Settings
including App storage and Background work; help center; tab-group menus; copy
and conflict windows; the shelf; empty states, errors, loading skeletons.
Steps that own these designs say "show me first" (05, 08a, 09c, 12a, 14b, 15,
19a, 22a) — they are schedule gates inside those steps, not afterthoughts.

## Token-measurement plan (executed in Step 01b)

1. Get access one of two ways (owner choice, question Q2 in the Step 00
   report): Figma Dev Mode / MCP, or exported PNGs of every frame at 100%
   and 150% plus the font name(s) used.
2. Measure per component and state (default/hover/pressed/disabled/focus):
   colors, type scale, spacing, radii, shadows, borders, motion durations,
   icon sizes. Record into `themes/default.tokens.json`; generate CSS
   variables; the Figma light look is the default theme.
3. Check contrast and focus visibility while measuring — flag, never copy, a
   low-contrast color or a missing focus state (`design.md` rule 8).
4. Verify icon and font licenses before reuse; otherwise switch to Lucide
   (ISC) / Phosphor (MIT) icons and an OFL font, and log it in
   `DESIGN_DEVIATIONS.md` (created in 01b).
5. Build the developer-only component gallery (01b) and screenshot-compare it
   against the Figma frames at 100% and 150%.

Known accent colors are described only by hue in the frames (Excel green,
PDF red, image teal, blue for Explorer/Word); exact hex values come from
measurement, not from this document.
