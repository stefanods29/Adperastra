# Step 09d: Explorer columns, selection and the command palette

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-09d-explorer-palette |
| Tag | v0.1.4-step09d |
| Depends on | 09a folder views;09b saved groups;07b metadata |
| Written before | 07a was built |
| Interface revision | folder-presentation-1; palette-1 |

This is a complete-design guide, not implementation code. Workers write source/tests/help only, no execution. Coordinator owns shared edits, compilation, tests, installation, measurements, screenshots and accepted commits.

## Goal and exclusions

Select items with a rubber band, choose and resize Details columns, remember each folder's sort/group/columns, and find commands, locations, tabs, saved groups, settings and help with Ctrl+K. No semantic/AI search (excluded), file-content index (11a), automatic folder-type column assignment (10d) or bulk rename (09e).

## Read first and dependencies

Read mapped v1 09a Explorer-extras and09b palette paragraphs; full09a/b; actual `src/commands/registry.ts`, `src/ribbon/shortcuts.ts`, `src/services/folderViews.ts`, `src/services/selection.ts`, `src/views/explorer/views/useItemInteractions.ts`, FileList/FileGrid/ListModeView/ColumnView; settings section registry and existing command tests. These existing files remain coordinator-owned.

| ID | Producer/task; exact file/export | Required contract |
|---|---|---|
| U1 | 02/03a `src/commands/registry.ts`: Command<C>,CommandRegistry<C>.list/get,isCommandEnabled,isCommandVisible,commandLabelKey | Command.run(ctx,arg?) returns void, never assumed Promise; evaluate enabledWhen again at activation. Add optional disabledReasonKey(ctx)->string only through coordinator |
| U2 | 05a `src/services/folderViews.ts`: folderViewKey(path)->string,getFolderViews()->Promise<FolderView[]>,setFolderView(path,mode)->Promise<void> | Extend native store/DTO additively; legacy mode/used_unix retained; folder keys normalize prefix/case/trailing slash |
| U3 | 05a `ItemViewProps` in views/explorer/views/useItemInteractions.ts | Reuse existing selection/interaction/virtualization; optional presentation below. No second selection store |
| U4 | 09a E1/E4/E6 folder tabs/session,09b E4/E6 saved groups | Palette host routes exact folder/document descriptors/restore host; missing file normal pipeline |
| U5 | 07b E1 metadata.ts readMetadata/releaseMetadata | Optional metadata only after user chooses its column, cancel when hidden; never hydrate cloud files in background |
| U6 | 05d `src/views/settings/sections.ts` SETTINGS_SECTIONS,sectionMatches; help registry | Build palette entries from registered IDs/labels/slugs, no duplicated hand-maintained catalog |

## Decisions and algorithms

1. Details columns IDs name/modified/kind/size plus07b width,height,date_taken,camera_model,duration_ms,author,page_count. Name cannot be hidden or moved from first. Default four existing columns; widths name320,modified180,kind160,size100, metadata140px; all96-600 except name160-1000. Order contains each visible ID once; chooser can restore defaults. Metadata columns are opt-in.
2. Header resize uses pointer capture, logical CSS widths and a1px token divider; no page-wide text selection. ArrowLeft/Right adjusts focused separator8px, Shift32px, Home default. ARIA separator orientation vertical/min/max/value. Persist on pointerup/keycommit, not each move; cancel restores initial width.
3. Folder presentation stores view_mode, SortSpec and GroupBy, columns and widths in existing folder-views store: at most1000, newest touched first,4MiB; retain existing1024-character remembered-path cap. Longer paths browse normally without persistence. View-mode off ignores retained overrides without deleting them. Session folder state is the active in-memory value, not a second persistence authority.
4. Rubber band starts only on empty item-surface background with primary pointer; threshold4CSSpx; never on item/edit box/scrollbar/column header. Hit-test item content rectangles in scroll-content coordinates and account for scroll offset/zoom; virtualized offscreen rows computed from the existing layout model. No modifier replaces selection; Ctrl toggles against captured initial selection; Shift adds. Pointer cancel/Esc restores initial selection. At edges autoscroll max600CSSpx/s with RAF, dt clamp32ms; stop on release/blur.
5. Palette dialog width680px/maxviewport minus32; top SearchBox44px, listmax420px virtualized40px rows. Query max256Unicode scalar values. Debounce0: synchronous preindexed bounded catalog max10,000 entries, no filesystem I/O while typing. Top50 matches; Up/Down/Page/Home/End/Enter/Esc, focus restores opener. Empty query shows20MRU then20recent locations.
6. Normalize matching with Unicode NFKD, remove combining marks, locale-independent lowercase, split whitespace. All query tokens must be ordered subsequences of either app-language or English label/keywords; contiguous token occurrence earns100, start-of-label extra30, word start extra20; subsequence earns max(1,40-span length+token length). Sum tokens, take better language score, add5 if MRU. Sort score descending, normalized localized label then stable ID ascending. No library dependency, backtracking regex or network.
7. Entry kinds command/folder/recent_file/tab/saved_group/settings/help; stable IDs prefixed kind plus canonicalID/pathkey. Display localized label, description, shortcut and disabled reason. Disabled entries remain visible but Enter cannot run them. Commands hidden by visibleWhen are absent; pending commands use existing coming-later explanation. Add Command.disabledReasonKey optional callback; fallback palette.disabled. No async return assumption for run; existing command error handling stays responsible.
8. Native file lookup is not performed for every candidate. Snapshot recent/pinned folder/file lists when opening, refresh once after async completion tagged by palette generation, cap500locations. Explicit absolute path entered may offer Open location, validate on Enter via native normal pipeline; never execute a command string. New generation/close cancels pending catalog reads.
9. Settings schema21 -> 22 adds palette.recent_ids string[]max50defaultempty, show_disabled booltrue. Persist MRU only after successful dispatch; exclude sensitive/locked entry names/paths. Failed dispatch not inserted. At most1palette host, no competing Ctrl+K listener; preventDefault only when handled.

