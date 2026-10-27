# Design spec (measured from the Figma file)

Measured directly from the Figma file "Adperastra prototype" on 27 Oct 2026 (every value below was read from the file's layers, not guessed). Use this file and the screenshots in `plan/design/screens/` instead of connecting to Figma. If a value you need isn't here, ask me for an exported screenshot rather than guessing.

All visible text in the frames is Spanish example content; the real strings come from the translation files (`rules.md`, section 2). Measurements are in pixels at 100% scale.

## Screenshots

| File | Frame |
|---|---|
| `design/screens/01-explorer-home.png` | File Explorer · Light (Explorer, Home page) |
| `design/screens/02-excel-open.png` | File Explorer · Excel abierto |
| `design/screens/03-pdf-open.png` | File Explorer · PDF abierto |
| `design/screens/04-word-open-tab-group.png` | File Explorer · Word abierto (with a tab group) |
| `design/screens/05-image-edit-mode.png` | File Explorer · PNG abierto (Edit mode) |
| `design/screens/06-image-draw-toggle.png` | File Explorer · PNG abierto · Dibujo (Draw toggle selected; panels identical to Edit mode, Draw panels not designed yet) |

## 1. Foundations

**Window:** 1200 × 900, corner radius 10, background `#FFFFFF`, 1 px border `#E5E5E5`. Light theme only (the dark theme must be derived, see `design.md`).

**Font:** Inter only (Regular, Medium, Semi Bold, Bold, Italic). Inter is under the SIL Open Font License, so it can be bundled. All text uses automatic line height unless stated, letter spacing 0.

**Icons:** the Lucide icon set (ISC license, fine to bundle), outline style, stroke width 1.4 at 16 px (some at 2). Standard sizes: 16 px (toolbar and command icons), 17 px (navigation pane), 12-14 px (small controls, chevrons, close buttons), 20 px (image tool rail), 29 px (large ribbon buttons such as Paste). Icon names used in the design: accessibility, align-left, align-start-vertical, arrow-down-wide-narrow, arrow-left, arrow-right, arrow-up, brush, check, chevron-down/left/right/up, clock-3, cloud, cloud-check, columns-2, copy, decimals-arrow-left, download, ellipsis, file, grid-2x2, highlighter, house, link, list, list-filter, message-square, minus, monitor, mouse-pointer, paintbrush, panel-left, panels-top-left, pen-line, pen-tool, pencil, pin, plus, printer, redo-2, rotate-cw, save, scissors, search, share, sigma, sliders, star, table-cells-merge, table-properties, table-rows-split, text-cursor-input, trash-2, triangle-right, type, undo-2, wrap-text, x. Some layers have Spanish names; use these Lucide equivalents: recortar → crop, redimensionar → scaling (or maximize-2), ajustar → sliders-horizontal, filtros → wand-sparkles, marcado → pen-line, borrar → eraser, voltear → flip-horizontal-2, girar izq./der. → rotate-ccw / rotate-cw, buscar → search, reemplazar → replace, more-styles → chevron-down in a box.

## 2. Color tokens

### Neutrals: text
| Token | Value | Used for |
|---|---|---|
| text.primary | `#202020` | Labels, file names, titles, menu text |
| text.secondary | `#616161` | Dates, types, sizes, captions, placeholders, status bar, group captions, icons (stroke) |
| text.tertiary | `#8A8A8A` / `#8B8B8B` | Disabled icons (for example the Forward arrow) |
| text.body-muted | `#333333` | Comment text |
| text.mode-inactive | `#4A4A4A` | Unselected segment label |
| icon.default | `#616161` stroke; dark icons `#424242` | Toolbar icons |
| text.on-accent | `#FFFFFF` | Text on filled accent buttons and chips |

### Neutrals: surfaces
| Token | Value | Used for |
|---|---|---|
| surface.window | `#FFFFFF` | Address row, command bar, active tab, cards, inputs |
| surface.chrome | `#F3F3F3` | Tab bar background, address box, search box, zoom box, formula bar, status bars of file tabs |
| surface.pane | `#FAFAFA` | Navigation pane, ribbon body, sheet tab strip |
| surface.sidebar | `#F7F7F7` | PDF thumbnails sidebar, image tool rail, scrollbar tracks |
| surface.selected | `#EAEAEA` | Selected navigation item |
| surface.tab-inactive | `#E1E1E1` | Inactive file tabs |
| surface.header | `#F0F0F0` | Spreadsheet row/column headers, segmented control track (Resize) |
| surface.segment-track | `#EDEDED` | Edit / Draw mode switch track |
| surface.canvas-doc | `#EFEFEF` | Word-style document canvas |
| surface.canvas-media | `#ECECEC` | PDF and image canvas |
| scrollbar.thumb | `#C8C8C8` (Explorer), `#C1C1C1` (documents); track `#EFEFEF` |

### Neutrals: borders
| Token | Value | Used for |
|---|---|---|
| border.default | `#E5E5E5` | Window border, row dividers, pane dividers, command separators, outlined chips |
| border.subtle | `#E0E0E0` | Spreadsheet grid, comment card, separators in file toolbars |
| border.panel | `#ECECEC` | Image properties panel section dividers |
| border.input | `#C8C8C8` | Inputs, page-number box, outlined buttons (Export, Save a copy) |
| border.chip | `#D0D0D0` | Aspect-ratio chips, rotate/flip buttons, slider track |
| border.gallery | `#D6D6D6` | Unselected style-gallery tiles |
| border.thumb | `#CFCFCF` | Unselected PDF page thumbnails |
| border.doc-table | `#D4D4D4` | Tables inside documents |

### Accents (one per area; a per-handler accent token)
| Area | Accent | Accent dark | Accent light (backgrounds) | Notes |
|---|---|---|---|---|
| Explorer / app | `#0067C0` | — | `#E5F1FB` (selected file row), `#E5F0FB` (pressed toolbar toggle) | Active nav indicator, "Recent" pill, focus |
| Excel-style | `#107C41` | `#185C37` (table header fill, Paste icon) | `#E6F2EA` (selected column header), `#F5F9F6` (table zebra rows) | AutoSave on, Share button, active ribbon tab, active sheet tab |
| Word-style | `#185ABD` | `#0F4761` (headings, table header), `#0E2841` (title) | `#EAF1FB` (table total row) | Share button, active tab, selected style tile border |
| PDF | `#E4181F` | — | — | Share button, PDF file icon |
| Image | `#0A8A93` | — | `#DEF3F4` (selected tool, chips, lock button) | Save button, selected tool label, slider, checkbox |
| PowerPoint-style (file icon) | `#C43E1C` | — | — | Only seen as a file icon; derive the rest |
| Tab group (example color) | `#7F56D9` | — | `#7F56D9` at 16% (group background) | Group name chip and outline |

### Other colors
| Use | Value |
|---|---|
| Highlight color dot (PDF) | `#FFD60A`, stroke `#C9A800` |
| Comment avatar (example) | `#8764B8`; initials white, Semi Bold 9 |
| Quick-access folder icons (example) | Desktop `#0099D5`, Downloads `#17A889`, Documents `#5C92BE`, Pictures `#1599D0`, Music `#E07539`, Videos `#9765CC`; plain folders use a yellow outline icon (`#DFB22B` / `#CC9F2B`) |
| File-type icons in lists | Excel `#107C41`, Word `#185ABD`, PowerPoint `#C43E1C`, images `#0078D4`, video `#8764B8` (outline icons with a small letter or symbol) |
| Image filter thumbnails (example gradients) | Original `#080B2A → #3B2A7A → #E0698A`; Vivid `#05103F → #5A2BD0 → #FF5D8F`; Warm `#2A0F1E → #8A3A3A → #FFB36B`; Cool `#041A2E → #1F5A8A → #7FD0E8`; B/W `#111111 → #777777 → #DDDDDD`; Sepia `#2B1D10 → #7A5A3A → #D9B98A` |
| Text cursor | `#000000`, 2 px wide |

## 3. Typography (Inter)

| Role | Style | Size | Color | Examples |
|---|---|---|---|---|
| Body / list text | Regular | 12 | text.primary | File names, tab titles, nav items, toolbar labels in file tabs |
| Small text | Regular | 11 | text.secondary or primary | Dates, types, sizes, ribbon command labels, grid cells, comment text |
| Caption | Regular | 10 | text.secondary | "Stored locally", ribbon group captions, status "Accessibility" text, zoom % |
| Tiny | Regular | 9 | text.secondary | Comment time |
| Command bar label | Regular | 13 | text.primary | "New", "Sort", "View", address text |
| Section title | Semi Bold | 13 | text.primary | "Quick access", properties panel section titles |
| Selected nav item | Semi Bold | 12 | text.primary | Selected navigation item |
| Selected tab / segment label | Semi Bold | 12 | accent | Active ribbon tab, active sheet tab, selected mode |
| Strong small | Semi Bold | 11 | text.primary | Comment author |
| Medium labels | Medium | 10-12 | varies | Group chip (Medium 11, white), selected tool label (Medium 10, accent), primary buttons (Medium 12, white), reply link (Medium 10, accent) |
| Button text on accent | Regular 11 / Medium 12 | | white | Share and Save buttons |
| Style gallery sample | Regular 16 (Heading sample Semi Bold 16) | | | "AaBbCc" tiles |
| fx symbol | Italic | 15 | text.secondary | Formula bar |
| Document title (example content) | Semi Bold | 28 | `#0E2841` | Word page title |
| Document heading (example content) | Semi Bold | 16 | `#0F4761` | Word headings |

Most-used styles by count: Regular 11 (365 uses), Regular 12 (129), Regular 10 (67), Semi Bold 11 (24).

## 4. Spacing, radii, borders, shadows

**Spacing:** a 2/4 px base. Most common gaps: 8, 6, 5, 3, 4, 10, 12, 14, 16, 22 (navigation arrows), 25 (ribbon tabs). Most common horizontal paddings: 8, 10, 12, 14, 16, 18.

**Corner radius:**
| Radius | Used for |
|---|---|
| 2 | File-type icon tiles, small bars, sliders, active indicator |
| 3 | Checkbox |
| 4 | Default: buttons, toolbar buttons, inputs, address and search boxes, nav items, file rows, ribbon commands, style tiles |
| 6 | Tool rail items, segment buttons, tab group name chip, Resize unit toggle |
| 7 | Inactive tabs, collapsed Home tab |
| 8 | Comment cards; switch handle |
| 9 | Tab group outline, Edit/Draw mode switch track |
| 10 | Window; AutoSave switch |
| 12 | Avatars (circle at 24 px) |
| 14 | Aspect-ratio chips (pills) |
| 16 | "Recent / Favorites" pills |

**Borders:** 1 px everywhere for UI borders and dividers; 2 px for selected states (selected style tile, selected page thumbnail, selected filter thumbnail, slider thumb). Icon strokes 1.4 px.

**Shadows:**
| Name | Value | Used for |
|---|---|---|
| shadow.page | 0 2 10, black 16% | Document and PDF pages |
| shadow.card | 0 2 8, black 12% | Comment cards |
| shadow.segment | 0 1 3, black 14% | Selected Edit/Draw segment |
| shadow.segment-small | 0 1 2, black 12% | Selected Pixels/Percentage segment |
| shadow.image | 0 4 16, black 22% | Image on the editor canvas |

## 5. Window chrome (all frames)

| Region | Size | Style |
|---|---|---|
| Tab bar | height 40, left padding 12 | fill `#F3F3F3` |
| Address row | height 56, padding 0 16, gap 16 | fill `#FFFFFF`, bottom border `#E5E5E5` on file tabs |
| Explorer command bar | height 48, padding 0 12, gap 5 | fill `#FFFFFF`, bottom border `#E5E5E5` |
| File-tab toolbar (PDF, image) | height 48, padding 0 16, gap 6 | fill `#FFFFFF`, bottom border |
| Office-style toolbar | 186 total: header row 40 + ribbon tabs 34 + ribbon body 112 | see section 8 |
| Status bar | height 28, padding 0 20 (Explorer) or 0 18 (file tabs) | Explorer: no fill, top border; file tabs: fill `#F3F3F3`, top border |

**Tabs**
- Home tab when alone: 242 × 34 at y 3, fill white, padding 0 14, gap 12: house icon 16, title Regular 12, close icon 12. The bottom of the active tab joins the row below (no bottom border).
- Home tab when files are open: icon-only, 42 × 34, radius 7, house icon 16 in the Explorer accent `#0067C0`.
- Active file tab: up to about 264 × 37 (touches the bottom of the tab bar), fill white, padding 0 14, gap 10: file-type icon tile 18 × 20 (radius 2, accent fill, white letter Bold 13: "X", "W", "PDF"...), title Regular 12 `#202020`, close 12.
- Inactive file tab: 150 × 34, radius 7, fill `#E1E1E1`, title Regular 12 `#616161`, truncated with an ellipsis.
- Tab spacing: gap 6 between tabs; "+" button 32 × 34 with a 16 px plus icon.
- Tab group: outline 1 px in the group color, background group color at 16%, radius 9, padding 0 5, gap 4; name chip 21 high, radius 6, padding 4 10, fill group color, label Medium 11 white.
- Window buttons: three 46 × 36 buttons (minimize, maximize, close) with 12 px icons, top right.

**Address row**
- Back, Forward, Up, Refresh: 16 px icons, gap 22 (disabled ones use `#8B8B8B`).
- Address box: 34 high, fill `#F3F3F3`, radius 4, padding 0 14, gap 12-14: house icon 16, chevrons 12, path segments Regular 13; on file tabs it ends in the file-type icon and the file name.
- Search box: 270 × 34, fill `#F3F3F3`, radius 4, padding 0 14; placeholder Regular 12 `#616161` ("Search in <place>"), search icon 15 at the right.

## 6. Explorer (Home page)

- **Command bar items:** text commands 32 high, padding 0 10, gap 8 (icon 16, label Regular 13, chevron 11); icon-only commands 36 × 32; separators 1 × 20 `#E5E5E5`. Order: New ▾ | Cut, Copy, Paste, Rename, Share, Delete | Sort ▾, View ▾ | •••. Keep a "Details" toggle at the right (from Windows 11; not in the frame).
- **Navigation pane:** width 196, fill `#FAFAFA`, right border, padding 12 6 0 6. Items 184 × 36, radius 4, padding 0 12 0 10, gap 10: expand chevron area 12, icon 17, label Regular 12. Selected item: fill `#EAEAEA`, label Semi Bold 12, plus an active indicator bar 3 × 16 `#0067C0` radius 2 at the left edge. Pinned items show a pin icon 11 at the right. Section spacers 12 high; dividers 1 px `#E5E5E5`. (The OneDrive item in the frame is not used.)
- **Content area:** padding 18 24 0 24.
  - Section heading: 24 high, chevron 12, gap 10, title Semi Bold 13.
  - Quick access grid: 3 columns, rows 48 high; each card: padding-left 12, gap 12, folder icon tile 32 × 32 (radius 2, colored), name Regular 12 and location Regular 10 `#616161`, gap 3.
  - "Recent | Favorites" pills: 28 high, radius 16, padding 0 13, gap 6, icon 13, label Regular 12. Selected: fill `#0067C0`, white text; unselected: 1 px `#E5E5E5` outline.
  - Column header row: 32 high, bottom border, labels Regular 11 `#616161`; the sorted column shows a small chevron.
  - File rows: 28 high, radius 4, padding 0 12; name cell with a 22 × 24 file-type icon, gap 9, name Regular 12; date, type, size Regular 11 `#616161`. Selected row fill `#E5F1FB`. Column widths in the frame: name 364, date 170, type 290, size 108 (right-aligned).
  - Scrollbar: 3 px wide, track `#EFEFEF`, thumb `#C8C8C8`, radius 2.
- **Status bar:** "N items | 1 item selected 248 KB" Regular 12 `#616161`; list/grid view buttons at the right.

## 7. File-tab status bar (Excel, Word, image)

Fill `#F3F3F3`, top border, padding 0 18. Left: status text Regular 11 `#616161` ("Ready", "Page 1 of 2 · 318 words", "1920 × 1080 px · PNG · 1.4 MB"), gap 18, accessibility icon 13 + "Accessibility: all good" Regular 10. Right (gap 17): three view-mode icons 14 (grid-2x2, file, panels-top-left), a separator, minus 12, zoom slider 94 wide (track 2 px `#ADADAD`, handle 5 × 10 radius 2 in the accent), plus 12, zoom "100 %" Regular 10.

## 8. Office-style tabs (Excel and Word frames)

- **Header row** (40 high, padding 0 18): "AutoSave" Regular 11 + switch 30 × 16 (radius 10, accent fill when on, white handle 12 × 12) | Save, Undo, Redo icons 16, gap 14 | separator | document title Semi Bold 12 | cloud-check icon 16 + "Saved" Regular 10 `#616161`. Right side, gap 8: "Comments" outlined button 105 × 27 (1 px `#E5E5E5`, radius 4, padding 0 9, gap 6, icon 14, label Regular 11) and the "Share" split button 109 × 27 (accent fill, radius 4, padding 0 10, gap 6, icon 14, label Regular 11 white, chevron 10).
- **Ribbon tabs row** (34 high, padding 0 18, gap 25, bottom border): labels Regular 12; the selected tab is Semi Bold 12 in the accent with a 3 px indicator bar under it (radius 2). At the right: "Editing" mode control (pencil icon 13, label Regular 11, chevron 10).
- **Ribbon body** (112 high, fill `#FAFAFA`, padding 7 12, gap 7, bottom border): groups 98 high separated by 1 × 70 lines `#E5E5E5`; each group has its commands (76 high) and a caption (Regular 10 `#616161`, centered) at the bottom.
  - Large button (for example Paste): 44 wide, icon 29, label Regular 11 under it, chevron 9.
  - Small commands: 25 high, radius 4, padding 0 5, gap 5, icon 15, label Regular 11; stacked three per column.
  - Style gallery tiles (Word-style): 70 × 62, radius 4, white, sample "AaBbCc" Regular 16 and label Regular 10; selected tile has a 2 px accent border, others 1 px `#D6D6D6`; a 25 × 25 "more" button after them.
  - Voice group (Word-style): two large buttons 54 × 60 (Dictate, Editor), radius 4.
- **Excel-style specifics:** formula bar 36 high (fill `#F3F3F3`, padding 5 8, gap 8): name box 104 × 26 (white, 1 px `#E5E5E5`), separator, cancel x 14, confirm check 16, "fx" Italic 15, formula input white 1 px border, chevron 12. Grid: column headers 26 high, row headers 44 wide, rows 22 high, cells padding 0 8, text Regular 11; headers fill `#F0F0F0` with `#E0E0E0` lines and labels Regular 11 `#616161`; selected column header fill `#E6F2EA` with an accent bottom line; selected cell 2 px accent outline. Vertical scrollbar 16 wide fill `#F3F3F3`. Sheet tab strip 36 high (fill `#FAFAFA`, padding 0 16, gap 8): navigation chevrons 13 and ellipsis, separator, sheet tabs padding 0 17 (active: white with an accent bottom line, label Semi Bold 12 in the accent; inactive: label Regular 12 `#616161`), add button 30 × 30.
- **Word-style specifics:** canvas `#EFEFEF` with 16 top padding; page 640 wide (A4-like ratio), white, shadow.page, padding 56 64 48 64; vertical scrollbar 16 wide fill `#F7F7F7`. Comment card: 200 wide, white, 1 px `#E0E0E0`, radius 8, shadow.card, padding 10 12 12 12, gap 8; header with a 24 px avatar, name Semi Bold 11, time Regular 9 `#616161`; text Regular 11 `#333333`; "Reply" Medium 10 in the accent.

## 9. PDF tab

- **Toolbar** (48 high, padding 0 16, gap 6, bottom border): icon buttons 32 × 32 radius 4 padding 8 (thumbnails toggle shown pressed with fill `#E5F0FB`) | separators 1 × 20 `#E0E0E0` | previous/next page buttons, page box 32 × 27 (white, 1 px `#C8C8C8`, radius 4), "of 3" Regular 12 `#616161` | zoom out, zoom level box 69 × 25 (fill `#F3F3F3`, radius 4, "90 %" Regular 12, chevron 12), zoom in | annotation tools (gap 2): select (icon only), Highlight (selected: fill `#E5F0FB`, icon 16, label Regular 12, color dot 9 px `#FFD60A`), Draw, Text, Comment, Sign (32 high, padding 8 10, gap 6) | flexible space | Search, Print, Download icon buttons and the red Share split button 120 × 27 (fill `#E4181F`, radius 4, label Medium 12 white, icon 14, chevron 10).
- **Thumbnails sidebar:** 188 wide, fill `#F7F7F7`, right border, padding 16 14, gap 16; title Medium 11 `#616161`; thumbnails 112 × 145, white; selected thumbnail 2 px `#0067C0` border and page number Medium 11 in `#0067C0`; others 1 px `#CFCFCF` and Regular 11 `#616161`.
- **Canvas:** fill `#ECECEC`, top padding 16; page 580 wide, white, shadow.page; comment card 184 wide in the right margin (same style as Word-style); vertical scrollbar 16 wide fill `#F7F7F7`, thumb 6 wide `#C1C1C1` radius 3, arrow icons 10. The PDF frame has no status bar.

## 10. Image tab

- **Toolbar** (48 high, padding 0 16, gap 6): Undo, Redo (32 × 32 icon buttons) | Compare (icon columns-2 16, label Regular 12) | Edit/Draw switch: track 182 × 34 fill `#EDEDED` radius 9 padding 3 gap 2; selected segment 90 × 28 white radius 6 shadow.segment, icon 15 + label Semi Bold 12 in the accent; unselected label Medium 12 `#4A4A4A` | zoom controls (as in the PDF toolbar) | at the right: "Export ▾" and "Save a copy ▾" outlined buttons (29 high, white, 1 px `#C8C8C8`, radius 4, padding 6 10 6 12, label Regular 12, chevron 10) and "Save" (27 high, fill `#0A8A93`, radius 4, padding 6 18, label Medium 12 white).
- **Tool rail:** 76 wide, fill `#F7F7F7`, right border, padding 10 6, gap 4; items 63 × 55, radius 6, padding 10 2 8 2, gap 5, icon 20 above label Regular 10; selected item fill `#DEF3F4`, label Medium 10 `#0A8A93`. Tools: Crop, Size, Adjust, Filters, Markup, Erase.
- **Canvas:** fill `#ECECEC`; image shown with shadow.image; crop overlay with rule-of-thirds lines, corner handles, and a size label (dark pill, small white text).
- **Properties panel:** 300 wide, white, left border. Collapsible sections separated by 1 px `#ECECEC`: header 37 high (padding 13 16 8 16, title Semi Bold 13, chevron 14), content padding 0 16 16 16, gap 10.
  - Chips (aspect ratios): 29 high, radius 14 (pill), padding 6 12, white with 1 px `#D0D0D0`, label Regular 12; selected: fill `#DEF3F4`, 1 px accent border, label Medium 12 in the accent; rows gap 8.
  - Outlined buttons (rotate, flip): 30 high, white, 1 px `#D0D0D0`, radius 4, padding 7 10, gap 6, icon 14, label Regular 11.
  - Slider: label row (Regular 12 + value Regular 12 `#616161`), track 4 px `#D0D0D0` radius 2, fill in the accent, thumb 16 px circle white with 2 px accent border.
  - Segmented control (Pixels / Percentage): track 29 high fill `#F0F0F0` radius 6 padding 2 gap 2; selected segment white radius 4 shadow.segment-small, label Medium 12.
  - Number inputs: label Regular 11 `#616161` above (gap 4), input 110 × 32 white 1 px `#C8C8C8` radius 4 padding 7 10, unit suffix in `#616161`; lock button 32 × 32 fill `#DEF3F4` radius 4 with a link icon 16.
  - Checkbox: 16 × 16 radius 3, accent fill with a white check 12 when on; label Regular 12.
  - Filter tiles: 84 × 52 thumbnails radius 4 (selected: 2 px accent border), label Medium 10 in the accent when selected, otherwise Regular 10; 3 per row, gap 8, rows gap 10.

## 11. What isn't designed yet

See `design.md`, "Screens still to design": dark theme, Explorer inside a folder with the Details pane, menus, setup window, Quick Convert, job queue, side and bottom toolbars, the remaining file types, Draw mode panels, Gallery, File (backstage) page, Settings (App storage, Background work), help center, tab-group menus, copy and conflict windows, shelf, empty states, errors, and skeletons. Design them with the tokens above and show me before building.
