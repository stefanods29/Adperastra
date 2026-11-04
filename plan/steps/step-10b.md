# Step 10b: Toolbar and keyboard customization

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-10b-toolbars-shortcuts |
| Tag | v0.1.13-step10b |
| Depends on | 05c docking;04b ribbon;09d palette;10a |
| Written before | 07a was built |
| Interface revision | command-layout-1; keyboard-map-1 |

Workers implement this guide in owned modules and write tests without running tools. Coordinator applies shared edits and executes all compilation, tests, generators, package checks, measurements and commits.

Type notation: safeu64 means Rust u64 serialized only in the JSON safe-integer range 0..9,007,199,254,740,991 and TypeScript number. UUID means a validated canonical UUID string. Optional fields are absent/null only where the table says optional. Enum spellings are literal serialized values; no worker invents alternate names.

## Goal and exclusions

Show, hide and reorder commands in toolbars/ribbon groups; maintain Quick Access; use a classic menu mode; remap keys and select editable Windows/Finder/Commander/Vim presets. Menus and Home section editing belong to10e, tab behavior to10c. No command scripting, macro recording, plugin API or interception of Windows-reserved shortcuts.

## Read first and exact dependencies

Read v1 step10a toolbar/keyboard paragraphs,04b/05c guides, current `src/ribbon/types.ts`, `src/ribbon/shortcuts.ts`, `src/services/shortcuts.ts`, `src/commands/{registry,menus,explorerCommands}.ts`, `src/layout/ToolbarDock.tsx` and `src/layout/toolbarLayout.ts`, and all command/ribbon tests. Read09a/b/c/d contract tables and UiHistoryRegistry.

| ID | Producer/task; symbol and canonical file | Contract used |
|---|---|---|
| U1 | 02/04b registry.ts Command<C>,CommandRegistry<C>,isCommandEnabled,isCommandVisible,commandLabelKey | run(ctx,arg?) returns void; no code from persisted configuration. Recheck current context at dispatch |
| U2 | 04b ribbon/types.ts RibbonDef/RibbonTab/RibbonGroup/RibbonControl | Existing controls only button,toggle,custom; custom render callbacks remain trusted static source and are addressed by ID, never serialized |
| U3 | 05c ToolbarDock,ToolbarLayoutContext,toolbarLayoutFor,tooltipPlacement | Keep docking and label geometry; customize entries before existing layout/overflow measurement |
| U4 | 04b ribbon/shortcuts.ts matchesShortcut/useCommandShortcuts; services/shortcuts.ts formatShortcut(shortcut,t) | Replace matching route through E3; do not leave competing listeners using old default shortcuts |
| U5 | 09a T3/E9 services/uiHistory.ts UiHistoryRegistry | Register adapter command-layout and keyboard-map; before/after data validated, history capacity reserved before apply |
| U6 | 09a tab shortcuts/09c drop/09d search palette | Ctrl+1..9 remain tab selection;Ctrl+Shift+S remains Save as;Ctrl+K palette; focusedsearch Ctrl+Tab overrides globalMRU; shelf defaultCtrl+Alt+S, notSaveas |

## Decisions and algorithms