## Data and exports

Canonical presentation types `src/services/folderPresentation.ts`, native `src-tauri/src/folder_presentation_types.rs`. Palette types `src/palette/types.ts`; only services call native APIs.

| Type | Exact fields/defaults/limits |
|---|---|
| ColumnId | name/modified/kind/size/width/height/date_taken/camera_model/duration_ms/author/page_count |
| ColumnSpec | id ColumnId;width number integer pixels in D1bounds |
| FolderPresentation | view_mode ViewModeId;sort SortSpec;group_by GroupBy;columns ColumnSpec[]1-11defaultD1 |
| FolderView additions | presentation optional FolderPresentation defaultlegacy mode/sortnameascending/groupnone/defaultcolumns; existingpath/mode/used_unix preserved |
| PaletteEntry | id string<=32768;kindD7;label_key optionalstring or safe runtime title<=512;english_label string<=512;keywords string[]max32x128;description optionalstring<=512;shortcut optionalstring<=128;disabled_reason_key optionalstring;enabled bool;target_id string; no executable callbacks in persistence |
| PaletteMatch | entry PaletteEntry;score finiteinteger;matched_ranges pairs of Unicode scalar offsets for accessible highlighting only |
| PaletteHost | commandContext()->CommandContext;dispatchCommand(id string)->void;openFolder(path)->Promise<void>;openFile(path)->Promise<void>;activateTab(id)->void;openSavedGroup(id)->Promise<void>;openSettings(sectionId)->void;openHelp(slug)->void |
| RubberBandState | pointer_id number;origin{x,y};current{x,y};initial_selection readonly string[];mode replace/toggle/add; geometryruntimeonly |

| ID | Exact canonical export | Signature and use |
|---|---|---|
| E1 | services/folderPresentation.ts getFolderPresentation/setFolderPresentation/clearFolderPresentations | get(path string)->Promise<FolderPresentation|null>; set(path,presentation)->Promise<void>; clear()->Promise<void>; native folder_presentation_get/set/clear; mainonly, existing storelock/atomicwrite.09a/10d/10e |
| E2 | palette/matchPalette.ts matchPalette | (query string,entries readonly PaletteEntry[],recentIds readonly string[],locale string)->readonly PaletteMatch[]max50; pure,D6algorithm.10b/10e/11b |
| E3 | palette/PaletteRegistry.ts PaletteRegistry | registerProvider(id string,provider{snapshot()->Promise<readonly PaletteEntry[]>;dispatch(entry PaletteEntry,host PaletteHost)->Promise<void>})->unsubscribe; collect()->Promise<readonly PaletteEntry[]>;dispatch(id,host)->Promise<void>; duplicate IDs rejected. Providers static app code only |
| E4 | palette/CommandPalette.tsx CommandPalette | props registry PaletteRegistry,host PaletteHost,locale string,recentIds readonly string[],onUsed(id)->void,onClose()->void,onOpenHelp(slug)->void. No invoke/fromcomponent |
| E5 | explorer/selectionGeometry.ts intersectSelection | (layoutRects readonly{id:string,x:number,y:number,width:number,height:number}[],rect samegeometry,initial readonlystring[],mode replace/toggle/add)->string[]; touchingedgewithoutpositivearea excluded, preserve displayorder |
| E6 | explorer/views/ColumnChooser.tsx;useRubberBand.ts | chooser props value readonlyColumnSpec[],onChange(columns)->void,onClose()->void; hook options rootRef,layoutRects()->readonlyrects,selection readonlystring[],onSelectionChange(ids)->void,enabledbool; returns overlayRect|null plus pointerhandlers. Coordinate owner is scroll root |

