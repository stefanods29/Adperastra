# Step 05d: Appearance, built-in themes, Settings page

| | |
|---|---|
| State | guide |
| Difficulty | ★★ |
| Branch | `step-05d-appearance` |
| Tag | `v0.0.13-step05d` |
| Depends on | 05c |
| Written before | P2 was built (written from the 04a, 04b and 04c recipes and the 05a to 05c guides; names from earlier guides are in `plan/guide-ledger.md`) |

This is a **guide** step (AGENTS.md "Steps come in two kinds"): every decision is below, but no code. Write the code exactly as described: the names, files, types, numbers and texts given here, and nothing else. If something you must write is not decided here, stop with `BLOCKED.md` (AGENTS.md section 5).

This step has an **OWNER CHECKPOINT** (task T10): the owner approves the new themes before the last task.

## Goal

The app gets six built-in themes (Adperastra light, the Figma design, stays the default), each with a preview card: three for light mode (Adperastra light, Bright, Paper) and three for dark mode (Adperastra dark, AMOLED black, High contrast). An Appearance section sets the UI scale (75 % to 200 %), the density (compact, comfortable, spacious), the corner radius (square, standard, round) and the animations (full, reduced, off). The Settings page is rebuilt: a search box, a list of sections to jump to, every section with its own help page and a "Reset to default" button, "Reset all settings" with Undo, and export and import of the settings to and from a file of the owner's choice. Every change shows at once and survives a restart.

## Do not do in this step

- No theme editor, no custom themes, no day and night schedule, no accent taken from the wallpaper (Step 10a).
- No keyboard shortcut or toolbar button customization (Step 10b); no date, size or tab options (Step 10c).
- No Windows high-contrast mode detection (`forced-colors`) and no full accessibility settings (Step 10f); the High contrast theme is an ordinary theme here.
- No fonts other than Inter, no font size setting (UI scale covers it).
- Density does not change the icon views' cell sizes (Step 05a's grid sizes stay).
- Export and import cover `settings.json` only (not folder views, sessions or the explorer state).

## Read first

- `plan/conventions.md`, `plan/pitfalls.md` (P-02, P-03, P-16, P-19, P-20, P-25, P-28, P-32), `plan/rules.md` R-SAFE-2, R-SAFE-3, R-SAFE-9, R-SEC-1, R-LANG, R-UI, `plan/design.md` and `plan/design-spec.md` sections 1, 2 and 4.
- Recipes: `plan/recipes/add-settings-field.md`, `plan/recipes/add-tauri-command.md`, `plan/recipes/add-translation-keys.md`, `plan/recipes/add-help-page.md`.
- Code: `themes/light.tokens.json`, `themes/dark.tokens.json`, `scripts/build-tokens.mjs`, `src/__tests__/tokens.test.ts`, `src/styles/global.css`, `src/styles/components.css` (skeleton, nav item and file row rules), `src/styles/settings.css`, `src/styles/views.css` (`.adp-flowlist-item`), `src/App.tsx` (`applyVisual`, the system theme listener, the providers, `HELP_SLUGS`, the `SettingsView` element), `src/views/SettingsView.tsx`, `src/views/settings/*.tsx`, `src/services/settings.ts`, `src/views/explorer/FileList.tsx`, `src/views/explorer/views/ListModeView.tsx`, `src/views/explorer/views/ColumnPane.tsx`, `src/views/explorer/views/viewModes.ts`, `src/views/explorer/views/columnTrail.ts`; in `src-tauri/src/main.rs` the settings part, `window_handle`, `show_classic_menu`, the `setup` closure, `generate_handler!` and the settings tests; `src-tauri/src/shell.rs` (`is_cancelled`, `hwnd_from`), `src-tauri/src/clipboard.rs` (how it initializes COM on a blocking thread).

## Decisions (already made)

- D1. **Themes are token files.** Every file `themes/<id>.tokens.json` is a theme with the same keys as `light.tokens.json`; `scripts/build-tokens.mjs` writes one block per file for `:root[data-theme="<id>"]` and for any element with `data-theme-preview="<id>"` (used by the preview cards). The six themes: `light` (Adperastra light, the Figma values, unchanged), `bright`, `paper` (light scheme); `dark` (Adperastra dark), `amoled`, `highContrast` (dark scheme). Their values are in the "Theme tokens" table. The roadmap's "Light" theme is named **Bright**, because "Light" already names the mode; the roadmap's "one more" is **Paper**.
- D2. **Choosing a theme**: the existing mode (System, Light, Dark) stays; two new settings say which theme each mode uses: `theme.light_theme` (default `light`) and `theme.dark_theme` (default `dark`). System follows Windows' light or dark setting, as today. This also prepares Step 10a's day and night schedule.
- D3. The root element gets `data-theme` (the theme id) and `data-scheme` (`light` or `dark`); `data-scheme` sets the CSS `color-scheme`, so scrollbars and native lists match. The accent setting works with every theme as today (`--adp-accent-current`).
- D4. Fix in the existing dark theme: `text.onAccent` becomes `#000000` (white on `#4CC2FF` is only about 2:1; black is 10:1). A test checks five contrast rules for every theme (table in T2).
- D5. **Appearance** (new settings section `appearance`): UI scale is the webview's page zoom (`WebviewWindow::set_zoom` in Tauri 2.12), applied by Rust at start (no flash) and by a new command when changed; everything scales together, and the classic "Show more options" menu is placed with the scale included. Density changes the spacing tokens and the height of rows (Details rows, List items, Column view rows, Home lists, navigation pane items, skeleton rows). Corner radius overrides the radius tokens. Animations: `full` (the default; Windows' "show fewer animations" setting still applies, as today), `reduced` (no repeating or long animations), `off` (no animations or transitions).
- D6. Virtualized lists read their row height from a new React context (`AppearanceContext`, provided by App); without it they use today's sizes, so existing tests pass unchanged. A density change makes each virtualizer measure again (a new `getItemKey` function).
- D7. **Settings page**: a search box (matches section titles and the labels inside each section, ignoring case and accents, in the app language), a list of sections on the left that scrolls to a section, and the sections in this order: General, Appearance, Theme, Layout, Views, Opening files. The language and pasted-image rows move into a General section; the theme mode and accent rows move into a Theme section with the theme cards. Every section has its "?" help button (as today) and a "Reset to default" button below it.
- D8. **Resetting**: a section's reset sets only that section's settings to their defaults (General keeps the language; Layout keeps the saved presets; Views resets only the view mode and Column view settings). "Reset all settings" asks first, then resets everything except the language and the saved layout presets. After a reset or an import, a notice offers **Undo** (back to the settings from just before) until it is dismissed or the page is left.
- D9. **Export and import** use the Windows file dialogs (`IFileSaveDialog`, `IFileOpenDialog` from the `windows` crate already in the app; no new features). Export writes the current settings as pretty JSON; when the chosen file exists, Windows asks first, and the old file goes to the Recycle Bin before the new one is written (temporary file, then rename; R-SAFE-2, R-SAFE-3). Import reads at most 1 MB, accepts settings files of schema 1 to the current one (older ones are migrated, newer ones are refused), asks to confirm, then applies them like any other change (with Undo).
- D10. Settings schema 9 (table below). Rust validates the new fields; TypeScript normalizes them.

## Data shapes

### Settings (schema 9)

Section `theme`, two new fields:

| Field | Rust type | TypeScript type | Default | Allowed | Rust `validate()` |
|---|---|---|---|---|---|
| `light_theme` | `String` | `LightThemeId` | `"light"` | `light`, `bright`, `paper` | must be one of them |
| `dark_theme` | `String` | `DarkThemeId` | `"dark"` | `dark`, `amoled`, `highContrast` | must be one of them |

New section `appearance` (Rust `AppearanceSettings`, TypeScript `AppearanceSettings`):

| Field | Rust type | TypeScript type | Default | Allowed | Rust `validate()` |
|---|---|---|---|---|---|
| `ui_scale` | `u32` | `UiScale` (number) | 100 | 75, 90, 100, 110, 125, 150, 175, 200 | must be in `UI_SCALES` |
| `density` | `String` | `Density` | `"comfortable"` | `compact`, `comfortable`, `spacious` | must be one of them |
| `corner_radius` | `String` | `CornerRadius` | `"standard"` | `square`, `standard`, `round` | must be one of them |
| `animations` | `String` | `AnimationLevel` | `"full"` | `full`, `reduced`, `off` | must be one of them |

TypeScript normalization: each choice with `pick` (default when invalid); `light_theme` and `dark_theme` with `pick` over their own lists (a dark id in `light_theme` gives `light`); `ui_scale`: a number equal to one of `UI_SCALES`, else 100.

### New TypeScript types and constants (`src/services/settings.ts`)

| Name | Shape |
|---|---|
| `LightThemeId`, `DarkThemeId`, `ThemeId` | `"light" \| "bright" \| "paper"`; `"dark" \| "amoled" \| "highContrast"`; either |
| `LIGHT_THEME_IDS`, `DARK_THEME_IDS` | read-only arrays in that order |
| `UiScale`, `UI_SCALES` | number; read-only array `[75, 90, 100, 110, 125, 150, 175, 200]` |
| `Density`, `DENSITIES` | `"compact" \| "comfortable" \| "spacious"`; array in that order |
| `CornerRadius`, `CORNER_RADII` | `"square" \| "standard" \| "round"`; array in that order |
| `AnimationLevel`, `ANIMATION_LEVELS` | `"full" \| "reduced" \| "off"`; array in that order |
| `AppearanceSettings` | `ui_scale`, `density`, `corner_radius`, `animations` |
| `ThemeSettings` (changed) | gets `light_theme`, `dark_theme` |
| `AppSettings.appearance` | `AppearanceSettings` (new section) |

### Themes (`src/appearance/themes.ts`)

| Id | Label key | Scheme |
|---|---|---|
| `light` | `themes.light` | light |
| `bright` | `themes.bright` | light |
| `paper` | `themes.paper` | light |
| `dark` | `themes.dark` | dark |
| `amoled` | `themes.amoled` | dark |
| `highContrast` | `themes.highContrast` | dark |