1. Customization refers to registered command IDs and trusted custom-control IDs. No callbacks, path arguments, shell strings or URLs in settings. Unknown IDs are retained as disabled “Unavailable command” entries for editing/export, never executed. Hidden commands remain in the command palette when visibleWhen allows them.
2. Bar IDs: explorer.command,app.quickAccess,app.classicMenu and ribbon.<handlerId>.<tabId>.<groupId>. Quick Access accepts at most20 registered commands, defaults explorer.undo/explorer.redo/explorer.copyPath; no executable custom control. A bar has at most100entries; all bars max1000entries. Mandatory Help/accessibility and overflow affordances stay reachable outside customization; deleting all ordinary entries yields an empty editable bar, not lost Settings access.
3. Ribbon customization reorders/hides controls only inside their registered group; moving across groups is allowed only when the source descriptor lists both groups in compatible_groups. Default empty means same-group only. Trusted custom controls preserve their own IDs and render functions. Hiding their entry does not delete document state. Classic mode shows File/Edit/View/Tools/Help menus based on the same registry, not a second command implementation.
4. Toolbar editor is Settings section toolbars, widthfull/max960px: bar selector, available list and current list side by side min240px each, rows36px, Add/Remove/Move up/Move down/Reset buttons; drag is optional and every operation has keyboard equivalent. Live preview uses draft; Apply is one app-state history entry; Cancel preserves saved state. ToolbarDock orientation and overflow remain unchanged.
5. Keyboard map stores strokes as data: modifier booleans Ctrl/Alt/Shift/Meta, match mode key/code and key string<=32. One or two strokes per binding; two-stroke timeout500ms. Physical mode compares KeyboardEvent.code, logical mode compares normalized event.key; capture shows both in non-US layouts. AltGraph events, composition,deadkeys and repeated first sequence strokes never trigger custom commands. Escape cancels a pending sequence.
6. Scope IDs global/explorer/search/text/image/pdf/media/office/dialog. A single dispatcher evaluates most-specific active scope first, then parent global. Text inputs/contenteditable/composition keep all printable bare keys and standard editing chords unless their focused editor explicitly registers handling. Dialog commands supersede document/global commands. Search Ctrl+Tab remains mode cycling, not tab switching. Disabled candidate is handled only if it owns the chord, displays reason and does not fall through to a destructive global action.
7. Conflict means identical normalized stroke sequence in equal or overlapping active scopes. Prefix conflict between one-stroke and two-stroke sequences is also refused. User must choose Reassign or Cancel; never silently shadow. OS reserved Alt+Tab/Alt+F4/Win+anything/Ctrl+Alt+Delete are refused. Ctrl+Z/Y/C/X/V/A in typing scopes cannot be reassigned globally. Native screen-reader commands are not intercepted by bare-key presets.
8. Windows preset uses current accepted registered shortcuts unchanged. Finder preset changes Explorer Enter to rename and Ctrl+O to open; no changes in editors. Commander preset assigns Explorer F5 copy-to-folder,F6 move-to-folder,F7 newfolder,F8 recycle; these remain unavailable if selection/root checks fail. New explorer.copyToFolder/moveToFolder commands ask destination and delegate normal09f transfer pipeline; no Replace. Vim preset only when Explorer item surface focused: h/j/k/l moves by existing direction model,gg first,G last,/ focuses filter; F2 rename and Windows modified shortcuts remain. No bare-key preset while typing or using a screen-reader interaction mode unless user explicitly enables it.
9. Presets are immutable defaults plus custom maps: max20maps, names1-60, UUIDs; editing a builtin makes a custom copy. Settings schema28 -> 29 adds toolbar_custom and keyboard_custom. Existing Command.shortcut remains documented default; tooltip/menus/palette obtain effective binding through E2. Reset restores selected preset, not unrelated settings.

## Data shapes and exports

Canonical `src/services/commandLayout.ts`, `src/keyboard/types.ts`, `src/services/keyboardMaps.ts`; native mirrors in command_layout_types.rs/keyboard_map_types.rs. All persisted fields snake_case.

| Type | Exact fields/defaults/validation |
|---|---|
| CommandLayoutEntry | kind command/custom/separator;id string<=128;visible booltrue; no arbitrarycommandargs |
| CommandBarLayout | bar_id string<=192;entries CommandLayoutEntry[]max100 |
| ToolbarCustomSettings | classic_menu boolfalse;bars CommandBarLayout[]max100, uniquebarIDs; quick_access string[]max20 defaultsD2 |
| ToolbarDescriptor | id string;default_entries readonlyCommandLayoutEntry[];compatible_groups readonlystring[];mandatory_ids readonlystring[]; runtime trusted only |
| ShortcutScope | global/explorer/search/text/image/pdf/media/office/dialog; canonical union used wherever this guide says scopeID |
| ShortcutStroke | ctrl/alt/shift/meta bool;mode key/code;key string1-32; normalizedspace is Space, arrows useArrowLeft/Right/Up/Down |
| ShortcutBinding | id UUID;command_id string<=128;scope ShortcutScope;strokes ShortcutStroke[]length1or2;enabled booltrue |
| KeyboardMap | id builtin:windows/builtin:finder/builtin:commander/builtin:vim or UUID;name1-60;bindings ShortcutBinding[]max500;version1 |
| KeyboardCustomSettings | active_map string defaultbuiltin:windows;custom_maps KeyboardMap[]max20;allow_bare_navigation boolfalse |
| ShortcutConflict | existing_binding_id UUID;command_id string;kind exact/prefix/reserved;scope ShortcutScope; no displaytext |
| KeyboardHost | activeScopes()->readonlyscopeIDs;isTypingTarget(target EventTarget|null)->bool;command(id)->Command<unknown>|undefined;dispatch(id string)->void;showDisabled(id)->void; navigate(direction left/right/up/down/first/last)->void;focusFilter()->void;copyToFolder()->Promise<void>;moveToFolder()->Promise<void> |

