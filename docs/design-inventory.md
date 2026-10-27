# Design inventory — Figma file (Step 00)

Source: the Figma file linked in `plan/design.md`. **Access note:** the owner
has now provided `plan/design-spec.md` (every color, font, size, spacing,
radius, shadow and icon measured from the Figma file) and screenshots in
`plan/design-sc/screens/` (6 PNGs, 01-explorer-home.png through
06-image-draw-toggle.png). No Figma connection is needed or used. Note one
path discrepancy: design-spec.md/design.md refer to `plan/design/screens/`
but the actual folder is `plan/design-sc/screens/` — the actual folder wins.

## Known global facts (measured, from design.md)

- One page, six frames, each 1200 x 900, light theme only.
- Window corner radius 10; white surfaces; border `#E5E5E5`.
- No Figma variables or styles exist — tokens must be measured from frames.
- Font is Inter (SIL OFL, bundleable); icons are Lucide (ISC, bundleable); measured accents — Explorer #0067C0, Excel-style #107C41, Word-style #185ABD, PDF #E4181F, image #0A8A93, PowerPoint-style #C43E1C, tab-group example #7F56D9; text primary #202020, secondary #616161. Full tables live in plan/design-spec.md.

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

## Token plan (Step 01b)

Tokens are copied from plan/design-spec.md into themes/default.tokens.json -> CSS variables; hover/pressed/disabled/focus states and motion are derived consistently from the measured values and shown to the owner; screenshot comparison uses plan/design-sc/screens/ at 100% and 150%; unknown values are asked for, never guessed.
