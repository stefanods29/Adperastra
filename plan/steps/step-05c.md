# Step 05c: Movable toolbars and panels, layout presets

| | |
|---|---|
| State | guide |
| Difficulty | ★★★ |
| Branch | `step-05c-layout` |
| Tag | `v0.0.12-step05c` |
| Depends on | 05b |
| Written before | P2 was built (written from the 04a, 04b and 04c recipes and the 05a and 05b guides; names from earlier guides are in `plan/guide-ledger.md`) |

This is a **guide** step (AGENTS.md "Steps come in two kinds"): every decision is below, but no code. Write the code exactly as described: the names, files, types, numbers and texts given here, and nothing else. If something you must write is not decided here, stop with `BLOCKED.md` (AGENTS.md section 5).

This step has an **OWNER CHECKPOINT** (task T10): the owner approves the side and bottom designs before the last task.

## Goal

The toolbar goes where the owner wants it: at the top (as in the Figma design), at the bottom, on the left or on the right, and it can be compact, show icons only, or hide until pointed at. The same choice applies to the Explorer's command bar and to the ribbon of every file tab. The tabs can sit at the top, at the bottom, or in a column on the left or right (which can shrink to icons). The navigation pane can be on the left, on the right or hidden, and the Details pane on the right or at the bottom. Three ready-made layout presets (Standard, Minimal, Classic) set everything at once, and the owner can save up to 20 presets of their own. Everything is in a new Settings > Layout section and in the toolbar's right-click menu, and it all comes back after a restart.

## Do not do in this step

- No themes, UI scale, density, corner radius or animation settings, and no searchable Settings page (Step 05d).
- No free drag-and-drop docking or floating panels (backlog; the layout is data, so it can be added later). No detaching tabs into windows (backlog).
- No choosing which buttons a toolbar shows, and no keyboard shortcut editing (Step 10b). No menu editor, no status bar or sidebar customization (Step 10e). The status bar stays at the bottom.
- No saved presets in the toolbar's right-click menu (it lists the three ready-made ones; saved ones are in Settings).
- No layout per tab or per file type. No tab groups (Step 09b): the new `TabStrip` component is the one place that draws tabs, so 09b extends it.
- No Microsoft names in the app (`plan/rules.md` R-LIC-5): the preset the roadmap called "Office classic" is named **Classic**.
- Do not change what the command bar, the ribbons, the navigation pane or the Details pane contain; only where and how they are drawn.

## Read first

- `plan/conventions.md`, `plan/pitfalls.md` (P-04, P-05, P-16, P-20, P-25, P-28, P-29, P-32), `plan/rules.md` R-UI, R-LANG and R-LIC-5, `plan/design.md`, `plan/design-spec.md` sections 4 to 6.
- Recipes: `plan/recipes/add-settings-field.md`, `plan/recipes/add-translation-keys.md`, `plan/recipes/add-help-page.md`.
- Code: `src/App.tsx` (all of it), `src/views/explorer/CommandBar.tsx`, `src/components/Menu.tsx` (props and `place`), `src/components/Tooltip.tsx`, `src/commands/menus.ts`, `src/commands/registry.ts`, `src/ribbon/Ribbon.tsx`, `src/ribbon/ViewerFrame.tsx`, `src/ribbon/keyTips.ts`, `src/styles/ribbon.css`, `src/views/explorer/DetailsPane.tsx`, `src/views/explorer/NavPane.tsx`, `src/styles/components.css` (the shell, tab, command bar, Explorer and Details pane rules), `src/services/settings.ts`, `src/views/SettingsView.tsx`, `src/views/settings/ViewsSettings.tsx` (the pattern for a settings section), `src/__tests__/commands.test.ts` (`baseCtx` and how it checks help pages), `src/__tests__/ribbon.test.tsx`, `src/__tests__/settings.test.ts`; in `src-tauri/src/main.rs` the settings part (from `CURRENT_SCHEMA` to the end of `migrate`) and the settings tests; in `src/views/ExplorerHome.tsx` the returned markup (from `return (` to the end).

## Decisions (already made)

- D1. A new settings section `layout` (schema 8) holds six layout values plus the saved presets (table below). The Details pane's visibility stays the View toggle `explorer.details_pane` (Alt+Shift+P); `layout` only says where it goes.
- D2. **One toolbar setting for every tab.** `toolbar_position` (top, bottom, left, right) and `toolbar_mode` (full, compact, iconsOnly, autoHide) apply to the Explorer's command bar and to every file tab's ribbon. A new component `ToolbarDock` places a toolbar next to its content; `ViewerFrame` and the Explorer use it. Toolbars read their side and style from a React context (`ToolbarLayoutContext`); without it they draw exactly as today, so every existing test passes unchanged.
- D3. Toolbar looks (sizes in the "Toolbar sizes" table):
  - **Full** (standard): today's look at the top and the bottom. On a side: a 200 px column, each button a row with its icon and name.
  - **Compact**: like Full but smaller (bars 40 px tall, 28 px buttons; a 168 px column on a side).
  - **Icons only**: no names, a tooltip on each button. On a side: a 48 px column. Ribbon lists (custom controls such as Encoding) move into a **More options** (•••) flyout at the end of the column.
  - **Hide until pointed at** (`autoHide`): the toolbar shrinks to a 6 px line along its side; pointing at the line, moving the keyboard focus into the toolbar, holding Alt, or an open toolbar menu shows it over the content in the Full look; it hides again 400 ms after the pointer leaves (when nothing else holds it open).