| ID | Exact canonical export | Signature/consumers |
|---|---|---|
| E1 | commandLayout.ts CommandLayoutRegistry | register(descriptor ToolbarDescriptor)->void;resolve(barId string,settings ToolbarCustomSettings)->readonlyCommandLayoutEntry[]; duplicateID rejected, no unknown customrender execution.10e setup/editors |
| E2 | keyboard/effectiveShortcuts.ts effectiveShortcut/findShortcutConflicts | effectiveShortcut(commandId string,scope ShortcutScope,map KeyboardMap)->ShortcutBinding|null;findShortcutConflicts(candidate ShortcutBinding,map KeyboardMap)->readonlyShortcutConflict[]; tooltips/palette/ribbonsconsumeexactbinding |
| E3 | keyboard/KeyboardRouter.ts KeyboardRouter | constructor(host KeyboardHost);setMap(map KeyboardMap)->void;handle(event KeyboardEvent)->boolean;dispose()->void cancels pending timer. One coordinator-ownedkeydownlistener calls handle, preventDefaultonlytrue |
| E4 | services/keyboardMaps.ts validateKeyboardMap/saveKeyboardMap | validateKeyboardMap(unknown)->KeyboardMap or stableerror;saveKeyboardMap(map)->Promise<KeyboardMap>;native keyboard_map_save(map), mirrors schema29limit;allmaps resideinsettings,no secondJSONstore |
| E5 | layout/ToolbarCustomizer.tsx;keyboard/ShortcutEditor.tsx | ToolbarCustomizer props descriptors readonlyToolbarDescriptor[],value ToolbarCustomSettings,onApply(value)->Promise<void>,onCancel,onOpenHelp;ShortcutEditor props map KeyboardMap,onApply(map)->Promise<void>,onCancel,onOpenHelp |
| E6 | keyboard/presets.ts keyboardPreset | (id windows/finder/commander/vim,defaults readonlyShortcutBinding[])->KeyboardMap; deterministic builtinbindingIDs derived fromfixedcommandIDs, no randomIDchurn onrender |

Newcommands explorer.copyToFolder/moveToFolder use existing icon Copy/MoveRight,label keys below,riskchange,helpkeyboard-styles; selectedsources captured/revalidatednative;folderpicker cancellation leavesfilesuntouched. Main-window-onlykeyboard_map_save validates schema29throughordinarysaveSettings; no dynamic nativeexecution.

## Texts and layout