### Theme tokens (the four new files and the one change to `dark`)

Every new file has exactly the keys of `light.tokens.json` (after Steps 04b and 04c: `color`, `font`, `radius`, `shadow`, `space`, `syntax`), plus one `_note` key at the top with the text given. `font`, `radius` and `space` are copied from `light.tokens.json`; `shadow` from `light.tokens.json` for `bright` and `paper`, from `dark.tokens.json` for `amoled` and `highContrast`. Where a cell says "= light" or "= dark", copy that file's value.

`_note` texts: `bright`: "Bright: neutral light theme with crisper borders (Step 05d)."; `paper`: "Paper: warm, low-glare light theme (Step 05d)."; `amoled`: "AMOLED black: pure black surfaces for OLED screens (Step 05d)."; `highContrast`: "High contrast: dark theme with every text at 7:1 or more (Step 05d)."

| Token | `bright` | `paper` | `amoled` | `highContrast` |
|---|---|---|---|---|
| `color.surface.window` | #FFFFFF | #FBF7EF | #000000 | #000000 |
| `color.surface.chrome` | #F9F9F9 | #F1EADC | #0A0A0A | #000000 |
| `color.surface.pane` | #FFFFFF | #F7F1E5 | #050505 | #000000 |
| `color.surface.sidebar` | #F9F9F9 | #F4EDE0 | #080808 | #000000 |
| `color.surface.selected` | #EDEDED | #E8DFCC | #262626 | #2B2B2B |
| `color.surface.tabInactive` | #EBEBEB | #E6DCC8 | #1A1A1A | #1A1A1A |
| `color.surface.header` | #F5F5F5 | #EFE7D7 | #111111 | #0D0D0D |
| `color.surface.segmentTrack` | #F0F0F0 | #EAE1CF | #1A1A1A | #1A1A1A |
| `color.surface.canvasDoc` | #F5F5F5 | #EFE8DA | #000000 | #000000 |
| `color.surface.canvasMedia` | #F3F3F3 | #ECE4D4 | #000000 | #000000 |
| `color.surface.selectedRow` | #CCE4F7 | #F2E3C2 | #0E3A5E | #00385C |
| `color.text.primary` | #1B1B1B | #2B2418 | #F5F5F5 | #FFFFFF |
| `color.text.secondary` | #5C5C5C | #5E5242 | #B3B3B3 | #E6E6E6 |
| `color.text.tertiary` | #767676 | #857860 | #808080 | #A6A6A6 |
| `color.text.bodyMuted` | #2E2E2E | #3A3125 | #E0E0E0 | #FFFFFF |
| `color.text.onAccent` | #FFFFFF | #FFFFFF | #000000 | #000000 |
| `color.border.default` | #E0E0E0 | #E3D9C6 | #262626 | #8C8C8C |
| `color.border.subtle` | #DADADA | #DCD1BC | #1F1F1F | #6E6E6E |
| `color.border.panel` | #E5E5E5 | #E8DFCF | #1A1A1A | #8C8C8C |
| `color.border.input` | #8A8A8A | #9A8A6E | #5C5C5C | #FFFFFF |
| `color.border.chip` | #C4C4C4 | #CFC3AC | #3A3A3A | #BFBFBF |
| `color.accent.explorer` | #005FB8 | #8A5A00 | #4CC2FF | #1AEBFF |
| `color.accent.excel` | = light | = light | = dark | #3CCB7F |
| `color.accent.word` | = light | = light | = dark | #6CB8FF |
| `color.accent.pdf` | = light | = light | = dark | #FF6B6B |
| `color.accent.image` | = light | = light | = dark | #4FE0E8 |
| `color.accent.powerpoint` | = light | = light | = dark | #FF8F6B |
| `color.accent.group` | = light | = light | = dark | #C3A6FF |
| `color.accentDark.excel` | = light | = light | = dark | #3CCB7F |
| `color.accentDark.word` | = light | = light | = dark | #6CB8FF |
| `color.accentLight.explorer` | #CCE4F7 | #F2E3C2 | rgba(76,194,255,0.18) | rgba(26,235,255,0.25) |
| `color.accentLight.excel` | = light | = light | = dark | rgba(60,203,127,0.25) |
| `color.accentLight.word` | = light | = light | = dark | rgba(108,184,255,0.25) |
| `color.accentLight.image` | = light | = light | = dark | rgba(79,224,232,0.25) |
| `color.accentLight.group` | = light | = light | = dark | rgba(195,166,255,0.25) |
| `color.status.caution` | = light | = light | = dark | #FFFF00 |
| `color.status.cautionBackground` | = light | = light | = dark | #2E2A00 |
| `syntax.*` (all 12 and `_note`) | = light | = light | = dark | below |

`highContrast` syntax: `_note` "Code colors with strong contrast on black (Step 05d)."; `keyword` #FF9492; `string` #ADDCFF; `number` #91CBFF; `comment` #BDC4CC; `function` #DBB7FF; `type` #FFB757; `tag` #72F088; `attribute` #91CBFF; `property` #91CBFF; `invalid` #FFB1AF; `match` rgba(255,255,0,0.4); `matchSelected` rgba(26,235,255,0.5).

Change in `dark.tokens.json`: `color.text.onAccent` becomes `#000000`.

### Density sizes (pixels)

| Density | Spacing tokens `--adp-space-0` to `--adp-space-10` | Row (`--adp-row-height`) | List item (`--adp-list-item-height`) | Navigation item (`--adp-nav-item-height`) |
|---|---|---|---|---|
| `compact` | 2, 3, 4, 6, 8, 9, 10, 12, 14, 16, 18 | 24 | 20 | 30 |
| `comfortable` | the theme's own values (2, 4, 6, 8, 10, 12, 14, 16, 18, 22, 25) | 28 | 24 | 36 |
| `spacious` | 3, 5, 8, 10, 12, 15, 18, 20, 22, 26, 30 | 36 | 30 | 44 |

Corner radius: `square`: `--adp-radius-xs` to `--adp-radius-xl` are 0 (`pill` and `round` stay); `standard`: the theme's values; `round`: xs 3, sm 6, md 8, lg 12, xl 14.

### Tauri commands

| Command (module) | Arguments | Returns | Errors |
|---|---|---|---|
| `appearance_set_zoom` (`src-tauri/src/appearance.rs`) | `scale: u32` | nothing | `appearance.bad_scale` (not in `UI_SCALES`), `appearance.other` (Tauri refused) |
| `settings_export` (`src-tauri/src/settings_file.rs`) | `title: String`, `file_name: String`, `filter_name: String` | `Option<String>`: the saved path, or none when the dialog was cancelled | `settingsFile.bad_request`, `settingsFile.bad_extension`, `settingsFile.recycle_failed`, `settingsFile.write_failed`, `settingsFile.other` |
| `settings_import` (`src-tauri/src/settings_file.rs`) | `title: String`, `filter_name: String` | `Option<Settings>`: the migrated settings (not saved yet), or none when cancelled | `settingsFile.bad_request`, `settingsFile.too_large`, `settingsFile.invalid`, `settingsFile.newer`, `settingsFile.other` |

### Settings sections (`src/views/settings/sections.ts`)

| Id | Title key | Help slug | Search keywords (translation keys, besides the title) |
|---|---|---|---|
| `general` | `settings.general` | `changing-language-and-theme` | `settings.language`, `settings.languageEnglish`, `settings.languageSpanish`, `settings.pastedImages` |
| `appearance` | `settings.appearance` | `themes-and-appearance` | `settings.uiScale`, `settings.density`, `settings.cornerRadius`, `settings.animations` |
| `theme` | `settings.theme` | `themes-and-appearance` | `settings.lightTheme`, `settings.darkTheme`, `settings.accent`, `settings.customColor`, and the six `themes.*` keys |
| `layout` | `settings.layout` | `moving-toolbars-and-panels` | `layout.toolbarPosition`, `layout.toolbarStyle`, `layout.preset`, `settings.tabBarPosition`, `settings.navPane`, `settings.detailsPanePlace` |
| `views` | `settings.views` | `view-modes` | `settings.viewsDefault`, `settings.viewsRemember`, `settings.viewsMenu`, `settings.viewsColumns`, `settings.columnWidth`, `settings.columnPreview` |
| `openingFiles` | `settings.openingFiles` | `default-apps` | `settings.protectedView`, `settings.defaultApps` |

### Translation keys (all new keys of this step)