Errors presentation.invalid/presentation.io/palette.invalid/palette.unavailable are native stablecodes; all results<768KiB, pathargumentmax32768, no arbitrary DTOkeys/prototype fields. Existing tests constructing CommandContext retain all required fields; newCommand.disabledReasonKey remains optional.

## Texts and commands

| Key | English | Spanish |
|---|---|---|
| palette.title / palette.search / palette.empty / palette.disabled | Command palette / Search commands, tabs and places… / No matching items. / This action is not available here. | Paleta de comandos / Buscar comandos, pestañas y ubicaciones… / No hay coincidencias. / Esta acción no está disponible aquí. |
| palette.commands / palette.tabs / palette.groups / palette.settings / palette.help / palette.places | Commands / Tabs / Saved groups / Settings / Help / Places | Comandos / Pestañas / Grupos guardados / Configuración / Ayuda / Ubicaciones |
| palette.openPath / palette.showDisabled | Open this location / Show unavailable actions | Abrir esta ubicación / Mostrar acciones no disponibles |
| columns.choose / columns.reset / columns.width | Choose columns… / Restore default columns / {name} column width | Elegir columnas… / Restaurar columnas predeterminadas / Ancho de la columna {name} |
| columns.widthPixels / columns.heightPixels / columns.dateTaken / columns.camera / columns.duration / columns.author / columns.pages | Width / Height / Date taken / Camera model / Duration / Author / Pages | Ancho / Alto / Fecha de captura / Modelo de cámara / Duración / Autor / Páginas |
| errors.presentation.invalid / errors.presentation.io / errors.palette.invalid / errors.palette.unavailable | These folder columns are not valid. / Folder presentation could not be saved. / This palette item is not valid. / This palette item is no longer available. | Estas columnas de carpeta no son válidas. / No se pudo guardar la presentación de la carpeta. / Este elemento de la paleta no es válido. / Este elemento de la paleta ya no está disponible. |

Existing name/modified/kind/size/group/view texts reused exactly fromcurrentlocales. Command app.commandPalette labelpalette.title iconSearch shortcutCtrl+K riskread-only helpslugcommand-palette; explorer.chooseColumns labelcolumns.choose iconColumns3 nobalshortcut helpfolder-columns. Paletteentryselection rolecombobox/aria-controls/aria-activedescendant,listbox/options; disabledreason announced. Columnchooser480pxDialog, checkboxes and keyboardMoveup/down buttons useexistingtranslatedcommonlabels; newkeys columns.moveUp “Move up”/“Subir”,columns.moveDown “Move down”/“Bajar”. CSS selectors adp-command-palette,adp-palette-row,adp-column-chooser,adp-selection-band usecurrentpane/text/border/accent/focus tokens; rubberband1pxborder/translucentselectedsurface, no rawcolors.

## Tasks

| Task; exact commit | Owned files / numbered work / imports | Tests: file; name; input -> expected |
|---|---|---|
| T1 `feat(explorer): folder presentation contracts [step-09d/T1]` | folderPresentation.ts;folder_presentation_types.rs/folder_presentation_store.rs.1defineDTO;2migratelegacy;3validate/atomicwrite. U2/U3 | folderPresentation.test.ts +native: `legacy_mode_retained`; `name_column_required`; `duplicate_column_refused`; `width95_refused`; `long_path_not_persisted_but_browsable` |
| T2 `feat(explorer): accessible column chooser and resize [step-09d/T2]` | ColumnChooser.tsx,useColumnResize.ts,styles/folderColumns.css; coordinatorFileList/ItemViewProps. U1/U3/U5/E1 | folderColumns.test.tsx: namecannotuncheck;Right+8/ShiftRight+32;Escreset;metadatahidden cancels; persisted600max |
| T3 `feat(explorer): rubber band selection in every view [step-09d/T3]` | selectionGeometry.ts,useRubberBand.ts,SelectionBand.tsx; coordinatorItemView/virtual-layoutadapters. U3/E5/E6 | rubberBand.test.ts: edge-only excluded;Ctrl togglescapturedset;shiftadds;scrolledgridcorrect;Esc restores;blur stopsRAF;10kvirtualrowsnot10kDOMnodes |
| T4 `feat(palette): bounded bilingual command matching [step-09d/T4]` | palette/types.ts,matchPalette.ts,PaletteRegistry.ts,paletteEntries.ts. U1/U4/U6 | paletteMatch.test.ts: café matchescafe;exactstart outrankssubsequence;alltokensrequired;tiesstableID;51resultsreturns50;EnglishmatchesSpanishUI |
| T5 `feat(palette): command and location dispatch [step-09d/T5]` | CommandPalette.tsx,usePaletteCatalog.ts,styles/palette.css; coordinatorCommandoptionalreason/schema22/roots. U1/U4/U6/E2/E3 | commandPalette.test.tsx: disabledEnterdoesnothing;enablementrechecked;CtrlKonce;Escfocus;MRUonlyafterdispatch;staleasyncgenerationdiscarded;noAIentry |
| T6 `docs(help): folder columns and command palette [step-09d/T6]` | sixhelpfilesbelow; coordinatorlocales/measurements/shots/registries. U1-U6 | columnsandpalettehelp links/enesICUparity;oldfilelistkeyboardandsorttestsunchanged exceptspecifiedoptionalprops |