| Key | English | Spanish |
|---|---|---|
| toolbarCustom.title / toolbarCustom.available / toolbarCustom.current / toolbarCustom.quick / toolbarCustom.classic | Customize toolbars / Available commands / Current toolbar / Quick Access / Classic menu bar | Personalizar barras de herramientas / Comandos disponibles / Barra actual / Acceso rápido / Barra de menús clásica |
| toolbarCustom.add / toolbarCustom.remove / toolbarCustom.up / toolbarCustom.down / toolbarCustom.reset / toolbarCustom.missing | Add command / Remove command / Move up / Move down / Reset this bar / Unavailable command | Agregar comando / Quitar comando / Subir / Bajar / Restablecer esta barra / Comando no disponible |
| keyboard.title / keyboard.style / keyboard.windows / keyboard.finder / keyboard.commander / keyboard.vim | Keyboard shortcuts / Keyboard style / Windows / Finder style / Commander style / Vim style | Atajos de teclado / Estilo de teclado / Windows / Estilo Finder / Estilo Commander / Estilo Vim |
| keyboard.capture / keyboard.physical / keyboard.logical / keyboard.scope / keyboard.conflict / keyboard.reassign / keyboard.bare | Press the shortcut / Physical key / Character key / Context / This shortcut conflicts with {command}. / Reassign / Enable letter navigation outside text fields | Pulsa el atajo / Tecla física / Carácter de tecla / Contexto / Este atajo entra en conflicto con {command}. / Reasignar / Activar navegación con letras fuera de campos de texto |
| keyboard.copyTo / keyboard.moveTo / keyboard.reserved / keyboard.sequence | Copy to folder… / Move to folder… / Windows or text editing reserves this shortcut. / Waiting for the second key… | Copiar a carpeta… / Mover a carpeta… / Windows o la edición de texto reserva este atajo. / Esperando la segunda tecla… |
| errors.keyboard.invalid / errors.keyboard.conflict / errors.keyboard.limit / errors.toolbar.invalid | This shortcut map is not valid. / Resolve the shortcut conflict before saving. / The shortcut-map limit has been reached. / This toolbar layout is not valid. | Este mapa de atajos no es válido. / Resuelve el conflicto antes de guardar. / Se alcanzó el límite de mapas de atajos. / Esta distribución de barra no es válida. |

Scope labels keyboard.scopeGlobal/Explorer/Search/Text/Image/Pdf/Media/Office/Dialog use English “Global/Explorer/Search/Text/Image/PDF/Media/Office/Dialog” and Spanish “Global/Explorador/Búsqueda/Texto/Imagen/PDF/Multimedia/Ofimática/Diálogo”. Add app.customizeToolbar labeltoolbarCustom.title iconSettings2,app.customizeShortcuts labelkeyboard.title iconKeyboard, no defaultkeys,riskchange,helpbelow. Existing commonApply/Cancel labels are reused only after coordinatorverifiesactualkeys. CSS adp-toolbar-customizer/adp-shortcut-editor/adp-shortcut-conflict: minwidth0, gridgap16, row36, capturetarget44high, errorswithiconandtext, tokenpane/border/focus; preview never executescommands.

## Tasks

| Task; exact commit | Files/work/imports | Tests/input -> expected |
|---|---|---|
| T1 `feat(customize): command layout and shortcut data [step-10b/T1]` | commandLayout.ts,keyboard/types.ts,keyboardMaps.ts,command_layout_types.rs,keyboard_map_types.rs;coordinator schema29. U1/U2/U5 | keyboardMaps.test.ts/native `unknown_command_retained_disabled`;`custom_renderer_not_deserialized`;`twenty_first_map_refused`;schema28settingspreserved |
| T2 `feat(toolbar): editable command layouts [step-10b/T2]` | ToolbarCustomizer.tsx,toolbarCustomization.ts,styles/toolbarCustomizer.css;coordinatorCommandBar/Ribbonintegration. U1-U3/E1 | toolbarCustomization.test.tsx:hidekeepspalettecommand;customcontrolcannotcrossincompatiblegroup;mandatoryHelpreachable;Cancelpreserves;verticaloverflowstillworks |
| T3 `feat(keyboard): one scoped shortcut router [step-10b/T3]` | KeyboardRouter.ts,shortcutNormalization.ts,effectiveShortcuts.ts;coordinatoruseCommandShortcutsbridge androotlistener. U1/U4/U6/E2 | keyboardRouter.test.ts:oneeventonecommand;defaultPreventedignored;AltGr/compositionignored;searchCtrlTabwins;Gnotcapturedininput;500mssequenceexpiry |
| T4 `feat(keyboard): editable keyboard presets and conflicts [step-10b/T4]` | presets.ts,ShortcutEditor.tsx,ShortcutCapture.tsx,styles/shortcuts.css. U4/E2/E3/E6 | keyboardPresets.test.ts:FinderExplorerEnterrename/textEnternewline;CommanderF8recycleonly;Vimggfirst;prefixconflictrefused;OSreservedreject;nonUSphysicalcodekept |
| T5 `feat(customize): shared preview history and quick access [step-10b/T5]` | customizeHistory.ts,QuickAccessBar.tsx,ClassicMenuBar.tsx;coordinatorUiHistoryadapterregistration/menuupdates. U1/U3/U5 | customizeHistory.test.ts:applyoneUndo;capacityfailsbeforemutation;undoinvalidcommanddoesnotexecute;failedsavekeepsdraft;quickmax20 |
| T6 `docs(help): toolbars and keyboard styles [step-10b/T6]` | fullhelppagesbelow;coordinatorlocale/pseudo/commandtexts/speedshots. U1-U6 | commands/help/tooltip effectivebindingparity;currentribbonunitcasesretained;sharedsettingsliteralfixturesupdatedwithdefaults |