| Key | English | Spanish |
|---|---|---|
| `themes.light` | Adperastra light | Adperastra claro |
| `themes.bright` | Bright | Luminoso |
| `themes.paper` | Paper | Papel |
| `themes.dark` | Adperastra dark | Adperastra oscuro |
| `themes.amoled` | AMOLED black | Negro AMOLED |
| `themes.highContrast` | High contrast | Contraste alto |
| `settings.general` | General | General |
| `settings.appearance` | Appearance | Apariencia |
| `settings.lightTheme` | Theme in light mode | Tema en modo claro |
| `settings.darkTheme` | Theme in dark mode | Tema en modo oscuro |
| `settings.uiScale` | UI scale | Escala de la interfaz |
| `settings.uiScaleValue` | {value}% | {value} % |
| `settings.density` | Density | Densidad |
| `settings.densityCompact` | Compact | Compacta |
| `settings.densityComfortable` | Comfortable | Cómoda |
| `settings.densitySpacious` | Spacious | Amplia |
| `settings.cornerRadius` | Corner radius | Radio de las esquinas |
| `settings.radiusSquare` | Square | Cuadradas |
| `settings.radiusStandard` | Standard | Estándar |
| `settings.radiusRound` | Round | Redondeadas |
| `settings.animations` | Animations | Animaciones |
| `settings.animationsFull` | Full | Completas |
| `settings.animationsReduced` | Reduced | Reducidas |
| `settings.animationsOff` | Off | Desactivadas |
| `settings.animationsNote` | When Windows is set to show fewer animations, the app always follows it. | Cuando Windows está configurado para mostrar menos animaciones, la aplicación siempre lo respeta. |
| `settings.search` | Find a setting | Buscar una opción |
| `settings.noResults` | No settings match your search. | Ninguna opción coincide con tu búsqueda. |
| `settings.sections` | Sections | Secciones |
| `settings.resetSection` | Reset to default | Restablecer valores predeterminados |
| `settings.resetAll` | Reset all settings… | Restablecer toda la configuración… |
| `settings.resetAllTitle` | Reset all settings? | ¿Restablecer toda la configuración? |
| `settings.resetAllBody` | Every setting goes back to its default, except your language and your saved layout presets. Your files are not changed. | Todas las opciones vuelven a sus valores predeterminados, excepto el idioma y tus diseños guardados. Tus archivos no cambian. |
| `settings.resetConfirm` | Reset | Restablecer |
| `settings.sectionWasReset` | {name} is back to its default settings. | {name} volvió a sus valores predeterminados. |
| `settings.allWereReset` | All settings are back to their defaults. | Toda la configuración volvió a sus valores predeterminados. |
| `settings.backup` | Back up and restore | Copia de seguridad y restauración |
| `settings.export` | Export settings… | Exportar la configuración… |
| `settings.import` | Import settings… | Importar la configuración… |
| `settings.exportTitle` | Export settings | Exportar la configuración |
| `settings.importTitle` | Import settings | Importar la configuración |
| `settings.exportFileName` | Adperastra settings {date}.json | Configuración de Adperastra {date}.json |
| `settings.fileFilter` | Settings files | Archivos de configuración |
| `settings.exported` | Settings exported to {path}. | Se exportó la configuración a {path}. |
| `settings.importConfirmTitle` | Replace your settings? | ¿Reemplazar tu configuración? |
| `settings.importConfirmBody` | The settings in the file will replace your current ones. You can undo this right after. | La configuración del archivo reemplazará la actual. Puedes deshacerlo justo después. |
| `settings.importConfirm` | Import | Importar |
| `settings.imported` | Settings imported. | Se importó la configuración. |
| `errors.appearance.other` | Couldn't change the scale. Try again. | No se pudo cambiar la escala. Vuelve a intentarlo. |
| `errors.appearance.bad_scale` | That scale isn't available. | Esa escala no está disponible. |
| `errors.settingsFile.other` | Couldn't use the settings file. Try again. | No se pudo usar el archivo de configuración. Vuelve a intentarlo. |
| `errors.settingsFile.bad_request` | That file name can't be used. | Ese nombre de archivo no se puede usar. |
| `errors.settingsFile.bad_extension` | Settings files end in .json. | Los archivos de configuración terminan en .json. |
| `errors.settingsFile.recycle_failed` | The old file couldn't be moved to the Recycle Bin, so nothing was saved. | No se pudo mover el archivo anterior a la Papelera de reciclaje, así que no se guardó nada. |
| `errors.settingsFile.write_failed` | Couldn't save the settings file. | No se pudo guardar el archivo de configuración. |
| `errors.settingsFile.too_large` | This file is too large to be a settings file. | Este archivo es demasiado grande para ser un archivo de configuración. |
| `errors.settingsFile.invalid` | This file isn't an Adperastra settings file. | Este archivo no es un archivo de configuración de Adperastra. |
| `errors.settingsFile.newer` | This file comes from a newer version of Adperastra. Update the app to use it. | Este archivo es de una versión más reciente de Adperastra. Actualiza la aplicación para usarlo. |

Existing keys this step reuses: `settings.title`, `settings.language`, `settings.languageEnglish`, `settings.languageSpanish`, `settings.languagePseudo`, `settings.theme`, `settings.themeSystem`, `settings.themeLight`, `settings.themeDark`, `settings.accent`, `settings.accentDesign`, `settings.accentWindows`, `settings.accentCustom`, `settings.customColor`, `settings.pastedImages`, `settings.formatPng`, `settings.formatJpg`, `settings.persistNote`, `common.undo`, `common.dismiss`, `common.cancel`. After editing `en.json`, run `npm run i18n:pseudo`.

## Tasks

After changing Rust code, run `cargo fmt --all` before the gate.

### T1 - Settings: theme choice and appearance (schema 9)

**Files:** modify `src-tauri/src/main.rs`, `src/services/settings.ts`, `src/__tests__/settings.test.ts`, `scripts/measure-ui.ps1`, and any test file that builds an `AppSettings` or `ThemeSettings` object literally (the compiler names them; they get the new fields from `defaultSettings()`).

This is `plan/recipes/add-settings-field.md` with N = 9.

**Do this (Rust):**

1. `CURRENT_SCHEMA` becomes 9.
2. `ThemeSettings` gets `light_theme` (serde default from a new `default_light_theme`, "light") and `dark_theme` (`default_dark_theme`, "dark"), and both in its `Default`.
3. A public constant `UI_SCALES` (`[u32; 8]`, the eight values) and default functions `default_ui_scale` (100), `default_density` ("comfortable"), `default_corner_radius` ("standard"), `default_animations` ("full"). A public struct `AppearanceSettings` (same derives as `ExplorerViewSettings`; doc comment "UI scale, density, corner radius and animations (schema 9, Step 05d).") with the four fields and those serde defaults, and its `Default`. `Settings` gets `appearance` (serde default) after `layout`, also in `impl Default for Settings` and in the struct literal of `migrate_v1`.
4. `validate`: `light_theme` and `dark_theme` must be in their lists; `ui_scale` in `UI_SCALES`; `density`, `corner_radius`, `animations` in theirs (one check each, same style).
5. `migrate`: the arm for 4 to 7 also takes 8.
6. Tests: `settings_defaults` expects 9; `settings_v7_migrates_to_v8_keeping_language_and_theme` expects `CURRENT_SCHEMA`. New: `settings_v8_migrates_to_v9_keeping_language_and_theme` (a schema-8 value with language `es`, theme mode `dark` and accent source `custom` with `#FF00AA`, `layout.toolbar_position` `left`, explorer `view_mode` `tiles`: after `migrate`, schema 9, all of these kept, `light_theme` `light`, `dark_theme` `dark`, `appearance` equals `AppearanceSettings::default()`), and `settings_validate_rejects_bad_appearance` (from the defaults, `validate` fails for `light_theme` `dark`, `dark_theme` `paper`, `ui_scale` 80, `ui_scale` 0, `density` `tiny`, `corner_radius` `oval`, `animations` `some`; and passes for `light_theme` `paper`, `dark_theme` `highContrast`, `ui_scale` 75 and 200, `density` `spacious`, `corner_radius` `square`, `animations` `off`).

**Do this (TypeScript):** `SETTINGS_SCHEMA_VERSION` becomes 9; add the types and constants of "New TypeScript types and constants"; the defaults; the normalization rules.

**Do this (`scripts/measure-ui.ps1`):** schema 9; `theme` gets `light_theme = "light"` and `dark_theme = "dark"`; a new `appearance` part with the four defaults. Keep the Windows line endings (P-32).

**Tests** (`src/__tests__/settings.test.ts`): in "keeps valid Explorer view options and repairs invalid ones" the schema becomes 9 and the expected object gets the new theme fields and the `appearance` section. New test "normalizes the theme choice and appearance (schema 9)":

| Input | Expected |
|---|---|
| `{}` | `light_theme` `light`, `dark_theme` `dark`, `appearance` defaults |
| theme `light_theme` `paper`, `dark_theme` `amoled` | kept |
| theme `light_theme` `dark`; `dark_theme` `bright` | `light`; `dark` |
| appearance `ui_scale` 125; 80; `"100"` | 125; 100; 100 |
| appearance `density` `spacious`; `huge` | `spacious`; `comfortable` |
| appearance `corner_radius` `round`; `animations` `off` | kept |
| appearance `animations` `none` | `full` |

**Commit:** `feat(settings): theme choice and appearance (schema 9) [step-05d/T1]`

### T2 - The six themes

**Files:** create `themes/bright.tokens.json`, `themes/paper.tokens.json`, `themes/amoled.tokens.json`, `themes/highContrast.tokens.json`, `src/appearance/themes.ts`, `src/appearance/contrast.ts`, `src/__tests__/themes.test.ts`; modify `themes/dark.tokens.json`, `scripts/build-tokens.mjs`, `src/__tests__/tokens.test.ts`, `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`); `src/styles/tokens.css` is rewritten by `npm run tokens` (never by hand).

**Translation keys:** the six `themes.*` keys.

**Do this:**

1. Create the four token files and change `dark.tokens.json` exactly as "Theme tokens" says (key order as in `light.tokens.json`).
2. `build-tokens.mjs`: read every file in `themes/` whose name ends in `.tokens.json`, sorted by name; the theme id is the name without `.tokens.json`; for each, write one block whose selector is `:root[data-theme="<id>"]` followed by a comma and `[data-theme-preview="<id>"]`, with the same flattening and sorting as today. Update the header comment ("Selectors: one block per theme file ...") accordingly. Run `npm run tokens`.
3. `src/appearance/themes.ts` (module doc comment "Built-in themes (Step 05d). The colors live in themes/<id>.tokens.json."): the type `ThemeScheme` (`"light"` or `"dark"`), `THEMES` (read-only list of `{ id: ThemeId; labelKey: string; scheme: ThemeScheme }` in the order of the "Themes" table), and the functions `themeScheme(id: ThemeId)` returning its scheme, and `resolveThemeId(theme: ThemeSettings, systemDark: boolean)` returning `ThemeId`: mode `light` gives `light_theme`, mode `dark` gives `dark_theme`, mode `system` gives `dark_theme` when `systemDark` is true, else `light_theme`.
4. `src/appearance/contrast.ts` (doc comment "WCAG contrast ratio of two #RRGGBB colors (Step 05d). Pure."): `relativeLuminance(hex: string)` (each channel `c = value / 255`, then `c / 12.92` when `c <= 0.03928`, else `((c + 0.055) / 1.055) ^ 2.4`; luminance = `0.2126 R + 0.7152 G + 0.0722 B`) and `contrastRatio(a: string, b: string)` = `(lighter + 0.05) / (darker + 0.05)`.