- D4. Bottom toolbars sit under the content and above the status bar; their menus open upward (the existing `Menu` placement already flips). Side toolbars open their menus beside them (`Menu`'s `side` anchor, which flips left near the right edge) and show tooltips beside the buttons (two new `Tooltip` placements, `right` and `left`).
- D5. A ribbon with more than one tab shows its tab row at the top and the bottom as today; on a side, the tabs become a dropdown (the current tab's name, or a `Layers` icon in Icons only). Alt+letter key tips keep working everywhere (the toolbar shows itself while Alt is held).
- D6. **Tabs**: `tab_bar_position` top (standard, in the title bar), bottom (a row above the status bar) or left/right (a column beside the content: 220 px with names, or 48 px with icons only when `tab_bar_collapsed` is on; a button at the top of the column switches). When the tabs are not at the top, the title bar shows the active tab's name (and stays the window's drag area). A new component `TabStrip` draws tabs in every position.
- D7. **Panes** (Explorer): `nav_pane_position` left (standard), right or hidden; `details_pane_position` right (standard) or bottom (200 px tall, under the file list, not under the navigation pane).
- D8. **Presets** (ids and values in the "Presets" table): Standard (the Figma layout, the default), Minimal, Classic. The current preset is not stored: the app compares the six values with the presets (built-in first, then saved), and shows **Custom** when nothing matches. Saved presets: up to 20, names 1 to 60 characters (trimmed), unique without regard to case; deleting one needs no confirmation (it only removes a name and six values; the help page says so).
- D9. Layout changes come from Settings > Layout (every value, presets, saving and deleting) and from the toolbar's right-click menu (position, style, the three ready-made presets). The menu's items are commands (contract 7) with their own context type; `Menu` and `resolveMenu` become generic over the context (with today's type as the default).
- D10. Changing the layout never remounts the Explorer or a file tab: every place that moves keeps fixed child positions (an empty slot instead of a missing element), so a folder keeps its scroll position and selection, and a viewer keeps its state.
- D11. The layout is stored in `settings.json` through the existing settings flow (crash-safe write, R-SAFE-9); App provides it to the whole window through a new `LayoutContext`.

## Data shapes

### Settings (schema 8): new section `layout`

| Field | Rust type | TypeScript type | Default | Allowed | Rust `validate()` |
|---|---|---|---|---|---|
| `toolbar_position` | `String` | `ToolbarPosition` | `"top"` | `top`, `bottom`, `left`, `right` | must be one of them |
| `toolbar_mode` | `String` | `ToolbarMode` | `"full"` | `full`, `compact`, `iconsOnly`, `autoHide` | must be one of them |
| `tab_bar_position` | `String` | `TabBarPosition` | `"top"` | `top`, `bottom`, `left`, `right` | must be one of them |
| `tab_bar_collapsed` | `bool` | `boolean` | `false` | | |
| `nav_pane_position` | `String` | `NavPanePosition` | `"left"` | `left`, `right`, `hidden` | must be one of them |
| `details_pane_position` | `String` | `DetailsPanePosition` | `"right"` | `right`, `bottom` | must be one of them |
| `saved_presets` | `Vec<SavedLayout>` | `SavedLayout[]` | empty | at most 20 | at most `MAX_SAVED_LAYOUTS` (20); each name not empty, equal to its trimmed form, at most `MAX_LAYOUT_NAME` (60) characters (`chars().count()`), no two names equal ignoring case; each preset's six values pass the same checks as the section's |

`SavedLayout`: `name` (`String` / `string`) plus the same six fields with the same serde defaults (a flat struct, no nesting).

TypeScript normalization (`normalizeSettings`, function `normalizeLayout`): each of the five choice fields with `pick` (its default when invalid); `tab_bar_collapsed` a boolean, else false; `saved_presets`: anything that is not an array gives an empty list; otherwise, in order, for each entry that is a record with a string `name`: the name trimmed, then cut to its first 60 characters (by code points) and trimmed again; skip it when empty or when its lower-case form was already kept; normalize its six values like the section's; stop after 20 kept entries.

### New TypeScript types and constants (`src/services/settings.ts`)

| Name | Shape |
|---|---|
| `ToolbarPosition` | `"top"`, `"bottom"`, `"left"` or `"right"` |
| `ToolbarMode` | `"full"`, `"compact"`, `"iconsOnly"` or `"autoHide"` |
| `TabBarPosition` | same values as `ToolbarPosition` |
| `NavPanePosition` | `"left"`, `"right"` or `"hidden"` |
| `DetailsPanePosition` | `"right"` or `"bottom"` |
| `LayoutValues` | the six fields `toolbar_position`, `toolbar_mode`, `tab_bar_position`, `tab_bar_collapsed`, `nav_pane_position`, `details_pane_position` |
| `SavedLayout` | `LayoutValues` plus `name` (string) |
| `LayoutSettings` | `LayoutValues` plus `saved_presets` (`SavedLayout[]`) |
| `TOOLBAR_POSITIONS`, `TOOLBAR_MODES`, `NAV_PANE_POSITIONS`, `DETAILS_PANE_POSITIONS` | read-only arrays of the allowed values, in the order of the table above |
| `MAX_SAVED_LAYOUTS`, `MAX_LAYOUT_NAME` | 20, 60 |
| `AppSettings.layout` | `LayoutSettings` (new section) |

### Presets (`src/layout/presets.ts`)

| Id | Label key | `toolbar_position` | `toolbar_mode` | `tab_bar_position` | `tab_bar_collapsed` | `nav_pane_position` | `details_pane_position` |
|---|---|---|---|---|---|---|---|
| `standard` | `commands.presetStandard` | top | full | top | false | left | right |
| `minimal` | `commands.presetMinimal` | top | iconsOnly | top | false | hidden | right |
| `classic` | `commands.presetClassic` | top | compact | bottom | false | left | right |

### Toolbar sizes (pixels)

| Look | Top or bottom bar | Buttons | Side column width | Side rows |
|---|---|---|---|---|
| Full (and Hide until pointed at, when shown) | 48 tall (as today) | 32 tall (as today) | 200 | 32 tall |
| Compact | 40 tall | 28 tall | 168 | 28 tall |
| Icons only | 48 tall | 32 tall, icons only | 48 | 32 tall, 36 wide, centered |
| Hidden line (Hide until pointed at) | 6 tall | | 6 wide | |

Tab column: 220 px wide with names, 48 px with icons only; rows 36 px. Bottom tab row: 36 px tall. Details pane at the bottom: 200 px tall.

### Commands (`src/commands/layoutCommands.ts`, context `LayoutCommandContext` = an object with `layout: LayoutSettings`)

All have risk `read-only` and check kind `radio`; none has a shortcut.

| Command id | Label key | Icon (lucide) | Checked when | Runs | Help slug |
|---|---|---|---|---|---|
| `layout.toolbarTop` | `commands.toolbarTop` | `PanelTop` | position is top | position top | `moving-toolbars-and-panels` |
| `layout.toolbarBottom` | `commands.toolbarBottom` | `PanelBottom` | position is bottom | position bottom | same |
| `layout.toolbarLeft` | `commands.toolbarLeft` | `PanelLeft` | position is left | position left | same |
| `layout.toolbarRight` | `commands.toolbarRight` | `PanelRight` | position is right | position right | same |
| `layout.toolbarFull` | `commands.toolbarFull` | `Rows2` | mode is full | mode full | same |
| `layout.toolbarCompact` | `commands.toolbarCompact` | `Minimize2` | mode is compact | mode compact | same |
| `layout.toolbarIconsOnly` | `commands.toolbarIconsOnly` | `LayoutGrid` | mode is iconsOnly | mode iconsOnly | same |
| `layout.toolbarAutoHide` | `commands.toolbarAutoHide` | `EyeOff` | mode is autoHide | mode autoHide | same |
| `layout.presetStandard` | `commands.presetStandard` | `LayoutTemplate` | the values equal the Standard preset | apply Standard | `layout-presets` |
| `layout.presetMinimal` | `commands.presetMinimal` | `Minimize` | the values equal Minimal | apply Minimal | `layout-presets` |
| `layout.presetClassic` | `commands.presetClassic` | `PanelsTopLeft` | the values equal Classic | apply Classic | `layout-presets` |

`TOOLBAR_MENU` (`src/commands/menus.ts`): a submenu `toolbarPosition` (label `layout.toolbarPosition`, icon `PanelTop`) with the four position commands; a submenu `toolbarStyle` (label `layout.toolbarStyle`, icon `Rows2`) with the four style commands; a separator; a submenu `layoutPreset` (label `layout.preset`, icon `LayoutTemplate`) with the three preset commands.

### Translation keys (all new keys of this step)

| Key | English | Spanish |
|---|---|---|
| `commands.toolbarTop` | Top | Arriba |
| `commands.toolbarBottom` | Bottom | Abajo |
| `commands.toolbarLeft` | Left | Izquierda |
| `commands.toolbarRight` | Right | Derecha |
| `commands.toolbarFull` | Icons and labels | Iconos y etiquetas |
| `commands.toolbarCompact` | Compact | Compacta |
| `commands.toolbarIconsOnly` | Icons only | Solo iconos |
| `commands.toolbarAutoHide` | Hide until pointed at | Ocultar hasta señalarla |
| `commands.presetStandard` | Standard | Estándar |
| `commands.presetMinimal` | Minimal | Mínimo |
| `commands.presetClassic` | Classic | Clásico |
| `layout.toolbarPosition` | Toolbar position | Posición de la barra de herramientas |
| `layout.toolbarStyle` | Toolbar style | Estilo de la barra de herramientas |
| `layout.preset` | Layout preset | Diseño predefinido |
| `layout.menuLabel` | Toolbar options | Opciones de la barra de herramientas |
| `ribbon.tabs` | Ribbon tabs | Pestañas de la cinta |
| `tabs.collapse` | Show only icons | Mostrar solo iconos |
| `tabs.expand` | Show names | Mostrar nombres |
| `settings.layout` | Layout | Diseño |
| `settings.layoutCustom` | Custom | Personalizado |
| `settings.layoutSave` | Save as preset… | Guardar como diseño… |
| `settings.layoutSaveTitle` | Save layout preset | Guardar el diseño |
| `settings.layoutPresetName` | Preset name | Nombre del diseño |
| `settings.layoutNameTooLong` | Use at most {max} characters. | Usa como máximo {max} caracteres. |
| `settings.layoutNameDuplicate` | A preset with this name already exists. | Ya existe un diseño con este nombre. |
| `settings.layoutFull` | You can save up to {max} presets. Delete one to save another. | Puedes guardar hasta {max} diseños. Elimina uno para guardar otro. |
| `settings.layoutSaved` | Your presets | Tus diseños |
| `settings.layoutDelete` | Delete {name} | Eliminar {name} |
| `settings.tabBarPosition` | Tab bar position | Posición de la barra de pestañas |
| `settings.tabBarCollapsed` | Show only icons in a side tab bar | Mostrar solo iconos en una barra de pestañas lateral |
| `settings.navPane` | Navigation pane | Panel de navegación |
| `settings.detailsPanePlace` | Details pane | Panel de detalles |
| `settings.placeTop` | Top | Arriba |
| `settings.placeBottom` | Bottom | Abajo |
| `settings.placeLeft` | Left | Izquierda |
| `settings.placeRight` | Right | Derecha |
| `settings.placeHidden` | Hidden | Oculto |

Existing keys this step reuses: `common.save`, `common.cancel`, `common.moreOptions` ("More options"), `explorer.commandBar`. After editing `en.json`, run `npm run i18n:pseudo`.

## Tasks

After changing Rust code, run `cargo fmt --all` before the gate.

### T1 - Settings: the layout section (schema 8)

**Files:** modify `src-tauri/src/main.rs`, `src/services/settings.ts`, `src/__tests__/settings.test.ts`, `scripts/measure-ui.ps1`, and any test file that builds an `AppSettings` object literally (the TypeScript compiler names them; each gets `layout: defaultSettings().layout`).

This is `plan/recipes/add-settings-field.md` with N = 8 and a new section.

**Do this (Rust, `main.rs`):**

1. `CURRENT_SCHEMA` becomes 8.
2. Public constants `MAX_SAVED_LAYOUTS` (`usize`, 20) and `MAX_LAYOUT_NAME` (`usize`, 60), and default functions `default_toolbar_position` ("top"), `default_toolbar_mode` ("full"), `default_tab_bar_position` ("top"), `default_nav_pane_position` ("left"), `default_details_pane_position` ("right").
3. Two public structs after `ExplorerViewSettings` (same derives as `ExplorerViewSettings`), with doc comments "One saved layout preset (schema 8, Step 05c)." and "Where the toolbar, tabs and panes go (schema 8, Step 05c). The Details pane's visibility stays `explorer.details_pane`.":
   - `SavedLayout`: `name` (serde plain default), then the six layout fields with the defaults above (`tab_bar_collapsed` plain default false).
   - `LayoutSettings`: the six layout fields with the same defaults, then `saved_presets` (`Vec<SavedLayout>`, plain default). `Default` for both gives the defaults (and an empty name for `SavedLayout`).
4. `Settings` gets the field `layout` (serde default) after `open`; add `layout: LayoutSettings::default()` to `impl Default for Settings` and to the struct literal in `migrate_v1`.
5. A private function `check_layout_values` (parameters: the five string fields by reference, and a `what: &str` used in messages) returning `Result<(), AppError>`: each field must be one of its allowed values, else a validation error naming `what`, the field and the bad value.
6. In `validate`, after the existing checks: `check_layout_values` for the section (`what` = "layout"); `saved_presets` has at most `MAX_SAVED_LAYOUTS` entries; for each preset: the name is not empty, equals its trimmed form, has at most `MAX_LAYOUT_NAME` characters, its lower-case form was not seen before (keep a set), and `check_layout_values` passes (`what` = "saved preset").
7. In `migrate`, the arm for 4, 5 or 6 also takes 7.
8. Existing tests: `settings_defaults` expects schema 8 (was 7); `settings_v6_migrates_to_v7_keeping_language_and_theme` expects `CURRENT_SCHEMA` (was 7).
9. New tests:
   - `settings_v7_migrates_to_v8_keeping_language_and_theme`: a schema-7 value with language `es`, theme mode `dark`, explorer `view_mode` `columns`, `column_width` 300, `details_pane` true (and the other explorer fields of schema 7), files `paste_image_format` `jpg`, open `protected_view` false. After `migrate`: schema 8; `es`; `dark`; `view_mode` `columns`; `column_width` 300; `details_pane` true; `paste_image_format` `jpg`; `protected_view` false; `layout` equals `LayoutSettings::default()`.
   - `settings_validate_rejects_bad_layout`: starting each time from the default settings, `validate` fails for: `toolbar_position` `middle`; `toolbar_mode` `tiny`; `tab_bar_position` `center`; `nav_pane_position` `top`; `details_pane_position` `left`; one saved preset named `""`; named `" Work"`; named with 61 letters `a`; two presets named `Work` and `work`; 21 presets named `p0` to `p20`; one preset `Work` with `toolbar_mode` `tiny`. It passes for: one preset `Work` with `toolbar_position` `left`; 20 presets `p0` to `p19`; a preset named with 60 letters `a`.

**Do this (TypeScript, `settings.ts`):**

1. `SETTINGS_SCHEMA_VERSION` becomes 8.
2. Add the types and constants of "New TypeScript types and constants" above `AppSettings`, with one-line doc comments; `AppSettings` gets `layout`.
3. `defaultSettings()` gets `layout` with the defaults and an empty `saved_presets`.
4. A private function `normalizeLayout(value: unknown)` returning `LayoutSettings`, following "TypeScript normalization"; `normalizeSettings()` sets `layout` from it.

**Do this (`scripts/measure-ui.ps1`):** in the `$settings` block the schema version becomes 8, and a `layout` part is added with the six defaults and `saved_presets` an empty PowerShell array. Keep the file's Windows line endings (P-32).

**Tests** (`src/__tests__/settings.test.ts`):
- "keeps valid Explorer view options and repairs invalid ones": the expected schema version 7 becomes 8, and the expected object gets the `layout` section with its defaults.
- New test "normalizes the layout section (schema 8)":

  | Input (inside `layout`) | Expected |
  |---|---|
  | nothing (`{}`) | the six defaults and no saved presets |
  | `toolbar_position` `left`; then `middle` | `left`; then `top` |
  | `toolbar_mode` `iconsOnly`; then `tiny` | `iconsOnly`; then `full` |
  | `tab_bar_position` `bottom`, `nav_pane_position` `hidden`, `details_pane_position` `bottom` | kept |
  | `details_pane_position` `hidden` | `right` |
  | `tab_bar_collapsed` `"yes"` | false |
  | `saved_presets` [`{ name: "  Work ", toolbar_position: "left" }`, `{ name: "" }`, `{ name: "work" }`, `"x"`, `{ name: <70 letters a> }`] | two presets: `Work` (position `left`, the other five values default) and a name of 60 letters `a` (all defaults) |
  | `saved_presets` with 25 entries named `p0` to `p24` | the first 20 (`p0` to `p19`) |
  | `saved_presets` `"nope"` | no presets |

**Commit:** `feat(settings): layout section (schema 8) [step-05c/T1]`

### T2 - The layout model and its context

**Files:** create `src/layout/presets.ts`, `src/layout/LayoutContext.tsx`, `src/layout/toolbarLayout.ts`, `src/__tests__/presets.test.ts`, `src/__tests__/toolbarLayout.test.ts`.

**Do this (`src/layout/presets.ts`):** module doc comment "Layout presets (Step 05c, contract 17). Pure." Exports:

| Export | Kind | Content / behavior |
|---|---|---|
| `BuiltInPresetId` | type | `"standard"`, `"minimal"` or `"classic"` |
| `BUILT_IN_PRESET_IDS` | read-only array | the three ids in that order |
| `BUILT_IN_PRESETS` | record from id to `LayoutValues` | the "Presets" table |
| `PRESET_LABEL_KEYS` | record from id to string | the label keys of the "Presets" table |
| `PresetMatch` | type | `{ kind: "builtIn"; id: BuiltInPresetId }` or `{ kind: "saved"; index: number }` |
| `PresetNameError` | type | `"full"`, `"empty"`, `"tooLong"` or `"duplicate"` |
| `layoutValues` | (`layout: LayoutValues`) returns `LayoutValues` | a new object with only the six fields |
| `sameLayout` | (`a`, `b`: `LayoutValues`) returns boolean | every one of the six fields is equal |
| `matchingPreset` | (`layout: LayoutSettings`) returns `PresetMatch` or `null` | the first built-in preset (in id order) equal to the layout's values; else the first saved preset equal to them; else `null` |
| `applyLayoutValues` | (`layout: LayoutSettings`, `values: LayoutValues`) returns `LayoutSettings` | a copy with the six fields from `values` and the same `saved_presets` |
| `presetNameError` | (`name: string`, `layout: LayoutSettings`) returns `PresetNameError` or `null` | in this order: `full` when there are already `MAX_SAVED_LAYOUTS` saved presets; `empty` when the trimmed name is empty; `tooLong` when the trimmed name has more than `MAX_LAYOUT_NAME` characters (code points); `duplicate` when a saved preset's name equals the trimmed name ignoring case; else `null` |
| `withSavedPreset` | (`layout`, `name`) returns `LayoutSettings` | when `presetNameError` is not `null`: `layout` itself. Otherwise a copy whose `saved_presets` gets, at the end, the trimmed name with `layoutValues(layout)` |
| `withoutSavedPreset` | (`layout`, `index: number`) returns `LayoutSettings` | a copy without the saved preset at `index` (an unchanged copy when there is none) |

**Do this (`src/layout/LayoutContext.tsx`):** module doc comment "The window's layout (Step 05c), provided by App." Export the interface `LayoutContextValue` (`layout`: `LayoutSettings`; `onLayoutChange`: function taking a `LayoutSettings`), the context `LayoutContext` (default: `defaultSettings().layout` and a function that does nothing) and the hook `useLayout()` returning the context value.

**Do this (`src/layout/toolbarLayout.ts`):** module doc comment "How a toolbar is drawn where it is docked (Step 05c). Without a provider, toolbars draw as at the top, in the Full look." Exports:

| Export | Kind | Content / behavior |
|---|---|---|
| `ToolbarOrientation` | type | `"horizontal"` or `"vertical"` |
| `ToolbarLayout` | interface | `side` (`ToolbarPosition`), `orientation` (`ToolbarOrientation`), `mode` (`"full"`, `"compact"` or `"iconsOnly"`) |
| `DEFAULT_TOOLBAR_LAYOUT` | constant | side `top`, orientation `horizontal`, mode `full` |
| `ToolbarLayoutContext` | React context | default `DEFAULT_TOOLBAR_LAYOUT` |
| `toolbarOrientation` | (`side: ToolbarPosition`) returns `ToolbarOrientation` | `vertical` for left and right, else `horizontal` |
| `toolbarLayoutFor` | (`side`, `mode: ToolbarMode`) returns `ToolbarLayout` | the side, its orientation, and the mode, where `autoHide` becomes `full` |
| `tooltipPlacement` | (`layout: ToolbarLayout`) returns `"above"`, `"below"`, `"right"` or `"left"` | vertical: `right` on the left side, `left` on the right side; horizontal: `below` at the top, `above` at the bottom |
| `BarItemKind` | type | `"menu"`, `"command"`, `"labeledCommand"` or `"overflow"` |
| `barLabelVisible` | (`layout`, `kind: BarItemKind`) returns boolean | `iconsOnly`: false. Vertical: true. Horizontal: true for `menu` and `labeledCommand`, false for `command` and `overflow`. |
| `ribbonLabelVisible` | (`layout`, `showLabel`: boolean or undefined) returns boolean | `iconsOnly`: false. Vertical: true. Horizontal: `showLabel` is not false. |

**Tests:**

`src/__tests__/presets.test.ts`:

| Test | Input | Expected |
|---|---|---|
| "matchingPreset finds built-in presets first" | the default layout; the Minimal values; toolbar position `left` (other values default); a layout with toolbar `left` and a saved preset `Work` with the same values; a saved preset `Copy` with the Standard values and the Standard layout | `builtIn standard`; `builtIn minimal`; `null`; `saved 0`; `builtIn standard` |
| "applyLayoutValues keeps the saved presets" | a layout with one saved preset, Classic values | the six Classic values; the same saved preset |
| "presetNameError checks in order" | `""`; `"   "`; 61 letters; 60 letters; `"work"` with a saved `Work`; any name with 20 saved presets | `empty`; `empty`; `tooLong`; `null`; `duplicate`; `full` |
| "withSavedPreset trims and adds at the end" | layout with toolbar `left` and saved [`A`]; name `"  Work  "`; then name `""` | saved [`A`, `Work`], `Work` has toolbar `left`; then the very same object |
| "withoutSavedPreset removes one" | saved [`A`, `B`]: index 0; index 5 | [`B`]; [`A`, `B`] |
| "layoutValues drops the saved presets" | a layout with saved presets | an object with exactly the six keys |

`src/__tests__/toolbarLayout.test.ts`:

| Test | Input | Expected |
|---|---|---|
| "toolbarLayoutFor turns auto-hide into the full look" | (`left`, `autoHide`); (`bottom`, `compact`) | (`left`, `vertical`, `full`); (`bottom`, `horizontal`, `compact`) |
| "tooltipPlacement points away from the edge" | sides `top`, `bottom`, `left`, `right` (mode full) | `below`, `above`, `right`, `left` |
| "barLabelVisible follows the look" | horizontal full: menu, command, labeledCommand, overflow; vertical full: command, overflow; any iconsOnly: menu | true, false, true, false; true, true; false |
| "ribbonLabelVisible follows the look" | horizontal full with `showLabel` false; with undefined; vertical compact with false; horizontal iconsOnly with true | false; true; true; false |

**Commit:** `feat(layout): layout presets and toolbar layout rules [step-05c/T2]`

### T3 - Toolbar menu: commands, generic menus, side tooltips, help pages

**Files:** create `src/commands/layoutCommands.ts`, `src/__tests__/layoutCommands.test.ts`, `src/__tests__/tooltip.test.tsx`, `help/en/moving-toolbars-and-panels.md`, `help/es/moving-toolbars-and-panels.md`, `help/en/layout-presets.md`, `help/es/layout-presets.md`; modify `src/components/Menu.tsx`, `src/commands/menus.ts`, `src/components/Tooltip.tsx`, `src/styles/components.css`, `help/en/command-bar.md`, `help/es/command-bar.md`, `help/en/the-ribbon.md`, `help/es/the-ribbon.md`, `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`).

**Translation keys:** all `commands.toolbar*` and `commands.preset*` keys, and `layout.toolbarPosition`, `layout.toolbarStyle`, `layout.preset`, `layout.menuLabel`.

**Do this:**

1. `Menu.tsx`: `MenuProps` gets a type parameter `C` with the default `CommandContext`; `ctx` is `C`, `lookup` returns `Command<C>` or undefined, `onRun` takes a `Command<C>`; the component becomes generic the same way. Only types change; no behavior.
2. `menus.ts`: `resolveMenu` gets the same type parameter (default `CommandContext`) for its `ctx` and `lookup`. Add `TOOLBAR_MENU` (`MenuEntry[]`, Data shapes) after `COMMAND_BAR` (import the three lucide icons).
3. `Tooltip.tsx`: `placement` also accepts `"right"` and `"left"`; the tooltip's class gets `adp-tooltip--right` or `adp-tooltip--left` for them (`adp-tooltip--below` stays for `below`). `components.css`, next to the `.adp-tooltip--below` rule: `.adp-tooltip--right`: vertically centered beside the trigger, 6 px to its right (bottom auto, top 50%, left 100% plus 6 px, a vertical translate of -50% instead of the horizontal one), z-index 60; `.adp-tooltip--left`: the same mirrored (right 100% plus 6 px, left auto).
4. `layoutCommands.ts`: module doc comment "Toolbar position, style and layout presets as commands (Step 05c)." Export the interfaces `LayoutCommandContext` (`layout: LayoutSettings`) and `LayoutActions` (`setLayout`, taking a `LayoutSettings`), and `createLayoutCommands(actions)` returning `Command<LayoutCommandContext>[]`: the eleven commands of the table, in table order, each enabled always, with `checkedWhen` and `run` as the table says (`run` calls `setLayout` with a copy of the context's layout where only that field changed, or `applyLayoutValues` with the preset).
5. Help pages: create the four pages with the exact text in "Help pages" below, and add the sentences to `command-bar.md` and `the-ribbon.md` described there.

**Tests:**

`src/__tests__/layoutCommands.test.ts`:

| Test | Steps | Expected |
|---|---|---|
| "toolbar positions and styles are radio commands" | `createLayoutCommands` with a `setLayout` spy; context with the default layout plus `toolbar_position` `left` | 11 commands, every one with check kind `radio`; `layout.toolbarLeft` is checked and `layout.toolbarTop` is not; running `layout.toolbarRight` calls `setLayout` with position `right` and every other field unchanged; running `layout.toolbarAutoHide` calls it with mode `autoHide` |
| "presets apply their values and show as checked" | context with the Minimal values and one saved preset | `layout.presetMinimal` checked, `layout.presetStandard` not; running `layout.presetClassic` calls `setLayout` with the Classic values and the same saved preset |
| "every layout command has a help page" | the same check `commands.test.ts` uses for help pages | passes for all eleven |
| "the toolbar menu has three groups" | `resolveMenu(TOOLBAR_MENU, context, lookup)` | a submenu with 4 command entries, a submenu with 4, a separator, a submenu with 3 |

`src/__tests__/tooltip.test.tsx` (plain React DOM, fake timers): "tooltips can open beside the button": a `Tooltip` with placement `right` around a button; mouse enter, advance 400 ms | an element with role `tooltip` and class `adp-tooltip--right`; with placement `left`, class `adp-tooltip--left`.

**Commit:** `feat(layout): toolbar menu commands and side tooltips [step-05c/T3]`

### T4 - The toolbar dock

**Files:** create `src/layout/ToolbarDock.tsx`, `src/styles/layout.css`, `src/__tests__/toolbarDock.test.tsx`; modify `src/main.tsx` (import `./styles/layout.css` as the last style import).

**Do this (`ToolbarDock.tsx`):** the default export `ToolbarDock` takes `toolbar` (React node), `children` (React node) and `contentClassName` (string, optional). In this order:

1. `{ layout, onLayoutChange } = useLayout()`; `side` = `layout.toolbar_position`; `autoHide` = `layout.toolbar_mode` is `autoHide`; `toolbarLayout` = `toolbarLayoutFor(side, layout.toolbar_mode)` (`useMemo`). `keyTips` = the value of `KeyTipsContext`.
2. States `hover` (false), `focusInside` (false), `menuAt` (an object with `x` and `y`, or `null`); a ref for the hide timer (cleared in the cleanup of an effect with no dependencies, P-28).
3. `revealed` = not `autoHide`, or `hover`, or `focusInside`, or `keyTips`, or `menuAt` is not `null`.
4. Handlers on the bar element (attached in every mode): mouse enter clears the hide timer and sets `hover`; mouse leave starts a 400 ms timer that clears `hover`; focus sets `focusInside`; blur clears it when the event's `relatedTarget` is missing or outside the bar; context menu: when the target is inside an `input`, `select` or `textarea`, do nothing (P-05: text fields keep their menu); otherwise prevent the default, stop propagation, and set `menuAt` to the event's client point.
5. Commands for the menu: `createLayoutCommands({ setLayout: onLayoutChange })` (`useMemo` on `onLayoutChange`), a lookup by id (`useMemo`), and the context `{ layout }`.
6. Markup:
   - Root: a `div` with classes `adp-dock adp-dock--<side>`, plus `adp-dock--autohide` in that mode.
   - The bar: a `div` with class `adp-dock-bar`, plus `adp-dock-bar--revealed` when `autoHide` and `revealed`, holding `toolbar` inside a `ToolbarLayoutContext` provider with `toolbarLayout`.
   - The content: a `div` with class `adp-dock-content` plus `contentClassName`, holding `children`.
   - The bar always comes before the content in the markup (CSS places it); never render them in a different order (D10).
   - When `menuAt` is set: `Menu` with `resolveMenu(TOOLBAR_MENU, context, lookup)`, the context, the lookup, anchor kind `point` at `menuAt`, `ariaLabel` from `layout.menuLabel`, `onRun` running the command when it is enabled, and `onClose` setting `menuAt` to `null`.

**Do this (`src/styles/layout.css`):** a comment line "Movable toolbars, panels and tabs (Step 05c). Colors only through tokens.", then these rules (more are added by later tasks):

| Selector | Layout | Size and spacing | Look |
|---|---|---|---|
| `.adp-dock` | flex; grows (flex 1); may shrink (min-width 0, min-height 0); positioned (relative) | | |
| `.adp-dock--top` / `--bottom` / `--left` / `--right` | flex column / column reversed / row / row reversed | | |
| `.adp-dock-bar` | does not grow or shrink; flex (its toolbar stretches across it) | | |
| `.adp-dock-content` | grows (flex 1); may shrink (min-width 0, min-height 0); flex (no direction set); positioned (relative) | | |
| `.adp-dock--autohide > .adp-dock-bar` | absolutely positioned on its side over the content (top: top 0, left 0, right 0; bottom: bottom 0, left 0, right 0; left: top 0, bottom 0, left 0; right: top 0, bottom 0, right 0); z-index 20; overflow hidden | 6 px tall (top, bottom) or 6 px wide (left, right) | background `--adp-color-border-default` |
| the same bar on hover, not revealed | | | background `--adp-accent-current` |
| `.adp-dock--autohide > .adp-dock-bar--revealed` | overflow visible | height (top, bottom) or width (left, right) back to automatic | background `--adp-color-surface-window`; shadow `--adp-shadow-card` |
| children of a hidden (not revealed) auto-hide bar | | | opacity 0 (they stay in the page, so the keyboard can still reach them) |
| `.adp-dock--bottom .adp-commandbar`, `.adp-dock--bottom .adp-ribbon` | | | no bottom border; top border 1 px `--adp-color-border-default` |
| `.adp-dock--left` toolbars (`.adp-commandbar`, `.adp-ribbon`) | | | no bottom border; right border 1 px `--adp-color-border-default` |
| `.adp-dock--right` toolbars | | | no bottom border; left border 1 px `--adp-color-border-default` |

Never use a CSS transform on `.adp-dock-bar` or its parents: it would trap the fixed-position flyout and menus inside the bar.

**Tests** (`src/__tests__/toolbarDock.test.tsx`; render inside `LayoutContext.Provider` with a layout from the test and an `onLayoutChange` spy; the toolbar is a `div` with a button and a text `input`; a probe component inside the toolbar stores the `ToolbarLayoutContext` value it reads):

| Test | Steps | Expected |
|---|---|---|
| "places the toolbar on the chosen side" | toolbar position `bottom` | the root has classes `adp-dock` and `adp-dock--bottom`; the toolbar is inside `.adp-dock-bar`, the children inside `.adp-dock-content` |
| "gives the toolbar its side and style" | `left` with `compact`; then `top` with `autoHide` | the probe read (`left`, `vertical`, `compact`); then (`top`, `horizontal`, `full`) |
| "auto-hide shows the toolbar on hover and hides it later" | fake timers; mode `autoHide`; mouse enter on the bar; mouse leave; advance 399 ms; then 1 ms | revealed class after the enter; still there at 399 ms; gone at 400 ms |
| "auto-hide shows the toolbar while it has the focus or Alt is held" | `autoHide`: focus the toolbar's button; then move the focus to a button outside the dock; then render with `KeyTipsContext` true | revealed; not revealed; revealed |
| "right-click opens the toolbar menu" | right-click the bar's button; click the item "Toolbar position"; click "Left" | a menu with the accessible name "Toolbar options"; `onLayoutChange` called with `toolbar_position` `left` and the other values unchanged; the menu closed |
| "a text box inside the toolbar keeps its own menu" | right-click the `input` | no menu; the event is not default-prevented |

Write expected texts as `i18n.t` of their keys.

**Commit:** `feat(layout): toolbar dock with auto-hide and the toolbar menu [step-05c/T4]`

### T5 - The command bar on any side, in any style

**Files:** modify `src/views/explorer/CommandBar.tsx`, `src/styles/layout.css`; create `src/__tests__/commandBarLayout.test.tsx`.

**Do this (`CommandBar.tsx`):**

1. Read `toolbar` = the value of `ToolbarLayoutContext`; `vertical` = its orientation is `vertical`.
2. Root classes: `adp-commandbar`, plus `adp-commandbar--vertical` when vertical, `adp-commandbar--compact` when the mode is `compact`, `adp-commandbar--icons` when the mode is `iconsOnly`. Add `aria-orientation` `vertical` when vertical.
3. Fitting entries into the bar (the existing `fit`): measure each entry's height instead of its width, and compare with the bar's `clientHeight` instead of its `clientWidth`, when vertical (the fixed allowance of 80 px stays). The existing layout effect that resets the measurements on a language change also runs when the orientation or the mode changes (add them to its dependencies).
4. Menus: when vertical, `toggleMenu` anchors the menu with kind `side` at the button's rectangle (left, top, right, bottom); otherwise with kind `below` as today.
5. Tooltips: every `Tooltip` in the bar uses `tooltipPlacement(toolbar)` instead of the fixed `below`.
6. Labels (`barLabelVisible`):
   - Menu entries (New, Sort, View): the label `span` only when `barLabelVisible(toolbar, "menu")`; the chevron: `ChevronDown` (11 px) when horizontal, `ChevronRight` (11 px) when vertical and labels show, none when vertical with icons only.
   - Command entries: when `entry.showLabel` is true, the label (today's `commands.details` text) only when `barLabelVisible(toolbar, "labeledCommand")`; otherwise the command's own label (`label`) when `barLabelVisible(toolbar, "command")`. Each label is a `span`.
   - The overflow entry: the label `commands.more` in a `span` after the icon when `barLabelVisible(toolbar, "overflow")`; its class becomes `adp-cmd-text` instead of `adp-cmd-icon` when the label shows.
   - The `className` of command buttons: `adp-cmd-text` when a label shows, else `adp-cmd-icon` (plus `adp-cmd--pressed` as today).
7. Nothing else changes; without a provider the bar is exactly as before.

**Do this (`layout.css`):** add

| Selector | Layout | Size and spacing |
|---|---|---|
| `.adp-commandbar--compact` | | height 40 px |
| `.adp-commandbar--compact .adp-cmd-text`, `.adp-commandbar--compact .adp-cmd-icon` | | height 28 px |
| `.adp-commandbar--vertical` | flex column; items stretch; no fixed height (height auto); overflow hidden | width 200 px; padding `--adp-space-3` top and bottom, `--adp-space-2` left and right; gap 2 px |
| `.adp-commandbar--vertical.adp-commandbar--compact` | | width 168 px |
| `.adp-commandbar--vertical.adp-commandbar--icons` | items centered | width 48 px; padding `--adp-space-3` 6 px |
| `.adp-commandbar--vertical .adp-cmd-wrap`, its tooltip wrapper | flex (full width) | width 100% |
| `.adp-commandbar--vertical .adp-cmd-text` | content starts at the left | width 100%; padding 0 `--adp-space-3` |
| `.adp-commandbar--vertical.adp-commandbar--compact .adp-cmd-text`, `.adp-cmd-icon` | | height 28 px |
| `.adp-commandbar--vertical .adp-cmd-sep` | | full width (24 px in the icons look), 1 px tall; margin `--adp-space-1` 0 |
| `.adp-commandbar--vertical .adp-cmd-spacer` | grows vertically (flex 1) | |

**Tests** (`src/__tests__/commandBarLayout.test.tsx`; copy `baseCtx` from `commands.test.ts`; commands from `createExplorerCommands` with `vi.fn` actions, a lookup over them; entries `COMMAND_BAR`; render `CommandBar` inside `ToolbarLayoutContext.Provider` with the layout given, or without a provider):

| Test | Layout | Expected |
|---|---|---|
| "the standard bar is unchanged" | no provider | no class `adp-commandbar--vertical`, `--compact` or `--icons`; the New button shows its label and holds a `lucide-chevron-down` icon; the Cut button shows no text |
| "a side bar shows names beside the icons" | `left`, `vertical`, `full` | class `adp-commandbar--vertical`, `aria-orientation` vertical; the Cut button's text is the translated `commands.cut`; the New button holds a `lucide-chevron-right` icon; the overflow button shows `commands.more` |
| "icons only hides every name" | `top`, `horizontal`, `iconsOnly` | class `adp-commandbar--icons`; the New button's text is empty; the Details toggle's text is empty |
| "compact adds its class" | `bottom`, `horizontal`, `compact` | class `adp-commandbar--compact` |
| "menus open from a side bar" | `left`, `vertical`, `full`; click New | an element with role `menu` |

**Commit:** `feat(explorer): command bar on any side and in any style [step-05c/T5]`

### T6 - Ribbons on any side, the More options flyout, ViewerFrame

**Files:** create `src/layout/Flyout.tsx`, `src/__tests__/ribbonLayout.test.tsx`; modify `src/ribbon/Ribbon.tsx`, `src/ribbon/ViewerFrame.tsx`, `src/styles/layout.css`, `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`).

**Translation keys:** `ribbon.tabs`.

**Do this (`Flyout.tsx`):** the default export `Flyout` takes `icon` (lucide icon), `label` (translated string), `opensTo` (`"right"` or `"left"`) and `children`. It draws a `button` with class `adp-icon-btn adp-flyout-btn`, `aria-label` and `title` = `label`, `aria-haspopup` `dialog`, `aria-expanded`, holding the icon at 16 px (hidden from screen readers). A click toggles a state `open`. When open, it also draws a `div` with class `adp-flyout`, `role="dialog"`, `aria-label` = `label`, fixed-positioned from the button's rectangle at the moment it opens: `top` = the rectangle's top; for `right`, `left` = the rectangle's right + 4; for `left`, `right` = window width - the rectangle's left + 4; and a maximum height of window height - top - 8 (it scrolls when taller). After opening, focus the first `select`, `button` or `input` inside the panel. While open, window listeners (removed when it closes or unmounts, P-28): Escape closes it and focuses the button; a mouse-down outside both the button and the panel closes it.

**Do this (`Ribbon.tsx`):**

1. Read `toolbar` = the value of `ToolbarLayoutContext`; `vertical`, `iconsOnly` (mode `iconsOnly`) and `compact` (mode `compact`).
2. Root classes: `adp-ribbon`, plus `adp-ribbon--vertical`, `adp-ribbon--compact`, `adp-ribbon--icons` when they apply. The body (`role="toolbar"`) gets `aria-orientation` `vertical` when vertical.
3. Tabs, when there is more than one: horizontal, the tab row as today. Vertical: instead of the tab row, a `DropdownMenu` (inside a `div` with class `adp-ribbon-tabpick`) with `ariaLabel` from `ribbon.tabs`, `label` = the current tab's translated label (no label in Icons only, where `icon` = `Layers`), items = the tabs (id and translated label), and `onSelect` selecting that tab. The Alt+letter effect stays unchanged.
4. Buttons: the label `span` shows when `ribbonLabelVisible(toolbar, control.showLabel)`.
5. Custom controls: drawn in place, as today, except when vertical with Icons only: then they are not drawn in place; a group whose shown controls are all custom is left out of the column (with its separator); and when at least one custom control is shown, a `Flyout` is drawn at the end of the body with `icon` `Ellipsis`, `label` from `common.moreOptions`, `opensTo` = `right` when the side is `left`, else `left`, holding every shown custom control's `render()` in order, each in a `span` with class `adp-ribbon-custom`.
6. Nothing else changes (the 04c rules for hidden controls and empty groups stay); without a provider the ribbon is exactly as before.

**Do this (`ViewerFrame.tsx`):** it renders `ToolbarDock` with `toolbar` = `ribbon`, `contentClassName` = `adp-viewer-content`, and the children inside, all within the existing `div` with class `adp-viewer`. Update its doc comment: "A viewer's ribbon and content (Step 04b). Step 05c docks the ribbon on the side the layout chooses (`ToolbarDock`)."

**Do this (`layout.css`):** add

| Selector | Layout | Size and spacing | Look |
|---|---|---|---|
| `.adp-ribbon--compact .adp-ribbon-body` | | height 40 px | |
| `.adp-ribbon--compact .adp-ribbon-btn` | | height 28 px | |
| `.adp-ribbon--vertical` | flex column | width 200 px | |
| `.adp-ribbon--vertical.adp-ribbon--compact` | | width 168 px | |
| `.adp-ribbon--vertical.adp-ribbon--icons` | | width 48 px | |
| `.adp-ribbon--vertical .adp-ribbon-body` | flex column, items stretch; grows (flex 1); vertical overflow auto, horizontal hidden | height auto; padding `--adp-space-3` 6 px; gap 2 px | |
| `.adp-ribbon--vertical .adp-ribbon-group` | flex column, items stretch | gap 2 px | |
| `.adp-ribbon--vertical .adp-ribbon-sep` | | full width, 1 px tall; margin `--adp-space-1` 0 | |
| `.adp-ribbon--vertical .adp-ribbon-btn` | content starts at the left | width 100% | |
| `.adp-ribbon--vertical.adp-ribbon--compact .adp-ribbon-btn` | | height 28 px | |
| `.adp-ribbon--vertical.adp-ribbon--icons .adp-ribbon-btn` | content centered | width 36 px; padding 0 | |
| `.adp-ribbon--vertical .adp-ribbon-custom` | flex column, items stretch | gap `--adp-space-1` | |
| `.adp-ribbon-tabpick` | | padding `--adp-space-2` | |
| `.adp-flyout` | fixed position; flex column | min-width 200 px; padding `--adp-space-4`; gap `--adp-space-3`; vertical overflow auto; z-index 70 | background `--adp-color-surface-window`; border 1 px `--adp-color-border-default`; corner radius `--adp-radius-lg`; shadow `--adp-shadow-card` |
| `.adp-flyout .adp-ribbon-custom` | flex column, items stretch | gap `--adp-space-1` | |

**Tests** (`src/__tests__/ribbonLayout.test.tsx`; commands and a ribbon definition like `ribbon.test.tsx`'s, plus a group with a custom control that renders a `select` with two options; render `Ribbon` inside `ToolbarLayoutContext.Provider`):

| Test | Steps | Expected |
|---|---|---|
| "a side ribbon shows names and stacks its groups" | `left`, `vertical`, `full` | class `adp-ribbon--vertical`; the body has `aria-orientation` vertical; both command buttons show their labels (also the one with `showLabel` false) |
| "icons only moves lists into More options" | `left`, `vertical`, `iconsOnly`; click the button named "More options"; press Escape in the flyout | no `select` inside `.adp-ribbon-body` before the click; after it, `.adp-flyout` holds the `select` and the `select` has the focus; after Escape there is no `.adp-flyout` and the "More options" button has the focus |
| "ribbon tabs become a list on a side" | a definition with two tabs; `right`, `vertical`, `full`; choose the second tab in the list | no element with role `tab`; a button named "Ribbon tabs" showing the first tab's label; after choosing, the second tab's group is shown |
| "ViewerFrame docks the ribbon" | `ViewerFrame` inside `LayoutContext.Provider` with toolbar position `right`, ribbon = a `div` with class `probe`, children = a `p` | `.adp-dock--right .adp-dock-bar .probe` exists; the `p` is inside an element with classes `adp-dock-content` and `adp-viewer-content` |

`src/__tests__/ribbon.test.tsx` passes unchanged (no provider: today's look).

**Commit:** `feat(ribbon): ribbons on any side and in any style [step-05c/T6]`

### T7 - The Explorer: docked command bar, moving panes

**Files:** modify `src/views/ExplorerHome.tsx`, `src/views/explorer/DetailsPane.tsx`, `src/styles/layout.css`; create `src/__tests__/explorerLayout.test.tsx`.

**Do this (`DetailsPane.tsx`):** a new optional prop `placement` (`"right"` or `"bottom"`, default `right`; comment "Where the layout puts the pane (Step 05c)."). The `aside` gets the extra class `adp-details-pane--bottom` when it is `bottom`. Nothing else changes.

**Do this (`ExplorerHome.tsx`, about 20 lines, only in the returned markup and one line to read the layout):**

1. Import `useLayout` and `ToolbarDock`; `const { layout } = useLayout()` near the other hooks at the top.
2. The `CommandBar` and the `div` with class `adp-explorer-body` go inside one `ToolbarDock`, right after the `AddressBar`: `toolbar` = the `CommandBar` element (unchanged props), `contentClassName` = `adp-explorer-main`, children = the body.
3. The body gets the extra class `adp-explorer-body--nav-right` when `nav_pane_position` is `right`. Its children, always in these three positions (D10): first the `NavPane` (unchanged) or nothing when `nav_pane_position` is `hidden`; second a new `div` with class `adp-explorer-center` holding the existing `section` (unchanged) and, after it, the `DetailsPane` with `placement` `bottom` when the Details pane is shown and `details_pane_position` is `bottom`; third the `DetailsPane` (unchanged props) when the Details pane is shown and the position is `right`, else nothing.
4. Nothing else changes (the dialogs, menus, toasts and drag badge stay where they are).

**Do this (`layout.css`):** add

| Selector | Layout | Size and spacing | Look |
|---|---|---|---|
| `.adp-explorer-main` | flex column | | |
| `.adp-explorer-center` | flex column; grows (flex 1); may shrink (min-width 0, min-height 0) | | |
| `.adp-explorer-center > .adp-explorer-content` | grows (flex 1) | | |
| `.adp-explorer-body--nav-right > .adp-explorer-nav` | placed after the other children (order 1) | | no right border; left border 1 px `--adp-color-border-panel` |
| `.adp-details-pane--bottom` | does not grow or shrink; vertical overflow auto | automatic width; height 200 px | no left border; top border 1 px `--adp-color-border-panel` |

**Tests** (`src/__tests__/explorerLayout.test.tsx`; plain React DOM as in `explorerActive.test.tsx`; render `ExplorerHome` with `onOpenHelp` doing nothing, `view` = the default explorer settings with `details_pane` true, inside `LayoutContext.Provider` with the default layout changed as each row says):

| Test | Layout | Expected |
|---|---|---|
| "the command bar sits in the toolbar dock" | default | an `.adp-commandbar` inside `.adp-dock--top .adp-dock-bar`; `.adp-explorer-body` inside `.adp-dock-content` |
| "the navigation pane moves right or hides" | `nav_pane_position` `right`; then `hidden` | the body has class `adp-explorer-body--nav-right` and an `.adp-explorer-nav`; then no `.adp-explorer-nav` |
| "the Details pane can sit under the files" | `details_pane_position` `bottom`; then `right` | an `.adp-details-pane.adp-details-pane--bottom` inside `.adp-explorer-center`; then an `.adp-details-pane` that is a direct child of the body and has no class `adp-details-pane--bottom` |

`explorerHome.test.tsx` and `explorerActive.test.tsx` pass unchanged (no provider: the standard layout).

**Commit:** `feat(explorer): docked command bar and movable panes [step-05c/T7]`

### T8 - Tabs at the top, at the bottom or on a side

**Files:** create `src/layout/TabStrip.tsx`, `src/__tests__/tabStrip.test.tsx`; modify `src/App.tsx`, `src/styles/layout.css`, `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`).

**Translation keys:** `tabs.collapse`, `tabs.expand`.

**Do this (`TabStrip.tsx`):** the default export `TabStrip` draws the tabs and the "+" menu in every position. Props:

| Prop | Type |
|---|---|
| `tabs` | read-only list of `TabState` |
| `activeId` | string |
| `side` | `TabBarPosition` |
| `collapsed` | boolean |
| `label` | function from a `TabState` to its name |
| `onActivate` | function taking a tab id |
| `onClose` | function taking a tab id |
| `onNewTab` | function taking `"help"`, `"settings"` or `"gallery"` |
| `onToggleCollapsed` | function, no arguments |

1. `vertical` = side is `left` or `right`. A tab shows only its icon when: vertical and `collapsed`; or not vertical, it is the Explorer tab, and there are file tabs (today's rule).
2. Each tab is drawn exactly as `App.tsx` draws it today (the same element, role, classes, icon choice with the handler's accent color, label, close button, click and middle-click), moved here unchanged, with two differences when vertical and `collapsed`: no close button (middle-click still closes), and the `title` is the tab's name (file tabs keep their path as the `title`).
3. Horizontal (`top` or `bottom`): a `div` with class `adp-tabbar` (plus `adp-tabbar--bottom` at the bottom) and `role="tablist"`, holding the tabs and then today's "+" `DropdownMenu` (unchanged).
4. Vertical: a `div` with classes `adp-tabrail adp-tabrail--<side>` (plus `adp-tabrail--collapsed`), `role="tablist"` and `aria-orientation` vertical, holding first an `IconButton` with class `adp-tabrail-toggle`, `labelKey` `tabs.expand` when collapsed and `tabs.collapse` otherwise, the icon `PanelLeftOpen` / `PanelLeftClose` on the left side and `PanelRightOpen` / `PanelRightClose` on the right side (Open when collapsed), whose click calls `onToggleCollapsed`; then the tabs; then the "+" `DropdownMenu`.

**Do this (`App.tsx`, about 30 new lines; the tab markup moves out):**

1. Imports: `TabStrip`, `LayoutContext`.
2. `onLayoutChange`: a `useCallback` like `onViewChange` that applies the settings with `layout` replaced. `layoutValue` (`useMemo` on `settings.layout` and `onLayoutChange`) = the context value.
3. Wrap everything inside the `div` with class `adp-shell` in `LayoutContext.Provider` with `layoutValue`.
4. In the header, the whole `div` with class `adp-tabbar` (the tabs and the "+" menu) is replaced by one slot: when `settings.layout.tab_bar_position` is `top`, a `TabStrip` with side `top`; otherwise a `span` with class `adp-titlebar-title`, the attribute `data-tauri-drag-region`, and the active tab's name (`tabLabel(activeTab)`). The props of `TabStrip`: the tabs, the active id, the side, `collapsed` = `settings.layout.tab_bar_collapsed`, `label` = `tabLabel`, `onActivate` activating the tab (as the old click did), `onClose` = `closeTab`, `onNewTab` = `openTab`, `onToggleCollapsed` calling `onLayoutChange` with `tab_bar_collapsed` flipped.
5. The `KeyTipsContext.Provider` that holds `main` goes inside a new `div` with classes `adp-workspace adp-workspace--tabs-<side>`, whose first child is a `TabStrip` with that side when the side is not `top`, and nothing when it is `top` (an empty slot, so `main` and the Explorer are never remounted, D10); its second child is the provider with `main`, unchanged.
6. Remove from `App.tsx` whatever only the moved tab markup used (for example the icon imports it alone needed). Keep `tabLabel`, `hasFileTabs`, `TabIcon` and everything the status bar uses.

**Do this (`layout.css`):** add

| Selector | Layout | Size and spacing | Look |
|---|---|---|---|
| `.adp-workspace` | flex; grows (flex 1); may shrink (min-height 0) | | |
| `.adp-workspace--tabs-top`, `--tabs-left` / `--tabs-right` / `--tabs-bottom` | row / row / row reversed / column reversed | | |
| `.adp-workspace > .adp-main` | grows (flex 1); may shrink (min-width 0, min-height 0) | | |
| `.adp-titlebar-title` | grows (flex 1); flex, items centered; one line, cut with an ellipsis | padding 0 `--adp-space-4` | text `--adp-color-text-secondary`; font size `--adp-font-body` |
| `.adp-tabbar--bottom` | does not grow or shrink; flex, items at the top | height 36 px; padding 0 `--adp-space-2`; gap `--adp-space-1` | background `--adp-color-surface-chrome`; top border 1 px `--adp-color-border-default` |
| `.adp-tabbar--bottom .adp-tab` | | | top border none; bottom border kept; corner radius 0 0 `--adp-radius-md` `--adp-radius-md` |
| `.adp-tabrail` | flex column; does not grow or shrink; vertical overflow auto | width 220 px; padding `--adp-space-2`; gap 2 px | background `--adp-color-surface-chrome` |
| `.adp-tabrail--left` / `--right` | | | right border / left border 1 px `--adp-color-border-default` |
| `.adp-tabrail--collapsed` | items centered | width 48 px | |
| `.adp-tabrail .adp-tab` | content starts at the left | full width (max width none); height 36 px | corner radius `--adp-radius-sm`; borders none |
| `.adp-tabrail--collapsed .adp-tab` | content centered | width 36 px; padding 0 | |
| `.adp-tabrail--left .adp-tab--active` / `.adp-tabrail--right .adp-tab--active` | | | an inset accent bar of 3 px on the inner edge (box shadow `--adp-accent-current`, left side / right side) |
| `.adp-tabrail .adp-tab-close` | pushed to the right end (left margin auto) | | |
| `.adp-tabrail-toggle` | aligned to the start | | |

**Tests** (`src/__tests__/tabStrip.test.tsx`; tabs: the Explorer tab and one file tab titled `notes.txt`; spies for every callback):

| Test | Steps | Expected |
|---|---|---|
| "a top tab bar draws the tabs in a row" | side `top` | a `.adp-tabbar` with `role="tablist"`; 2 elements with role `tab`; the Explorer tab shows no label (a file tab is open); the file tab shows "notes.txt" and a close button |
| "the bottom bar has its class" | side `bottom` | `.adp-tabbar.adp-tabbar--bottom` |
| "a side column shows names and can shrink" | side `left`, not collapsed; click the toggle; then render collapsed | `.adp-tabrail--left` with `aria-orientation` vertical; both tabs show their names; the toggle (accessible name `tabs.collapse`) calls `onToggleCollapsed`; collapsed: class `adp-tabrail--collapsed`, no tab label, no close button, the file tab's `title` is its path and the Explorer tab's `title` is its name, the toggle's name is `tabs.expand` |
| "tabs activate on click and close on middle-click" | side `right`: click the file tab; middle-click it (aux click, button 1) | `onActivate` with its id; `onClose` with its id |

**Traps:**
- Never render the workspace children in a different order or drop the empty slot: React would remount `main`, and the Explorer would lose its folder, selection and scroll.
- The title bar keeps `data-tauri-drag-region` on the header; the new title `span` also gets it, so the window can be dragged by the title.

**Commit:** `feat(layout): tabs at the top, at the bottom or on a side [step-05c/T8]`

### T9 - Settings > Layout

**Files:** create `src/views/settings/LayoutSettings.tsx`, `src/__tests__/layoutSettings.test.tsx`; modify `src/views/SettingsView.tsx`, `src/styles/layout.css`, `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`).

**Translation keys:** all `settings.layout*`, `settings.tabBar*`, `settings.navPane`, `settings.detailsPanePlace` and `settings.place*` keys.

**Do this (`LayoutSettings.tsx`):** the default export `LayoutSettings` takes `layout` (`LayoutSettings`), `detailsPane` (boolean: the Details pane is shown), `onChange` (function taking a `LayoutSettings` and a boolean: the new layout and whether the Details pane is shown; one call per change, so both are saved together) and `onOpenHelp` (function taking a slug). Built like `ViewsSettings` (05a):

1. A `section` with class `adp-settings-section`, labelled by its heading; header `div` with class `adp-view-header` holding an `h3` (id `adp-layout-title`, class `adp-heading`, text `settings.layout`) and a `HelpButton` that opens `moving-toolbars-and-panels`.
2. Row (`div.adp-setting-row`): label (class `adp-setting-label`) `layout.preset`; a native `select` with class `adp-defaultapps-select`, accessible name `layout.preset`, `data-layout-field` `preset`, value from `matchingPreset`: `builtin:<id>`, `saved:<index>`, or `custom`. Options: the three built-in presets (`builtin:<id>`, text from `PRESET_LABEL_KEYS`), then each saved preset (`saved:<index>`, its name), then, only when nothing matches, a disabled option `custom` with the text `settings.layoutCustom`. Choosing a built-in or saved preset calls `onChange(applyLayoutValues(layout, its values), detailsPane)`. Then a `HelpButton` that opens `layout-presets`.
3. Row: a `Button` `settings.layoutSave`, disabled when there are `MAX_SAVED_LAYOUTS` saved presets, opening the save dialog; when disabled, a note (`p.adp-note`) `settings.layoutFull` with `max` = 20.
4. When there are saved presets: a label `settings.layoutSaved` and a list (`ul`, class `adp-layout-presets`) with one `li` (class `adp-layout-preset`) per preset: the name in a `span`, then a `button` with class `adp-icon-btn`, accessible name and `title` `settings.layoutDelete` with the name, holding a 16 px `Trash2` icon (hidden from screen readers), calling `onChange(withoutSavedPreset(layout, index), detailsPane)`.
5. Five rows, each a label (class `adp-setting-label`) and a native `select` (class `adp-defaultapps-select`, accessible name = the label's text, `data-layout-field` as given):

   | Label | `data-layout-field` | Options (value: text) | On change |
   |---|---|---|---|
   | `layout.toolbarPosition` | `toolbar_position` | `top`: `settings.placeTop`; `bottom`: `settings.placeBottom`; `left`: `settings.placeLeft`; `right`: `settings.placeRight` | the field set |
   | `layout.toolbarStyle` | `toolbar_mode` | `full`: `commands.toolbarFull`; `compact`: `commands.toolbarCompact`; `iconsOnly`: `commands.toolbarIconsOnly`; `autoHide`: `commands.toolbarAutoHide` | the field set |
   | `settings.tabBarPosition` | `tab_bar_position` | the four places as for the toolbar | the field set |
   | `settings.navPane` | `nav_pane_position` | `left`, `right`, `hidden` (`settings.placeHidden`) | the field set |
   | `settings.detailsPanePlace` | `details_pane` | `right`, `bottom`, `hidden`; the value is `hidden` when `detailsPane` is false, else `details_pane_position` | `hidden`: `onChange(layout, false)`; `right` or `bottom`: `onChange` with `details_pane_position` set and `true` |

   Each "the field set" calls `onChange` with a copy of `layout` where that field has the chosen value, and `detailsPane` unchanged.
6. After the tab bar row: a `Switch` with label `settings.tabBarCollapsed`, checked = `tab_bar_collapsed`, disabled unless the tab bar is `left` or `right`, whose change sets that field.
7. The save dialog (a `Dialog` with title `settings.layoutSaveTitle`): a `TextInput` with `ariaLabel` `settings.layoutPresetName` (state `name`, starting empty); below it, when `name` is not empty and `presetNameError(name, layout)` is `tooLong` or `duplicate`, a `p` with class `adp-note` and `role="alert"` with `settings.layoutNameTooLong` (`max` = 60) or `settings.layoutNameDuplicate`; then `div.adp-dialog-actions` with a primary `Button` `common.save`, disabled while `presetNameError` is not `null`, which calls `onChange(withSavedPreset(layout, name), detailsPane)` and closes the dialog, and a `Button` `common.cancel` that closes it. Enter in the text box saves when the name is valid.

**Do this (`SettingsView.tsx`):** right before the Views section (05a), show `LayoutSettings` with `layout` = the settings' `layout`, `detailsPane` = the settings' `explorer.details_pane`, `onChange` applying the settings with the new `layout` and `explorer.details_pane` in one call, and `onOpenHelp` = `onOpenHelpPage`.

**Do this (`layout.css`):** add

| Selector | Layout | Size and spacing |
|---|---|---|
| `.adp-layout-presets` | flex column; no list bullets | no margin, no padding; gap `--adp-space-2` |
| `.adp-layout-preset` | flex row, items centered vertically | gap `--adp-space-3` |

**Tests** (`src/__tests__/layoutSettings.test.tsx`; `onChange` is a spy; expected texts through `i18n.t`):

| Test | Steps | Expected |
|---|---|---|
| "shows the matching preset and applies another" | default layout, `detailsPane` false; change the preset list to `builtin:minimal` | the list's value was `builtin:standard`; `onChange` got the Minimal values and false |
| "shows Custom when nothing matches" | toolbar position `left` | the preset list's value is `custom`; its option `custom` is disabled |
| "moves the toolbar and the panes" | `detailsPane` false: change `toolbar_position` to `right`; `nav_pane_position` to `hidden`; `details_pane` to `bottom` | three calls: position `right` and false; nav `hidden` and false; `details_pane_position` `bottom` and true |
| "hides the Details pane" | `detailsPane` true; change `details_pane` to `hidden` | `onChange` got the same layout and false |
| "the side tab bar switch works only on a side" | tab bar `top`; then `left` and click the switch | disabled; then enabled and `onChange` got `tab_bar_collapsed` true |
| "saves a preset" | click "Save as preset…"; type `  Work  ` in the text box; click Save | `onChange` got `saved_presets` [`Work` with the current six values] and the same `detailsPane`; the dialog closed |
| "refuses a duplicate or empty name" | a saved preset `Work`; open the dialog; type `work`; then clear the text box | the duplicate message shows and Save is disabled; then no message and Save is still disabled |
| "deletes a saved preset" | saved `Work` and `Home`; click "Delete Work" | `onChange` got `saved_presets` [`Home`] |
| "the save button is disabled at 20 presets" | 20 saved presets | the button is disabled and the `settings.layoutFull` text (with 20) shows |

**Commit:** `feat(settings): Layout section with presets [step-05c/T9]`

### T10 - OWNER CHECKPOINT: side and bottom designs

**Files:** modify `scripts/measure-ui.mjs`.

The owner asked to see the side and bottom designs before the step is finished.

**Do this:**

1. In the `window.__m` object of `scripts/measure-ui.mjs`, add a helper `layoutField(field, value)`: find `select[data-layout-field="<field>"]`, set its value with the native `HTMLSelectElement` value setter, and dispatch a bubbling `change` event. Add a helper `openSettings()` that clicks the second button of `.adp-button-row` (Settings), and `openExplorer()` that clicks the first element with `role="tab"` in the document (the Explorer tab).
2. In the screenshot part, after Step 05b's last action (back to Details), add these steps (each action through the `step` helper; "settings" below means: `openSettings()`, wait 300 ms, the `layoutField` calls, `openExplorer()`, wait 400 ms):
   - First read and remember the current value of the `details_pane` field (open Settings, read `select[data-layout-field="details_pane"]`'s value, go back).
   - settings: `toolbar_position` `left`; shot `24-toolbar-left`.
   - settings: `toolbar_position` `bottom`, `toolbar_mode` `iconsOnly`; shot `25-toolbar-bottom-icons`.
   - settings: `toolbar_position` `top`, `toolbar_mode` `full`, `tab_bar_position` `left`; shot `26-tabs-left`.
   - settings: `tab_bar_position` `top`, `nav_pane_position` `right`, `details_pane` `bottom`; click the third item; shot `27-panes-moved`.
   - settings: `nav_pane_position` `left`, `details_pane` back to the remembered value, `toolbar_position` `right`, `toolbar_mode` `iconsOnly`; double-click the row whose text includes `notes.txt` (it opens in a text tab); wait 800 ms; click `.adp-flyout-btn` when it exists; shot `28-ribbon-right-icons`; press Escape; Ctrl+W.
   - settings: `preset` `builtin:classic`; shot `29-classic`.
   - `openSettings()`; wait 300 ms; shot `30-layout-settings`; `layoutField("preset", "builtin:standard")`; `openExplorer()`.
3. Run the gate, commit (`test(screens): side and bottom layout screenshots [step-05c/T10]`), run `.\scripts\gate.ps1 -Package`, then take the screenshots in English light and Spanish dark into `docs/screenshots/step-05c/` (`plan/git-and-testing.md` "Screenshots").

**OWNER CHECKPOINT:** tell the owner: "The side and bottom layouts are ready to look at", list the seven screenshot files with their full paths, and ask for approval. Stop and wait. Changes the owner asks for become tasks `F1`, `F2`... (AGENTS.md section 4 E) before T11; the decisions they change are written in `DESIGN_DEVIATIONS.md`.

**Commit:** `test(screens): side and bottom layout screenshots [step-05c/T10]`

### T11 - Speed measurements and design notes

**Files:** modify `scripts/measure-ui.mjs`, `DESIGN_DEVIATIONS.md`.

**Do this:**

1. In the record written to the JSON file, the step value `05b` becomes `05c`.
2. In the full measurement mode, after Step 05b's measurements (back in the demo folder in Details), add two measurements with the `measure` helper. "Open the toolbar menu" means: dispatch a bubbling, cancelable `contextmenu` event at (300, 110) on `.adp-commandbar`, wait a frame. "Item i of the main menu" is `document.querySelectorAll(".adp-ctxmenu")[0].querySelectorAll("[role=menuitem]")[i]`; "radio j of the submenu" is `document.querySelectorAll(".adp-ctxmenu")[1].querySelectorAll("[role=menuitemradio]")[j]`.

   | Name | Setup | Action | Cleanup |
   |---|---|---|---|
   | `move the toolbar to the left (toolbar menu)` | open the toolbar menu; click item 0 (Toolbar position); wait a frame | click radio 2 (Left) | open the toolbar menu (now on the left bar: dispatch the event on `.adp-commandbar` again), click item 0, wait a frame, click radio 0 (Top) |
   | `apply the Classic preset (toolbar menu)` | open the toolbar menu; click item 2 (Layout preset); wait a frame | click radio 2 (Classic) | open the toolbar menu, click item 2, wait a frame, click radio 0 (Standard) |

3. `DESIGN_DEVIATIONS.md`: add a section dated with the day you write it, titled "Movable toolbars, panels and tabs (Step 05c)", saying in plain words: the Figma file has only the top layout; the side toolbars (200, 168 or 48 px columns), the bottom toolbar, the auto-hide line (6 px), the tab column (220 or 48 px, rows 36 px), the bottom tab row (36 px), the navigation pane on the right and the Details pane at the bottom (200 px) were designed in this step from the existing tokens and approved by the owner on the date of the checkpoint (or with the changes the owner asked for).

**Tests:** none (the script runs in AGENTS.md section 4, C.3 and C.4).

**Commit:** `test(speed): layout measurements and design notes [step-05c/T11]`

## Help pages

### New page `help/en/moving-toolbars-and-panels.md` (exact text)

```markdown
# Moving toolbars and panels

Put the toolbar, the tabs and the panes where they suit you: at the top, at the bottom or on a side. The toolbar setting applies to the Explorer's command bar and to the ribbon of every file tab.

## Move the toolbar

- Right-click an empty part of the command bar, or of a file tab's ribbon, and choose **Toolbar position**: **Top**, **Bottom**, **Left** or **Right**.
- On the left or right, the toolbar becomes a column: each button shows its name, and menus such as **New**, **Sort** and **View** open beside it.
- You can also choose it in **Settings** > **Layout** > **Toolbar position**.

## Choose how the toolbar looks

Right-click the toolbar and choose **Toolbar style**:

- **Icons and labels**: the standard look.
- **Compact**: a smaller toolbar.
- **Icons only**: no names, to save space. Point at a button to see its name. In a column, lists such as **Encoding** move into **More options** (the button with three dots).
- **Hide until pointed at**: the toolbar hides behind a thin line. Point at the line, hold **Alt**, or press **Tab** until you reach the toolbar, and it appears.

## Move the tabs

In **Settings** > **Layout**, choose **Tab bar position**:

- **Top** (standard) or **Bottom**: the tabs sit in a row.
- **Left** or **Right**: the tabs sit in a column, with their names. The button at the top of the column shows only icons, to save space; click it again to show the names. Point at an icon to see the tab's name.

When the tabs aren't at the top, the top of the window shows the name of the open tab.

## Move or hide the panes

In **Settings** > **Layout**:

- **Navigation pane**: **Left**, **Right** or **Hidden**.
- **Details pane**: **Right**, **Bottom** or **Hidden**. **Alt+Shift+P** still shows and hides it.

## Good to know

- Your choices are saved and come back when you start the app again.
- To go back to the standard layout, choose the **Standard** layout preset (see "Layout presets").
- Moving toolbars and panes only changes how the window looks. It never changes your files.

See also: "Layout presets", "The command bar" and "The ribbon".
```

### New page `help/es/moving-toolbars-and-panels.md` (exact text)

```markdown
# Mover barras de herramientas y paneles

Coloca la barra de herramientas, las pestañas y los paneles donde te resulte más cómodo: arriba, abajo o a un lado. La opción de la barra de herramientas se aplica a la barra de comandos del Explorador y a la cinta de opciones de cada pestaña de archivo.

## Mover la barra de herramientas

- Haz clic derecho en una parte vacía de la barra de comandos, o de la cinta de opciones de una pestaña de archivo, y elige **Posición de la barra de herramientas**: **Arriba**, **Abajo**, **Izquierda** o **Derecha**.
- A la izquierda o a la derecha, la barra se convierte en una columna: cada botón muestra su nombre, y los menús como **Nuevo**, **Ordenar** y **Ver** se abren a su lado.
- También puedes elegirla en **Configuración** > **Diseño** > **Posición de la barra de herramientas**.

## Elegir cómo se ve la barra de herramientas

Haz clic derecho en la barra y elige **Estilo de la barra de herramientas**:

- **Iconos y etiquetas**: el aspecto estándar.
- **Compacta**: una barra más pequeña.
- **Solo iconos**: sin nombres, para ahorrar espacio. Señala un botón para ver su nombre. En una columna, las listas como **Codificación** pasan a **Más opciones** (el botón con tres puntos).
- **Ocultar hasta señalarla**: la barra se oculta detrás de una línea fina. Señala la línea, mantén presionada **Alt** o presiona **Tab** hasta llegar a la barra, y aparecerá.

## Mover las pestañas

En **Configuración** > **Diseño**, elige **Posición de la barra de pestañas**:

- **Arriba** (estándar) o **Abajo**: las pestañas quedan en una fila.
- **Izquierda** o **Derecha**: las pestañas quedan en una columna, con sus nombres. El botón de la parte superior de la columna muestra solo los iconos, para ahorrar espacio; haz clic otra vez para ver los nombres. Señala un icono para ver el nombre de la pestaña.

Cuando las pestañas no están arriba, la parte superior de la ventana muestra el nombre de la pestaña abierta.

## Mover u ocultar los paneles

En **Configuración** > **Diseño**:

- **Panel de navegación**: **Izquierda**, **Derecha** u **Oculto**.
- **Panel de detalles**: **Derecha**, **Abajo** u **Oculto**. **Alt+Mayús+P** sigue mostrándolo y ocultándolo.

## Para tener en cuenta

- Tus opciones se guardan y vuelven cuando abres la aplicación de nuevo.
- Para volver al diseño estándar, elige el diseño predefinido **Estándar** (consulta «Diseños predefinidos»).
- Mover barras y paneles solo cambia cómo se ve la ventana. Nunca cambia tus archivos.

Consulta también: «Diseños predefinidos», «La barra de comandos» y «La cinta de opciones».
```

### New page `help/en/layout-presets.md` (exact text)

```markdown
# Layout presets

A layout preset places the toolbar, the tabs and the panes in one step. Use a ready-made one, or save your own.

## Use a ready-made preset

Right-click the toolbar and choose **Layout preset**, or choose one in **Settings** > **Layout** > **Layout preset**:

- **Standard**: the toolbar and the tabs at the top, the navigation pane on the left and the Details pane on the right.
- **Minimal**: a toolbar with icons only and no navigation pane, for more room.
- **Classic**: a compact toolbar at the top and the tabs at the bottom.

## Save your own

1. Place the toolbar, the tabs and the panes the way you like.
2. In **Settings** > **Layout**, click **Save as preset…**.
3. Type a name and click **Save**.

Your presets appear in the **Layout preset** list and under **Your presets**. The trash can button next to a name deletes that preset at once. You can save up to 20.

## Good to know

- When your layout doesn't match any preset, the list shows **Custom**.
- A preset says where the Details pane goes, but doesn't show or hide it: **Alt+Shift+P** does that.
- Presets only change how the window looks. They never change your files.

See also: "Moving toolbars and panels".
```

### New page `help/es/layout-presets.md` (exact text)

```markdown
# Diseños predefinidos

Un diseño predefinido coloca la barra de herramientas, las pestañas y los paneles en un solo paso. Usa uno ya preparado o guarda los tuyos.

## Usar un diseño ya preparado

Haz clic derecho en la barra de herramientas y elige **Diseño predefinido**, o elige uno en **Configuración** > **Diseño** > **Diseño predefinido**:

- **Estándar**: la barra de herramientas y las pestañas arriba, el panel de navegación a la izquierda y el panel de detalles a la derecha.
- **Mínimo**: una barra de herramientas con solo iconos y sin panel de navegación, para tener más espacio.
- **Clásico**: una barra de herramientas compacta arriba y las pestañas abajo.

## Guardar los tuyos

1. Coloca la barra de herramientas, las pestañas y los paneles como prefieras.
2. En **Configuración** > **Diseño**, haz clic en **Guardar como diseño…**.
3. Escribe un nombre y haz clic en **Guardar**.

Tus diseños aparecen en la lista **Diseño predefinido** y en **Tus diseños**. El botón de la papelera junto a un nombre elimina ese diseño al instante. Puedes guardar hasta 20.

## Para tener en cuenta

- Cuando tu diseño no coincide con ninguno, la lista muestra **Personalizado**.
- Un diseño indica dónde va el panel de detalles, pero no lo muestra ni lo oculta: eso lo hace **Alt+Mayús+P**.
- Los diseños solo cambian cómo se ve la ventana. Nunca cambian tus archivos.

Consulta también: «Mover barras de herramientas y paneles».
```

### Changes to existing pages

- `help/en/command-bar.md`: right before its last line ("See also: ..."), add the paragraph: "To move the command bar to the bottom or to a side, or to change its style, right-click an empty part of it (see "Moving toolbars and panels")."
- `help/es/command-bar.md`: right before its last line, add: "Para mover la barra de comandos abajo o a un lado, o para cambiar su estilo, haz clic derecho en una parte vacía de ella (consulta «Mover barras de herramientas y paneles»)."
- `help/en/the-ribbon.md`: right before its last line, add the section "## Moving the ribbon" with the sentence: "Right-click an empty part of the ribbon to move it to the bottom or to a side, or to change its style. The same choice applies to the Explorer's command bar (see "Moving toolbars and panels")."
- `help/es/the-ribbon.md`: right before its last line, add the section "## Mover la cinta de opciones" with: "Haz clic derecho en una parte vacía de la cinta de opciones para moverla abajo o a un lado, o para cambiar su estilo. La misma opción se aplica a la barra de comandos del Explorador (consulta «Mover barras de herramientas y paneles»)."

## Check by hand (the owner, in the packaged app)

No special test files are needed: use any folder with a few files and subfolders, and a text file (for example `%TEMP%\adp-05b` from Step 05b).

1. Right-click an empty part of the command bar: the menu shows **Toolbar position**, **Toolbar style** and **Layout preset**. Move the toolbar to each side: the Explorer's command bar moves; open a text file: its ribbon is on the same side.
2. On a side, the menus **New**, **Sort** and **View** open beside the column; tooltips appear beside the buttons; in **Icons only** on a side, the text file's **Encoding** list is in **More options**.
3. At the bottom, the menus open upward and stay on screen.
4. **Hide until pointed at**: the toolbar becomes a thin line; pointing at it shows it over the files; it hides again after you move away. Holding Alt shows it. Tab reaches its buttons.
5. **Compact** and **Icons only** at the top: the bar gets smaller / loses its names; every button still has a tooltip with its shortcut.
6. Settings > **Layout**: move the tabs to the bottom, the left and the right; in a column, the toggle shows only icons and back; the title of the window shows the open tab's name; tabs still switch, close (also with a middle-click) and the "+" menu works.
7. Move the navigation pane to the right and hide it; put the Details pane at the bottom (Alt+Shift+P still shows and hides it).
8. While a folder is open and scrolled down with an item selected, change any layout value: the folder stays where it was, with the same selection.
9. Presets: choose **Minimal**, **Classic** and **Standard** from the toolbar menu and from Settings: everything changes at once. Change one value: the list shows **Custom**. Save it as "Work", choose Standard, then "Work": the layout comes back. Delete "Work".
10. Close and reopen the app: the layout and the saved presets are still there.
11. Repeat checks 1, 6 and 9 in Spanish and in the dark theme: texts fit in the side columns, colors follow the theme, focus outlines are visible.

## Speed

| Interaction | Tier | How measured |
|---|---|---|
| Move the toolbar to another side | Fast (1 s) | `move the toolbar to the left (toolbar menu)` |
| Apply a layout preset | Fast (1 s) | `apply the Classic preset (toolbar menu)` |
| Show an auto-hide toolbar on hover | Instant (0.1 s) | by hand (check 4) |
| Every existing measurement | as before | not more than 20% slower than step 05b's JSON |

## Screenshots

`24-toolbar-left`, `25-toolbar-bottom-icons`, `26-tabs-left`, `27-panes-moved`, `28-ribbon-right-icons`, `29-classic`, `30-layout-settings` (added in T10), in English light, Spanish dark and the pseudo-locale, in `docs/screenshots/step-05c/`.

## Done when

- [ ] T1 to T11 are committed, each after `GATE PASSED`, and the owner approved the designs at the T10 checkpoint.
- [ ] The toolbar works on all four sides and in all four styles, for the Explorer and for every file tab.
- [ ] Tabs work at the top, at the bottom and in a column on either side (with names or icons only).
- [ ] The navigation pane and the Details pane move and hide as described; changing the layout never resets a folder's scroll or selection.
- [ ] The three presets apply at once; saved presets can be added (up to 20) and deleted; Custom shows when nothing matches.
- [ ] Settings schema 8 loads a schema-7 file without losing anything (Rust test `settings_v7_migrates_to_v8_keeping_language_and_theme`).
- [ ] Every existing test passes unchanged except where T1 says.
- [ ] The speed table rows meet their tiers; the screenshots exist; `DESIGN_DEVIATIONS.md` has the new section; the step report is written.