## Full help

`customizing-toolbars.md`, English **Customizing toolbars**: “Choose which registered commands appear where you work.” How to use: “Open Settings > Customize toolbars. Choose a bar, add or remove commands and use Move up or Move down. Review the preview and Apply. Quick Access holds frequently used commands; Classic menu bar offers File, Edit, View, Tools and Help.” Good to know: “Hiding a command does not remove it from the command palette. A custom control can move only between compatible groups. Cancel leaves your saved layout unchanged.” See also: “Keyboard shortcuts and styles” and “Moving toolbars and panels”. Spanish **Personalizar barras de herramientas**: “Elige qué comandos registrados aparecen donde trabajas.” Cómo usar: “Abre Configuración > Personalizar barras de herramientas. Elige una barra, agrega o quita comandos y usa Subir o Bajar. Revisa la vista previa y aplica los cambios. Acceso rápido conserva comandos frecuentes; la barra clásica ofrece Archivo, Edición, Ver, Herramientas y Ayuda.” Para tener en cuenta: “Ocultar un comando no lo quita de la paleta. Un control personalizado solo puede moverse entre grupos compatibles. Cancelar conserva la distribución guardada.” Consulta también: «Atajos y estilos de teclado» y «Mover barras y paneles».

`keyboard-styles.md`, English **Keyboard shortcuts and styles**: “Choose a preset or save your own shortcuts.” How to use: “Open Settings > Keyboard shortcuts. Select Windows, Finder style, Commander style or Vim style. Capture a physical or character key, choose its context and resolve any conflict before saving.” Good to know: “Letter navigation works only outside text fields when enabled. Text editing and Windows-reserved shortcuts remain protected. Finder Enter renames in Explorer; Commander F5/F6 ask a copy or move destination. All operations retain normal confirmations and file safety.” See also: “Command palette” and “Customizing toolbars”. Spanish **Atajos y estilos de teclado**: “Elige un ajuste o guarda tus propios atajos.” Cómo usar: “Abre Configuración > Atajos de teclado. Selecciona Windows, estilo Finder, Commander o Vim. Captura una tecla física o un carácter, elige el contexto y resuelve los conflictos antes de guardar.” Para tener en cuenta: “La navegación con letras funciona solo fuera de campos de texto cuando está activada. Se protegen la edición de texto y los atajos reservados por Windows. Intro cambia nombres en Explorer con el estilo Finder; F5/F6 piden un destino con Commander. Todas las operaciones conservan sus confirmaciones y seguridad.” Consulta también: «Paleta de comandos» y «Personalizar barras de herramientas».

## Check by hand, speed, screenshots and done

Retained fixtures: syntheticfolderwitha.txt “alpha” andb.txt “beta”; fourpresetmaps andonecustomnonUSphysicalbinding; twoinvalidmaps withprefix/OSreservedconflicts. Coordinator exercisesallpresets inExplorerandtextfields,modal/searchpriority,copy/movepickercancel,toolbarallpositions/customcontrol/overflow,Undo/restart,Spanishdark,pseudo/keyboard/200%zoom. Originalfilesmustremainunchangedunlessexplicitnormaloperationwasapproved.

Measure step10b.keyboard.dispatch andtoolbar.apply Instant<100ms; keyrouterdoesnomorethan500bindingcomparisons/eventandnomainthreadlongtask>50ms. Reserve117-toolbar-editor,118-shortcut-editor inthreevariants. Done: onecentralroute,effectivebindingeverywhere,noinjectedcallbacks,nohiddenSettingsaccess,coordinatorexecutedgate/package/UI/accessibility/speedreportcomplete.