**Tests:**

`src/__tests__/tokens.test.ts`: keep the three existing tests unchanged; add:
- "every theme has the same tokens as the light theme": for each of the four new files and `dark`, the sorted list of flattened keys (skipping keys that start with `_`) equals `light`'s.
- "the dark theme writes black on its accent": `dark.color.text.onAccent` is `#000000`.

`src/__tests__/themes.test.ts`:

| Test | Input | Expected |
|---|---|---|
| "contrastRatio follows WCAG" | (`#000000`, `#FFFFFF`); (`#FFFFFF`, `#FFFFFF`); (`#777777`, `#FFFFFF`) | 21; 1; between 4.47 and 4.49 |
| "every theme is readable" | for each of the six token files (imported as JSON) | `contrastRatio(text.primary, surface.window)` ≥ 7; `(text.secondary, surface.window)` ≥ 4.5; `(text.primary, surface.selectedRow)` ≥ 4.5; `(text.onAccent, accent.explorer)` ≥ 4.5; `(accent.explorer, surface.window)` ≥ 3 |
| "high contrast is high" | `highContrast` | `(text.secondary, surface.window)` ≥ 7 |
| "resolveThemeId follows the mode" | mode `light` with `paper`/`amoled`; mode `dark` with the same; mode `system` with systemDark true, then false | `paper`; `amoled`; `amoled`; `paper` |
| "THEMES lists three themes per scheme" | | 6 entries; ids in table order; three with scheme `light` |

(The six palettes were checked when this guide was written: the lowest values are about 6.2 for secondary text in `light`, 8.3 for selected rows in `dark`, 5.7 for text on the accent in `light`, and 5.6 for the accent on the window in `paper`.)

**Commit:** `feat(themes): six built-in themes with contrast checks [step-05d/T2]`

### T3 - Apply the theme and the appearance

**Files:** create `src/appearance/applyAppearance.ts`, `src/styles/appearance.css`, `src/__tests__/applyAppearance.test.ts`; modify `src/App.tsx`, `src/main.tsx` (import `./styles/appearance.css` right after `./styles/tokens.css`), `src/styles/global.css`.

**Do this (`applyAppearance.ts`):** module doc comment "Puts the theme and appearance on the root element (Step 05d)." Export `applyThemeAttributes(root: HTMLElement, theme: ThemeSettings, systemDark: boolean)` (sets `data-theme` to `resolveThemeId(theme, systemDark)` and `data-scheme` to its scheme) and `applyAppearanceAttributes(root: HTMLElement, appearance: AppearanceSettings)` (sets `data-density`, `data-radius` (from `corner_radius`) and `data-motion` (from `animations`)).

**Do this (`App.tsx`, `applyVisual`):** replace the line that works out `resolved` and sets `dataset.theme` with `applyThemeAttributes(document.documentElement, next.theme, <the same matchMedia "(prefers-color-scheme: dark)" check>)`, and call `applyAppearanceAttributes(document.documentElement, next.appearance)` right after. The system theme listener effect stays as it is (it already calls `applyVisual` when the mode is `system`).

**Do this (`appearance.css`):** a comment line "Appearance: scheme, density, corner radius, animations (Step 05d). Values from plan/steps/step-05d.md.", then:

| Selector | What it sets |
|---|---|
| `:root` | `--adp-row-height` 28 px, `--adp-list-item-height` 24 px, `--adp-nav-item-height` 36 px |
| `:root[data-scheme="light"]` / `:root[data-scheme="dark"]` | `color-scheme` light / dark |
| `:root[data-density="compact"]` | the compact spacing tokens and sizes of "Density sizes" |
| `:root[data-density="spacious"]` | the spacious spacing tokens and sizes |
| `:root[data-radius="square"]` | `--adp-radius-xs` to `--adp-radius-xl` 0 |
| `:root[data-radius="round"]` | xs 3 px, sm 6 px, md 8 px, lg 12 px, xl 14 px |
| every element and its `::before` and `::after` under `:root[data-motion="reduced"]` | animation duration 0.01 ms and iteration count 1, both `!important` (transitions stay) |
| the same under `:root[data-motion="off"]` | the same, plus no transition (`!important`) |

This file is imported after `tokens.css`, so its `:root[...]` rules win over the theme blocks of equal weight.

**Do this (`global.css`):** the `:focus-visible` outline uses `--adp-accent-current` instead of `--adp-accent-explorer` (the accent setting and every theme then apply to focus outlines). Nothing else changes.

**Tests** (`src/__tests__/applyAppearance.test.ts`, on a fresh `div` each time):

| Test | Input | Expected attributes |
|---|---|---|
| "theme attributes follow the mode" | theme mode `dark`, `dark_theme` `highContrast`; mode `system` with `light_theme` `paper` and systemDark false | `data-theme` `highContrast`, `data-scheme` `dark`; `paper`, `light` |
| "appearance attributes" | density `compact`, corner radius `round`, animations `off` | `data-density` `compact`, `data-radius` `round`, `data-motion` `off` |

**Commit:** `feat(appearance): apply the theme, density, corners and animations [step-05d/T3]`

### T4 - UI scale

**Files:** create `src-tauri/src/appearance.rs`, `src/services/appearance.ts`; modify `src-tauri/src/main.rs`, `src-tauri/isolation/index.html`, `src/App.tsx`, `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`).

**Translation keys:** the two `errors.appearance.*` keys.

**Do this (Rust, `appearance.rs`):** module doc comment "UI scale (Step 05d): the webview's page zoom." Functions:

| Function | Parameters | Returns | Behavior |
|---|---|---|---|
| `is_ui_scale` (public) | `scale: u32` | bool | `crate::UI_SCALES` contains it |
| `zoom_factor` (public) | `scale: u32` | `f64` | `scale / 100` |
| `screen_point` (public) | `origin: (i32, i32)`, `css: (i32, i32)`, `dpi_scale: f64`, `ui_scale: u32` | `(i32, i32)` | each coordinate: `origin + round(css × dpi_scale × zoom_factor(ui_scale))` |
| `apply_startup_zoom` (public) | `window: &WebviewWindow`, `scale: u32` | nothing | when `is_ui_scale(scale)` and the scale is not 100, `window.set_zoom(zoom_factor(scale))`, ignoring an error |
| `appearance_set_zoom` (command, not async: no disk work) | `window`, `scale: u32` | `Result<(), String>` | `ensure_main`; `appearance.bad_scale` unless `is_ui_scale`; `window.set_zoom(zoom_factor(scale))`, an error gives `appearance.other` |

Tests at the bottom of the module: `ui_scales_are_the_listed_percentages` (100 and 75 are scales, 80 and 0 are not; `zoom_factor(125)` is 1.25); `screen_point_includes_the_ui_scale` (origin (100, 200), css (10, 20), dpi 1.5: with scale 100 gives (115, 230); with 200 gives (130, 260)).

**Do this (`main.rs`):**
1. Declare `mod appearance;`; register `appearance::appearance_set_zoom` in `generate_handler!` and add `'appearance_set_zoom'` to `ALLOWED` in `src-tauri/isolation/index.html`.
2. In the `setup` closure, inside the existing block that has the main window: read `ui_scale` from the managed `AppState`'s settings (lock with `map_err`/`if let Ok`, copy the number, release the lock) and call `appearance::apply_startup_zoom`.
3. `show_classic_menu` gets the parameter `state: State<'_, AppState>` (after `window`; the TypeScript call does not change, Tauri fills it), reads `ui_scale` from the settings the same way, and computes the request's `x` and `y` with `appearance::screen_point((origin.x, origin.y), (x, y), scale, ui_scale)` instead of the inline formula.

**Do this (TypeScript):** `src/services/appearance.ts` exports `setUiZoom(scale: number)`, async, which does nothing outside Tauri and otherwise invokes `appearance_set_zoom` with `{ scale }`. In `App.tsx`'s `applyVisual`, after `applyAppearanceAttributes`, call `setUiZoom(next.appearance.ui_scale)` and ignore an error.

**Traps:**
- The page zoom also changes `window.devicePixelRatio`, so the snap-layout rectangle (`set_maximize_rect`) and drops from other apps stay correct without changes; only the classic menu needed the fix.
- Never use the CSS `zoom` property for the UI scale: element positions and mouse coordinates would disagree.

**Commit:** `feat(appearance): UI scale through the webview zoom [step-05d/T4]`

### T5 - Density in lists

**Files:** create `src/appearance/density.ts`, `src/__tests__/density.test.tsx`; modify `src/App.tsx`, `src/views/explorer/FileList.tsx`, `src/views/explorer/views/ListModeView.tsx`, `src/views/explorer/views/ColumnPane.tsx`, `src/styles/components.css`, `src/styles/views.css`.

**Do this (`density.ts`):** module doc comment "Row sizes for the density setting (Step 05d)." Export `ROW_SIZES` (a record from `Density` to `{ row: number; listItem: number }`: compact 24/20, comfortable 28/24, spacious 36/30), the React context `AppearanceContext` (a `Density`, default `comfortable`) and the hook `useRowSizes()` returning `ROW_SIZES` of the context's value.

**Do this (`App.tsx`):** wrap what `LayoutContext.Provider` holds (Step 05c) in `AppearanceContext.Provider` with `settings.appearance.density`.

**Do this (lists):**
- `FileList.tsx`: `const { row: rowHeight } = useRowSizes()`; every use of `ROW_HEIGHT` (the estimated size, the row style height, the page size in `moveTarget`) uses `rowHeight`; remove the constant. Add `getItemKey` to the virtualizer: a `useCallback` returning the index, whose only dependency is `rowHeight` (a new function makes the virtualizer measure again when the density changes). `HEADER_HEIGHT` stays.
- `ListModeView.tsx`: the item height used for "rows per column" and for the items comes from `useRowSizes().listItem` instead of `LIST_ITEM_HEIGHT` (the constant stays in `viewModes.ts` for other users).
- `ColumnPane.tsx`: the estimated size, the row height and the page size use `useRowSizes().row` instead of `COLUMN_ROW_HEIGHT`; add the same `getItemKey` as in `FileList`.