Traps: never change sorting semantics while changing columns; no main-thread file reads for palette; computed rectangles useonecoordinate system; no second selection reducer. Workers list exact sharedchanges instead ofeditingroots.

## Full help

`folder-columns.md`, English **Folder columns**: “Choose the details shown for each folder.” How to use: “Right-click a Details column heading and choose **Choose columns…**. Show the columns you need, move them up or down and resize their headings. Use **Restore default columns** to return to the original four.” Good to know: “The Name column stays visible. Extra metadata is loaded only when needed. Remembered folder views include sorting and grouping when enabled.” See also: “View modes” and “Rich file information”. Spanish **Columnas de carpetas**: “Elige los detalles que muestra cada carpeta.” Cómo usar: “Haz clic derecho en un encabezado de Detalles y elige **Elegir columnas…**. Muestra las columnas necesarias, ordénalas y ajusta su ancho desde los encabezados. Usa **Restaurar columnas predeterminadas** para volver a las cuatro originales.” Para tener en cuenta: “Nombre permanece visible. Los metadatos adicionales se cargan solo cuando se necesitan. Si están activadas, las vistas recordadas incluyen el orden y la agrupación.” Consulta también: «Modos de vista» e «Información detallada de archivos».

`selecting-with-a-box.md`, English **Selecting with a box**: “Select several items by drawing over the folder background.” How to use: “Drag from empty space across the items. Hold Shift to add or Ctrl to toggle items. Release to finish or press Esc to cancel.” Good to know: “Dragging from an item starts the normal file drag. Scrolling near an edge continues the selection.” See also: “Selecting files” and “View modes”. Spanish **Seleccionar con un recuadro**: “Selecciona varios elementos dibujando sobre el fondo de una carpeta.” Cómo usar: “Arrastra desde un espacio vacío sobre los elementos. Mantén Mayús para agregar o Ctrl para alternar elementos. Suelta para terminar o pulsa Esc para cancelar.” Para tener en cuenta: “Arrastrar desde un elemento inicia el arrastre normal de archivos. Acercarte a un borde desplaza la selección.” Consulta también: «Seleccionar archivos» y «Modos de vista».

`command-palette.md`, English **Command palette**: “Find commands, open tabs and places from one search box.” How to use: “Press Ctrl+K and type in your app language or English. Use the arrow keys and Enter to choose a result. Press Esc to return.” Good to know: “Unavailable commands show a reason and cannot run. Opening a location follows the normal file-opening rules. Recent actions stay on this PC.” See also: “Keyboard shortcuts” and “Saved groups”. Spanish **Paleta de comandos**: “Busca comandos, pestañas y ubicaciones desde un solo campo.” Cómo usar: “Pulsa Ctrl+K y escribe en el idioma de la aplicación o en inglés. Usa las flechas e Intro para elegir un resultado. Pulsa Esc para volver.” Para tener en cuenta: “Los comandos no disponibles muestran un motivo y no se ejecutan. Abrir una ubicación sigue las reglas normales de apertura. Las acciones recientes permanecen en esta PC.” Consulta también: «Atajos de teclado» y «Grupos guardados».

## Check by hand, speed, screenshots, done

Fixtures retained: folderwith10,000synthetic emptyfiles,5imageswithknownwidth/author metadata,folderwith>1024characterpath,2foldersofdifferentsort/group. Coordinatorchecksboxselectionallviews/scroll/keyboardcancel,resize/savereopen,CtrlKSpanish/English/disabled/recent/group/settings/help/path,error/loading,200%zoom/dark/pseudo. No permanentcleanup.

Measurements step09d.palette.open/filter/dispatch andcolumns.resize/selection.frame Instant<100ms; noUIlongtask>50ms;100kfolderfirstrowsFast<1s; metadataasbackgroundpolicy07a. Screenshots97-command-palette,98-folder-columns inthreevariants. Done: E1-E6exact,currenttestsretained,allscopecovered,coordinatorgate/package/runtime/accessibility/speedresultsrecorded; no semanticsearch/AI claim.