**Do this (CSS):** `components.css`: `.adp-file-row--static` and `.adp-skeleton-row` use `var(--adp-row-height)` for their height; `.adp-nav-item` and `.adp-nav-drive` get a minimum height of `var(--adp-nav-item-height)`. `views.css`: `.adp-flowlist-item` uses `var(--adp-list-item-height)`.

**Tests** (`src/__tests__/density.test.tsx`; the virtualizer mock from `fileList.test.tsx`, which multiplies by the estimated size):

| Test | Steps | Expected |
|---|---|---|
| "row sizes per density" | `ROW_SIZES` | compact 24/20, comfortable 28/24, spacious 36/30 |
| "Details rows follow the density" | render `FileList` (the props of `fileList.test.tsx`) inside `AppearanceContext.Provider` with `spacious` | the second row's `transform` is `translateY(36px)` and its height is 36 px |
| "without a provider rows keep 28 px" | the same without a provider | `translateY(28px)` and 28 px |

`fileList.test.tsx`, `listModeView.test.tsx` and `columnPane.test.tsx` pass unchanged.

**Commit:** `feat(appearance): density sets the height of list rows [step-05d/T5]`

### T6 - General, Theme and Appearance sections

**Files:** create `src/views/settings/GeneralSettings.tsx`, `src/views/settings/ThemeSettings.tsx`, `src/views/settings/AppearanceSettings.tsx`, `src/__tests__/themeSettings.test.tsx`, `src/__tests__/appearanceSettings.test.tsx`; modify `src/views/SettingsView.tsx`, `src/styles/settings.css`, `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`).

**Translation keys:** `settings.general`, `settings.appearance`, `settings.lightTheme`, `settings.darkTheme`, `settings.uiScale`, `settings.uiScaleValue`, the `settings.density*`, `settings.radius*` and `settings.animations*` keys, `settings.cornerRadius`.

**Do this:** each component is built like `ViewsSettings` (a `section` with class `adp-settings-section` labelled by its `h3`, a header `div.adp-view-header` with the `h3` (class `adp-heading`) and a `HelpButton` with the section's slug from the "Settings sections" table), and takes `settings` (`AppSettings`), `onApply` (taking `AppSettings`) and `onOpenHelp` (taking a slug).

1. `GeneralSettings` (heading `settings.general`, `h3` id `adp-general-title`): the language row and the pasted-images row, moved from `SettingsView.tsx` unchanged (same buttons, keys and behavior).
2. `ThemeSettings` (heading `settings.theme`, id `adp-theme-title`):
   - The mode row moved from `SettingsView.tsx` (System, Light, Dark buttons); each button also gets `data-theme-mode` = its mode id.
   - Row `settings.lightTheme`: a `div` with class `adp-theme-cards` holding one card per light-scheme theme (`THEMES` order); row `settings.darkTheme`: the same for the dark-scheme themes. A card is a `button` with class `adp-theme-card`, `aria-pressed` = it is the chosen theme for that mode, `data-theme-id` = its id, whose click calls `onApply` with `theme.light_theme` (or `dark_theme`) set to it. Inside: a `div` with class `adp-theme-preview` and `data-theme-preview` = the id, hidden from screen readers, holding (all `span`s) `adp-theme-preview-bar`, `adp-theme-preview-side`, and `adp-theme-preview-main`, which holds two `adp-theme-preview-line` spans (the second also `adp-theme-preview-line--short`), one `adp-theme-preview-row` and one `adp-theme-preview-accent`; then a `span` with class `adp-theme-card-name` and the theme's translated label.
   - The accent row moved from `SettingsView.tsx` unchanged.
3. `AppearanceSettings` (heading `settings.appearance`, id `adp-appearance-title`):
   - Row `settings.uiScale`: a native `select` (class `adp-defaultapps-select`, accessible name `settings.uiScale`, `data-appearance-field` `ui_scale`) with one option per `UI_SCALES` entry (text `settings.uiScaleValue` with `value`), changing `appearance.ui_scale` (as a number).
   - Rows `settings.density`, `settings.cornerRadius`, `settings.animations`: each a `div.adp-button-row` of three `Button`s (variant `primary` when chosen, else `default`; `aria-pressed`), with `data-appearance-<field>` = the value (`data-appearance-density`, `data-appearance-radius`, `data-appearance-animations`), texts from the `settings.density*`, `settings.radius*`, `settings.animations*` keys in the order of `DENSITIES`, `CORNER_RADII`, `ANIMATION_LEVELS`; each click changes that field. Under the animations row, a note (`p.adp-note`) `settings.animationsNote`.
4. `SettingsView.tsx`: remove the rows that moved; show `GeneralSettings`, `AppearanceSettings` and `ThemeSettings` (in that order) before the Layout section, with `settings`, `onApply` and `onOpenHelpPage`. The rest stays until T7.

**Do this (`settings.css`):** add

| Selector | Layout | Size and spacing | Look |
|---|---|---|---|
| `.adp-theme-cards` | flex row, wrapping | gap `--adp-space-5` | |
| `.adp-theme-card` | flex column, items stretch | width 148 px; padding `--adp-space-2`; gap `--adp-space-2` | background `--adp-color-surface-window`; border 1 px `--adp-color-border-default`; corner radius `--adp-radius-lg`; pointer cursor; text `--adp-color-text-primary` |
| `.adp-theme-card[aria-pressed="true"]` | | | border 2 px `--adp-accent-current` (keep the size: 1 px less padding) |
| `.adp-theme-card:focus-visible` | | | outline 2 px `--adp-accent-current`, offset 2 px |
| `.adp-theme-preview` | a grid of two columns (28 px, the rest) and two rows (10 px, the rest) | height 80 px; overflow hidden | background `--adp-color-surface-window`; border 1 px `--adp-color-border-default`; corner radius `--adp-radius-sm` |
| `.adp-theme-preview-bar` | spans both columns of the first row | | background `--adp-color-surface-chrome` |
| `.adp-theme-preview-side` | second row, first column | | background `--adp-color-surface-pane`; right border 1 px `--adp-color-border-default` |
| `.adp-theme-preview-main` | second row, second column; flex column | padding 6 px; gap 4 px | |
| `.adp-theme-preview-line` | | height 4 px; width 80 % | background `--adp-color-text-primary`; corner radius 2 px |
| `.adp-theme-preview-line--short` | | width 50 % | background `--adp-color-text-secondary` |
| `.adp-theme-preview-row` | | height 10 px | background `--adp-color-surface-selected-row`; corner radius 2 px |
| `.adp-theme-preview-accent` | aligned to the start | width 28 px; height 8 px | background `--adp-accent-explorer`; corner radius 4 px |
| `.adp-theme-card-name` | | | font size `--adp-font-body`; centered |

**Tests:**

`src/__tests__/themeSettings.test.tsx`:

| Test | Steps | Expected |
|---|---|---|
| "shows three cards per mode with live previews" | default settings | 6 `.adp-theme-card`; each holds a `[data-theme-preview]` with its own id; the `light` and `dark` cards are pressed |
| "choosing a card sets the theme for that mode" | click the `paper` card; then the `amoled` card | `onApply` got `light_theme` `paper`; then `dark_theme` `amoled` |
| "mode buttons keep working" | click the button with `data-theme-mode` `dark` | `onApply` got mode `dark` |

`src/__tests__/appearanceSettings.test.tsx`:

| Test | Steps | Expected |
|---|---|---|
| "changes the UI scale" | change the `ui_scale` select to 150 | `onApply` got `ui_scale` 150 (a number) |
| "density, corners and animations" | click `data-appearance-density` `compact`; `data-appearance-radius` `square`; `data-appearance-animations` `reduced` | three calls with those values; the default buttons (`comfortable`, `standard`, `full`) were pressed before |

**Commit:** `feat(settings): General, Theme and Appearance sections [step-05d/T6]`

### T7 - The Settings page: search, sections, resets

**Files:** create `src/views/settings/sections.ts`, `src/__tests__/settingsSections.test.ts`, `src/__tests__/settingsView.test.tsx`; modify `src/views/SettingsView.tsx`, `src/styles/settings.css`, `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`).

**Translation keys:** `settings.search`, `settings.noResults`, `settings.sections`, `settings.resetSection`, `settings.resetAll`, `settings.resetAllTitle`, `settings.resetAllBody`, `settings.resetConfirm`, `settings.sectionWasReset`, `settings.allWereReset`.

**Do this (`sections.ts`):** module doc comment "The Settings page's sections (Step 05d): search words and resets. Pure." Exports:

| Export | Kind | Content / behavior |
|---|---|---|
| `SettingsSectionId` | type | the six ids of the "Settings sections" table |
| `SETTINGS_SECTIONS` | read-only list | `{ id, titleKey, helpSlug, keywordKeys }` per table row, in table order |
| `plainSearchText` | (`text: string`) returns string | NFD form without combining marks, lower case, trimmed |
| `sectionMatches` | (`section`, `query: string`, `t`: a function from key to text) returns boolean | an empty `plainSearchText(query)` matches; otherwise true when `plainSearchText` of the title or of any keyword's text contains it |
| `resetSection` | (`id`, `settings: AppSettings`) returns `AppSettings` | a copy where only that section's settings are defaults: `general`: `files`; `appearance`: `appearance`; `theme`: `theme`; `layout`: `layout` with the same `saved_presets`; `views`: in `explorer`, `view_mode`, `remember_view_per_folder`, `view_mode_order`, `hidden_view_modes`, `column_width`, `column_preview`; `openingFiles`: `open` |
| `resetAllSettings` | (`settings`) returns `AppSettings` | `defaultSettings()` with the same `language` and the same `layout.saved_presets` |

**Do this (`SettingsView.tsx`):**

1. States: `query` (string), `undo` (an object with `previous` (`AppSettings`) and `message` (a translated string), or `null`), `confirmReset` (boolean).
2. A helper `applyWithUndo(next, message)`: remember the current settings and the message in `undo`, then `onApply(next)`.
3. Markup, inside the existing `div.adp-settings`:
   - The header as today (title and `HelpButton`).
   - When `undo` is set: a `div` with class `adp-settings-notice` and `role="status"`: the message, a `Button` (variant `subtle`) `common.undo` that calls `onApply(undo.previous)` and clears `undo`, and a `Button` (variant `subtle`) `common.dismiss` that clears it.
   - A `SearchBox` (inside a `div` with class `adp-settings-search`) with `query` and the placeholder `settings.search`.
   - A `div` with class `adp-settings-body` holding a `nav` (class `adp-settings-nav`, `aria-label` `settings.sections`) and a `div` with class `adp-settings-content`.
   - The shown sections are those of `SETTINGS_SECTIONS` that `sectionMatches` the query. The `nav` has one `button` (class `adp-settings-nav-item`) per shown section with its title; a click scrolls the section's block into view (`scrollIntoView` with `block` `start`, called only when it exists: jsdom has none).
   - The content has, per shown section, a `div` with class `adp-settings-block` and `id` `adp-settings-<id>`, holding the section's component (General, Appearance, Theme, Layout (05c), Views (05a), Opening files (04c), with the same props as before) and then a `div.adp-settings-block-actions` with a `Button` (variant `subtle`) `settings.resetSection`, whose click calls `applyWithUndo(resetSection(id, settings), t("settings.sectionWasReset", { name: <the section's title> }))`.
   - When no section is shown: a `p.adp-empty-note` `settings.noResults`.
   - At the end (always): a `div.adp-settings-footer` with a `Button` `settings.resetAll` that sets `confirmReset`, and the existing `settings.persistNote` note. (T8 adds the backup buttons here.)
   - When `confirmReset`: a `Dialog` with title `settings.resetAllTitle`, the text `settings.resetAllBody` in a `p`, and `div.adp-dialog-actions` with a primary `Button` `settings.resetConfirm` (calls `applyWithUndo(resetAllSettings(settings), t("settings.allWereReset"))` and closes) and a `Button` `common.cancel`.

**Do this (`settings.css`):** add

| Selector | Layout | Size and spacing | Look |
|---|---|---|---|
| `.adp-settings` | (change) max width 920 px | | |
| `.adp-settings-search` | | width min(360 px, 100 %) | |
| `.adp-settings-search .adp-search` | | full width; height 32 px | |
| `.adp-settings-body` | flex row, items at the top | gap `--adp-space-8` | |
| `.adp-settings-nav` | flex column; stays in view while scrolling (sticky at the top) | width 180 px; gap 2 px; does not shrink | |
| `.adp-settings-nav-item` | content starts at the left | height 32 px; padding 0 `--adp-space-4` | no border; background transparent; corner radius `--adp-radius-sm`; text `--adp-color-text-primary`; pointer cursor |
| `.adp-settings-nav-item:hover` | | | background `--adp-color-surface-selected` |
| `.adp-settings-nav-item:focus-visible` | | | outline 2 px `--adp-accent-current`, offset -2 px |
| `.adp-settings-content` | flex column; grows (flex 1); may shrink (min-width 0) | max width 640 px; gap `--adp-space-6` | |
| `.adp-settings-block` | flex column | gap `--adp-space-3` | |
| `.adp-settings-block-actions` | flex row, ending at the right | | |
| `.adp-settings-notice` | flex row, items centered | gap `--adp-space-3`; padding `--adp-space-3` `--adp-space-5` | background `--adp-accent-light-explorer`; corner radius `--adp-radius-md`; text `--adp-color-text-primary` |
| `.adp-settings-footer` | flex column, items at the start | gap `--adp-space-4`; padding-top `--adp-space-6` | top border 1 px `--adp-color-border-panel` |
| below 720 px of window width (media query) | `.adp-settings-nav` is not shown | | |

**Tests:**

`src/__tests__/settingsSections.test.ts`:

| Test | Input | Expected |
|---|---|---|
| "plainSearchText ignores case and accents" | `"  Apariéncia "` | `"apariencia"` |
| "sectionMatches looks at titles and labels" | with `t` = the app's `i18n.t` in English: `appearance` with `"density"`; `appearance` with `"DENS"`; `theme` with `"amoled"`; `layout` with `"density"`; any section with `""` | true; true; true; false; true |
| "resetSection touches only its section" | settings with language `es`, `files.paste_image_format` `jpg`, `appearance.density` `compact`, `layout.toolbar_position` `left` and one saved preset, `explorer.view_mode` `tiles` and `explorer.show_hidden` true | `general`: paste `png`, language still `es`; `appearance`: density `comfortable`, toolbar still `left`; `layout`: toolbar `top`, the saved preset kept; `views`: view mode `details`, `show_hidden` still true |
| "resetAllSettings keeps the language and the saved presets" | the same settings | equals `defaultSettings()` except language `es` and the saved preset |

`src/__tests__/settingsView.test.tsx` (render `SettingsView` with default settings, a spy `onApply` that also re-renders with what it got, `onOpenHelp` and `onOpenHelpPage` spies):

| Test | Steps | Expected |
|---|---|---|
| "lists the six sections in order" | render | 6 `.adp-settings-nav-item` with the six titles in table order; 6 `.adp-settings-block` |
| "search keeps only the matching sections" | type `toolbar` in the search box; then `zzz` | only the Layout block and its nav item; then no block and the `settings.noResults` text |
| "a section reset can be undone" | click Appearance's density `compact`; click the Appearance block's `settings.resetSection` button; click Undo | density `compact`; then `comfortable` and the notice shows `settings.sectionWasReset` with "Appearance"; then `compact` again and no notice |
| "reset all asks first" | click `settings.resetAll`; click Cancel; open again and click `settings.resetConfirm` | no `onApply` after Cancel; then `onApply` got `resetAllSettings` of the settings and the notice shows `settings.allWereReset` |

**Commit:** `feat(settings): searchable Settings page with section resets [step-05d/T7]`

### T8 - Export and import the settings

**Files:** create `src-tauri/src/settings_file.rs`, `src/services/settingsFile.ts`, `src/__tests__/settingsFile.test.ts`; modify `src-tauri/src/main.rs`, `src-tauri/src/shell.rs`, `src-tauri/isolation/index.html`, `src/views/SettingsView.tsx`, `src/__tests__/settingsView.test.tsx`, `src/i18n/locales/en.json`, `src/i18n/locales/es.json` (then `npm run i18n:pseudo`).

**Translation keys:** `settings.backup`, `settings.export`, `settings.import`, `settings.exportTitle`, `settings.importTitle`, `settings.exportFileName`, `settings.fileFilter`, `settings.exported`, `settings.importConfirmTitle`, `settings.importConfirmBody`, `settings.importConfirm`, `settings.imported`, and every `errors.settingsFile.*` key.

**Do this (Rust):**

1. `shell.rs`: make `is_cancelled` and `hwnd_from` visible to the crate (`pub(crate)`); nothing else changes.
2. `settings_file.rs`, module doc comment "Export and import settings.json through the Windows file dialogs (Step 05d)." Constants: `MAX_SETTINGS_FILE` (`u64`, 1,048,576), `MAX_DIALOG_TEXT` (`usize`, 200). Pure functions with tests:

   | Function | Parameters | Returns | Behavior |
   |---|---|---|---|
   | `check_texts` | `title: &str`, `file_name: Option<&str>`, `filter_name: &str` | `Result<(), String>` | `settingsFile.bad_request` when the title or filter name is empty or longer than `MAX_DIALOG_TEXT` characters, or when a file name is given and it is longer than 255 characters, fails `fs_service::validate_new_name`, or does not end in `.json` (ignoring case) |
   | `check_export_path` | `path: &str` | `Result<(), String>` | `crate::validate_absolute_path` fails: `settingsFile.bad_request`; the extension is not `json` (ignoring case): `settingsFile.bad_extension` |
   | `parse_import` | `text: &str` | `Result<Settings, String>` | not JSON, or not an object: `settingsFile.invalid`; `schema_version` missing, not a whole number, or 0: `settingsFile.invalid`; above `crate::CURRENT_SCHEMA`: `settingsFile.newer`; otherwise `crate::migrate` of the value (an error gives `settingsFile.invalid`) |

3. Dialog helpers (Windows only, private, each with a `// SAFETY:` comment, following the COM pattern in `clipboard.rs`): run on the calling (blocking) thread: initialize COM apartment-threaded (uninitialize at the end only when it succeeded); create `FileSaveDialog` or `FileOpenDialog`; set the title, one file type (the filter name with the pattern `*.json`), the default extension `json`, and the options: save: the current options plus `FOS_OVERWRITEPROMPT`, `FOS_FORCEFILESYSTEM`, `FOS_PATHMUSTEXIST`; open: plus `FOS_FILEMUSTEXIST`, `FOS_FORCEFILESYSTEM`; for save also the suggested file name; `Show` with the owner window (`crate::shell::hwnd_from` of the handle); a cancelled dialog (`crate::shell::is_cancelled`) gives `None`; otherwise the result item's file-system path (`SIGDN_FILESYSPATH`). Any other COM error gives `settingsFile.other`.
4. Commands (async, `spawn_blocking` for the dialog and disk work, P-19; the owner handle from `crate::window_handle(&window)` before spawning):
   - `settings_export(window, state, title, file_name, filter_name)`: `ensure_main`; `check_texts(title, Some(file_name), filter_name)`; copy the current settings out of `AppState` (lock with `map_err`, then release). In the blocking task: show the save dialog (`None` returns `Ok(None)`); `check_export_path`; when the file exists, send it to the Recycle Bin with `fs_service::recycle_items` (one path, a new cancellation token, a progress callback that does nothing; the app crate has no direct `trash` dependency); when the report does not list it as completed (or the call fails): `settingsFile.recycle_failed`, and nothing is written; write the pretty JSON with `crate::atomic_write` (`settingsFile.write_failed`); return the path without the `\\?\` prefix.
   - `settings_import(window, title, filter_name)`: `ensure_main`; `check_texts(title, None, filter_name)`. In the blocking task: show the open dialog (`None` returns `Ok(None)`); the file's size above `MAX_SETTINGS_FILE`: `settingsFile.too_large`; read it as text (a read or UTF-8 error: `settingsFile.invalid`); return `parse_import` of it. Nothing is saved here.
5. `main.rs`: `mod settings_file;`, both commands in `generate_handler!`; `src-tauri/isolation/index.html`: add `'settings_export'` and `'settings_import'` to `ALLOWED`.

Rust tests (bottom of `settings_file.rs`):

| Test | Input | Expected |
|---|---|---|
| `parse_import_accepts_current_and_older_files` | the JSON of `Settings::default()`; `{"schema_version":2,"language":"es","theme":{"mode":"dark"}}` | equals the default; language `es`, theme mode `dark`, schema `CURRENT_SCHEMA` |
| `parse_import_refuses_other_files` | `not json`; `[1,2]`; `{"language":"es"}`; `{"schema_version":0}`; schema `CURRENT_SCHEMA + 1` | `invalid`; `invalid`; `invalid`; `invalid`; `newer` (all `settingsFile.*`) |
| `check_texts_and_paths` | title `Export`, file `s.json`, filter `Settings`; file `s.txt`; file `CON.json`; an empty title; path `C:\x\s.json`; `C:\x\s.JSON`; `C:\x\s.txt`; `relative.json` | ok; `bad_request`; `bad_request`; `bad_request`; ok; ok; `bad_extension`; `bad_request` |

**Do this (TypeScript, `src/services/settingsFile.ts`):**

| Export | Behavior |
|---|---|
| `isoDate(date: Date)` | the local date as `YYYY-MM-DD` (`2026-03-07` for 7 March 2026) |
| `exportSettings(title, fileName, filterName)`, returns `Promise<string \| null>` | outside Tauri: `null`; otherwise `settings_export` with `{ title, fileName, filterName }` |
| `importSettings(title, filterName)`, returns `Promise<AppSettings \| null>` | outside Tauri: `null`; otherwise `settings_import` with `{ title, filterName }`, and `normalizeSettings` of the result when it is not `null` |

**Do this (`SettingsView.tsx`):**

1. A new state `message` (string or `null`): when it is set and `undo` is `null`, the same `div.adp-settings-notice` shows it with only the `common.dismiss` button (which clears it). Setting `undo` clears `message`, and setting `message` clears `undo`.
2. In `div.adp-settings-footer`, before the reset-all button: an `h3` (class `adp-heading`) `settings.backup` and a `div.adp-button-row` with two `Button`s:
   - `settings.export`: calls `exportSettings(t("settings.exportTitle"), t("settings.exportFileName", { date: isoDate(new Date()) }), t("settings.fileFilter"))`; a returned path sets `message` to `settings.exported` with `path`; `null` (cancelled) does nothing; a failure sets `message` to `errorText(t, error, "settingsFile")`.
   - `settings.import`: calls `importSettings(t("settings.importTitle"), t("settings.fileFilter"))`; returned settings go into a state `pendingImport` and show a `Dialog` (title `settings.importConfirmTitle`, the text `settings.importConfirmBody` in a `p`, a primary `Button` `settings.importConfirm` that calls `applyWithUndo(pendingImport, t("settings.imported"))` and closes, and a `Button` `common.cancel` that clears `pendingImport`); `null` does nothing; a failure sets `message` to the error text.

**Tests:**

`src/__tests__/settingsFile.test.ts`: "isoDate pads month and day": `new Date(2026, 2, 7)` gives `2026-03-07`; "export and import do nothing outside the app": both resolve to `null`.

`src/__tests__/settingsView.test.tsx`: add "the backup buttons are there": the `settings.export` and `settings.import` buttons exist inside `.adp-settings-footer`.

**Traps:**
- The exported file is written only after the old file is in the Recycle Bin; if recycling fails, nothing is written (R-SAFE-2).
- Imported settings are applied through `onApply`, so Rust validates them again when saving (R-SEC-1).
- The dialog's title and filter name are UI text: they come from the translation files and are passed to Rust; Rust never makes up display text (R-LANG-7).

**Commit:** `feat(settings): export and import the settings file [step-05d/T8]`

### T9 - Help pages

**Files:** create `help/en/themes-and-appearance.md`, `help/es/themes-and-appearance.md`, `help/en/the-settings-page.md`, `help/es/the-settings-page.md`; modify `help/en/changing-language-and-theme.md`, `help/es/changing-language-and-theme.md`, `src/App.tsx`.

**Do this:**
1. Create the four pages and replace the two `changing-language-and-theme.md` pages with the exact texts in "Help pages".
2. `App.tsx`: `HELP_SLUGS.settings` becomes `the-settings-page`, and the `SettingsView`'s `onOpenHelp` opens `the-settings-page`.

**Tests:** none new (the gate checks that every page exists in both languages).

**Commit:** `docs(help): themes, appearance and the Settings page [step-05d/T9]`

### T10 - OWNER CHECKPOINT: the new themes

**Files:** modify `scripts/measure-ui.mjs`.

The owner asked to see the themes before they are final.

**Do this:**

1. In the screenshot part, after Step 05c's last action (Settings back to the Standard preset, Explorer shown), add these steps (each through the `step` helper). First open Settings (`window.__m.openSettings()`, wait 300 ms) and remember which `[data-theme-mode]` button has `aria-pressed` true.
   - Click `[data-theme-mode="light"]`, then the card `[data-theme-id="bright"]`; open the Explorer (`window.__m.openExplorer()`), click the third item, wait 300 ms; shot `31-theme-bright`.
   - The same with the card `paper`; shot `32-theme-paper`.
   - Click `[data-theme-mode="dark"]` and the card `amoled`; Explorer; shot `33-theme-amoled`.
   - The same with `highContrast`; shot `34-theme-high-contrast`.
   - Settings: cards `light` and `dark`, the remembered mode button, `[data-appearance-density="compact"]`; Explorer; shot `35-density-compact`.
   - Settings: `[data-appearance-density="spacious"]`; Explorer; shot `36-density-spacious`.
   - Settings: `[data-appearance-density="comfortable"]`; wait 300 ms; shot `37-settings-page`; type `theme` into the Settings search box (native value setter and a bubbling `input` event); wait 200 ms; shot `38-settings-search`; clear the search the same way; open the Explorer.
2. Run the gate, commit, run `.\scripts\gate.ps1 -Package`, and take the screenshots in English light and Spanish dark into `docs/screenshots/step-05d/`.

**OWNER CHECKPOINT:** tell the owner "The new themes are ready to look at", list the eight screenshot files with their full paths, and ask for approval. Stop and wait. Color changes the owner asks for are tasks `F1`, `F2`... before T11: change the token files only, run `npm run tokens`, and keep the T2 contrast test passing (if a wished color fails it, tell the owner the contrast number and ask).

**Commit:** `test(screens): theme and density screenshots [step-05d/T10]`

### T11 - Speed measurements and design notes

**Files:** modify `scripts/measure-ui.mjs`, `DESIGN_DEVIATIONS.md`.

**Do this:**

1. The record's step value `05c` becomes `05d`.
2. In the full mode, after Step 05c's measurements, open Settings once (`openSettings()`, wait 300 ms) and remember the pressed `[data-theme-mode]` button; add two measurements with the `measure` helper, then click the remembered mode button and open the Explorer:

   | Name | Setup | Action | Cleanup |
   |---|---|---|---|
   | `switch to the dark theme (Settings)` | click `[data-theme-mode="light"]` | click `[data-theme-mode="dark"]` | `true` |
   | `change the density (Settings)` | click `[data-appearance-density="comfortable"]` | click `[data-appearance-density="spacious"]` | click `[data-appearance-density="comfortable"]` |

3. `DESIGN_DEVIATIONS.md`: a section dated with the day you write it, "Themes and appearance (Step 05d)": the Figma file has only the light theme; Bright, Paper, AMOLED black and High contrast were designed in this step (values in `themes/*.tokens.json`), the dark theme's text on the accent became black for contrast, density and corner radius change the measured spacing and radii, and the owner approved them at the checkpoint (with any changes listed).

**Tests:** none (the script runs in AGENTS.md section 4, C.3 and C.4).

**Commit:** `test(speed): theme and density measurements, design notes [step-05d/T11]`

## Help pages

### New page `help/en/themes-and-appearance.md` (exact text)

```markdown
# Themes and appearance

Change the colors of the app and how big and roomy it looks. Every change shows at once.

## Choose a theme

1. Open **Settings** and go to **Theme**.
2. Choose a mode: **System** follows your Windows setting, **Light** and **Dark** always use one of them.
3. Under **Theme in light mode**, click a card: **Adperastra light** (the standard look), **Bright** (crisper and whiter) or **Paper** (warm and soft on the eyes).
4. Under **Theme in dark mode**, click a card: **Adperastra dark**, **AMOLED black** (pure black, good for OLED screens) or **High contrast** (the strongest contrast, for easier reading).

Each card shows a small preview of the theme. The **Accent** color works with every theme.

## Size, spacing and corners

In **Settings** > **Appearance**:

- **UI scale** makes everything bigger or smaller, from 75% to 200%.
- **Density** sets the space around things and the height of the rows in lists: **Compact**, **Comfortable** (standard) or **Spacious**.
- **Corner radius** makes corners **Square**, **Standard** or **Round**.
- **Animations**: **Full**, **Reduced** (no repeating effects) or **Off**. When Windows is set to show fewer animations, the app always follows it.

## Good to know

- The **High contrast** theme is part of the app. To use Windows' own high contrast themes everywhere, turn them on in Windows Settings.
- To go back to the standard look, click **Reset to default** under **Theme** or **Appearance**.
- Themes and appearance only change how the app looks. They never change your files.

See also: "The Settings page" and "Changing language and theme".
```

### New page `help/es/themes-and-appearance.md` (exact text)

```markdown
# Temas y apariencia

Cambia los colores de la aplicación y qué tan grande y espaciosa se ve. Cada cambio se muestra al instante.

## Elegir un tema

1. Abre **Configuración** y ve a **Tema**.
2. Elige un modo: **Sistema** sigue tu configuración de Windows; **Claro** y **Oscuro** usan siempre uno de los dos.
3. En **Tema en modo claro**, haz clic en una tarjeta: **Adperastra claro** (el aspecto estándar), **Luminoso** (más nítido y blanco) o **Papel** (cálido y suave para la vista).
4. En **Tema en modo oscuro**, haz clic en una tarjeta: **Adperastra oscuro**, **Negro AMOLED** (negro puro, ideal para pantallas OLED) o **Contraste alto** (el mayor contraste, para leer con más facilidad).

Cada tarjeta muestra una pequeña vista previa del tema. El **Color de énfasis** funciona con todos los temas.

## Tamaño, espacio y esquinas

En **Configuración** > **Apariencia**:

- **Escala de la interfaz** agranda o achica todo, del 75 % al 200 %.
- **Densidad** define el espacio alrededor de los elementos y la altura de las filas de las listas: **Compacta**, **Cómoda** (estándar) o **Amplia**.
- **Radio de las esquinas** hace que las esquinas sean **Cuadradas**, **Estándar** o **Redondeadas**.
- **Animaciones**: **Completas**, **Reducidas** (sin efectos que se repiten) o **Desactivadas**. Cuando Windows está configurado para mostrar menos animaciones, la aplicación siempre lo respeta.

## Para tener en cuenta

- El tema **Contraste alto** es parte de la aplicación. Para usar los temas de contraste alto de Windows en todas partes, actívalos en la Configuración de Windows.
- Para volver al aspecto estándar, haz clic en **Restablecer valores predeterminados** debajo de **Tema** o **Apariencia**.
- Los temas y la apariencia solo cambian cómo se ve la aplicación. Nunca cambian tus archivos.

Consulta también: «La página de configuración» y «Cambiar idioma y tema».
```

### New page `help/en/the-settings-page.md` (exact text)

```markdown
# The Settings page

All the app's options in one place. Changes apply at once and are saved automatically.

## Find a setting

- Open **Settings** with the gear button at the top right.
- Type in **Find a setting** to keep only the sections that match, for example "toolbar" or "theme".
- Click a section in the list on the left to jump to it.
- The **?** button of each section opens its help page.

## Undo a change of mind

- **Reset to default**, under each section, puts only that section back to its standard values. **General** keeps your language, and **Layout** keeps your saved presets.
- **Reset all settings…** asks first, then puts every setting back to its standard value, except your language and your saved layout presets.
- After a reset, a message offers **Undo**: click it to get back the settings you had just before.

## Back up and restore

- **Export settings…** saves your settings to a file you choose, for example to copy them to another PC. If a file with that name exists, Windows asks before replacing it, and the old file goes to the Recycle Bin.
- **Import settings…** reads a settings file and asks before using it. Right after, **Undo** brings your previous settings back.
- Settings files from an older version of the app work. Files from a newer version need an updated app.

## Good to know

- Your settings are saved in a file on this PC only. Nothing is sent anywhere.
- Exporting and importing only touch the settings file you choose. Your other files are never changed.

See also: "Themes and appearance", "Moving toolbars and panels" and "Views: icons, list, details, tiles, content and columns".
```

### New page `help/es/the-settings-page.md` (exact text)

```markdown
# La página de configuración

Todas las opciones de la aplicación en un solo lugar. Los cambios se aplican al instante y se guardan automáticamente.

## Buscar una opción

- Abre **Configuración** con el botón del engranaje, arriba a la derecha.
- Escribe en **Buscar una opción** para dejar solo las secciones que coinciden, por ejemplo "barra" o "tema".
- Haz clic en una sección de la lista de la izquierda para ir a ella.
- El botón **?** de cada sección abre su página de ayuda.

## Si cambias de idea

- **Restablecer valores predeterminados**, debajo de cada sección, devuelve solo esa sección a sus valores estándar. **General** conserva tu idioma y **Diseño** conserva tus diseños guardados.
- **Restablecer toda la configuración…** pregunta primero y luego devuelve todas las opciones a sus valores estándar, excepto tu idioma y tus diseños guardados.
- Después de restablecer, un mensaje ofrece **Deshacer**: haz clic para recuperar la configuración que tenías justo antes.

## Copia de seguridad y restauración

- **Exportar la configuración…** guarda tu configuración en un archivo que eliges, por ejemplo para copiarla a otra computadora. Si ya existe un archivo con ese nombre, Windows pregunta antes de reemplazarlo, y el archivo anterior va a la Papelera de reciclaje.
- **Importar la configuración…** lee un archivo de configuración y pregunta antes de usarlo. Justo después, **Deshacer** recupera tu configuración anterior.
- Los archivos de configuración de una versión anterior de la aplicación funcionan. Los de una versión más reciente necesitan que actualices la aplicación.

## Para tener en cuenta

- Tu configuración se guarda solo en un archivo de esta computadora. No se envía a ningún lado.
- Exportar e importar solo usan el archivo de configuración que eliges. Tus demás archivos nunca cambian.

Consulta también: «Temas y apariencia», «Mover barras de herramientas y paneles» y «Vistas: iconos, lista, detalles, mosaicos, contenido y columnas».
```

### New text of `help/en/changing-language-and-theme.md` (replace the whole page)

```markdown
# Changing language and theme

Open the **Settings** tab to change these options. Changes apply at once; you don't need to restart the app.

## Language

In **General**, choose **English** or **Español**. If a word is missing in your language, the app shows it in English.

## Theme

In **Theme**, choose **System** (follows your Windows setting), **Light** or **Dark**, and pick the theme each mode uses from the cards. See "Themes and appearance" for every theme.

## Accent color

Also in **Theme**: the color from the design, from Windows, or a custom color you pick.

Settings are saved automatically in a file on your PC.

See also: "Themes and appearance" and "The Settings page".
```

### New text of `help/es/changing-language-and-theme.md` (replace the whole page)

```markdown
# Cambiar idioma y tema

Abre la pestaña **Configuración** para cambiar estas opciones. Los cambios se aplican al instante; no necesitas reiniciar la aplicación.

## Idioma

En **General**, elige **English** o **Español**. Si falta una palabra en tu idioma, la aplicación la muestra en inglés.

## Tema

En **Tema**, elige **Sistema** (sigue tu configuración de Windows), **Claro** u **Oscuro**, y elige en las tarjetas el tema que usa cada modo. Consulta «Temas y apariencia» para ver todos los temas.

## Color de énfasis

También en **Tema**: el color del diseño, el de Windows o un color personalizado que elijas.

La configuración se guarda automáticamente en un archivo de tu computadora.

Consulta también: «Temas y apariencia» y «La página de configuración».
```

## Check by hand (the owner, in the packaged app)

No special test files are needed: use any folder (for example `%TEMP%\adp-05b` from Step 05b) and a text file.

1. Settings > **Theme**: six cards with previews. Click each light card in Light mode and each dark card in Dark mode: the whole app changes at once (Explorer, a text file tab, menus, dialogs, scrollbars, focus outlines).
2. **System** mode: change Windows between light and dark: the app follows with the chosen light and dark themes.
3. **High contrast**: every text is easy to read; selected rows and focus outlines are clearly visible.
4. Settings > **Appearance** > **UI scale**: 75 %, 125 %, 200 %: everything scales; menus open where you click; right-click > **Show more options** opens at the pointer; restart the app: it starts at the chosen scale without a jump.
5. **Density** Compact and Spacious: rows in Details, List and Columns change height; scrolling and arrow keys still work; the navigation pane follows.
6. **Corner radius** Square and Round; **Animations** Off: no shimmer on loading rows, switches flip without animation.
7. Search for "toolbar", "densidad" (in Spanish), "amoled": only matching sections stay. Click a section in the left list: the page jumps there.
8. **Reset to default** under Appearance after changing it: back to standard; **Undo** brings your changes back. **Reset all settings…**: asks first; afterwards the language is unchanged; **Undo** works.
9. **Export settings…** to the Desktop: a `.json` file appears; export again with the same name: Windows asks; the old file is in the Recycle Bin. Change a few settings, **Import settings…** that file: it asks first, then the old settings return; **Undo** works. Try importing a text file renamed to `.json`: a clear message, nothing changes.
10. Repeat checks 1, 4 and 7 in Spanish and in the dark theme.

## Speed

| Interaction | Tier | How measured |
|---|---|---|
| Switch the theme | Fast (1 s) | `switch to the dark theme (Settings)` |
| Change the density | Fast (1 s) | `change the density (Settings)` |
| Change the UI scale | Fast (1 s) | by hand (check 4) |
| Search in Settings while typing | Instant (0.1 s) | by hand (check 7) |
| Every existing measurement | as before | not more than 20% slower than step 05c's JSON |

## Screenshots

`31-theme-bright`, `32-theme-paper`, `33-theme-amoled`, `34-theme-high-contrast`, `35-density-compact`, `36-density-spacious`, `37-settings-page`, `38-settings-search` (added in T10), in English light, Spanish dark and the pseudo-locale, in `docs/screenshots/step-05d/`.

## Done when

- [ ] T1 to T11 are committed, each after `GATE PASSED`, and the owner approved the themes at the T10 checkpoint.
- [ ] Six themes, chosen per mode, apply everywhere at once and pass the contrast test.
- [ ] UI scale, density, corner radius and animations work and survive a restart; the app starts at the saved scale.
- [ ] The Settings page searches, jumps to sections, resets a section or everything with Undo, and exports and imports the settings file safely.
- [ ] Settings schema 9 loads a schema-8 file without losing anything (Rust test `settings_v8_migrates_to_v9_keeping_language_and_theme`).
- [ ] Every existing test passes unchanged except where T1 says.
- [ ] The speed table rows meet their tiers; the screenshots exist; `DESIGN_DEVIATIONS.md` has the new section; the step report is written.
